'use strict';

const { getLiveExceptionsMap } = require('../utils/liveExceptionsAccess');

function createDashboardWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        dashboardMessageService,
        dashboardStateUtils,
        getAttendanceData,
        getOvertimeUsers,
        setOvertimeUsers,
        getStatusMessageId,
        setStatusMessageId,
        saveSystemAsync,
        refreshGuildMembers,
        syncVoiceStates,
        expireDayOffSessions,
        isMaintenanceWindow,
        isWithinPreShiftWindow,
        getDashboardShift,
        getShiftBounds,
        getMemberShiftRole,
        getActiveApprovedDayOffReservation,
        applyApprovedDayOffReservation,
        ensureUserData,
        determineShift,
        normalizeCurrentShiftSession,
        handleClockOut,
        transitionRecordedStatus,
        isOvertimeEntryStillValid,
        getRankingWorkerShift,
        getDashboardName,
        applyCurrentShiftLiveOnState,
        applyLiveOnState = async () => ({ changed: false }),
        getLiveExceptions,
        isAssignedWorker = () => false,
        safeAddFields = () => {},
        renderDashboardHeader = () => '',
        renderSummaryBox = () => '',
        renderCleanGrid = () => 'NONE',
        renderStatusList = () => 'NONE',
        renderOvertimeList = () => 'NONE',
        formatDuration = mins => String(mins),
        logger = console
    } = deps;

    const DASHBOARD_LAYOUT_VERSION = 'classic-dashboard-wide-blank-v14';
    const DASHBOARD_INSTANCE_TAG = `pid:${process.pid}`;
    const DASHBOARD_RENDER_DEBOUNCE_MS = 2500;
    const DASHBOARD_MIN_VISIBLE_WORKERS = 10;
    const DASHBOARD_STATE_SETTLE_MS = 15 * 1000;

    let dashboardRenderTimer = null;
    let dashboardRenderPending = { forceMemberRefresh: false, reconcileSession: false };
    let dashboardRenderChain = Promise.resolve();
    let dashboardLastPublishedStableKey = null;
    let dashboardPendingStableKey = null;
    let dashboardPendingStableKeyAt = 0;
function readMemberVoicePresence(member, guild) {
    const memberId = member?.id;
    const voiceState = guild?.voiceStates?.cache?.get(memberId);
    const memberVoice = member?.voice;
    const channelId = voiceState?.channelId || memberVoice?.channelId;
    const isVoiceConnected = Boolean(channelId);
    const isStreaming = Boolean(
        voiceState?.streaming === true ||
        (memberVoice?.channelId && memberVoice.streaming === true)
    );
    return { voiceState: voiceState || memberVoice, isVoiceConnected, isStreaming };
}

function parseDashboardStableKey(stableKey) {
    if (!stableKey) return null;
    try {
        return JSON.parse(stableKey);
    } catch {
        return null;
    }
}

function isLiveOnRecoveryPublish(prevKey, nextKey) {
    const prev = parseDashboardStableKey(prevKey);
    const next = parseDashboardStableKey(nextKey);
    if (!prev || !next) return false;
    const prevLiveOff = new Set(prev.liveOff || []);
    const nextActive = new Set(next.active || []);
    for (const id of prevLiveOff) {
        if (nextActive.has(id)) return true;
    }
    return (prev.liveOff?.length || 0) > (next.liveOff?.length || 0) &&
        (next.active?.length || 0) >= (prev.active?.length || 0);
}

function buildLiveOffVoiceIds(guild) {
    const ids = new Set();
    for (const voiceState of guild.voiceStates.cache.values()) {
        if (!voiceState.channelId) continue;
        const member = voiceState.member || guild.members.cache.get(voiceState.id);
        const { isStreaming } = readMemberVoicePresence(member || { id: voiceState.id }, guild);
        if (!isStreaming) ids.add(voiceState.id);
    }
    return ids;
}

