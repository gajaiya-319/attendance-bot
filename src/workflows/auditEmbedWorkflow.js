'use strict';

function createAuditEmbedWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        PermissionFlagsBits,
        padWidth,
        truncateWidth,
        renderEmbedCodeBlock,
        safeAddFields,
        refreshGuildMembers,
        getAttendanceData,
        getOvertimeUsers,
        getAnnounceData,
        getDayOffReservations,
        getStatusMessageId,
        getLastSavedAt,
        getLastBackupAt,
        dashboardStateUtils,
        collectStatusTransitionWarnings,
        collectDataAuditIssues,
        collectOperationalIssues,
        formatOperationalIssueRows,
        getDashboardName,
        isAssignedWorker,
        hasManagedAttendanceRole,
        ensureUserData,
        determineShift,
        transitionRecordedStatus,
        createBackupSnapshot,
        saveSystemAsync,
        queueDashboardRender,
        writeAdminActionLog,
        readAdminAudit,
        readDayOffLog,
        getRuntimeHealthSnapshot,
        getStartupBuildInfo,
        readRuntimeHealthFile,
        buildCommandDefinitions,
        hiddenCommandAliases,
        validateCommandPayloads,
        getOperationalShift,
        getDashboardShift,
        getShiftBounds,
        getActiveMaintenanceWindow,
        isMaintenanceWindow,
        isWithinPreShiftWindow,
        maintenanceOverrideService,
        guildId: GUILD_ID,
        logger = console
    } = deps;
function buildDiagnosticsEmbed(guild) {
    const users = Object.values(getAttendanceData());
    const checkedIn = users.filter(u => u.checkedIn).length;
    const disconnected = users.filter(u => u.disconnected).length;
    const dayOff = users.filter(u => u.dayOff).length;
    const scheduled = Object.values(getAnnounceData()).filter(Boolean).filter(d => d.active).length;
    const health = getRuntimeHealthSnapshot();

    const embed = new EmbedBuilder()
        .setTitle('System Diagnostics')
        .setColor(health.memberFetch.backoffSeconds || health.commandRegister.error !== 'none' ? '#E67E22' : '#5865F2')
        .setTimestamp();
    safeAddFields(embed,
        { name: 'Version', value: CONFIG.VERSION, inline: true },
        { name: 'Guild Cache', value: `${guild?.memberCount || guild?.members?.cache?.size || 0}`, inline: true },
        { name: 'Saved Users', value: `${users.length}`, inline: true },
        { name: 'Checked In', value: `${checkedIn}`, inline: true },
        { name: 'Disconnected', value: `${disconnected}`, inline: true },
        { name: 'Day Off', value: `${dayOff}`, inline: true },
        { name: 'Overtime', value: `${getOvertimeUsers().length}`, inline: true },
        { name: 'Active Announcements', value: `${scheduled}`, inline: true },
        { name: 'Member Fetch', value: [
            `Last OK: ${health.memberFetch.lastOk}`,
            `Backoff: ${health.memberFetch.backoffSeconds}s`,
            `Error: ${health.memberFetch.error}`
        ].join('\n'), inline: false },
        { name: 'Command Register', value: [
            `Last OK: ${health.commandRegister.lastOk}`,
            `Count: ${health.commandRegister.count}`,
            `Error: ${health.commandRegister.error}`
        ].join('\n'), inline: false },
        { name: 'Last Save', value: getLastSavedAt() || 'Not saved in this session', inline: false },
        { name: 'Last Backup', value: getLastBackupAt() || 'No rotated backup in this session', inline: false },
        { name: 'Status Message', value: getStatusMessageId() || 'Not linked', inline: false }
    );
    return embed;
}
function buildDataAuditEmbed() {
    const issues = collectDataAuditIssues();
    const text = issues.length ? issues.slice(0, 30).join('\n') : 'No data issues found.';
    const embed = new EmbedBuilder()
        .setTitle('Data Audit')
        .setColor(issues.length ? '#E67E22' : '#2ECC71')
        .setDescription(`Issues: ${issues.length}`)
        .setTimestamp();
    safeAddFields(embed, { name: 'Details', value: renderEmbedCodeBlock(text), inline: false });
    return embed;
}

