'use strict';

const {
    hasOperationalAttendanceState
} = require('../utils/inactiveWorkerPolicy');
const {
    repairRawAttendanceRows,
    buildRawAttendanceRepairSignature,
    formatRawAttendanceRepairSummary
} = require('../services/rawAttendanceRepairService');
const {
    runOpsQueueAutoRecovery
} = require('../services/opsQueueAutoRecoveryService');

function createOpsMonitoringWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        padWidth,
        truncateWidth,
        renderEmbedCodeBlock,
        safeAddFields,
        getAttendanceData,
        getOvertimeUsers,
        getDayOffReservations,
        getDashboardName,
        getActiveLiveException,
        getMemberShiftRole,
        getOperationalShift,
        setOvertimeUsers = null,
        saveSystemAsync = async () => {},
        transitionRecordedStatus = null,
        opsQueueService,
        purchaseSheetService,
        rawAttendanceSheetService = null,
        attendanceAutoRepairService = null,
        selfHealingSupervisorService = null,
        retryQueuedItem,
        alertState,
        logger = console
    } = deps;
function collectDataAuditIssues() {
    const issues = [];
    for (const user of Object.values(getAttendanceData())) {
        if (user.checkedIn && user.dayOff) issues.push(`${user.name}: checkedIn=true + dayOff=true`);
        if (user.checkedIn && user.isFinished) issues.push(`${user.name}: checkedIn=true + isFinished=true`);
        if (user.disconnected && !user.checkedIn) issues.push(`${user.name}: disconnected=true but checkedIn=false`);
        if (!user.shift && (user.checkedIn || user.dayOff || user.disconnected)) issues.push(`${user.name}: active state without shift`);
        if ((user.offCount || 0) < 0) issues.push(`${user.name}: offCount is negative`);
        if ((user.points || 0) !== Number(user.points || 0)) issues.push(`${user.name}: points is invalid`);
    }

    const duplicateDayOffs = new Map();
    for (const r of Object.values(getDayOffReservations())) {
        if (!r || !['pending', 'approved'].includes(r.status)) continue;
        const key = `${r.userId}:${r.leaveDate}:${r.shift}`;
        duplicateDayOffs.set(key, (duplicateDayOffs.get(key) || 0) + 1);
    }
    for (const [key, count] of duplicateDayOffs.entries()) {
        if (count > 1) issues.push(`duplicate day off reservation: ${key} (${count})`);
    }

    return issues;
}

function makeOperationalIssue(code, detail, severity = 'WARN') {
    return { code, detail, severity };
}

const OPERATIONAL_ISSUE_LABELS = {
    'data-state': '저장상태 이상',
    'saved-user-missing': '퇴사자/멤버 없음',
    'server-role-conflict': '서버 역할 중복',
    'shift-role-conflict': '근무조 역할 중복',
    'worker-role-incomplete': '역할군 누락',
    'saved-shift-mismatch': '저장 근무조 불일치',
    'nickname-shift-mismatch': '닉네임 근무조 불일치',
    'nickname-server-mismatch': '닉네임 서버 불일치',
    'worker-data-missing': '근무자 데이터 없음',
    'dashboard-duplicate': '현황판 중복 표시',
    'overtime-missing-user': '연장 데이터 사용자 없음',
    'overtime-dayoff': '휴무 중 연장',
    'overtime-finished': '퇴근 후 연장 상태',
    'overtime-not-working': '연장 상태 불일치',
    'working-role-extra': 'WORKING 역할 과다',
    'working-role-missing': 'WORKING 역할 누락',
    'dayoff-working-role': '휴무자 WORKING 역할',
    'shift-role-mismatch': '근무조 역할 불일치',
    'inactive-auto-archived': '자동 비활성 정리'
};

function issueLabel(code) {
    return OPERATIONAL_ISSUE_LABELS[code] || code;
}

function hasRole(member, roleId) {
    return Boolean(roleId && member?.roles?.cache?.has?.(roleId));
}

