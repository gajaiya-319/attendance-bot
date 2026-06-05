'use strict';

function createReportingWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        padWidth,
        truncateWidth,
        formatExactWidth,
        renderEmbedCodeBlock,
        safeAddFields,
        refreshGuildMembers,
        getDashboardShift,
        getShiftBounds,
        getDayNightWorkerStats,
        getDayNightWorkerOvertimeUsers,
        getAttendanceData,
        getOvertimeUsers,
        renderPercentBar,
        renderReportTopRow,
        renderReportStatsLegend,
        renderReportMetricRow,
        renderReportMetricHeader,
        renderSessionMetricRow,
        formatDuration,
        isOwnerId,
        PermissionFlagsBits,
        logger = console
    } = deps;
async function sendDeepReport(type = 'Regular') {
    try {
        const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL);
        const embed = new EmbedBuilder()
            .setTitle(`[${type.toUpperCase()}] 운영 보고서`)
            .setColor(type === 'Analysis' ? '#3498DB' : '#2ECC71')
            .setTimestamp();
        const guild = logChan.guild;
        await refreshGuildMembers(guild);
        const allStats = getDayNightWorkerStats(guild);

        if (type === 'Analysis') {
            let content = '```\n[PTS] [Normal/Late/Absent/Early/OT/Off] [DC] | Name\n';
            const sorted = allStats.sort((a, b) => (b.points || 0) - (a.points || 0));
            sorted.forEach(u => {
                const stats = `${u.totalNormal || 0}/${u.totalLate || 0}/${u.totalAbsent || 0}/${u.totalEarly || 0}/${u.totalOT || 0}/${u.offCount || 0}`;
                content += `${padWidth((u.points || 0).toString(), 5)} ${padWidth(stats, 18)} ${padWidth((u.dcCount || 0).toString(), 4)} | ${u.name?.split('-')[0] || 'Unknown'}\n`;
            });
            safeAddFields(embed, { name: '전체 인원 지표', value: renderEmbedCodeBlock(content.replace(/^```\n/, ''), 1000) });
        } else {
            const act = allStats.filter(u => u.checkedIn).length;
            const off = allStats.filter(u => u.dayOff).length;
            const denominator = Math.max(allStats.length - off, 1);
            const rate = Math.round((act / denominator) * 100) || 0;
            safeAddFields(embed, { name: '출석 요약', value: `출석률: ${rate}%\n출근: ${act}명 | 휴무: ${off}명` });
        }
        return logChan.send({ embeds: [embed] });
    } catch (e) {
        console.error('[REPORT ERROR]', e);
    }
}

async function sendOpsReport(type = 'Regular') {
    try {
        const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL);
        const now = moment().tz(CONFIG.TIMEZONE);
        const currentShift = getDashboardShift(now);
        const shiftNameText = currentShift === 'day' ? 'DAY SHIFT' : 'NIGHT SHIFT';
        const embedColor = currentShift === 'day' ? '#F1C40F' : '#3498DB';
        const embed = new EmbedBuilder()
            .setTitle(type === 'Analysis' ? `PRECISION REPORT - ${shiftNameText}` : `SUMMARY REPORT - ${shiftNameText}`)
            .setColor(embedColor)
            .setDescription(`PH TIME: ${now.format('hh:mm A')}`)
            .setFooter({ text: `Integrated Ops Control Center | ${CONFIG.VERSION}` })
            .setTimestamp();

        const guild = logChan.guild;
        await refreshGuildMembers(guild);
        const allStats = getDayNightWorkerStats(guild, currentShift);
        const reportOvertimeUsers = getDayNightWorkerOvertimeUsers(guild, currentShift);

        if (type !== 'Analysis') {
            const activeUsers = allStats.filter(u => u.checkedIn && !u.disconnected && !u.dayOff);
            const finishedUsers = allStats.filter(u => u.isFinished && !u.checkedIn && !u.dayOff);
            const offUsers = allStats.filter(u => u.dayOff);
            const disconnectedUsers = allStats.filter(u => u.disconnected);
            const absentUsers = allStats.filter(u => {
                if (u.checkedIn || u.dayOff || !u.shift) return false;
                return now.diff(getShiftBounds(u.shift, now).start, 'minutes') > 120;
            });
            const standbyUsers = allStats.filter(u => {
                if (u.checkedIn || u.dayOff || !u.shift || u.isFinished) return false;
                const diff = now.diff(getShiftBounds(u.shift, now).start, 'minutes');
                return diff >= 0 && diff <= 120;
            });
            const workBase = Math.max(allStats.length - offUsers.length, 1);
            const attendanceRate = Math.round(((activeUsers.length + finishedUsers.length) / workBase) * 100) || 0;
            const absenceRate = Math.round((absentUsers.length / workBase) * 100) || 0;
            const activeRate = Math.round((activeUsers.length / workBase) * 100) || 0;
            const finishedRate = Math.round((finishedUsers.length / workBase) * 100) || 0;
            const standbyRate = Math.round((standbyUsers.length / workBase) * 100) || 0;
            const offRate = Math.round((offUsers.length / Math.max(allStats.length, 1)) * 100) || 0;
            const dcRate = Math.round((disconnectedUsers.length / workBase) * 100) || 0;
            const otRate = Math.round((reportOvertimeUsers.length / workBase) * 100) || 0;
            const lateUsers = allStats.filter(u => u.status === 'late');
            const lateRate = Math.round((lateUsers.length / workBase) * 100) || 0;

            const listNames = (arr, empty = 'NONE') => {
                if (!arr.length) return empty;
                return arr
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .slice(0, 20)
                    .map(u => `${padWidth(truncateWidth(u.name?.split('-')[0] || 'Unknown', 16), 17)} ${u.checkInTime || ''}`)
                    .join('\n');
            };

            const makeRateRow = (label, rate, val, base) => {
                const paddedLabel = formatExactWidth(label, 8);
                return `${paddedLabel} |   ${String(rate).padStart(3)}%  ${renderPercentBar(rate)}  |  ${String(val).padStart(2)} / ${String(base).padStart(2)}`;
            };

            const rateBlock = [
                makeRateRow('Attend', attendanceRate, activeUsers.length + finishedUsers.length, workBase),
                makeRateRow('Active', activeRate, activeUsers.length, workBase),
                makeRateRow('Finished', finishedRate, finishedUsers.length, workBase),
                makeRateRow('Standby', standbyRate, standbyUsers.length, workBase),
                makeRateRow('Absent', absenceRate, absentUsers.length, workBase),
                makeRateRow('Late', lateRate, lateUsers.length, workBase),
                makeRateRow('Off', offRate, offUsers.length, Math.max(allStats.length, 1)),
                makeRateRow('DC', dcRate, disconnectedUsers.length, workBase),
                makeRateRow('OT 비율', otRate, reportOvertimeUsers.length, workBase)
            ].join('\n\n');

            safeAddFields(embed,
                { name: `📊 ${shiftNameText} Summary Snapshot`, value: `TOTAL ${allStats.length} | WORK BASE ${workBase} | ACTIVE ${activeUsers.length} | FINISHED ${finishedUsers.length} | ABSENT ${absentUsers.length} | STANDBY ${standbyUsers.length} | OFF ${offUsers.length} | OT ${reportOvertimeUsers.length} | DC ${disconnectedUsers.length}`, inline: false },
                { name: `📈 Daily Rates`, value: renderEmbedCodeBlock(rateBlock), inline: false },
                { name: `🟢 Active (${activeUsers.length})`, value: renderEmbedCodeBlock(listNames(activeUsers)), inline: false },
                { name: `⚪ Finished (${finishedUsers.length})`, value: renderEmbedCodeBlock(listNames(finishedUsers)), inline: false },
                { name: `❌ Absent (${absentUsers.length})`, value: renderEmbedCodeBlock(listNames(absentUsers)), inline: false },
                { name: `🟡 Standby (${standbyUsers.length})`, value: renderEmbedCodeBlock(listNames(standbyUsers)), inline: false },
                { name: `🔵 Day Off (${offUsers.length})`, value: renderEmbedCodeBlock(listNames(offUsers)), inline: false },
                { name: `⚡ Disconnected (${disconnectedUsers.length})`, value: renderEmbedCodeBlock(listNames(disconnectedUsers)), inline: false },
                { name: `🔥 Overtime (${reportOvertimeUsers.length})`, value: renderEmbedCodeBlock(reportOvertimeUsers.map(ot => getAttendanceData()[ot.id] || ot).map(u => formatExactWidth(u.name || 'Unknown', 16)).join('\n') || 'NONE'), inline: false }
            );
            return logChan.send({ embeds: [embed] });
        }

        const sorted = allStats.sort((a, b) => (b.points || 0) - (a.points || 0));
        const active = allStats.filter(u => u.checkedIn && !u.disconnected && !u.dayOff);
        const disconnected = allStats.filter(u => u.disconnected);
        const off = allStats.filter(u => u.dayOff);
        const absent = allStats.filter(u => {
            if (u.checkedIn || u.dayOff || !u.shift) return false;
            return now.diff(getShiftBounds(u.shift, now).start, 'minutes') > 120;
        });
        const standby = allStats.filter(u => {
            if (u.checkedIn || u.dayOff || !u.shift) return false;
            const diff = now.diff(getShiftBounds(u.shift, now).start, 'minutes');
            return diff >= 0 && diff <= 120;
        });

        const attention = [
            ...disconnected.slice(0, 5).map(u => `DC     ${padWidth(truncateWidth(u.name || 'Unknown', 16), 17)} ${u.disconnectedAt ? formatDuration(now.diff(moment(u.disconnectedAt), 'minutes')) : ''}`),
            ...absent.slice(0, 5).map(u => `ABSENT ${padWidth(truncateWidth(u.name || 'Unknown', 16), 17)} +${formatDuration(now.diff(getShiftBounds(u.shift, now).start, 'minutes'))}`)
        ].join('\n') || 'No urgent issues.';
        const topRows = sorted.slice(0, 5).map((u, idx) => renderReportTopRow(u, idx)).join('\n') || 'No data.';
        const top = `${renderReportStatsLegend()}\n${topRows}`;
        const metrics = sorted.slice(0, 20).map(renderReportMetricRow).join('\n') || 'No data.';
        const sessionMetrics = sorted
            .filter(u => Array.isArray(u.sessions) && u.sessions.length > 0)
            .slice(0, 15)
            .map(u => renderSessionMetricRow(u, now))
            .join('\n') || 'No session data.';
        const sessionMetricsTable = `이름        |상태|인정 |총시간|OFF  |DC\n${sessionMetrics}`;

        safeAddFields(embed,
            { name: `${shiftNameText} Precision Snapshot`, value: `TOTAL ${allStats.length} | ACTIVE ${active.length} | STANDBY ${standby.length} | ABSENT ${absent.length} | OFF ${off.length} | OT ${reportOvertimeUsers.length} | DC ${disconnected.length}`, inline: false },
            { name: 'Attention', value: renderEmbedCodeBlock(attention), inline: false },
            { name: '상위 5명', value: renderEmbedCodeBlock(top), inline: false },
            { name: '세션 인정 시간', value: renderEmbedCodeBlock(sessionMetricsTable), inline: false },
            { name: '전체 지표', value: renderEmbedCodeBlock(`${renderReportMetricHeader()}\n${metrics}`), inline: false }
        );
        return logChan.send({ embeds: [embed] });
    } catch (e) {
        console.error('[OPS REPORT ERROR]', e);
    }
}

function buildDiagnosticsEmbed(guild) {
    const users = Object.values(getAttendanceData());
    const checkedIn = users.filter(u => u.checkedIn).length;
    const disconnected = users.filter(u => u.disconnected).length;
    const dayOff = users.filter(u => u.dayOff).length;
    const scheduled = Object.values(announceData).filter(Boolean).filter(d => d.active).length;
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
        { name: 'Last Save', value: lastSavedAt || 'Not saved in this session', inline: false },
        { name: 'Last Backup', value: lastBackupAt || 'No rotated backup in this session', inline: false },
        { name: 'Status Message', value: statusMessageId || 'Not linked', inline: false }
    );
    return embed;
}

function getRankingWorkerShift(user, guild = null) {
    if (!user?.id) return null;
    const member = guild?.members?.cache?.get(user.id);
    if (member?.user?.bot) return null;

    const hasDayRole = Boolean(member?.roles?.cache?.has(CONFIG.ROLES.DAY));
    const hasNightRole = Boolean(member?.roles?.cache?.has(CONFIG.ROLES.NIGHT));
    if (hasDayRole || hasNightRole) {
        if (hasDayRole && hasNightRole) return user.shift === 'night' ? 'night' : 'day';
        return hasDayRole ? 'day' : 'night';
    }

    if (!guild && ['day', 'night'].includes(user.shift)) return user.shift;
    return null;
}

function buildRankingEmbed({ guild = null, shift = 'all' } = {}) {
    const scope = ['all', 'day', 'night'].includes(shift) ? shift : 'all';
    const attendanceData = getAttendanceData();
    const workersById = new Map();

    if (guild?.members?.cache) {
        guild.members.cache.forEach(member => {
            const saved = attendanceData[member.id] || {};
            const workerShift = getRankingWorkerShift({ ...saved, id: member.id }, guild);
            if (!workerShift || (scope !== 'all' && workerShift !== scope)) return;
            workersById.set(member.id, {
                ...saved,
                id: member.id,
                name: saved.name || member.displayName || member.user?.username || 'Unknown',
                shift: saved.shift || workerShift
            });
        });
    }

    Object.values(attendanceData).forEach(user => {
        const workerShift = getRankingWorkerShift(user, guild);
        if (!workerShift || (scope !== 'all' && workerShift !== scope)) return;
        workersById.set(user.id, {
            ...user,
            shift: user.shift || workerShift
        });
    });

    const sorted = Array.from(workersById.values())
        .sort((a, b) => ((b.points || 0) - (a.points || 0)) || String(a.name || '').localeCompare(String(b.name || '')));
    const legend = 'Legend: [Normal/Late/Absent/Early/OT/Off]';
    const lines = sorted.length
        ? sorted.map((u, idx) => {
            const name = truncateWidth((u.name || 'Unknown').split('-')[0].trim(), 18);
            const stats = `${u.totalNormal || 0}/${u.totalLate || 0}/${u.totalAbsent || 0}/${u.totalEarly || 0}/${u.totalOT || 0}/${u.offCount || 0}`;
            return `${String(idx + 1).padStart(2, '0')}. ${padWidth(name, 20)} ${String(u.points || 0).padStart(5)} pts  [${stats}]`;
        }).join('\n')
        : 'No day/night worker attendance data.';

    const titleByScope = {
        all: 'Combined Day/Night Worker Ranking',
        day: 'Day Shift Worker Ranking',
        night: 'Night Shift Worker Ranking'
    };

    return new EmbedBuilder()
        .setTitle(titleByScope[scope])
        .setDescription(`\`\`\`\n${legend}\n${lines}\n\`\`\``)
        .setColor('#F1C40F')
        .setFooter({ text: `Members shown: ${sorted.length}. DAY/NIGHT role members are included, even at 0 pts.` })
        .setTimestamp();
}

async function buildInactiveCandidatesEmbed(guild, days = CONFIG.INACTIVE_CANDIDATE_DAYS) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const thresholdDays = Math.max(1, Math.min(30, Number(days) || CONFIG.INACTIVE_CANDIDATE_DAYS));
    const cutoff = now.clone().subtract(thresholdDays, 'days');
    await refreshGuildMembers(guild, { force: false, minIntervalMs: 5 * 60 * 1000 });

    const candidates = guild.members.cache
        .filter(member => {
            if (!member || member.user?.bot) return false;
            if (isOwnerId(member.id)) return false;
            if (member.permissions?.has(PermissionFlagsBits.Administrator)) return false;
            const u = getAttendanceData()[member.id];
            if (u?.checkedIn || u?.disconnected || u?.dayOff || getOvertimeUsers().some(ot => ot.id === member.id)) return false;
            const lastAt = u?.lastActivityAt || (member.joinedTimestamp ? moment(member.joinedTimestamp).tz(CONFIG.TIMEZONE).toISOString() : null);
            return Boolean(lastAt && moment(lastAt).tz(CONFIG.TIMEZONE).isBefore(cutoff));
        })
        .map(member => {
            const u = getAttendanceData()[member.id] || {};
            const lastAt = u.lastActivityAt || moment(member.joinedTimestamp).tz(CONFIG.TIMEZONE).toISOString();
            const source = u.lastActivitySource || 'joined';
            return {
                id: member.id,
                name: member.displayName || member.user?.username || 'Unknown',
                source,
                lastAt: moment(lastAt).tz(CONFIG.TIMEZONE),
                days: now.diff(moment(lastAt).tz(CONFIG.TIMEZONE), 'days')
            };
        })
        .sort((a, b) => a.lastAt.valueOf() - b.lastAt.valueOf());

    const rows = candidates.length
        ? candidates.slice(0, 30).map(c => {
            const name = padWidth(truncateWidth(c.name, 18), 19);
            return `${name} | ${String(c.days).padStart(2)}d | ${c.lastAt.format('MM/DD HH:mm')} | ${c.source}`;
        })
        : ['No inactive kick candidates.'];

    const embed = new EmbedBuilder()
        .setTitle('Inactive Kick Candidate Report')
        .setColor(candidates.length ? '#E67E22' : '#2ECC71')
        .setDescription(`기준: 마지막 관찰 활동 ${thresholdDays}일 이상 없음\n주의: 아직 자동 추방하지 않고 후보만 표시합니다.`)
        .setFooter({ text: 'Activity sources: message | voice_state | command | button | joined' })
        .setTimestamp();

    let chunk = [];
    let chunkLength = 8;
    let page = 1;
    for (const row of rows) {
        const nextLength = chunkLength + row.length + 1;
        if (chunk.length && nextLength > 950) {
            safeAddFields(embed, { name: `Candidates (${candidates.length}) #${page}`, value: renderEmbedCodeBlock(chunk.join('\n')), inline: false });
            chunk = [];
            chunkLength = 8;
            page++;
        }
        chunk.push(row);
        chunkLength += row.length + 1;
    }
    if (chunk.length) {
        safeAddFields(embed, { name: `Candidates (${candidates.length}) #${page}`, value: renderEmbedCodeBlock(chunk.join('\n')), inline: false });
    }
    return embed;
}

    return {
        sendDeepReport,
        sendOpsReport,
        getRankingWorkerShift,
        buildRankingEmbed,
        buildInactiveCandidatesEmbed
    };
}

module.exports = { createReportingWorkflow };
