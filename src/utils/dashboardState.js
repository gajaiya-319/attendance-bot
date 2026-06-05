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

    function shouldIncludeCurrentShiftMember(member, context = {}) {
        const {
            user,
            voiceState,
            activeDisplayShift,
            roleId,
            dashboardMaintenance = false,
            now
        } = context;

        if (CONFIG.EXCEPTIONS?.SHARED_SEAT_USER && member?.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) return true;
        const isVoiceConnected = Boolean(member?.voice?.channelId || voiceState?.channelId);
        const roleMatchesCurrentShift = Boolean(!dashboardMaintenance && member?.roles?.cache?.has(roleId));
        const postMaintenanceFinished = Boolean(
            !dashboardMaintenance &&
            shouldShowPostMaintenanceFinished(member, user, activeDisplayShift, now)
        );
        const finishedAt = user?.checkOutRaw || user?.attendanceStatusChangedAt;
        const finishedTooLong = Boolean(
            user?.isFinished &&
            !user?.checkedIn &&
            !user?.disconnected &&
            finishedAt &&
            now.diff(moment(finishedAt).tz(CONFIG.TIMEZONE), 'minutes') > CONFIG.FINISHED_VISIBLE_AFTER_MINS
        );
        const hasOvertime = overtimeUsers().some(ot => ot.id === member?.id);
        if (finishedTooLong && !roleMatchesCurrentShift && !postMaintenanceFinished && !user?.dayOff && !hasOvertime) return false;
        const recentManualAction = Boolean(
            user?.manualPanelTouchedAt &&
            now.diff(moment(user.manualPanelTouchedAt).tz(CONFIG.TIMEZONE), 'minutes') <= 10 &&
            user?.shift === activeDisplayShift
        );
        const preShiftStandby = shouldShowAsPreShiftStandby(member, user, now);
        const hasTrackedState = Boolean(
            user &&
            !user.dayOff &&
            (
                user.checkedIn ||
                user.disconnected ||
                user.pendingManualOT ||
                hasOvertime ||
                (user.isFinished && isVoiceConnected && !finishedTooLong) ||
                postMaintenanceFinished
            )
        );
        return roleMatchesCurrentShift || recentManualAction || preShiftStandby || postMaintenanceFinished || hasTrackedState;
    }

    function getDashboardMemberRelation(member, activeShift) {
        const memberShift = getMemberShiftRole(member);
        if (!memberShift || !activeShift) return 'unknown';
        if (memberShift === activeShift) return 'current';
        return 'previous-or-other';
    }

    function shouldHidePreviousShiftWaiting(member, activeShift, state) {
        return getDashboardMemberRelation(member, activeShift) === 'previous-or-other' && state === 'WAITING';
    }

    function getDashboardBaseName(member) {
        return (member?.displayName || member?.user?.username || 'Unknown').split('-')[0].trim() || 'Unknown';
    }

    function buildDashboardNameCounts(members = []) {
        const counts = new Map();
        const iterable = typeof members.values === 'function' ? members.values() : members;
        for (const member of iterable) {
            const key = getDashboardBaseName(member).toLowerCase();
            counts.set(key, (counts.get(key) || 0) + 1);
        }
        return counts;
    }

    function getDashboardDisplayName(member, dashboardNameCounts = new Map()) {
        const baseName = getDashboardBaseName(member);
        return dashboardNameCounts.get(baseName.toLowerCase()) > 1
            ? `${baseName}#${String(member?.id || '').slice(-4)}`
            : baseName;
    }

    function buildCurrentRoleMemberIds(members = [], roleId, dashboardMaintenance = false) {
        const ids = new Set();
        if (dashboardMaintenance) return ids;
        const iterable = typeof members.values === 'function' ? members.values() : members;
        for (const member of iterable) {
            if (!member?.id) continue;
            const matchesCurrentRole = Boolean(roleId && member.roles?.cache?.has(roleId));
            const isSharedSeat = Boolean(CONFIG.EXCEPTIONS?.SHARED_SEAT_USER && member.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER);
            if (matchesCurrentRole || isSharedSeat) ids.add(member.id);
        }
        return ids;
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
        if (user.isFinished) return 'FINISHED';
        if (isVoiceLiveOff && !isPreShift && user.checkedIn) return 'LIVE_OFF';
        if (user.disconnected) return 'DISCONNECTED';
        if (liveException) return isVoiceConnected ? 'LIVE_EXCEPTION' : 'DISCONNECTED';
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

        if (!attendanceStatus && !voiceStatus) return legacy;
        if (user.dayOff || attendanceStatus === 'DAY_OFF') {
            if (isStreaming && !user.disconnected) {
                return user.status === 'late' ? 'LATE' : 'ACTIVE';
            }
            return 'LEAVE';
        }
        if (isStreaming && !user.disconnected) {
            if (context.liveException) return 'LIVE_EXCEPTION';
            return user.status === 'late' ? 'LATE' : 'ACTIVE';
        }
        const finishedBeforeCurrentShift = Boolean(finishedAt && bounds?.start && moment(finishedAt).tz(CONFIG.TIMEZONE).isBefore(bounds.start));
        if (finishedVisibleExpired && isWithinCurrentShiftBounds && finishedBeforeCurrentShift && !user.checkedIn && !isOT) {
            if (isVoiceConnected && !isStreaming) return 'WAITING';
            return now.diff(bounds.start, 'minutes') > 120 ? 'ABSENT' : 'WAITING';
        }
        if (attendanceStatus === 'FINISHED' || user.isFinished) return 'FINISHED';
        if (voiceStatus === 'DISCONNECTED' || user.disconnected) return 'DISCONNECTED';
        if (context.liveException) return isVoiceConnected ? 'LIVE_EXCEPTION' : 'DISCONNECTED';
        if ((voiceStatus === 'EXCEPTION' || user.status === 'exception') && user.checkedIn && !user.isFinished) {
            return isVoiceConnected ? 'LIVE_EXCEPTION' : 'DISCONNECTED';
        }

        if (isShiftEnded && !isWithinCurrentShiftBounds && !isOT && user.checkedIn) {
            return 'FINISHED';
        }

        if (attendanceStatus === 'OVERTIME' || attendanceStatus === 'WORKING') {
            if (isStreaming) return user.status === 'late' ? 'LATE' : 'ACTIVE';
            if (voiceStatus === 'LIVE_OFF') return 'LIVE_OFF';
            if (voiceStatus === 'LIVE_ON') return user.status === 'late' ? 'LATE' : 'ACTIVE';
            if (voiceStatus === 'OFFLINE') return user.checkedIn ? legacy : 'WAITING';
        }

        if (attendanceStatus === 'PRE_SHIFT') return legacy;
        return legacy;
    }

    function buildExclusiveDashboardGroups(visibleUsers = [], dashboardOvertimeUsers = []) {
        const byId = new Map(visibleUsers.map(user => [user.id, user]));
        const used = new Set();
        const takeUsers = (predicate) => visibleUsers.filter(user => {
            if (!user?.id || used.has(user.id)) return false;
            if (!predicate(user)) return false;
            used.add(user.id);
            return true;
        });

        const leave = takeUsers(user => user.fState === 'LEAVE' || user.dayOff);
        const overtime = dashboardOvertimeUsers.filter(ot => {
            const user = byId.get(ot.id);
            if (!user || used.has(ot.id) || user.dayOff) return false;
            used.add(ot.id);
            return true;
        });

        return {
            leave,
            overtime,
            liveExceptionUsers: takeUsers(user => user.fState === 'LIVE_EXCEPTION'),
            disconnected: takeUsers(user => user.fState === 'DISCONNECTED'),
            liveOff: takeUsers(user => user.fState === 'LIVE_OFF'),
            absent: takeUsers(user => user.fState === 'ABSENT'),
            active: takeUsers(user => ['ACTIVE', 'LATE'].includes(user.fState)),
            finished: takeUsers(user => user.fState === 'FINISHED'),
            standby: takeUsers(user => user.fState === 'WAITING')
        };
    }

    function getCacheValue(cache, id) {
        if (!cache) return null;
        if (typeof cache.get === 'function') return cache.get(id);
        return cache[id] || null;
    }

    function buildDashboardOvertimeUsers(overtimeEntries = [], context = {}) {
        const {
            attendanceData = {},
            membersCache,
            voiceStatesCache,
            currentRoleMemberIds = new Set(),
            activeDisplayShift = null,
            now
        } = context;

        return overtimeEntries.filter(ot => {
            const user = attendanceData[ot.id];
            const member = getCacheValue(membersCache, ot.id);
            const voiceState = getCacheValue(voiceStatesCache, ot.id);
            const isCurrentShiftMember = currentRoleMemberIds.has(ot.id) &&
                (!activeDisplayShift || !ot.shift || ot.shift === activeDisplayShift);
            const isStreamingNow = Boolean(member?.voice?.streaming || voiceState?.streaming);
            const hasLiveException = Boolean(getActiveLiveException(ot.id, now));
            return Boolean(
                member &&
                user?.checkedIn &&
                !user?.dayOff &&
                (!isCurrentShiftMember || ['MANUAL', 'FORCED', 'PRE_OT'].includes(ot.type)) &&
                (isStreamingNow || hasLiveException || ot.type === 'FORCED')
            );
        });
    }

    function getDashboardOvertimeCleanupDecision(ot, context = {}) {
        const {
            isCurrentRoleMember = false,
            isMainShiftTime = false,
            isStreaming = false
        } = context;

        if (!isCurrentRoleMember) return { keep: true, action: 'keep-previous-shift-overtime' };
        if (ot?.type === 'PRE_OT' && isMainShiftTime) {
            return { keep: false, action: 'end-pre-shift-ot' };
        }
        if (ot?.type === 'MANUAL' && isMainShiftTime) {
            return { keep: false, action: 'reserve-manual-ot' };
        }
        if (['MANUAL', 'PRE_OT'].includes(ot?.type)) {
            return { keep: true, action: 'keep-manual-or-pre-shift-overtime' };
        }
        if (!isMainShiftTime) return { keep: true, action: 'keep-outside-main-shift' };
        if (isStreaming) return { keep: false, action: 'end-current-shift-streaming-overtime' };
        return { keep: false, action: 'remove-current-shift-overtime' };
    }

    function shouldAutoFinishPreviousShiftMember(context = {}) {
        const {
            memberShift,
            activeDisplayShift,
            hasOvertime = false,
            hasLiveException = false,
            user,
            previousShiftEnd,
            now
        } = context;

        if (!memberShift || !activeDisplayShift || memberShift === activeDisplayShift) return false;
        if (hasOvertime || hasLiveException) return false;
        if (!user || (!user.checkedIn && !user.disconnected)) return false;
        if (!previousShiftEnd || !now?.isSameOrAfter) return false;
        return now.isSameOrAfter(previousShiftEnd);
    }

    function assignDashboardUserDisplayState(user, member, context = {}) {
        const {
            activeDisplayShift,
            isDashboardOvertime = false,
            isVoiceLiveOff = false,
            isPreShift = false,
            isStreaming = false,
            isVoiceConnected = false,
            hasLiveOffVoice = false,
            liveException = null,
            bounds,
            now
        } = context;

        const postMaintenanceFinished = shouldShowPostMaintenanceFinished(member, user, activeDisplayShift, now);
        if (isStreaming && isVoiceConnected && !user.disconnected) {
            user.fState = isDashboardOvertime
                ? 'OVERTIME'
                : (liveException
                    ? 'LIVE_EXCEPTION'
                    : (user.status === 'late' ? 'LATE' : 'ACTIVE'));
        } else if (postMaintenanceFinished) {
            user.fState = 'FINISHED';
        } else {
            user.fState = getHybridDashboardState(user, {
                isVoiceLiveOff,
                isPreShift,
                isStreaming,
                isVoiceConnected,
                hasLiveOffVoice,
                liveException,
                bounds,
                now
            });
            if (isDashboardOvertime) {
                user.fState = 'OVERTIME';
            } else if (shouldHidePreviousShiftWaiting(member, activeDisplayShift, user.fState)) {
                user.fState = 'OUT_OF_SCOPE';
            }
        }
        user.isOT = isDashboardOvertime;
        return user;
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
        if (user.disconnected) return 'DISCONNECTED';
        const voiceState = member?.guild?.voiceStates?.cache?.get(user.id);
        const isConnected = Boolean(member?.voice?.channelId || voiceState?.channelId);
        const isStreaming = Boolean(member?.voice?.streaming || voiceState?.streaming);
        if (getActiveLiveException(user.id, now)) return isConnected ? 'EXCEPTION' : 'DISCONNECTED';
        if (isStreaming) return 'LIVE_ON';
        if (isConnected) return 'LIVE_OFF';
        return 'OFFLINE';
    }

    return {
        shouldShowPostMaintenanceFinished,
        shouldShowAsPreShiftStandby,
        shouldIncludeCurrentShiftMember,
        getDashboardMemberRelation,
        shouldHidePreviousShiftWaiting,
        getDashboardBaseName,
        buildDashboardNameCounts,
        getDashboardDisplayName,
        buildCurrentRoleMemberIds,
        getLegacyDashboardState,
        getHybridDashboardState,
        buildExclusiveDashboardGroups,
        buildDashboardOvertimeUsers,
        getDashboardOvertimeCleanupDecision,
        shouldAutoFinishPreviousShiftMember,
        assignDashboardUserDisplayState,
        deriveAttendanceStatusForAudit,
        deriveVoiceStatusForAudit
    };
}

module.exports = createDashboardStateUtils;