function getRoleProfile(member) {
    const hasValakas = hasRole(member, CONFIG.ROLES.HEINE);
    const hasPaagrio = hasRole(member, CONFIG.ROLES.PAAGRIO);
    const hasDay = hasRole(member, CONFIG.ROLES.DAY);
    const hasNight = hasRole(member, CONFIG.ROLES.NIGHT);
    return {
        hasValakas,
        hasPaagrio,
        hasDay,
        hasNight,
        server: hasValakas && !hasPaagrio ? 'VALAKAS' : (hasPaagrio && !hasValakas ? 'PAAGRIO' : null),
        shift: hasDay && !hasNight ? 'day' : (hasNight && !hasDay ? 'night' : null)
    };
}

function getNicknameProfile(member) {
    const text = String(member?.displayName || member?.nickname || member?.user?.username || '');
    const match = text.match(/\s[-\u2013\u2014]\s(?:.*?\s)?([PVH])\s*(Day|Night)\s*Time\b/i);
    if (!match) return null;
    return {
        server: match[1].toUpperCase() === 'P' ? 'PAAGRIO' : 'VALAKAS',
        shift: match[2].toLowerCase()
    };
}

function collectRoleNicknameDataMismatchIssues(guild) {
    const issues = [];
    const attendanceData = getAttendanceData();
    const members = guild?.members?.cache;
    if (!members) return issues;
    const overtimeIds = new Set(getOvertimeUsers().map(ot => ot.id).filter(Boolean));

    for (const [id, user] of Object.entries(attendanceData)) {
        const member = members.get(id);
        const isActiveSavedState = hasOperationalAttendanceState({ ...user, id }, overtimeIds);
        if (!member && isActiveSavedState) {
            issues.push(makeOperationalIssue('saved-user-missing', `${user?.name || id}: 저장된 출결 상태가 남아있지만 디스코드 멤버가 없습니다`));
        }
    }

    for (const member of members.values()) {
        if (!member || member.user?.bot) continue;
        const user = attendanceData[member.id] || null;
        const name = user ? getDashboardName(user) : (member.displayName || member.user?.username || member.id);
        const roleProfile = getRoleProfile(member);
        const nickProfile = getNicknameProfile(member);

        if (roleProfile.hasValakas && roleProfile.hasPaagrio) {
            issues.push(makeOperationalIssue('server-role-conflict', `${name}: 발라카스와 파아그리오 역할이 동시에 있습니다`));
        }
        if (roleProfile.hasDay && roleProfile.hasNight) {
            issues.push(makeOperationalIssue('shift-role-conflict', `${name}: 주간과 야간 역할이 동시에 있습니다`));
        }

        const hasAnyWorkerRole = roleProfile.hasValakas || roleProfile.hasPaagrio || roleProfile.hasDay || roleProfile.hasNight;
        const hasCompleteWorkerRole = Boolean(roleProfile.server && roleProfile.shift);
        if (hasAnyWorkerRole && !hasCompleteWorkerRole) {
            issues.push(makeOperationalIssue('worker-role-incomplete', `${name}: 서버 역할 또는 주간/야간 역할이 누락되었습니다`));
        }

        if (user?.shift && roleProfile.shift && user.shift !== roleProfile.shift) {
            issues.push(makeOperationalIssue('saved-shift-mismatch', `${name}: 저장 근무조=${user.shift}, 실제 역할 근무조=${roleProfile.shift}`));
        }

        if (nickProfile && roleProfile.shift && nickProfile.shift !== roleProfile.shift) {
            issues.push(makeOperationalIssue('nickname-shift-mismatch', `${name}: 닉네임 근무조=${nickProfile.shift}, 역할 근무조=${roleProfile.shift}`));
        }
        if (nickProfile && roleProfile.server && nickProfile.server !== roleProfile.server) {
            issues.push(makeOperationalIssue('nickname-server-mismatch', `${name}: 닉네임 서버=${nickProfile.server}, 역할 서버=${roleProfile.server}`));
        }

        if (hasCompleteWorkerRole && !user) {
            issues.push(makeOperationalIssue('worker-data-missing', `${name}: 역할은 있지만 저장된 출결 데이터가 아직 없습니다`));
        }
    }

    return issues;
}