function deriveAttendanceStatusForAudit(user) {
    return dashboardStateUtils.deriveAttendanceStatusForAudit(user);
}

function deriveVoiceStatusForAudit(member, user, now = moment().tz(CONFIG.TIMEZONE)) {
    return dashboardStateUtils.deriveVoiceStatusForAudit(member, user, now);
}

async function buildStatusAuditEmbed(guild) {
    await refreshGuildMembers(guild);
    const now = moment().tz(CONFIG.TIMEZONE);
    const rows = [];
    let checked = 0;

    for (const user of Object.values(getAttendanceData())) {
        const member = guild?.members?.cache?.get(user.id);
        if (!member || member.user?.bot) continue;
        if (!isAssignedWorker(member) && !hasManagedAttendanceRole(member)) continue;
        checked++;

        const expectedAttendance = deriveAttendanceStatusForAudit(user);
        const expectedVoice = deriveVoiceStatusForAudit(member, user, now);
        const recordedAttendance = user.attendanceStatus || 'MISSING';
        const recordedVoice = user.voiceStatus || 'MISSING';
        if (expectedAttendance === recordedAttendance && expectedVoice === recordedVoice) continue;

        rows.push([
            truncateWidth(getDashboardName(user), 14).padEnd(14),
            `A ${recordedAttendance}->${expectedAttendance}`,
            `V ${recordedVoice}->${expectedVoice}`
        ].join(' | '));
    }

    const text = rows.length ? rows.slice(0, 30).join('\n') : 'No status mismatches found.';
    const transitionWarnings = collectStatusTransitionWarnings(getAttendanceData(), { limit: 10 });
    const warningText = transitionWarnings.length
        ? transitionWarnings.map(entry => {
            const time = entry.at ? moment(entry.at).tz(CONFIG.TIMEZONE).format('MM-DD HH:mm') : 'unknown';
            const name = truncateWidth(entry.userName || entry.userId || 'Unknown', 14).padEnd(14);
            const source = truncateWidth(entry.source || 'unknown', 12).padEnd(12);
            const warning = truncateWidth((entry.warnings || []).join(', ') || 'unknown-warning', 42);
            return `${time} | ${name} | ${source} | ${warning}`;
        }).join('\n')
        : 'No transition warnings found.';

    const embed = new EmbedBuilder()
        .setTitle('Recorded Status Audit')
        .setColor(rows.length || transitionWarnings.length ? '#E67E22' : '#2ECC71')
        .setDescription(`Checked: ${checked}\nMismatches: ${rows.length}\nTransition warnings: ${transitionWarnings.length}`)
        .setFooter({ text: 'Recorded -> Expected. Recent warnings come from status transition audit logs.' })
        .setTimestamp();
    safeAddFields(embed,
        { name: 'Details', value: renderEmbedCodeBlock(text), inline: false },
        { name: 'Recent Transition Warnings', value: renderEmbedCodeBlock(warningText), inline: false }
    );
    return embed;
}

async function collectStatusAuditMismatches(guild, now = moment().tz(CONFIG.TIMEZONE)) {
    await refreshGuildMembers(guild);
    const rows = [];
    let checked = 0;

    for (const user of Object.values(getAttendanceData())) {
        const member = guild?.members?.cache?.get(user.id);
        if (!member || member.user?.bot) continue;
        if (!isAssignedWorker(member) && !hasManagedAttendanceRole(member)) continue;
        checked++;

        const expectedAttendance = deriveAttendanceStatusForAudit(user);
        const expectedVoice = deriveVoiceStatusForAudit(member, user, now);
        const recordedAttendance = user.attendanceStatus || 'MISSING';
        const recordedVoice = user.voiceStatus || 'MISSING';
        if (expectedAttendance === recordedAttendance && expectedVoice === recordedVoice) continue;

        rows.push({
            name: getDashboardName(user),
            recordedAttendance,
            expectedAttendance,
            recordedVoice,
            expectedVoice
        });
    }

    return { checked, rows };
}

function formatShiftBoundsForOps(label, bounds) {
    if (!bounds?.start || !bounds?.end) return `${label}: unavailable`;
    return `${label}: ${bounds.start.format('MM-DD HH:mm')} -> ${bounds.end.format('MM-DD HH:mm')}`;
}

