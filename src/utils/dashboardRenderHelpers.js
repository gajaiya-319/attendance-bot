'use strict';

function createDashboardRenderHelpers({
    moment,
    timezone,
    padWidth,
    truncateWidth,
    formatDuration,
    getShiftBounds,
    getLiveException = () => null,
    getAttendanceUser = () => null,
    getLiveOffSummary = () => null
}) {
    if (!moment) throw new Error('moment is required');
    if (!timezone) throw new Error('timezone is required');
    if (typeof padWidth !== 'function') throw new Error('padWidth is required');
    if (typeof truncateWidth !== 'function') throw new Error('truncateWidth is required');

    function getDashboardName(user) {
        return (user?.dashboardName || user?.name || 'Unknown').split('-')[0].trim() || 'Unknown';
    }

    function formatCompactDuration(mins) {
        const safeMins = Math.max(0, Math.floor(Number(mins) || 0));
        const hours = Math.floor(safeMins / 60);
        const minutes = safeMins % 60;
        if (hours > 0) return `${hours}h${String(minutes).padStart(2, '0')}`;
        return `${minutes}m`;
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
        const height = Math.max(5, rows.length);
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
        if (user?.dashboardVoiceConnected === false) return 'not in voice';
        if (user?.voiceJoinedAt || user?.lastLiveOnAt) return 'not checked in';
        if (user?.shift && typeof getShiftBounds === 'function') {
            const bounds = getShiftBounds(user.shift, now);
            if (bounds?.start && now.isBefore(bounds.start)) return 'before shift';
        }
        return 'waiting';
    }

    function getAbsentGraceInfo(user, now) {
        if (!user?.shift || typeof getShiftBounds !== 'function') return null;
        const bounds = getShiftBounds(user.shift, now);
        if (!bounds?.start || now.isBefore(bounds.start)) return null;
        const elapsedMins = Math.max(0, now.diff(bounds.start, 'minutes'));
        const absentAfterMins = 120;
        return {
            elapsedMins,
            remainingMins: Math.max(0, absentAfterMins - elapsedMins),
            isDue: elapsedMins >= absentAfterMins
        };
    }

    function getOvertimeTiming(ot, now) {
        const u = getAttendanceUser(ot?.id) || ot || {};
        const explicitStart = ot?.startedAt || ot?.otStartedAt || u.otStartedAt;
        let startedAt = explicitStart ? moment(explicitStart).tz(timezone) : null;
        let pending = false;

        if ((!startedAt || !startedAt.isValid()) && ot?.type !== 'PRE_OT' && ot?.type !== 'FORCED' && u.shift && typeof getShiftBounds === 'function') {
            const bounds = getShiftBounds(u.shift, now);
            if (bounds?.end) startedAt = moment(bounds.end).tz(timezone);
        }

        if ((!startedAt || !startedAt.isValid()) && (ot?.type === 'PRE_OT' || ot?.type === 'FORCED') && u.checkInRaw) {
            startedAt = moment(u.checkInRaw).tz(timezone);
        }

        if (!startedAt || !startedAt.isValid()) {
            return { user: u, startedAt: null, minutes: 0, pending: false };
        }

        if (now.isBefore(startedAt)) {
            pending = true;
        }

        return {
            user: u,
            startedAt,
            minutes: pending ? 0 : Math.max(0, now.diff(startedAt, 'minutes')),
            pending
        };
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
                    const canUseVoiceTime = u.dashboardVoiceConnected !== false;
                    const firstAt = u.preShiftLiveAt || (canUseVoiceTime ? (u.voiceJoinedAt || u.lastLiveOnAt || u.checkInRaw) : null);
                    const status = u.preShiftLiveAt ? 'LIVE' : (u.dashboardVoiceConnected === false ? 'NO VOICE CH' : 'WAIT NO LIVE');
                    const grace = getAbsentGraceInfo(u, now);
                    const timeText = firstAt ? moment(firstAt).tz(timezone).format('hh:mm A') : '--:--';
                    const absentText = grace && !grace.isDue ? ` | ABS ${formatCompactDuration(grace.remainingMins)}` : '';
                    meta = `${padWidth(status, 8)} ${timeText}${absentText}`;
                }
                if (mode === 'finished') meta = u.checkOutTime ? `OUT ${u.checkOutTime}` : '퇴근 완료';
                if (mode === 'liveoff') {
                    const liveOffAt = u.liveOffStartedAt || u.voiceJoinedAt;
                    const currentMins = liveOffAt ? Math.max(0, now.diff(moment(liveOffAt).tz(timezone), 'minutes')) : 0;
                    const summary = getLiveOffSummary(u, now) || {};
                    const totalMins = Number.isFinite(summary.trackedMinutes) ? summary.trackedMinutes : currentMins;
                    const deadlineMins = Number.isFinite(summary.clockOutInMinutes) ? summary.clockOutInMinutes : null;
                    const warnings = Array.isArray(u.liveOffWarningMarks)
                        ? u.liveOffWarningMarks.filter(mark => Number(mark) > 0).sort((a, b) => Number(a) - Number(b))
                        : [];
                    const warnText = warnings.length ? ` | W${warnings.join('/')}` : '';
                    const outText = deadlineMins !== null ? ` | OUT ${formatCompactDuration(deadlineMins)}` : '';
                    meta = liveOffAt
                        ? `NOW ${formatCompactDuration(currentMins)} | TOT ${formatCompactDuration(totalMins)}${warnText}${outText}`
                        : `NOW -- | TOT ${formatCompactDuration(totalMins)}${warnText}${outText}`;
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

    function getAttentionMeta(user, now, mode) {
        if (mode === 'liveoff') {
            const summary = getLiveOffSummary(user, now) || {};
            const totalMins = Number.isFinite(summary.trackedMinutes) ? summary.trackedMinutes : 0;
            return { detail: `OFF ${formatCompactDuration(totalMins)}`, action: 'LIVE ON' };
        }
        if (mode === 'dc') {
            const disconnectedAt = user?.disconnectedAt ? moment(user.disconnectedAt).tz(timezone) : null;
            const mins = disconnectedAt ? Math.max(0, now.diff(disconnectedAt, 'minutes')) : 0;
            return { detail: `DC ${formatCompactDuration(mins)}`, action: 'REJOIN' };
        }
        if (mode === 'absent') {
            const bounds = getShiftBounds(user?.shift, now);
            const mins = bounds?.start ? Math.max(0, now.diff(bounds.start, 'minutes')) : 0;
            return { detail: `NO SHOW ${formatCompactDuration(mins)}`, action: 'ABSENT' };
        }
        if (mode === 'earlyout') {
            const mins = Number(user?.dashboardEarlyOutMins || user?.earlyOutMins || 0);
            return { detail: `EARLY ${formatCompactDuration(mins)}`, action: 'Mgr chk' };
        }
        if (mode === 'excessiveLate') {
            const bounds = getShiftBounds(user?.shift, now);
            const mins = bounds?.start ? Math.max(0, now.diff(bounds.start, 'minutes')) : 0;
            return { detail: `LATE ${formatCompactDuration(mins)}`, action: 'Mgr chk' };
        }
        if (mode === 'standby') {
            const grace = getAbsentGraceInfo(user, now);
            const time = grace && !grace.isDue ? formatCompactDuration(grace.remainingMins) : '--';
            const action = user?.dashboardVoiceConnected === false ? '' : '';
            const detail = user?.dashboardVoiceConnected === false ? `NO VOICE CH | ABS ${time}` : `WAIT NO LIVE | ABS ${time}`;
            return { detail, action };
        }
        if (mode === 'overtime') {
            const timing = getOvertimeTiming(user, now);
            if (timing.pending && timing.startedAt) {
                return { detail: `OT WAIT ${formatCompactDuration(timing.startedAt.diff(now, 'minutes'))}`, action: 'SHIFT END' };
            }
            return { detail: `OT ${formatCompactDuration(timing.minutes)}`, action: 'WORKING' };
        }
        return { detail: 'CHECK', action: String(mode || 'CHECK').toUpperCase() };
    }

    function renderAttentionSummary(groups = {}, now, limit = 10) {
        if (typeof formatDuration !== 'function') throw new Error('formatDuration is required');
        const candidates = [
            ...(groups.liveOff || []).map(user => ({ priority: 1, icon: '📴LIVEOFF', user, mode: 'liveoff' })),
            ...(groups.disconnected || []).map(user => ({ priority: 2, icon: '⚡DC', user, mode: 'dc' })),
            ...(groups.absent || []).map(user => ({ priority: 3, icon: '❌ABSENT', user, mode: 'absent' })),
            ...(groups.earlyFinished || groups.earlyOut || []).map(user => ({ priority: 4, icon: '⚠️EARLYOUT', user, mode: 'earlyout' })),
            ...(groups.excessiveLate || []).map(user => ({ priority: 5, icon: '⚠️2H LATE', user, mode: 'excessiveLate' })),
            ...(groups.overtime || []).map(user => ({ priority: 6, icon: '🔥OT', user, mode: 'overtime' })),
            ...(groups.standby || []).map(user => ({ priority: 7, icon: '⏳WAIT', user, mode: 'standby' }))
        ];
        if (!candidates.length) return 'NONE';
        const lines = candidates
            .sort((a, b) => {
                const au = a.mode === 'overtime' ? getOvertimeTiming(a.user, now).user : a.user;
                const bu = b.mode === 'overtime' ? getOvertimeTiming(b.user, now).user : b.user;
                return a.priority - b.priority || getDashboardName(au).localeCompare(getDashboardName(bu));
            })
            .slice(0, limit)
            .map(item => {
                const displayUser = item.mode === 'overtime' ? getOvertimeTiming(item.user, now).user : item.user;
                const name = padWidth(truncateWidth(getDashboardName(displayUser), 13), 14);
                const meta = getAttentionMeta(item.user, now, item.mode);
                if (item.mode === 'standby') {
                    return `${padWidth(item.icon, 10)} ${name} ${truncateWidth(meta.detail, 24)}`;
                }
                return `${padWidth(item.icon, 10)} ${name} ${truncateWidth(meta.detail, 18)} -> ${truncateWidth(meta.action, 10)}`;
            });
        const remaining = candidates.length - lines.length;
        if (remaining > 0) lines.push(`... +${remaining} more`);
        return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
    }

    function renderOvertimeList(now, source = []) {
        if (!source.length) return 'NONE';
        if (typeof formatDuration !== 'function') throw new Error('formatDuration is required');

        const lines = source
            .map(ot => {
                const u = getAttendanceUser(ot.id) || ot;
                const name = padWidth(truncateWidth(getDashboardName(u), 16), 17);
                const timing = getOvertimeTiming(ot, now);
                const mins = timing.minutes;
                const typeLabel = ot.type === 'PRE_OT' ? 'P-OT' : ot.type === 'FORCED' ? 'F-OT' : ot.type === 'MANUAL' ? 'M-OT' : ot.type === 'AUTO' ? 'A-OT' : 'OT';
                const meta = timing.pending && timing.startedAt
                    ? `대기 ${formatCompactDuration(timing.startedAt.diff(now, 'minutes'))}`
                    : (mins > 0 ? formatDuration(mins) : '0시간 0분');
                return `${padWidth(typeLabel, 5)} ${name} ${meta}`;
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
        renderAttentionSummary,
        renderOvertimeList,
        renderDashboardHeader,
        formatKoreanDateTime,
        renderPercentBar
    };
}

module.exports = {
    createDashboardRenderHelpers
};