function archiveMissingActiveUsers(guild, now = moment().tz(CONFIG.TIMEZONE)) {
    const attendanceData = getAttendanceData();
    const members = guild?.members?.cache;
    if (!members) return [];

    const overtimeIds = new Set(getOvertimeUsers().map(ot => ot.id).filter(Boolean));
    const archived = [];
    const archivedIds = new Set();

    for (const [id, user] of Object.entries(attendanceData)) {
        if (!user) continue;
        const member = members.get(id);
        if (member) continue;
        if (!hasOperationalAttendanceState({ ...user, id }, overtimeIds)) continue;

        const beforeStatus = user.attendanceStatus || null;
        user.id = user.id || id;
        user.checkedIn = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.pendingManualOT = false;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.pendingClockOut = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.isFinished = true;
        user.status = null;
        user.inactiveArchivedAt = now.toISOString();
        user.inactiveArchiveReason = 'discord-member-missing';

        if (typeof transitionRecordedStatus === 'function') {
            transitionRecordedStatus(user, {
                attendanceStatus: 'FINISHED',
                voiceStatus: 'OFFLINE'
            }, now, 'ops-auto-archive', 'discord-member-missing');
        } else {
            user.attendanceStatus = 'FINISHED';
            user.voiceStatus = 'OFFLINE';
        }

        archived.push(makeOperationalIssue(
            'inactive-auto-archived',
            `${user.name || id}: 디스코드 멤버가 없어 활성 출결 상태를 자동 비활성 처리했습니다 (${beforeStatus || '상태없음'} → FINISHED)`,
            'INFO'
        ));
        archivedIds.add(id);
    }

    if (archivedIds.size && typeof setOvertimeUsers === 'function') {
        setOvertimeUsers(getOvertimeUsers().filter(ot => !archivedIds.has(ot.id)));
    }

    return archived;
}

function collectDashboardGroupDuplicateIssues(groups = {}) {
    const buckets = [
        ['ACTIVE', groups.active],
        ['LIVE_EXCEPTION', groups.liveExceptionUsers],
        ['DISCONNECTED', groups.disconnected],
        ['LIVE_OFF', groups.liveOff],
        ['STANDBY', groups.standby],
        ['ABSENT', groups.absent],
        ['FINISHED', groups.finished],
        ['DAY_OFF', groups.leave],
        ['OVERTIME', groups.overtime]
    ];
    const seen = new Map();
    for (const [groupName, users] of buckets) {
        for (const user of users || []) {
            if (!user?.id) continue;
            const entry = seen.get(user.id) || { name: getDashboardName(user), groups: [] };
            entry.groups.push(groupName);
            seen.set(user.id, entry);
        }
    }
    return [...seen.values()]
        .filter(entry => entry.groups.length > 1)
        .map(entry => makeOperationalIssue('dashboard-duplicate', `${entry.name}: ${entry.groups.join(' + ')}`));
}