function formatMaintenanceOverrideRows(now) {
    const today = now.format('YYYY-MM-DD');
    const tomorrow = now.clone().add(1, 'day').format('YYYY-MM-DD');
    const overrides = maintenanceOverrideService.listOverrides()
        .filter(row => row.date >= now.clone().subtract(7, 'days').format('YYYY-MM-DD'))
        .slice(0, 6);
    if (!overrides.length) return 'No maintenance overrides.';
    return overrides.map(row => {
        const marker = row.date === today ? 'TODAY' : row.date === tomorrow ? 'TOMORROW' : row.date;
        const state = row.enabled ? 'ON' : 'OFF';
        const moved = row.movedTo ? ` -> ${row.movedTo}` : row.movedFrom ? ` <- ${row.movedFrom}` : '';
        const reason = row.reason ? ` | ${truncateWidth(row.reason, 28)}` : '';
        return `${marker} ${state}${moved}${reason}`;
    }).join('\n');
}

async function buildOpsCheckEmbed(guild) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const users = Object.values(getAttendanceData());
    const buildInfo = getStartupBuildInfo();
    const activeShift = getOperationalShift(now) || 'maintenance';
    const dashboardShift = getDashboardShift(now);
    const activeMaintenance = getActiveMaintenanceWindow(now);
    const dayBounds = getShiftBounds('day', now);
    const nightBounds = getShiftBounds('night', now);
    const visibleCommandPayloads = buildCommandDefinitions()
        .filter(command => !hiddenCommandAliases.has(command.name))
        .map(command => command.toJSON());
    const commandIssues = validateCommandPayloads(visibleCommandPayloads);
    const dataIssues = collectDataAuditIssues();
    const operationalIssues = collectOperationalIssues(guild, now);
    const statusAudit = await collectStatusAuditMismatches(guild, now);
    const transitionWarnings = collectStatusTransitionWarnings(getAttendanceData(), { limit: 5 });
    const adminAuditRows = await readAdminAudit(5);
    const health = getRuntimeHealthSnapshot(now);
    const runtimeFileHealth = await readRuntimeHealthFile(visibleCommandPayloads.length);
    const activeAnnouncements = Object.values(getAnnounceData()).filter(Boolean).filter(d => d.active).length;
    const checkedIn = users.filter(u => u.checkedIn).length;
    const disconnected = users.filter(u => u.disconnected).length;
    const dayOff = users.filter(u => u.dayOff).length;
    const severity = dataIssues.length ||
        operationalIssues.length ||
        statusAudit.rows.length ||
        transitionWarnings.length ||
        commandIssues.length ||
        !runtimeFileHealth.ok ||
        health.memberFetch.backoffSeconds ||
        health.commandRegister.error !== 'none'
        ? 'WARN'
        : 'OK';
    const warningRows = transitionWarnings.length
        ? transitionWarnings.map(entry => {
            const time = entry.at ? moment(entry.at).tz(CONFIG.TIMEZONE).format('MM-DD HH:mm') : 'unknown';
            return `${time} ${truncateWidth(entry.userName, 12)} ${truncateWidth((entry.warnings || []).join(','), 34)}`;
        }).join('\n')
        : 'No recent transition warnings.';
    const mismatchRows = statusAudit.rows.length
        ? statusAudit.rows.slice(0, 8).map(row => {
            const name = padWidth(truncateWidth(row.name, 14), 15);
            return `${name} A ${row.recordedAttendance}->${row.expectedAttendance} | V ${row.recordedVoice}->${row.expectedVoice}`;
        }).join('\n')
        : 'No status mismatches.';
    const adminRows = adminAuditRows.length
        ? adminAuditRows.map(row => {
            try {
                const parsed = JSON.parse(row);
                return `${parsed.time || 'unknown'} | ${truncateWidth(parsed.action || 'ACTION', 18)} | ${truncateWidth(parsed.targetName || 'N/A', 18)} | ${truncateWidth(parsed.actorName || 'Unknown', 14)}`;
            } catch {
                return truncateWidth(row, 90);
            }
        }).join('\n')
        : 'No admin audit records found.';

    const embed = new EmbedBuilder()
        .setTitle(`Operational Health Check - ${severity}`)
        .setColor(severity === 'OK' ? '#2ECC71' : '#E67E22')
        .setDescription(`PH TIME: ${now.format('YYYY-MM-DD HH:mm:ss')}`)
        .setFooter({ text: 'Read-only operational summary. Use /상태추적 and /상태동기화 for one user.' })
        .setTimestamp();
    safeAddFields(embed,
            {
                name: 'Runtime',
                value: [
                    `Version: ${CONFIG.VERSION}`,
                    `Build: ${buildInfo.hash} (${buildInfo.fileCount} files)`,
                    `Changed: ${buildInfo.changedAt}`,
                    `Guild cache: ${guild?.memberCount || guild?.members?.cache?.size || 0}`,
                    `Saved users: ${users.length}`,
                    `Commands: ${visibleCommandPayloads.length}`,
                    `Command last OK: ${health.commandRegister.lastOk}`,
                    `Runtime stage: ${runtimeFileHealth.stage}`,
                    `Runtime PID: ${runtimeFileHealth.pid || 'missing'} (${runtimeFileHealth.pidMatches ? 'match' : 'mismatch'})`,
                    `Runtime commands: ${runtimeFileHealth.commandCount}/${runtimeFileHealth.expectedCommandCount}`,
                    `Member fetch OK: ${health.memberFetch.lastOk}`,
                    `Member fetch backoff: ${health.memberFetch.backoffSeconds}s`,
                    `Last save: ${getLastSavedAt() || 'none'}`,
                    `Last backup: ${getLastBackupAt() || 'none'}`
                ].join('\n'),
                inline: false
            },
            {
                name: 'Current Schedule',
                value: [
                    `Operational shift: ${activeShift}`,
                    `Dashboard shift: ${dashboardShift}`,
                    formatShiftBoundsForOps('Day', dayBounds),
                    formatShiftBoundsForOps('Night', nightBounds),
                    activeMaintenance
                        ? `Maintenance: ${activeMaintenance.sourceDate || activeMaintenance.day} ${activeMaintenance.start}-${activeMaintenance.end} ${activeMaintenance.override ? '(override)' : '(default)'}`
                        : 'Maintenance: none now'
                ].join('\n'),
                inline: false
            },
            {
                name: 'Maintenance Overrides',
                value: renderEmbedCodeBlock(formatMaintenanceOverrideRows(now)),
                inline: false
            },
            {
                name: 'Attendance Summary',
                value: [
                    `Checked in: ${checkedIn}`,
                    `Day off: ${dayOff}`,
                    `Disconnected: ${disconnected}`,
                    `Overtime: ${getOvertimeUsers().length}`,
                    `Active announcements: ${activeAnnouncements}`
                ].join('\n'),
                inline: true
            },
            {
                name: 'Risk Counters',
                value: [
                    `Data issues: ${dataIssues.length}`,
                    `Operational issues: ${operationalIssues.length}`,
                    `Status mismatches: ${statusAudit.rows.length}`,
                    `Transition warnings: ${transitionWarnings.length}`,
                    `Command issues: ${commandIssues.length}`,
                    `Runtime health: ${runtimeFileHealth.ok ? 'OK' : 'WARN'}`
                ].join('\n'),
                inline: true
            },
            {
                name: 'API Health',
                value: [
                    `Command register error: ${health.commandRegister.error}`,
                    `Runtime health error: ${runtimeFileHealth.commandError}`,
                    `Member fetch error: ${health.memberFetch.error}`
                ].join('\n'),
                inline: false
            },
            { name: 'Operational Issues', value: renderEmbedCodeBlock(formatOperationalIssueRows(operationalIssues, 12)), inline: false },
            { name: 'Status Mismatches', value: renderEmbedCodeBlock(mismatchRows), inline: false },
            { name: 'Recent Transition Warnings', value: renderEmbedCodeBlock(warningRows), inline: false },
            { name: 'Recent Admin Actions', value: renderEmbedCodeBlock(adminRows), inline: false }
    );
    return embed;
}

