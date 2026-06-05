'use strict';

function createDashboardRenderHelpers({
    moment,
    timezone,
    padWidth,
    truncateWidth,
    formatDuration,
    getShiftBounds,
    getLiveException = () => null,
    getAttendanceUser = () => null
}) {
    if (!moment) throw new Error('moment is required');
    if (!timezone) throw new Error('timezone is required');
    if (typeof padWidth !== 'function') throw new Error('padWidth is required');
    if (typeof truncateWidth !== 'function') throw new Error('truncateWidth is required');

    function getDashboardName(user) {
        return (user?.dashboardName || user?.name || 'Unknown').split('-')[0].trim() || 'Unknown';
    }

    function renderCleanGrid(arr, icon) {
        if (!arr || arr.length === 0) return 'NONE';
        const sorted = [...arr].sort((a, b) => getDashboardName(a).localeCompare(getDashboardName(b)));
        const fixN = (u) => padWidth(truncateWidth(getDashboardName(u), 10), 11);
        const fixT = (t) => padWidth(String(t || '00:00').replace(/\s?[AP]M$/i, '').trim(), 5);
        const formatCell = (u) => `${icon} ${fixT(u.checkInTime)} ${fixN(u)}`;
        let lines = "```\n";
        for (let i = 0; i < sorted.length; i += 2) {
            const left = sorted[i];
            const right = sorted[i + 1];
            lines += formatCell(left) + (right ? `  ${formatCell(right)}` : '') + "\n";
        }
        return lines + "```";
    }

    function renderSummaryBox(rows) {
        const labelWidth = 10;
        const valueWidth = 3;
        const height = Math.max(4, rows.length);
        const width = labelWidth + valueWidth;
        const lines = rows.map(([label, value]) => `${padWidth(label, labelWidth)}${String(value).padStart(valueWidth)}`);
        while (lines.length < height) lines.push(' '.repeat(width));
        return `\`\`\`text\n${lines.slice(0, height).join('\n')}\n\`\`\``;
    }

    function renderShiftSummary(label, groups) {
        return `${label} | ABSENT ${groups.absent.length} | DC ${groups.disconnected.length} | WAITING ${groups.standby.length} | ACTIVE ${groups.active.length} | OFF ${groups.leave.length}`;
    }

    function getStandbyReason(user, now) {
        if (user?.pendingManualOT) return 'manual OT pending';
        if (user?.manualResumeRequired) return 'clock-in required';
        if (user?.preShiftLiveAt) return 'pre-shift live';
        if (user?.voiceJoinedAt || user?.lastLiveOnAt) return 'not checked in';
        if (user?.shift && typeof getShiftBounds === 'function') {
            const bounds = getShiftBounds(user.shift, now);
            if (bounds?.start && now.isBefore(bounds.start)) return 'before shift';
        }
        return 'waiting';
    }

    function renderStatusList(arr, icon, now, mode = 'time') {
        if (!arr || arr.length === 0) return 'NONE';
        if (typeof formatDuration !== 'function') throw new Error('formatDuration is required');
        if (typeof getShiftBounds !== 'function') throw new Error('getShiftBounds is required');

        const lines = arr
            .sort((a, b) => {
                if (mode !== 'standby') return getDashboardName(a).localeCompare(getDashboardName(b));
                const rank = (u) => {
                    const liveRank = u.preShiftLiveAt ? 0 : 1;
                    const firstAt = u.preShiftLiveAt || u.voiceJoinedAt || u.lastLiveOnAt || u.checkInRaw || now.toISOString();
                    return `${liveRank}:${moment(firstAt).valueOf()}:${getDashboardName(u)}`;
                };
                return rank(a).localeCompare(rank(b));
            })
            .map(u => {
                const name = padWidth(truncateWidth(getDashboardName(u), 16), 17);
                let meta = u.checkInTime || '00:00';
                if (mode === 'dc' && u.disconnectedAt) meta = `DC ${formatDuration(now.diff(moment(u.disconnectedAt), 'minutes'))}`;
                if (mode === 'absent') meta = `+${formatDuration(now.diff(getShiftBounds(u.shift, now).start, 'minutes'))}`;
                if (mode === 'standby') {
                    const firstAt = u.preShiftLiveAt || u.voiceJoinedAt || u.lastLiveOnAt || u.checkInRaw;
                    const status = u.preShiftLiveAt ? 'LIVE' : 'OFF ';
                    const reason = getStandbyReason(u, now);
                    meta = firstAt ? `${status} ${moment(firstAt).tz(timezone).format('hh:mm A')} [${reason}]` : `${status} [${reason}]`;
                }
                if (mode === 'finished') meta = u.checkOutTime ? `OUT ${u.checkOutTime}` : '퇴근 완료';
                if (mode === 'liveoff') {
                    const liveOffAt = u.liveOffStartedAt || u.voiceJoinedAt;
                    meta = liveOffAt ? `OFF ${formatDuration(now.diff(moment(liveOffAt), 'minutes'))}` : 'LIVE OFF';
                }
                if (mode === 'exception') {
                    const ex = getLiveException(u.id);
                    const minsLeft = ex?.expiresAt ? Math.max(0, moment(ex.expiresAt).diff(now, 'minutes')) : 0;
                    meta = `${formatDuration(minsLeft)} 남음`;
                }
                return `${icon} ${name} ${meta}`;
            });
        return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
    }

    function renderOvertimeList(now, source = []) {
        if (!source.length) return 'NONE';
        if (typeof formatDuration !== 'function') throw new Error('formatDuration is required');

        const lines = source
            .map(ot => {
                const u = getAttendanceUser(ot.id) || ot;
                const name = padWidth(truncateWidth(getDashboardName(u), 16), 17);
                const otStartedAt = ot.startedAt || u.otStartedAt || u.checkInRaw;
                const mins = otStartedAt ? now.diff(moment(otStartedAt).tz(timezone), 'minutes') : 0;
                const typeLabel = ot.type === 'PRE_OT' ? 'P-OT' : ot.type === 'FORCED' ? 'F-OT' : ot.type === 'MANUAL' ? 'M-OT' : ot.type === 'AUTO' ? 'A-OT' : 'OT';
                return `${padWidth(typeLabel, 5)} ${name} ${mins > 0 ? formatDuration(mins) : ''}`;
            })
            .sort();
        return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
    }

    function renderDashboardHeader(now, maintenance = false, buildLabel = null) {
        const dateStr = now.format('ddd, MMM DD, YYYY').toUpperCase();
        const status = maintenance ? '[ MAINTENANCE - WORK CLOSED ]' : `[ ${dateStr} ]`;
        const buildLine = buildLabel ? `\n> \`🤖 ${buildLabel}\`` : '';
        const widthKeeper = '\u2800'.repeat(80);
        return `> # ⏱️ PH TIME: **${now.format('hh:mm:ss A')}**\n>      **[${status}](https://-)**\n${widthKeeper}${buildLine}`;
    }

    function formatKoreanDateTime(value) {
        return moment(value).tz(timezone).format('YYYY년 MM월 DD일 HH:mm');
    }

    function renderPercentBar(percent, size = 10) {
        const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
        const filled = Math.round((safePercent / 100) * size);
        return `[${'#'.repeat(filled)}${'.'.repeat(size - filled)}] ${String(safePercent).padStart(3)}%`;
    }

    return {
        getDashboardName,
        renderCleanGrid,
        renderSummaryBox,
        renderShiftSummary,
        renderStatusList,
        renderOvertimeList,
        renderDashboardHeader,
        formatKoreanDateTime,
        renderPercentBar
    };
}

module.exports = {
    createDashboardRenderHelpers
};