function collectOperationalIssues(guild, now = moment().tz(CONFIG.TIMEZONE), groups = null) {
    const issues = collectDataAuditIssues()
        .map(detail => makeOperationalIssue('data-state', detail));
    const overtimeIds = new Set(getOvertimeUsers().map(ot => ot.id));

    for (const ot of getOvertimeUsers()) {
        const user = getAttendanceData()[ot.id];
        const name = user ? getDashboardName(user) : (ot.name || ot.id);
        if (!user) {
            issues.push(makeOperationalIssue('overtime-missing-user', `${name}: 연장근무 데이터는 있지만 출결 사용자 데이터가 없습니다`));
            continue;
        }
        if (user.dayOff) issues.push(makeOperationalIssue('overtime-dayoff', `${name}: 휴무 상태인데 연장근무 데이터가 남아있습니다`));
        if (user.isFinished) issues.push(makeOperationalIssue('overtime-finished', `${name}: 퇴근 완료 상태인데 연장근무 데이터가 남아있습니다`));
        if (!user.checkedIn && !user.pendingManualOT) issues.push(makeOperationalIssue('overtime-not-working', `${name}: 출근 상태가 아닌데 연장근무 데이터가 남아있습니다`));
    }

    const activeShift = getOperationalShift(now);
    if (groups) issues.push(...collectDashboardGroupDuplicateIssues(groups));

    if (guild?.members?.cache) {
        issues.push(...collectRoleNicknameDataMismatchIssues(guild));

        for (const member of guild.members.cache.values()) {
            if (!member || member.user?.bot) continue;
            const user = getAttendanceData()[member.id];
            const name = user ? getDashboardName(user) : (member.displayName || member.user?.username || member.id);
            const hasWorkingRole = Boolean(CONFIG.ROLES.WORKING && member.roles?.cache?.has(CONFIG.ROLES.WORKING));
            const shouldHaveWorkingRole = Boolean(user?.checkedIn && !user?.dayOff && !user?.isFinished);
            if (hasWorkingRole && !shouldHaveWorkingRole) {
                issues.push(makeOperationalIssue('working-role-extra', `${name}: 실제 근무 상태가 아닌데 WORKING 역할이 남아있습니다`));
            }
            if (!hasWorkingRole && shouldHaveWorkingRole) {
                issues.push(makeOperationalIssue('working-role-missing', `${name}: 근무 중인데 WORKING 역할이 없습니다`));
            }
            if (hasWorkingRole && user?.dayOff) {
                issues.push(makeOperationalIssue('dayoff-working-role', `${name}: 휴무자인데 WORKING 역할이 남아있습니다`));
            }
            const memberShift = getMemberShiftRole(member);
            const hasLiveException = Boolean(getActiveLiveException(member.id, now));
            if (
                activeShift &&
                hasWorkingRole &&
                memberShift &&
                memberShift !== activeShift &&
                !overtimeIds.has(member.id) &&
                !hasLiveException
            ) {
                issues.push(makeOperationalIssue('shift-role-mismatch', `${name}: 현재 ${activeShift} 운영 시간인데 멤버 역할은 ${memberShift}입니다`));
            }
        }
    }

    return issues.slice(0, 50);
}

function formatOperationalIssueRows(issues, limit = 8) {
    if (!issues.length) return '운영 점검 문제 없음';
    return issues.slice(0, limit).map(issue => {
        const label = padWidth(truncateWidth(issueLabel(issue.code), 16), 17);
        return `${label} ${truncateWidth(issue.detail, 68)}`;
    }).join('\n');
}

async function fetchOpsAlertChannel() {
    const channelId = CONFIG.LOG_CHANNEL || CONFIG.DAYOFF_CHANNEL || CONFIG.ANNOUNCE_CHANNEL || CONFIG.DAY_CHAN || CONFIG.NIGHT_CHAN;
    return channelId ? client.channels.fetch(channelId).catch(() => null) : null;
}

function buildOpsQueueResultSignature(summary, pendingAfter) {
    const pendingSignature = (pendingAfter || [])
        .map(item => `${item.id}:${item.status || 'pending'}:${item.lastCode || item.code || item.lastError || 'pending'}:${item.nextAttemptAt || '-'}`)
        .sort()
        .join('|');
    return [
        summary?.retried || 0,
        summary?.succeeded || 0,
        summary?.failed || 0,
        summary?.needsReview || 0,
        pendingSignature
    ].join('::');
}