function buildStatusTraceEmbed(member) {
    const user = getAttendanceData()[member.id] || ensureUserData(member, determineShift(member));
    const events = Array.isArray(user.attendanceEvents) ? user.attendanceEvents.slice(-12).reverse() : [];
    const warnings = Array.isArray(user.statusTransitionWarnings) ? user.statusTransitionWarnings.slice(-8).reverse() : [];
    const current = [
        `name=${user.name || member.displayName}`,
        `shift=${user.shift || 'none'}`,
        `checkedIn=${Boolean(user.checkedIn)}`,
        `finished=${Boolean(user.isFinished)}`,
        `dayOff=${Boolean(user.dayOff)}`,
        `disconnected=${Boolean(user.disconnected)}`,
        `attendance=${user.attendanceStatus || 'MISSING'}`,
        `voice=${user.voiceStatus || 'MISSING'}`,
        `transitionSeq=${Number(user.statusTransitionSeq) || 0}`
    ].join('\n');
    const eventText = events.length
        ? events.map(event => {
            const time = event?.at ? moment(event.at).tz(CONFIG.TIMEZONE).format('MM-DD HH:mm') : 'unknown';
            const type = truncateWidth(event?.type || 'unknown', 24).padEnd(24);
            const source = truncateWidth(event?.source || event?.meta?.source || 'unknown', 16);
            const reason = truncateWidth(event?.meta?.reason || event?.reason || '', 28);
            return `${time} | ${type} | ${source} | ${reason}`;
        }).join('\n')
        : 'No attendance events found.';
    const warningText = warnings.length
        ? warnings.map(entry => {
            const time = entry?.at ? moment(entry.at).tz(CONFIG.TIMEZONE).format('MM-DD HH:mm') : 'unknown';
            const source = truncateWidth(entry?.source || 'unknown', 14).padEnd(14);
            const reason = truncateWidth(entry?.reason || 'no-reason', 22).padEnd(22);
            const detail = truncateWidth((entry?.warnings || []).join(', ') || 'unknown-warning', 36);
            return `${time} | ${source} | ${reason} | ${detail}`;
        }).join('\n')
        : 'No transition warnings found.';

    const embed = new EmbedBuilder()
        .setTitle(`Status Trace - ${member.displayName}`)
        .setColor(warnings.length ? '#E67E22' : '#5865F2')
        .setFooter({ text: `Read-only trace | ${CONFIG.VERSION}` })
        .setTimestamp();
    safeAddFields(embed,
        { name: 'Current Saved State', value: renderEmbedCodeBlock(current), inline: false },
        { name: 'Recent Events', value: renderEmbedCodeBlock(eventText), inline: false },
        { name: 'Recent Transition Warnings', value: renderEmbedCodeBlock(warningText), inline: false }
    );
    return embed;
}

