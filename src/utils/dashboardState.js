'use strict';

function createDashboardStateUtils(deps) {
    const {
        CONFIG,
        moment,
        getScheduledEndMoment,
        getRecentMaintenanceEnd,
        isWithinPreShiftWindow,
        getMemberShiftRole,
        getActiveLiveException,
        getOvertimeUsers
    } = deps;

    function overtimeUsers() {
        return typeof getOvertimeUsers === 'function' ? getOvertimeUsers() : [];
    }

    function shouldShowPostMaintenanceFinished(member, user, activeShift, now) {
        if (!member?.roles?.cache || !user || !activeShift) return false;
        if (user.dayOff || user.checkedIn || user.disconnected || overtimeUsers().some(ot => ot.id === member.id)) return false;
        if (!getRecentMaintenanceEnd(now)) return false;
        const previousShift = activeShift === 'day' ? 'night' : 'day';
        const previousRoleId = previousShift === 'day' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
        const activeRoleId = activeShift === 'day' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
        if (!member.roles.cache.has(previousRoleId) || member.roles.cache.has(activeRoleId)) return false;
        const voiceState = member.guild?.voiceStates?.cache?.get(member.id);
        return Boolean(member.voice?.channelId || voiceState?.channelId);
    }

    function shouldShowAsPreShiftStandby(member, user, now) {
        const shift = user?.shift || getMemberShiftRole(member);
        if (!shift || user?.dayOff || user?.isFinished) return false;
        const voiceState = member.guild?.voiceStates?.cache?.get(member.id);
        const isVoiceConnected = Boolean(member.voice?.channelId || voiceState?.channelId);
        const hasPreShiftLive = Boolean(user?.preShiftLiveAt);
        return isWithinPreShiftWindow(shift, now) && (isVoiceConnected || hasPreShiftLive);
    }

    function getLegacyDashboardState(user, context) {
        const {
            isVoiceLiveOff,
            isPreShift,
            isStreaming,
            isVoiceConnected,
            hasLiveOffVoice,
            liveException,
            bounds,
            now
        } = context;

        if (user.dayOff) return 'LEAVE';
        if (liveException) return isVoiceConnected ? 'LIVE_EXCEPTION' : 'WAITING';
        if (user.isFinished) return 'FINISHED';
        if (isVoiceLiveOff && !isPreShift && user.checkedIn) return 'LIVE_OFF';
        if (user.disconnected) return 'DISCONNECTED';
        if (user.checkedIn && !isStreaming) return 'LIVE_OFF';
        if ((hasLiveOffVoice || (isVoiceConnected && !isStreaming)) && user.checkedIn) return isPreShift ? 'WAITING' : 'LIVE_OFF';
        if (user.checkedIn) return user.status === 'late' ? 'LATE' : 'ACTIVE';
        if (isVoiceConnected && !isStreaming) return 'WAITING';
        return now.isAfter(bounds.start) && now.diff(bounds.start, 'minutes') > 120 ? 'ABSENT' : 'WAITING';
    }

    function getHybridDashboardState(user, context) {
        const legacy = getLegacyDashboardState(user, context);
        const attendanceStatus = user.attendanceStatus || null;
        const voiceStatus = user.voiceStatus || null;
        const { now, bounds, isVoiceConnected, isStreaming } = context;
        const shiftEnd = getScheduledEndMoment(user, now);
        const isShiftEnded = shiftEnd && now.isSameOrAfter(shiftEnd);
        const isWithinCurrentShiftBounds = Boolean(
            bounds?.start &&
            bounds?.end &&
            now.isSameOrAfter(bounds.start) &&
            now.isBefore(bounds.end)
        );
        const isOT = overtimeUsers().some(ot => ot.id === user.id);
        const finishedAt = user.checkOutRaw || user.attendanceStatusChangedAt || null;
        const finishedVisibleExpired = Boolean(
            user.isFinished &&
            finishedAt &&
            now.diff(moment(finishedAt).tz(CONFIG.TIMEZONE), 'minutes') > CONFIG.FINISHED_VISIBLE_AFTER_MINS
        );

        if (context.liveException) return 'LIVE_EXCEPTION';
        if (!attendanceStatus && !voiceStatus) return legacy;
        if (user.dayOff || attendanceStatus === 'DAY_OFF') return 'LEAVE';
        const finishedBeforeCurrentShift = Boolean(finishedAt && bounds?.start && moment(finishedAt).tz(CONFIG.TIMEZONE).isBefore(bounds.start));
        if (finishedVisibleExpired && isWithinCurrentShiftBounds && finishedBeforeCurrentShift && !user.checkedIn && !isOT) {
            if (isVoiceConnected && !isStreaming) return 'WAITING';
            return now.diff(bounds.start, 'minutes') > 120 ? 'ABSENT' : 'WAITING';
        }
        if (attendanceStatus === 'FINISHED' || user.isFinished) return 'FINISHED';

        if (isShiftEnded && !isWithinCurrentShiftBounds && !isOT && user.checkedIn) {
            return 'FINISHED';
        }

        if (voiceStatus === 'DISCONNECTED' || user.disconnected) return 'DISCONNECTED';

        if (attendanceStatus === 'OVERTIME' || attendanceStatus === 'WORKING') {
            if (voiceStatus === 'LIVE_OFF') return 'LIVE_OFF';
            if (voiceStatus === 'LIVE_ON') return user.status === 'late' ? 'LATE' : 'ACTIVE';
            if (voiceStatus === 'OFFLINE') return user.checkedIn ? legacy : 'WAITING';
        }

        if (attendanceStatus === 'PRE_SHIFT') return legacy;
        return legacy;
    }

    function deriveAttendanceStatusForAudit(user) {
        if (!user) return 'UNKNOWN';
        if (user.dayOff) return 'DAY_OFF';
        if (overtimeUsers().some(ot => ot.id === user.id)) return 'OVERTIME';
        if (user.checkedIn || user.disconnected) return 'WORKING';
        if (user.isFinished) return 'FINISHED';
        if (user.shift) return 'PRE_SHIFT';
        return 'UNKNOWN';
    }

    function deriveVoiceStatusForAudit(member, user, now) {
        if (!user) return 'UNKNOWN';
        if (getActiveLiveException(user.id, now)) return 'EXCEPTION';
        if (user.disconnected) return 'DISCONNECTED';
        const voiceState = member?.guild?.voiceStates?.cache?.get(user.id);
        const isConnected = Boolean(member?.voice?.channelId || voiceState?.channelId);
        const isStreaming = Boolean(member?.voice?.streaming || voiceState?.streaming);
        if (isStreaming) return 'LIVE_ON';
        if (isConnected) return 'LIVE_OFF';
        return 'OFFLINE';
    }

    return {
        shouldShowPostMaintenanceFinished,
        shouldShowAsPreShiftStandby,
        getLegacyDashboardState,
        getHybridDashboardState,
        deriveAttendanceStatusForAudit,
        deriveVoiceStatusForAudit
    };
}

module.exports = createDashboardStateUtils;