async function sendOpsQueueAutoResultAlert(summary, pendingAfter, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!summary?.total) return false;
    if (!summary.failed && !(pendingAfter || []).length) return false;
    const signature = buildOpsQueueResultSignature(summary, pendingAfter);
    const sameSignature = signature === alertState.lastOpsQueueAutoResultSignature;
    const cooldownMs = 10 * 60 * 1000;
    if (sameSignature && Date.now() - alertState.lastOpsQueueAutoResultAlertAt < cooldownMs) return false;

    const channel = await fetchOpsAlertChannel();
    if (!channel?.send) return false;

    alertState.lastOpsQueueAutoResultSignature = signature;
    alertState.lastOpsQueueAutoResultAlertAt = Date.now();

    const lines = [
        '🔁 시트 자동 복구 결과',
        `시간: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
        `전체: ${summary.total}개`,
        `재시도: ${summary.retried || 0}개`,
        `복구성공: ${summary.succeeded}개`,
        `대기유지: ${summary.failed}개`,
        `관리자확인: ${summary.needsReview || 0}개`,
        `제거: ${summary.dropped || 0}개`
    ];
    if (summary.failed > 0) {
        lines.push('', '실패 항목은 `/작업대기`로 확인하고, 필요하면 `/작업재시도`로 즉시 다시 실행할 수 있습니다.');
    }
    await channel.send(lines.join('\n')).catch(error => {
        console.warn('[OPS QUEUE AUTO RESULT ALERT SKIP]', error?.code || error?.message || 'unknown');
    });
    return true;
}

async function notifyOperationalIssues(guild, issues, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!issues.length) {
        alertState.lastOperationalIssueSignature = null;
        return false;
    }
    const signature = issues.slice(0, 10).map(issue => `${issue.code}:${issue.detail}`).sort().join('|');
    const cooldownMs = 30 * 60 * 1000;
    if (
        signature === alertState.lastOperationalIssueSignature &&
        Date.now() - alertState.lastOperationalIssueAlertAt < cooldownMs
    ) {
        return false;
    }

    const channel = await fetchOpsAlertChannel();
    if (!channel?.send) return false;

    alertState.lastOperationalIssueSignature = signature;
    alertState.lastOperationalIssueAlertAt = Date.now();
    const embed = new EmbedBuilder()
        .setTitle(`운영 점검 필요 (${issues.length}건)`)
        .setColor('#E67E22')
        .setDescription([
            `PH TIME: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
            '전체 점검은 `/운영점검` 명령어로 확인하세요.',
            '개별 확인은 `/상태추적 대상:유저` 명령어를 사용하세요.'
        ].join('\n'))
        .setTimestamp();
    safeAddFields(embed, {
        name: '주요 문제',
        value: renderEmbedCodeBlock(formatOperationalIssueRows(issues, 10)),
        inline: false
    });
    await channel.send({ embeds: [embed] }).catch(error => {
        console.warn('[OPERATIONAL ISSUE ALERT SKIP]', error?.code || error?.message || 'unknown');
    });
    return true;
}

async function sendOpsQueueStuckAlert(items, summary, now = moment().tz(CONFIG.TIMEZONE)) {
    const cooldownMs = 30 * 60 * 1000;
    if (Date.now() - alertState.lastOpsQueueStuckAlertAt < cooldownMs) return false;

    const stuckItems = items.filter(item => {
        const createdAt = item.createdAt ? moment(item.createdAt).tz(CONFIG.TIMEZONE) : null;
        return Number(item.attempts || 0) >= 3 || (createdAt?.isValid() && now.diff(createdAt, 'minutes') >= 10);
    });
    if (!stuckItems.length) return false;

    const channel = await fetchOpsAlertChannel();
    if (!channel?.send) return false;

    alertState.lastOpsQueueStuckAlertAt = Date.now();
    const rows = stuckItems.slice(0, 8).map(item => {
        const name = padWidth(truncateWidth(item.userName || item.id || 'unknown', 16), 17);
        const kind = padWidth(truncateWidth(item.kind || 'sheet', 14), 15);
        const attempts = String(item.attempts || 0).padStart(2);
        const code = truncateWidth(item.lastCode || item.code || item.lastError || 'pending', 30);
        return `${kind} ${name} try=${attempts} ${code}`;
    }).join('\n');
    const embed = new EmbedBuilder()
        .setTitle(`시트 작업 확인 필요 (${items.length}건)`)
        .setColor('#E67E22')
        .setDescription([
            `PH TIME: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
            `자동 재시도: 성공 ${summary?.succeeded || 0}건 / 대기 ${summary?.failed || 0}건`,
            '확인은 `/작업대기`, 강제 재시도는 `/작업재시도` 명령어를 사용하세요.'
        ].join('\n'))
        .setTimestamp();
    safeAddFields(embed, {
        name: '대기 작업',
        value: renderEmbedCodeBlock(rows),
        inline: false
    });
    await channel.send({ embeds: [embed] }).catch(error => {
        console.warn('[OPS QUEUE STUCK ALERT SKIP]', error?.code || error?.message || 'unknown');
    });
    return true;
}

async function sendOpsQueueRecoveryAttentionAlert(items, summary, now = moment().tz(CONFIG.TIMEZONE)) {
    const cooldownMs = 30 * 60 * 1000;
    if (Date.now() - alertState.lastOpsQueueStuckAlertAt < cooldownMs) return false;

    const reviewItems = (items || []).filter(item => {
        const createdAt = item.createdAt ? moment(item.createdAt).tz(CONFIG.TIMEZONE) : null;
        return item.status === 'needs-review' ||
            Number(item.attempts || 0) >= 3 ||
            (createdAt?.isValid() && now.diff(createdAt, 'minutes') >= 10);
    });
    if (!reviewItems.length) return false;

    const channel = await fetchOpsAlertChannel();
    if (!channel?.send) return false;

    alertState.lastOpsQueueStuckAlertAt = Date.now();
    const rows = reviewItems.slice(0, 8).map(item => {
        const kind = padWidth(truncateWidth(item.kind || 'sheet', 14), 15);
        const name = padWidth(truncateWidth(item.userName || item.id || 'unknown', 16), 17);
        const attempts = String(item.attempts || 0).padStart(2);
        const status = truncateWidth(item.status || item.autoRepairAction || 'pending', 12);
        const code = truncateWidth(item.lastCode || item.code || item.lastError || 'pending', 28);
        return `${kind} ${name} try=${attempts} ${status} ${code}`;
    }).join('\n');

    const embed = new EmbedBuilder()
        .setTitle(`시트 작업 확인 필요 (${reviewItems.length}건)`)
        .setColor('#E67E22')
        .setDescription([
            `PH TIME: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
            `자동 복구 성공 ${summary?.succeeded || 0}건 / 대기 ${summary?.failed || 0}건 / 관리자확인 ${summary?.needsReview || 0}건`,
            '확인은 `/작업대기`, 강제 재시도는 `/작업재시도` 명령어를 사용하세요.'
        ].join('\n'))
        .setTimestamp();

    safeAddFields(embed, {
        name: '대기 작업',
        value: renderEmbedCodeBlock(rows),
        inline: false
    });

    await channel.send({ embeds: [embed] }).catch(error => {
        console.warn('[OPS QUEUE RECOVERY ATTENTION ALERT SKIP]', error?.code || error?.message || 'unknown');
    });
    return true;
}

