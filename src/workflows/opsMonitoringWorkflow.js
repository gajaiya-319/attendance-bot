'use strict';

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
        opsQueueService,
        purchaseSheetService,
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
            issues.push(makeOperationalIssue('overtime-missing-user', `${name}: overtime entry has no attendance user`));
            continue;
        }
        if (user.dayOff) issues.push(makeOperationalIssue('overtime-dayoff', `${name}: overtime + dayOff=true`));
        if (user.isFinished) issues.push(makeOperationalIssue('overtime-finished', `${name}: overtime + FINISHED`));
        if (!user.checkedIn && !user.pendingManualOT) issues.push(makeOperationalIssue('overtime-not-working', `${name}: overtime but not checked in`));
    }

    const activeShift = getOperationalShift(now);
    if (groups) issues.push(...collectDashboardGroupDuplicateIssues(groups));

    if (guild?.members?.cache) {
        for (const member of guild.members.cache.values()) {
            if (!member || member.user?.bot) continue;
            const user = getAttendanceData()[member.id];
            const name = user ? getDashboardName(user) : (member.displayName || member.user?.username || member.id);
            const hasWorkingRole = Boolean(CONFIG.ROLES.WORKING && member.roles?.cache?.has(CONFIG.ROLES.WORKING));
            const shouldHaveWorkingRole = Boolean(user?.checkedIn && !user?.dayOff && !user?.isFinished);
            if (hasWorkingRole && !shouldHaveWorkingRole) {
                issues.push(makeOperationalIssue('working-role-extra', `${name}: has WORKING role but state is not active`));
            }
            if (!hasWorkingRole && shouldHaveWorkingRole) {
                issues.push(makeOperationalIssue('working-role-missing', `${name}: active state but missing WORKING role`));
            }
            if (hasWorkingRole && user?.dayOff) {
                issues.push(makeOperationalIssue('dayoff-working-role', `${name}: dayOff user has WORKING role`));
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
                issues.push(makeOperationalIssue('shift-role-mismatch', `${name}: WORKING role during ${activeShift}, member shift=${memberShift}`));
            }
        }
    }

    return issues.slice(0, 50);
}

function formatOperationalIssueRows(issues, limit = 8) {
    if (!issues.length) return 'No operational issues.';
    return issues.slice(0, limit).map(issue => {
        const code = padWidth(truncateWidth(issue.code, 22), 23);
        return `${code} ${truncateWidth(issue.detail, 64)}`;
    }).join('\n');
}

async function fetchOpsAlertChannel() {
    const channelId = CONFIG.LOG_CHANNEL || CONFIG.DAYOFF_CHANNEL || CONFIG.ANNOUNCE_CHANNEL || CONFIG.DAY_CHAN || CONFIG.NIGHT_CHAN;
    return channelId ? client.channels.fetch(channelId).catch(() => null) : null;
}

function buildOpsQueueResultSignature(summary, pendingAfter) {
    const pendingSignature = (pendingAfter || [])
        .map(item => `${item.id}:${item.lastCode || item.code || item.lastError || 'pending'}`)
        .sort()
        .join('|');
    return [
        summary?.succeeded || 0,
        summary?.failed || 0,
        pendingSignature
    ].join('::');
}

async function sendOpsQueueAutoResultAlert(summary, pendingAfter, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!summary?.total) return false;
    const signature = buildOpsQueueResultSignature(summary, pendingAfter);
    const sameSignature = signature === alertState.lastOpsQueueAutoResultSignature;
    const cooldownMs = 10 * 60 * 1000;
    if (sameSignature && Date.now() - alertState.lastOpsQueueAutoResultAlertAt < cooldownMs) return false;

    const channel = await fetchOpsAlertChannel();
    if (!channel?.send) return false;

    alertState.lastOpsQueueAutoResultSignature = signature;
    alertState.lastOpsQueueAutoResultAlertAt = Date.now();

    const lines = [
        '\ud83d\udd01 \uc2dc\ud2b8 \uc790\ub3d9 \uc7ac\uc2dc\ub3c4 \uacb0\uacfc',
        `\uc2dc\uac04: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
        `\uc804\uccb4: ${summary.total}\uac1c`,
        `\uc131\uacf5: ${summary.succeeded}\uac1c`,
        `\uc2e4\ud328 \uc720\uc9c0: ${summary.failed}\uac1c`
    ];
    if (summary.failed > 0) {
        lines.push('', '\uc2e4\ud328 \ud56d\ubaa9\uc740 `/\uc791\uc5c5\ub300\uae30`\ub85c \ud655\uc778\ud558\uace0, \ud544\uc694\ud558\uba74 `/\uc791\uc5c5\uc7ac\uc2dc\ub3c4`\ub85c \uc989\uc2dc \ub2e4\uc2dc \uc2e4\ud589\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.');
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
        .setTitle(`Operational Issues Detected (${issues.length})`)
        .setColor('#E67E22')
        .setDescription([
            `PH TIME: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
            'Run `/운영점검` for the full health summary.',
            'For one user, run `/상태추적 대상:유저`.'
        ].join('\n'))
        .setTimestamp();
    safeAddFields(embed, {
        name: 'Top Issues',
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
        .setTitle(`Pending Sheet Jobs Need Attention (${items.length})`)
        .setColor('#E67E22')
        .setDescription([
            `PH TIME: ${now.format('YYYY-MM-DD HH:mm:ss')}`,
            `Auto retry: ${summary?.succeeded || 0} succeeded, ${summary?.failed || 0} still pending.`,
            'Run `/작업대기` to inspect or `/작업재시도` to force another retry.'
        ].join('\n'))
        .setTimestamp();
    safeAddFields(embed, {
        name: 'Stuck Jobs',
        value: renderEmbedCodeBlock(rows),
        inline: false
    });
    await channel.send({ embeds: [embed] }).catch(error => {
        console.warn('[OPS QUEUE STUCK ALERT SKIP]', error?.code || error?.message || 'unknown');
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
    const summary = await opsQueueService.retryAll(item => retryQueuedItem({
        item,
        client,
        CONFIG,
        purchaseSheetService
    }));

    console.log('[OPS QUEUE AUTO RETRY]', {
        total: summary.total,
        succeeded: summary.succeeded,
        failed: summary.failed
    });

    const pendingAfter = await opsQueueService.list();
    await sendOpsQueueAutoResultAlert(summary, pendingAfter, now);
    if (pendingAfter.length) await sendOpsQueueStuckAlert(pendingAfter, summary, now);
    return summary;
}

async function checkOperationalIssues(guild = client.guilds.cache.get(CONFIG.GUILD_ID)) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const issues = collectOperationalIssues(guild, now);
    await notifyOperationalIssues(guild, issues, now);
    return issues;
}

    return {
        collectDataAuditIssues,
        makeOperationalIssue,
        collectDashboardGroupDuplicateIssues,
        collectOperationalIssues,
        formatOperationalIssueRows,
        fetchOpsAlertChannel,
        buildOpsQueueResultSignature,
        sendOpsQueueAutoResultAlert,
        notifyOperationalIssues,
        sendOpsQueueStuckAlert,
        processOpsQueueAutoRetry,
        checkOperationalIssues
    };
}

module.exports = { createOpsMonitoringWorkflow };