async function reconcileStreamingLiveOnStates(guild, now) {
    if (typeof applyLiveOnState !== 'function') return false;
    let changed = false;
    for (const voiceState of guild.voiceStates.cache.values()) {
        if (!voiceState.channelId || !voiceState.streaming) continue;
        const member = voiceState.member || guild.members.cache.get(voiceState.id);
        if (!member?.user || member.user.bot) continue;
        const u = getAttendanceData()[member.id];
        if (!u?.checkedIn || u.disconnected || u.isFinished || u.dayOff) continue;
        const { isStreaming } = readMemberVoicePresence(member, guild);
        if (!isStreaming) continue;
        if (u.voiceStatus === 'LIVE_ON' && !u.liveOffStartedAt) continue;
        const result = applyLiveOnState(u, now, 'dashboard-render', 'streaming-live-on-reconcile');
        if (result?.changed) changed = true;
    }
    return changed;
}

function queueDashboardRender(options = {}) {
    if (options?.forceMemberRefresh) dashboardRenderPending.forceMemberRefresh = true;
    if (options?.reconcileSession) dashboardRenderPending.reconcileSession = true;
    if (dashboardRenderTimer) clearTimeout(dashboardRenderTimer);
    dashboardRenderTimer = setTimeout(() => {
        dashboardRenderTimer = null;
        const opts = {
            forceMemberRefresh: dashboardRenderPending.forceMemberRefresh,
            reconcileSession: dashboardRenderPending.reconcileSession
        };
        dashboardRenderPending = { forceMemberRefresh: false, reconcileSession: false };
        dashboardRenderChain = dashboardRenderChain
            .then(() => renderDashboardCore(opts))
            .catch(error => console.error('[DASHBOARD QUEUE ERROR]', error));
    }, DASHBOARD_RENDER_DEBOUNCE_MS);
    return dashboardRenderChain;
}

function buildDashboardStableKey({
    activeDisplayShift,
    dashboardMaintenance,
    groups
}) {
    const groupIds = key => (groups[key] || [])
        .map(user => [
            user.id || user.name,
            user.attendanceStatus || '',
            user.voiceStatus || '',
            user.checkInTime || '',
            user.checkOutTime || ''
        ].join(':'))
        .sort();
    return JSON.stringify({
        summaryLayout: DASHBOARD_LAYOUT_VERSION,
        buildLabel: `${DASHBOARD_INSTANCE_TAG}|${DASHBOARD_LAYOUT_VERSION}`,
        activeDisplayShift,
        dashboardMaintenance,
        active: groupIds('active'),
        liveExceptionUsers: groupIds('liveExceptionUsers'),
        disconnected: groupIds('disconnected'),
        finished: groupIds('finished'),
        liveOff: groupIds('liveOff'),
        standby: groupIds('standby'),
        absent: groupIds('absent'),
        leave: groupIds('leave'),
        overtime: groupIds('overtime')
    });
}

function getActiveLiveException(userId, now = moment().tz(CONFIG.TIMEZONE)) {
    const exception = getLiveExceptionsMap(getLiveExceptions, logger)[userId];
    if (!exception || exception.status !== 'active') return null;
    if (!exception.expiresAt || now.isSameOrAfter(moment(exception.expiresAt))) return null;
    return exception;
}

function getDayNightWorkerStats(guild, shift = 'all') {
    const scope = ['all', 'day', 'night'].includes(shift) ? shift : 'all';
    return Object.values(getAttendanceData()).filter(user => {
        const workerShift = getRankingWorkerShift(user, guild);
        if (!workerShift) return false;
        return scope === 'all' || workerShift === scope;
    });
}

function getDayNightWorkerOvertimeUsers(guild, shift = 'all') {
    const scope = ['all', 'day', 'night'].includes(shift) ? shift : 'all';
    return getOvertimeUsers().filter(ot => {
        const user = getAttendanceData()[ot.id] || ot;
        const workerShift = getRankingWorkerShift(user, guild);
        if (!workerShift) return false;
        return scope === 'all' || workerShift === scope;
    });
}