async function processOpsQueueAutoRetry() {
    const now = moment().tz(CONFIG.TIMEZONE);
    const retryEveryMs = 15 * 1000;
    if (Date.now() - alertState.lastOpsQueueAutoRetryAt < retryEveryMs) return { skipped: true, reason: 'cooldown' };

    const pendingBefore = await opsQueueService.list();
    if (!pendingBefore.length) return { skipped: true, reason: 'empty' };

    alertState.lastOpsQueueAutoRetryAt = Date.now();
    const summary = await runOpsQueueAutoRecovery({
        opsQueueService,
        now: now.toDate(),
        logger,
        retryItem: item => retryQueuedItem({
            item,
            client,
            CONFIG,
            purchaseSheetService
        })
    });

    console.log('[OPS QUEUE AUTO RETRY]', {
        total: summary.total,
        retried: summary.retried,
        succeeded: summary.succeeded,
        failed: summary.failed,
        needsReview: summary.needsReview
    });

    const pendingAfter = await opsQueueService.list();
    await sendOpsQueueAutoResultAlert(summary, pendingAfter, now);
    if (pendingAfter.length) await sendOpsQueueRecoveryAttentionAlert(pendingAfter, summary, now);
    return summary;
}

async function auditAndNotifyOperationalIssues(guild, now = moment().tz(CONFIG.TIMEZONE)) {
    const archivedIssues = archiveMissingActiveUsers(guild, now);
    if (archivedIssues.length) {
        await saveSystemAsync().catch(error => {
            logger.warn?.('[OPS AUTO ARCHIVE SAVE SKIP]', error?.message || error);
        });
    }
    const issues = [
        ...archivedIssues,
        ...collectOperationalIssues(guild, now)
    ];
    await notifyOperationalIssues(guild, issues, now);
    return issues;
}