async function syncUserRecordedStatus(member, actor) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const user = ensureUserData(member, determineShift(member));
    const before = {
        attendanceStatus: user.attendanceStatus || 'MISSING',
        voiceStatus: user.voiceStatus || 'MISSING'
    };
    const next = {
        attendanceStatus: deriveAttendanceStatusForAudit(user),
        voiceStatus: deriveVoiceStatusForAudit(member, user, now)
    };

    let backupPath = null;
    try {
        backupPath = await createBackupSnapshot('before-status-sync');
    } catch (error) {
        console.error('[STATUS SYNC BACKUP ERROR]', error);
    }

    if (!backupPath) {
        await writeAdminActionLog('STATUS_SYNC_ABORTED', actor, member, [
            'reason=backup-failed',
            `attendance=${before.attendanceStatus}->${next.attendanceStatus}`,
            `voice=${before.voiceStatus}->${next.voiceStatus}`
        ]);
        return { user, before, next, changed: false, backupPath: null, ok: false };
    }

    const changed = transitionRecordedStatus(user, next, now, 'status-sync-command', 'admin-sync-recorded-status');
    await writeAdminActionLog('STATUS_SYNC', actor, member, [
        `attendance=${before.attendanceStatus}->${next.attendanceStatus}`,
        `voice=${before.voiceStatus}->${next.voiceStatus}`,
        `changed=${changed}`,
        `backup=${backupPath}`
    ]);
    if (changed) await saveSystemAsync();
    await queueDashboardRender({ forceMemberRefresh: true });
    return { user, before, next, changed, backupPath, ok: true };
}