async function reconcileDashboardSessionState(guild, now, {
    activeDisplayShift,
    currentShiftMembers,
    currentRoleMemberIds
}) {
    let sessionChanged = false;
    for (const member of currentShiftMembers.values()) {
        const shouldNormalizeCurrentShift = currentRoleMemberIds.has(member.id);
        const user = ensureUserData(member, shouldNormalizeCurrentShift ? activeDisplayShift : (getAttendanceData()[member.id]?.shift || determineShift(member)));
        const activeDayOffReservation = getActiveApprovedDayOffReservation(member.id, user?.shift || activeDisplayShift, now);
        if (activeDayOffReservation && await applyApprovedDayOffReservation(activeDayOffReservation, member, user, now, 'dashboard-dayoff-self-heal')) {
            sessionChanged = true;
        }
        if (shouldNormalizeCurrentShift && await normalizeCurrentShiftSession(member, user, activeDisplayShift, now)) {
            sessionChanged = true;
        }
        const memberShift = getMemberShiftRole(member);
        const activeLiveException = getActiveLiveException(member.id, now);
        const previousBounds = memberShift ? getShiftBounds(memberShift, now) : null;
        if (dashboardStateUtils.shouldAutoFinishPreviousShiftMember({
            memberShift,
            activeDisplayShift,
            hasOvertime: getOvertimeUsers().some(ot => ot.id === member.id),
            hasLiveException: Boolean(activeLiveException),
            user,
            previousShiftEnd: previousBounds?.end,
            now
        })) {
            await handleClockOut(member, user, previousBounds.end, '이전 근무조 예정 종료 시간 도달 - 교대 자동 퇴근', previousBounds.end, {
                skipEarlyPenalty: true,
                clockOutSource: 'shift-handoff-auto-finish',
                detectedAt: now
            });
            sessionChanged = true;
        }
    }
    const overtimeBeforeCleanup = getOvertimeUsers().length;
    getOvertimeUsers() = getOvertimeUsers().filter(ot => {
        const user = getAttendanceData()[ot.id];
        const member = guild.members.cache.get(ot.id);
        if (!user || !member || user.dayOff) return false;
        if (!isOvertimeEntryStillValid(ot, user, member, now)) {
            if (user.attendanceStatus === 'OVERTIME') {
                transitionRecordedStatus(user, {
                    attendanceStatus: user.checkedIn ? 'WORKING' : 'FINISHED',
                    voiceStatus: user.disconnected ? 'DISCONNECTED' : (member.voice?.channelId ? (member.voice?.streaming ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE')
                }, now, 'dashboard-overtime-cleanup', 'invalid-overtime-entry-removed');
            }
            return false;
        }
        if (!currentRoleMemberIds.has(ot.id)) return true;
        const bounds = getShiftBounds(activeDisplayShift, now);
        const isMainShiftTime = now.isBetween(bounds.start, bounds.end, null, '[]');
        const { isStreaming } = readMemberVoicePresence(member, guild);
        const cleanupDecision = dashboardStateUtils.getDashboardOvertimeCleanupDecision(ot, {
            isCurrentRoleMember: !ot.shift || ot.shift === activeDisplayShift,
            isMainShiftTime,
            isStreaming
        });
        if (cleanupDecision.action === 'end-pre-shift-ot') {
            user.pendingManualOT = false;
            const { isVoiceConnected, isStreaming: streamingNow } = readMemberVoicePresence(member, guild);
            transitionRecordedStatus(user, {
                attendanceStatus: 'WORKING',
                voiceStatus: streamingNow ? 'LIVE_ON' : (isVoiceConnected ? 'LIVE_OFF' : 'OFFLINE')
            }, now, 'dashboard-overtime-cleanup', 'pre-shift-ot-ended-regular-shift-started');
            return false;
        }
        if (cleanupDecision.action === 'reserve-manual-ot') {
            user.pendingManualOT = true;
            return false;
        }
        if (cleanupDecision.keep) return true;
        if (cleanupDecision.action === 'end-current-shift-streaming-overtime') {
            applyCurrentShiftLiveOnState(user, activeDisplayShift, now, 'dashboard-overtime-cleanup', 'overtime-ended-current-shift-live-on');
        }
        return false;
    });
    if (getOvertimeUsers().length !== overtimeBeforeCleanup) sessionChanged = true;
    return sessionChanged;
}

async function renderDashboardCore({ forceMemberRefresh = false, reconcileSession = false } = {}) {
    try {
        const ch = client.channels.cache.get(CONFIG.STATUS_CHANNEL) ||
            await client.channels.fetch(CONFIG.STATUS_CHANNEL).catch(() => null);
        if (!ch) return;
        const guild = ch.guild;
        const memberRefreshOk = await refreshGuildMembers(guild, { force: forceMemberRefresh });
        await syncVoiceStates();
        try {
            const consolidated = await dashboardMessageService.consolidateStatusMessages(ch, getStatusMessageId());
            if (consolidated.keptId && consolidated.keptId !== getStatusMessageId()) {
                setStatusMessageId(consolidated.keptId);
                await saveSystemAsync();
            }
            if (consolidated.deleted > 0) {
                console.log(`[DASHBOARD MSG] Removed ${consolidated.deleted} duplicate status message(s).`);
            }
        } catch (consolidateError) {
            console.error('[DASHBOARD MSG CONSOLIDATE ERROR]', consolidateError);
        }

        const now = moment().tz(CONFIG.TIMEZONE);
        const expiredDayOff = expireDayOffSessions(now);
        const dashboardMaintenance = isMaintenanceWindow(now) && !isWithinPreShiftWindow('day', now);
        const activeDisplayShift = getDashboardShift(now);
        const roleId = activeDisplayShift === 'day' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
        const shiftNameText = dashboardMaintenance
            ? '🛠️ MAINTENANCE WINDOW'
            : activeDisplayShift === 'day'
                ? '☀️ 주간 DAY SHIFT'
                : '🌙 야간 NIGHT SHIFT';
        const embedColor = dashboardMaintenance
            ? '#95A5A6'
            : activeDisplayShift === 'day'
                ? '#F1C40F'
                : '#3498DB';
        const liveOffVoiceIds = buildLiveOffVoiceIds(guild);

        const currentShiftMembers = guild.members.cache
            .filter(m => {
                if (!isAssignedWorker(m)) return false;
                return dashboardStateUtils.shouldIncludeCurrentShiftMember(m, {
                    user: getAttendanceData()[m.id],
                    voiceState: guild.voiceStates.cache.get(m.id),
                    activeDisplayShift,
                    roleId,
                    dashboardMaintenance,
                    now
                });
            });
        const assignedWorkerCount = guild.members.cache
            .filter(m => isAssignedWorker(m))
            .size;
        if (
            !forceMemberRefresh &&
            !memberRefreshOk &&
            assignedWorkerCount < DASHBOARD_MIN_VISIBLE_WORKERS
        ) {
            console.log('[DASHBOARD SKIP] Member cache refresh unavailable; keeping previous status message.', {
                assignedWorkerCount,
                minVisibleWorkers: DASHBOARD_MIN_VISIBLE_WORKERS,
                retryAfterMs: Math.max(0, memberFetchRetryAfter - Date.now())
            });
            return;
        }
        const currentRoleMemberIds = dashboardStateUtils.buildCurrentRoleMemberIds(currentShiftMembers, roleId, dashboardMaintenance);
        let sessionChanged = false;
        if (reconcileSession) {
            sessionChanged = await reconcileDashboardSessionState(guild, now, {
                activeDisplayShift,
                currentShiftMembers,
                currentRoleMemberIds
            });
        }
        if (await reconcileStreamingLiveOnStates(guild, now)) {
            sessionChanged = true;
        }
        const dashboardNameCounts = dashboardStateUtils.buildDashboardNameCounts(currentShiftMembers);
        const dashboardOvertimeUsers = dashboardStateUtils.buildDashboardOvertimeUsers(getOvertimeUsers(), { attendanceData: getAttendanceData(),
            membersCache: guild.members.cache,
            voiceStatesCache: guild.voiceStates.cache,
            currentRoleMemberIds,
            activeDisplayShift,
            now
        });
        const dashboardOvertimeIds = new Set(dashboardOvertimeUsers.map(ot => ot.id));
        const users = currentShiftMembers
            .map(m => {
                const userShift = currentRoleMemberIds.has(m.id)
                    ? activeDisplayShift
                    : (getAttendanceData()[m.id]?.shift || determineShift(m) || activeDisplayShift);
                const u = ensureUserData(m, userShift);
                const { voiceState, isVoiceConnected, isStreaming } = readMemberVoicePresence(m, guild);
                u.dashboardName = dashboardStateUtils.getDashboardDisplayName(m, dashboardNameCounts);
                const bounds = getShiftBounds(u.shift, now);
                const isPreShift = now.isBefore(bounds.start);
                const liveException = getActiveLiveException(m.id, now);
                const isVoiceLiveOff = isVoiceConnected && !isStreaming;
                const isDashboardOvertime = dashboardOvertimeIds.has(m.id);
                dashboardStateUtils.assignDashboardUserDisplayState(u, m, {
                    activeDisplayShift,
                    isDashboardOvertime,
                    isVoiceLiveOff,
                    isPreShift,
                    isStreaming,
                    isVoiceConnected,
                    hasLiveOffVoice: liveOffVoiceIds.has(m.id),
                    liveException,
                    bounds,
                    now
                });
                return u;
            });

        const visibleUsers = users.filter(u => u.fState !== 'OUT_OF_SCOPE');
        const groups = dashboardStateUtils.buildExclusiveDashboardGroups(visibleUsers, dashboardOvertimeUsers);
        const {
            active,
            liveExceptionUsers,
            disconnected,
            finished,
            liveOff,
            standby,
            absent,
            leave,
            overtime: exclusiveOvertimeUsers
        } = groups;

        const totalUsers = visibleUsers.length;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle('🖥️ INTEGRATED OPS CONTROL CENTER')
            .setDescription(renderDashboardHeader(now, dashboardMaintenance));

        safeAddFields(embed,
            {
                name: '📊 OVERVIEW',
                value: renderSummaryBox([
                    ['TOTAL', totalUsers],
                    ['ACTIVE', active.length],
                    ['FINISHED', finished.length]
                ]),
                inline: true
            },
            {
                name: '⚠️ ATTENTION',
                value: renderSummaryBox([
                    ['LIVE OFF', liveOff.length],
                    ['DC', disconnected.length],
                    ['ABSENT', absent.length],
                    ['WAITING', standby.length]
                ]),
                inline: true
            },
            {
                name: '📌 ETC',
                value: renderSummaryBox([
                    ['OFF', leave.length],
                    ['OT', exclusiveOvertimeUsers.length],
                    ['EXCEPTION', liveExceptionUsers.length]
                ]),
                inline: true
            }
        );

        safeAddFields(embed, { name: '\u200B', value: '\u200B', inline: false });
        safeAddFields(embed, { name: `${shiftNameText} [CURRENT]`, value: '\u200B', inline: false });
        safeAddFields(embed,
            { name: `✅ ACTIVE & LIVE ON (${active.length}명)`, value: renderCleanGrid(active, '✅'), inline: false },
            { name: `📴 LIVE OFF (${liveOff.length}명)`, value: renderStatusList(liveOff, '📴', now, 'liveoff'), inline: false },
            { name: `⚡ DISCONNECTED (${disconnected.length}명)`, value: renderStatusList(disconnected, '⚡', now, 'dc'), inline: false },
            { name: `🟣 LIVE EXCEPTION (${liveExceptionUsers.length}명)`, value: renderStatusList(liveExceptionUsers, '🟣', now, 'exception'), inline: false },
            { name: `❌ ABSENT (${absent.length}명)`, value: renderStatusList(absent, '❌', now, 'absent'), inline: false },
            { name: `⏳ STANDBY (${standby.length}명)`, value: renderStatusList(standby, '⏳', now, 'standby'), inline: false },
            { name: `⏹️ FINISHED (${finished.length}명)`, value: renderStatusList(finished, '⏹️', now, 'finished'), inline: false },
            { name: `🔵 DAY OFF (${leave.length}명)`, value: renderStatusList(leave, '🔵', now), inline: false }
        );

        safeAddFields(embed, {
            name: `🔥 OVERTIME (${exclusiveOvertimeUsers.length}명)`,
            value: renderOvertimeList(now, exclusiveOvertimeUsers),
            inline: false
        });

        const dashboardStableKey = buildDashboardStableKey({
            activeDisplayShift,
            dashboardMaintenance,
            groups
        });
        const forceDashboardEdit = forceMemberRefresh || sessionChanged || expiredDayOff;
        const liveOnRecoveryPublish = isLiveOnRecoveryPublish(dashboardLastPublishedStableKey, dashboardStableKey);
        if (
            !forceDashboardEdit &&
            !liveOnRecoveryPublish &&
            getStatusMessageId() &&
            dashboardLastPublishedStableKey &&
            dashboardStableKey !== dashboardLastPublishedStableKey
        ) {
            const currentMs = Date.now();
            if (dashboardPendingStableKey !== dashboardStableKey) {
                dashboardPendingStableKey = dashboardStableKey;
                dashboardPendingStableKeyAt = currentMs;
                console.log('[DASHBOARD SETTLE] New dashboard state detected; waiting before publishing.');
                return;
            }
            if (currentMs - dashboardPendingStableKeyAt < DASHBOARD_STATE_SETTLE_MS) {
                console.log('[DASHBOARD SETTLE] Dashboard state still settling; keeping previous status message.');
                return;
            }
        }
        if (liveOnRecoveryPublish) {
            dashboardPendingStableKey = null;
            dashboardPendingStableKeyAt = 0;
        }
        const statusMessageResult = await dashboardMessageService.upsertStatusMessage(ch, { statusMessageId: getStatusMessageId(),
            embed,
            stableKey: dashboardStableKey,
            forceEdit: forceDashboardEdit,
            minEditIntervalMs: 60 * 1000
        });
        setStatusMessageId(statusMessageResult.statusMessageId);
        if (statusMessageResult.created || statusMessageResult.updated || statusMessageResult.skipped) {
            dashboardLastPublishedStableKey = dashboardStableKey;
            dashboardPendingStableKey = null;
            dashboardPendingStableKeyAt = 0;
        }
        if (statusMessageResult.created) await saveSystemAsync();
        if (sessionChanged || expiredDayOff) await saveSystemAsync();
    } catch (e) {
        console.error('[DASH CORE ERROR]', e);
    }
}
    return {
        getLayoutVersion: () => DASHBOARD_LAYOUT_VERSION,
        getInstanceTag: () => DASHBOARD_INSTANCE_TAG,
        queueDashboardRender,
        renderDashboardCore,
        reconcileDashboardSessionState,
        getDayNightWorkerStats,
        getDayNightWorkerOvertimeUsers,
        getActiveLiveException,
        readMemberVoicePresence,
        buildLiveOffVoiceIds
    };
}

module.exports = { createDashboardWorkflow };