async function sendRawAttendanceRepairAlert(summary, now = moment().tz(CONFIG.TIMEZONE)) {
    const repairedCount = (summary.repaired || []).length;
    const failedCount = (summary.failed || []).length;
    if (!repairedCount && !failedCount) return false;

    const signature = buildRawAttendanceRepairSignature(summary);
    const sameSignature = signature === alertState.lastRawAttendanceSelfRepairSignature;
    const cooldownMs = 30 * 60 * 1000;
    if (sameSignature && Date.now() - (alertState.lastRawAttendanceSelfRepairAlertAt || 0) < cooldownMs) {
        return false;
    }

    const channel = await fetchOpsAlertChannel();
    if (!channel?.send) return false;

    alertState.lastRawAttendanceSelfRepairSignature = signature;
    alertState.lastRawAttendanceSelfRepairAlertAt = Date.now();

    const lines = [
        '🛠 Raw_Attendance 자동복구 결과',
        `시간: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
        '',
        formatRawAttendanceRepairSummary(summary)
    ];
    await channel.send(lines.join('\n')).catch(error => {
        console.warn('[RAW ATTENDANCE REPAIR ALERT SKIP]', error?.code || error?.message || 'unknown');
    });
    return true;
}

async function runRawAttendanceSelfRepair(now = moment().tz(CONFIG.TIMEZONE)) {
    const intervalMs = 10 * 60 * 1000;
    if (Date.now() - (alertState.lastRawAttendanceSelfRepairAt || 0) < intervalMs) {
        return { skipped: true, reason: 'cooldown' };
    }
    if (!rawAttendanceSheetService?.readRows || !rawAttendanceSheetService?.sendAttendanceRow) {
        return { skipped: true, reason: 'raw-attendance-service-not-ready' };
    }

    alertState.lastRawAttendanceSelfRepairAt = Date.now();
    try {
        const rows = await rawAttendanceSheetService.readRows();
        const summary = await repairRawAttendanceRows({
            rows,
            rawAttendanceSheetService,
            logger
        });
        await sendRawAttendanceRepairAlert(summary, now);
        return summary;
    } catch (error) {
        logger.warn?.('[RAW ATTENDANCE SELF REPAIR SKIP]', error?.message || error);
        return { skipped: true, reason: error?.message || String(error) };
    }
}

async function checkOperationalIssues(guild = client.guilds.cache.get(CONFIG.GUILD_ID)) {
    const now = moment().tz(CONFIG.TIMEZONE);
    await runRawAttendanceSelfRepair(now);
    return auditAndNotifyOperationalIssues(guild, now);
}

async function sendSelfHealingAttentionAlert(cycle, now = moment().tz(CONFIG.TIMEZONE)) {
    const blocked = (cycle?.results || []).filter(result => (
        result.reason === 'needs-review' ||
        (!result.ok && !result.skipped && result.retryable === false)
    ));
    if (!blocked.length) return false;

    const signature = blocked
        .map(result => `${result.name}:${result.error?.code || result.reason || 'unknown'}`)
        .sort()
        .join('|');
    const cooldownMs = 60 * 60 * 1000;
    if (
        signature === alertState.lastSelfHealingAttentionSignature &&
        Date.now() - (alertState.lastSelfHealingAttentionAt || 0) < cooldownMs
    ) {
        return false;
    }

    const channel = await fetchOpsAlertChannel();
    if (!channel?.send) return false;
    alertState.lastSelfHealingAttentionSignature = signature;
    alertState.lastSelfHealingAttentionAt = Date.now();

    const rows = blocked.slice(0, 8).map(result => {
        const code = result.error?.code || result.reason || 'unknown';
        return `- ${result.name}: ${code}`;
    });
    await channel.send([
        `자가 복구 관리자 확인 필요 (${blocked.length}건)`,
        `시간: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
        ...rows,
        '자동 복구가 안전하지 않은 항목만 격리했습니다. 데이터는 삭제되지 않았습니다.'
    ].join('\n')).catch(error => {
        logger.warn?.('[SELF HEALING ATTENTION ALERT SKIP]', error?.code || error?.message || error);
    });
    return true;
}