function buildTimeAuditEmbed() {
    const cases = [
        { label: 'Tue Day', shift: 'day', at: '2026-05-19 12:00', start: '2026-05-19 09:00', end: '2026-05-19 19:00' },
        { label: 'Tue Night', shift: 'night', at: '2026-05-19 20:00', start: '2026-05-19 19:00', end: '2026-05-20 04:00' },
        { label: 'Wed Night Carry', shift: 'night', at: '2026-05-20 03:30', start: '2026-05-19 19:00', end: '2026-05-20 04:00' },
        { label: 'Wed Day', shift: 'day', at: '2026-05-20 09:00', start: '2026-05-20 09:00', end: '2026-05-20 21:00' },
        { label: 'Normal Night', shift: 'night', at: '2026-05-21 22:00', start: '2026-05-21 21:00', end: '2026-05-22 09:00' }
    ];

    const rows = cases.map(testCase => {
        const at = moment.tz(testCase.at, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
        const bounds = getShiftBounds(testCase.shift, at);
        const startOk = bounds.start.format('YYYY-MM-DD HH:mm') === testCase.start;
        const endOk = bounds.end.format('YYYY-MM-DD HH:mm') === testCase.end;
        const status = startOk && endOk ? 'OK' : 'FAIL';
        return `${padWidth(testCase.label, 15)} ${status} | ${bounds.start.format('ddd HH:mm')} -> ${bounds.end.format('ddd HH:mm')}`;
    });

    const maintenanceAt = moment.tz('2026-05-20 06:00', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
    rows.push(`${padWidth('Wed Maint', 15)} ${isMaintenanceWindow(maintenanceAt) ? 'OK' : 'FAIL'} | 04:00 -> 09:00 closed`);

    const preShiftAt = moment.tz('2026-05-20 08:50', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
    rows.push(`${padWidth('Day PreShift', 15)} ${isWithinPreShiftWindow('day', preShiftAt) ? 'OK' : 'FAIL'} | 08:50 accepted buffer`);

    const embed = new EmbedBuilder()
        .setTitle('Time Logic Audit')
        .setColor(rows.some(row => row.includes('FAIL')) ? '#E67E22' : '#2ECC71')
        .setDescription(`Timezone: ${CONFIG.TIMEZONE}`)
        .setFooter({ text: 'This command only checks schedule calculations.' })
        .setTimestamp();
    safeAddFields(embed, {
        name: 'Cases',
        value: renderEmbedCodeBlock(rows.join('\n')),
        inline: false
    });
    return embed;
}

async function buildPermissionCheckEmbed(guild) {
    const me = guild?.members?.me || (guild ? await guild.members.fetchMe().catch(() => null) : null);
    if (guild) await refreshGuildMembers(guild, { force: false, minIntervalMs: 5 * 60 * 1000 });
    const statusChannel = await client.channels.fetch(CONFIG.STATUS_CHANNEL).catch(() => null);
    const logChannel = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    const dayOffChannel = await client.channels.fetch(CONFIG.DAYOFF_CHANNEL).catch(() => null);
    const workingRole = guild?.roles?.cache?.get(CONFIG.ROLES.WORKING);
    const botHighest = me?.roles?.highest;
    const canManageWorking = Boolean(workingRole && botHighest && botHighest.comparePositionTo(workingRole) > 0);
    const dayOffPerms = dayOffChannel && me ? dayOffChannel.permissionsFor(me) : null;
    const guildManageRoles = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));
    const guildManageNicknames = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageNicknames));
    const guildManageMessages = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageMessages));
    const guildAddReactions = Boolean(me?.permissions?.has(PermissionFlagsBits.AddReactions));
    const dayOffManageMessages = Boolean(dayOffPerms?.has(PermissionFlagsBits.ManageMessages));
    const dayOffAddReactions = Boolean(dayOffPerms?.has(PermissionFlagsBits.AddReactions));
    const managedRoleIds = [
        CONFIG.ROLES.DAY,
        CONFIG.ROLES.NIGHT,
        CONFIG.ROLES.HEINE,
        CONFIG.ROLES.PAAGRIO,
        CONFIG.ROLES.WORKING,
        CONFIG.ROLES.GUEST
    ].filter(Boolean);
    const roleRows = managedRoleIds.map(roleId => {
        const role = guild?.roles?.cache?.get(roleId);
        const manageable = Boolean(role && botHighest && botHighest.comparePositionTo(role) > 0);
        return `${padWidth(truncateWidth(role?.name || roleId, 18), 19)} ${manageable ? 'OK' : 'NO'}`;
    });
    const nicknameRiskMembers = guild?.members?.cache
        ?.filter(member => {
            if (!member || member.user?.bot) return false;
            if (member.id === me?.id) return false;
            if (member.id === guild.ownerId) return true;
            return Boolean(botHighest && member.roles?.highest && botHighest.comparePositionTo(member.roles.highest) <= 0);
        })
        .map(member => {
            const reason = member.id === guild.ownerId ? 'owner' : 'role';
            return `${padWidth(truncateWidth(member.displayName || member.user?.username || member.id, 18), 19)} ${reason}`;
        })
        .slice(0, 15) || [];
    const healthy = guildManageRoles && guildManageNicknames && canManageWorking && dayOffManageMessages && dayOffAddReactions && nicknameRiskMembers.length === 0;
    const rows = [
        `Bot member: ${me ? 'OK' : 'MISSING'}`,
        `Status channel: ${statusChannel ? 'OK' : 'MISSING'}`,
        `Log channel: ${logChannel ? 'OK' : 'MISSING'}`,
        `Day Off channel: ${dayOffChannel ? 'OK' : 'MISSING'}`,
        `WORKING role: ${workingRole ? 'OK' : 'MISSING'}`,
        `Guild Manage Roles: ${guildManageRoles ? 'OK' : 'NO'}`,
        `Guild Manage Nicknames: ${guildManageNicknames ? 'OK' : 'NO'}`,
        `Can manage WORKING: ${canManageWorking ? 'OK' : 'NO'}`,
        `Guild Manage Messages: ${guildManageMessages ? 'OK' : 'NO'}`,
        `Guild Add Reactions: ${guildAddReactions ? 'OK' : 'NO'}`,
        `Day Off Manage Messages: ${dayOffManageMessages ? 'OK' : 'NO'}`,
        `Day Off Add Reactions: ${dayOffAddReactions ? 'OK' : 'NO'}`
    ];
    const notes = [
        '닉네임 변경은 서버장 또는 봇보다 높은 역할 대상에게는 불가능합니다.',
        '해결: Discord 역할 설정에서 봇 역할을 관리 대상 역할보다 위로 올려주세요.'
    ];
    const embed = new EmbedBuilder()
        .setTitle('Permission Check')
        .setColor(healthy ? '#2ECC71' : '#E67E22')
        .setDescription(`\`\`\`\n${rows.join('\n')}\n\`\`\``)
        .setTimestamp();
    safeAddFields(embed,
        { name: 'Managed Role Hierarchy', value: renderEmbedCodeBlock(roleRows.join('\n') || 'No managed roles configured.'), inline: false },
        { name: `Nickname Update Risks (${nicknameRiskMembers.length})`, value: renderEmbedCodeBlock(nicknameRiskMembers.join('\n') || 'NONE'), inline: false },
        { name: 'Notes', value: notes.join('\n'), inline: false }
    );
    return embed;
}

async function buildDayOffLogEmbed(limit = 10) {
    const rows = await readDayOffLog(limit);
    const text = rows.length ? rows.join('\n') : 'No day off audit log found.';
    return new EmbedBuilder()
        .setTitle('Day Off Audit Log')
        .setColor('#3B82F6')
        .setDescription(`\`\`\`json\n${truncateWidth(text, 3800)}\n\`\`\``)
        .setTimestamp();
}

    return {
        buildDiagnosticsEmbed,
        buildDataAuditEmbed,
        deriveAttendanceStatusForAudit,
        deriveVoiceStatusForAudit,
        buildStatusAuditEmbed,
        collectStatusAuditMismatches,
        formatShiftBoundsForOps,
        formatMaintenanceOverrideRows,
        buildOpsCheckEmbed,
        buildStatusTraceEmbed,
        syncUserRecordedStatus,
        buildTimeAuditEmbed,
        buildPermissionCheckEmbed,
        buildDayOffLogEmbed
    };
}

module.exports = { createAuditEmbedWorkflow };