async function runAutoAuditRepair(guild = client.guilds.cache.get(CONFIG.GUILD_ID)) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const summary = {
        at: now.toISOString(),
        attendanceState: null,
        queue: null,
        rawAttendance: null,
        operationalIssues: [],
        selfHealing: null
    };

    if (typeof selfHealingSupervisorService?.runCycle === 'function') {
        const tasks = [];
        if (typeof attendanceAutoRepairService?.run === 'function') {
            tasks.push({
                name: 'attendance-state',
                repairRevision: 'attendance-state-v1',
                repair: async () => {
                    const result = attendanceAutoRepairService.run({
                        now,
                        reason: 'self-healing-supervisor'
                    });
                    if (result?.changed) await saveSystemAsync();
                    return result;
                },
                verify: result => ({
                    ok: !(result?.changes || []).some(change => change?.severity === 'blocked'),
                    reason: (result?.changes || []).some(change => change?.severity === 'blocked')
                        ? 'attendance state contains a blocked repair'
                        : null
                })
            });
        }
        tasks.push({
            name: 'sheet-operation-queue',
            repairRevision: 'sheet-name-variants-v2',
            repair: () => processOpsQueueAutoRetry(),
            verify: result => ({
                ok: result?.ok !== false && !result?.error,
                reason: result?.ok === false || result?.error
                    ? (result?.error || 'sheet queue recovery failed')
                    : null
            })
        });
        tasks.push({
            name: 'raw-attendance-sheet',
            repairRevision: 'raw-attendance-v1',
            retryDelayMs: 10 * 60 * 1000,
            repair: () => runRawAttendanceSelfRepair(now),
            verify: result => {
                const skippedError = result?.skipped && ![
                    'cooldown',
                    'raw-attendance-service-not-ready'
                ].includes(result.reason);
                return {
                    ok: !result?.failed?.length && !skippedError,
                    reason: result?.failed?.length
                        ? `${result.failed.length} raw attendance repair(s) failed`
                        : (skippedError ? result.reason : null)
                };
            }
        });
        tasks.push({
            name: 'operational-invariants',
            repairRevision: 'operational-invariants-v1',
            repair: () => auditAndNotifyOperationalIssues(guild, now),
            verify: () => true
        });

        const cycle = await selfHealingSupervisorService.runCycle(tasks, {
            reason: 'maintenance-heartbeat',
            guildId: guild?.id || CONFIG.GUILD_ID
        });
        await sendSelfHealingAttentionAlert(cycle, now);
        summary.selfHealing = {
            ok: cycle.ok,
            failed: cycle.failed || 0,
            needsReview: cycle.needsReview || 0,
            recovered: cycle.recovered || 0,
            skipped: cycle.skipped || 0
        };
        for (const item of cycle.results || []) {
            if (item.name === 'attendance-state') summary.attendanceState = item.result || item;
            if (item.name === 'sheet-operation-queue') summary.queue = item.result || item;
            if (item.name === 'raw-attendance-sheet') summary.rawAttendance = item.result || item;
            if (item.name === 'operational-invariants') summary.operationalIssues = item.result || [];
        }
        return summary;
    }

    summary.queue = await processOpsQueueAutoRetry().catch(error => ({
        ok: false,
        error: error?.message || String(error)
    }));
    summary.rawAttendance = await runRawAttendanceSelfRepair(now).catch(error => ({
        skipped: true,
        reason: error?.message || String(error)
    }));
    summary.operationalIssues = await auditAndNotifyOperationalIssues(guild, now).catch(error => {
        logger.warn?.('[AUTO AUDIT OPERATIONAL SKIP]', error?.message || error);
        return [];
    });

    return summary;
}

    return {
        collectDataAuditIssues,
        makeOperationalIssue,
        collectRoleNicknameDataMismatchIssues,
        archiveMissingActiveUsers,
        collectDashboardGroupDuplicateIssues,
        collectOperationalIssues,
        formatOperationalIssueRows,
        fetchOpsAlertChannel,
        buildOpsQueueResultSignature,
        sendOpsQueueAutoResultAlert,
        notifyOperationalIssues,
        sendOpsQueueStuckAlert,
        sendOpsQueueRecoveryAttentionAlert,
        processOpsQueueAutoRetry,
        auditAndNotifyOperationalIssues,
        runRawAttendanceSelfRepair,
        sendSelfHealingAttentionAlert,
        runAutoAuditRepair,
        checkOperationalIssues
    };
}

module.exports = { createOpsMonitoringWorkflow };
