const assert = require('assert');
const moment = require('moment-timezone');
const createDashboardStateUtils = require('../src/utils/dashboardState');

const CONFIG = {
    TIMEZONE: 'Asia/Manila',
    FINISHED_VISIBLE_AFTER_MINS: 30,
    ROLES: {
        DAY: 'day-role',
        NIGHT: 'night-role'
    },
    EXCEPTIONS: {
        SHARED_SEAT_USER: 'shared-seat'
    }
};

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
}

function roles(...ids) {
    return {
        cache: {
            has: id => ids.includes(id)
        }
    };
}

const utils = createDashboardStateUtils({
    CONFIG,
    moment,
    getScheduledEndMoment: user => user.scheduledEndAt ? moment(user.scheduledEndAt).tz(CONFIG.TIMEZONE) : null,
    getRecentMaintenanceEnd: now => now.isSame(at('2026-05-20 09:05')) ? { endedAt: at('2026-05-20 09:00') } : null,
    isWithinPreShiftWindow: (shift, now) => shift === 'day' && now.isSame(at('2026-05-20 08:55')),
    getMemberShiftRole: member => member.shiftRole || null,
    getActiveLiveException: (id) => id === 'exception-ot' ? { status: 'active' } : null,
    getOvertimeUsers: () => [{ id: 'ot-user' }]
});

{
    const state = utils.getHybridDashboardState({
        id: 'working-live-off',
        checkedIn: true,
        isFinished: false,
        dayOff: false,
        disconnected: false,
        attendanceStatus: 'WORKING',
        voiceStatus: 'LIVE_OFF',
        scheduledEndAt: at('2026-05-20 21:00').toISOString()
    }, {
        now: at('2026-05-20 13:00'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        isVoiceConnected: true,
        isStreaming: false,
        isVoiceLiveOff: true,
        isPreShift: false,
        hasLiveOffVoice: true,
        liveException: null
    });

    assert.strictEqual(state, 'LIVE_OFF', 'working user with LIVE_OFF voice status renders LIVE_OFF');
}

{
    const state = utils.getHybridDashboardState({
        id: 'working-live-on-now',
        checkedIn: true,
        isFinished: false,
        dayOff: false,
        disconnected: false,
        attendanceStatus: 'WORKING',
        voiceStatus: 'LIVE_OFF',
        liveOffStartedAt: at('2026-05-20 13:00').toISOString()
    }, {
        now: at('2026-05-20 13:00'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        isVoiceConnected: true,
        isStreaming: true,
        isVoiceLiveOff: false,
        isPreShift: false,
        hasLiveOffVoice: false,
        liveException: null
    });

    assert.strictEqual(state, 'ACTIVE', 'live stream ON overrides stale LIVE_OFF voice status');
}

{
    const state = utils.getHybridDashboardState({
        id: 'finished-old',
        checkedIn: false,
        isFinished: true,
        dayOff: false,
        disconnected: false,
        attendanceStatus: 'FINISHED',
        voiceStatus: 'OFFLINE',
        checkOutRaw: at('2026-05-19 21:00').toISOString()
    }, {
        now: at('2026-05-20 13:00'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        isVoiceConnected: false,
        isStreaming: false,
        isVoiceLiveOff: false,
        isPreShift: false,
        hasLiveOffVoice: false,
        liveException: null
    });

    assert.strictEqual(state, 'ABSENT', 'expired previous finished user becomes ABSENT during current shift');
}

{
    const state = utils.getHybridDashboardState({
        id: 'exception-finished-stale',
        checkedIn: false,
        isFinished: true,
        dayOff: false,
        disconnected: false,
        attendanceStatus: 'FINISHED',
        voiceStatus: 'OFFLINE',
        checkOutRaw: at('2026-05-20 11:00').toISOString()
    }, {
        now: at('2026-05-20 13:00'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        isVoiceConnected: true,
        isStreaming: false,
        isVoiceLiveOff: true,
        isPreShift: false,
        hasLiveOffVoice: true,
        liveException: { status: 'active' }
    });

    assert.strictEqual(state, 'FINISHED', 'finished attendance state overrides an active live exception');
}

{
    const state = utils.getHybridDashboardState({
        id: 'finished-but-live',
        checkedIn: false,
        isFinished: true,
        dayOff: false,
        disconnected: false,
        attendanceStatus: 'FINISHED',
        voiceStatus: 'OFFLINE',
        checkOutRaw: at('2026-05-20 11:00').toISOString()
    }, {
        now: at('2026-05-20 13:00'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        isVoiceConnected: true,
        isStreaming: true,
        isVoiceLiveOff: false,
        isPreShift: false,
        hasLiveOffVoice: false,
        liveException: null
    });

    assert.strictEqual(state, 'ACTIVE', 'live streaming overrides stale finished attendance for display');
}

{
    const state = utils.getHybridDashboardState({
        id: 'dayoff-but-live',
        checkedIn: false,
        isFinished: false,
        dayOff: true,
        disconnected: false,
        attendanceStatus: 'DAY_OFF',
        voiceStatus: 'OFFLINE'
    }, {
        now: at('2026-05-20 13:00'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        isVoiceConnected: true,
        isStreaming: true,
        isVoiceLiveOff: false,
        isPreShift: false,
        hasLiveOffVoice: false,
        liveException: null
    });

    assert.strictEqual(state, 'ACTIVE', 'live streaming overrides stale day off for display');
}

{
    const state = utils.getHybridDashboardState({
        id: 'self-exception-active',
        checkedIn: true,
        isFinished: false,
        dayOff: false,
        disconnected: false,
        status: 'exception',
        attendanceStatus: 'WORKING',
        voiceStatus: 'EXCEPTION',
        scheduledEndAt: at('2026-05-20 21:00').toISOString()
    }, {
        now: at('2026-05-20 13:00'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        isVoiceConnected: true,
        isStreaming: false,
        isVoiceLiveOff: true,
        isPreShift: false,
        hasLiveOffVoice: true,
        liveException: null
    });

    assert.strictEqual(state, 'LIVE_EXCEPTION', 'self clock-in exception renders as LIVE_EXCEPTION without a stored exception object');
}

{
    const state = utils.getHybridDashboardState({
        id: 'exception-disconnected',
        checkedIn: true,
        isFinished: false,
        dayOff: false,
        disconnected: true,
        status: 'exception',
        attendanceStatus: 'WORKING',
        voiceStatus: 'DISCONNECTED',
        scheduledEndAt: at('2026-05-20 21:00').toISOString()
    }, {
        now: at('2026-05-20 13:00'),
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        isVoiceConnected: false,
        isStreaming: false,
        isVoiceLiveOff: false,
        isPreShift: false,
        hasLiveOffVoice: false,
        liveException: { status: 'active' }
    });

    assert.strictEqual(state, 'DISCONNECTED', 'disconnected state overrides an active live exception');
}

{
    const state = utils.deriveAttendanceStatusForAudit({
        id: 'ot-user',
        checkedIn: true,
        dayOff: false,
        disconnected: false,
        isFinished: false
    });

    assert.strictEqual(state, 'OVERTIME', 'audit derives OVERTIME from injected overtime list');
}

{
    const member = {
        id: 'post-maint-finished',
        roles: roles(CONFIG.ROLES.NIGHT),
        voice: { channelId: 'voice' },
        guild: { voiceStates: { cache: new Map() } }
    };

    const visible = utils.shouldShowPostMaintenanceFinished(member, {
        id: member.id,
        checkedIn: false,
        dayOff: false,
        disconnected: false
    }, 'day', at('2026-05-20 09:05'));

    assert.strictEqual(visible, true, 'previous shift finished user in voice remains visible after maintenance');
}

{
    const currentMember = {
        id: 'current-member',
        roles: roles(CONFIG.ROLES.DAY),
        voice: {},
        guild: { voiceStates: { cache: new Map() } }
    };

    assert.strictEqual(utils.shouldIncludeCurrentShiftMember(currentMember, {
        user: null,
        activeDisplayShift: 'day',
        roleId: CONFIG.ROLES.DAY,
        dashboardMaintenance: false,
        now: at('2026-05-20 13:00')
    }), true, 'current shift role member is included even without tracked user data');

    const staleFinishedMember = {
        id: 'stale-finished',
        roles: roles(CONFIG.ROLES.NIGHT),
        voice: {},
        guild: { voiceStates: { cache: new Map() } }
    };

    assert.strictEqual(utils.shouldIncludeCurrentShiftMember(staleFinishedMember, {
        user: {
            id: staleFinishedMember.id,
            isFinished: true,
            checkedIn: false,
            disconnected: false,
            checkOutRaw: at('2026-05-20 10:00').toISOString()
        },
        activeDisplayShift: 'day',
        roleId: CONFIG.ROLES.DAY,
        dashboardMaintenance: false,
        now: at('2026-05-20 13:00')
    }), false, 'stale finished user outside current role is hidden after visibility grace');

    assert.strictEqual(utils.shouldIncludeCurrentShiftMember(staleFinishedMember, {
        user: {
            id: staleFinishedMember.id,
            isFinished: true,
            checkedIn: false,
            disconnected: false,
            checkOutRaw: at('2026-05-20 10:00').toISOString(),
            dayOff: true
        },
        activeDisplayShift: 'day',
        roleId: CONFIG.ROLES.DAY,
        dashboardMaintenance: false,
        now: at('2026-05-20 13:00')
    }), false, 'day off stale finished user is not kept by tracked-state fallback');

    const manualMember = {
        id: 'manual-recent',
        roles: roles(CONFIG.ROLES.NIGHT),
        voice: {},
        guild: { voiceStates: { cache: new Map() } }
    };

    assert.strictEqual(utils.shouldIncludeCurrentShiftMember(manualMember, {
        user: {
            id: manualMember.id,
            shift: 'day',
            manualPanelTouchedAt: at('2026-05-20 12:55').toISOString()
        },
        activeDisplayShift: 'day',
        roleId: CONFIG.ROLES.DAY,
        dashboardMaintenance: false,
        now: at('2026-05-20 13:00')
    }), true, 'recent manual action keeps a member visible for the current display shift');

    const preShiftMember = {
        id: 'pre-shift',
        shiftRole: 'day',
        roles: roles(CONFIG.ROLES.NIGHT),
        voice: { channelId: 'voice' },
        guild: { voiceStates: { cache: new Map() } }
    };

    assert.strictEqual(utils.shouldIncludeCurrentShiftMember(preShiftMember, {
        user: { id: preShiftMember.id, shift: 'day' },
        activeDisplayShift: 'day',
        roleId: CONFIG.ROLES.DAY,
        dashboardMaintenance: false,
        now: at('2026-05-20 08:55')
    }), true, 'pre-shift voice standby is included before shift start');
}

{
    const groups = utils.buildExclusiveDashboardGroups([
        { id: 'leave-by-state', fState: 'LEAVE' },
        { id: 'leave-by-flag', fState: 'OVERTIME', dayOff: true },
        { id: 'ot-user', fState: 'OVERTIME' },
        { id: 'exception-user', fState: 'LIVE_EXCEPTION' },
        { id: 'dc-user', fState: 'DISCONNECTED' },
        { id: 'liveoff-user', fState: 'LIVE_OFF' },
        { id: 'absent-user', fState: 'ABSENT' },
        { id: 'active-user', fState: 'ACTIVE' },
        { id: 'late-user', fState: 'LATE' },
        { id: 'finished-user', fState: 'FINISHED' },
        { id: 'waiting-user', fState: 'WAITING' },
        { id: 'ignored-user', fState: 'OUT_OF_SCOPE' }
    ], [
        { id: 'ot-user', type: 'AUTO' },
        { id: 'leave-by-flag', type: 'AUTO' },
        { id: 'missing-user', type: 'AUTO' }
    ]);

    assert.deepStrictEqual(groups.leave.map(u => u.id), ['leave-by-state', 'leave-by-flag']);
    assert.deepStrictEqual(groups.overtime.map(u => u.id), ['ot-user']);
    assert.deepStrictEqual(groups.liveExceptionUsers.map(u => u.id), ['exception-user']);
    assert.deepStrictEqual(groups.disconnected.map(u => u.id), ['dc-user']);
    assert.deepStrictEqual(groups.liveOff.map(u => u.id), ['liveoff-user']);
    assert.deepStrictEqual(groups.absent.map(u => u.id), ['absent-user']);
    assert.deepStrictEqual(groups.active.map(u => u.id), ['active-user', 'late-user']);
    assert.deepStrictEqual(groups.finished.map(u => u.id), ['finished-user']);
    assert.deepStrictEqual(groups.standby.map(u => u.id), ['waiting-user']);
}

{
    const membersCache = new Map([
        ['previous-streaming', { id: 'previous-streaming', voice: { streaming: true } }],
        ['current-auto-streaming', { id: 'current-auto-streaming', voice: { streaming: true } }],
        ['current-manual-streaming', { id: 'current-manual-streaming', voice: { streaming: true } }],
        ['forced-offline', { id: 'forced-offline', voice: {} }],
        ['exception-ot', { id: 'exception-ot', voice: {} }],
        ['dayoff-ot', { id: 'dayoff-ot', voice: { streaming: true } }],
        ['offline-auto', { id: 'offline-auto', voice: {} }]
    ]);
    const voiceStatesCache = new Map([
        ['previous-streaming', { streaming: true }],
        ['current-auto-streaming', { streaming: true }],
        ['current-manual-streaming', { streaming: true }],
        ['dayoff-ot', { streaming: true }]
    ]);
    const attendanceData = {
        'previous-streaming': { checkedIn: true },
        'current-auto-streaming': { checkedIn: true },
        'current-manual-streaming': { checkedIn: true },
        'forced-offline': { checkedIn: true },
        'exception-ot': { checkedIn: true },
        'dayoff-ot': { checkedIn: true, dayOff: true },
        'offline-auto': { checkedIn: true },
        'not-checked-in': { checkedIn: false }
    };

    const dashboardOvertime = utils.buildDashboardOvertimeUsers([
        { id: 'previous-streaming', type: 'AUTO' },
        { id: 'current-auto-streaming', type: 'AUTO' },
        { id: 'current-manual-streaming', type: 'MANUAL' },
        { id: 'forced-offline', type: 'FORCED' },
        { id: 'exception-ot', type: 'AUTO' },
        { id: 'dayoff-ot', type: 'AUTO' },
        { id: 'offline-auto', type: 'AUTO' },
        { id: 'not-checked-in', type: 'AUTO' },
        { id: 'missing-member', type: 'AUTO' }
    ], {
        attendanceData,
        membersCache,
        voiceStatesCache,
        currentRoleMemberIds: new Set(['current-auto-streaming', 'current-manual-streaming']),
        now: at('2026-05-20 13:00')
    });

    assert.deepStrictEqual(dashboardOvertime.map(ot => ot.id), [
        'previous-streaming',
        'current-manual-streaming',
        'forced-offline',
        'exception-ot'
    ]);

    const previousShiftOtWithCurrentRole = utils.buildDashboardOvertimeUsers([
        { id: 'current-auto-streaming', type: 'AUTO', shift: 'night' }
    ], {
        attendanceData,
        membersCache,
        voiceStatesCache,
        currentRoleMemberIds: new Set(['current-auto-streaming']),
        activeDisplayShift: 'day',
        now: at('2026-05-20 13:00')
    });

    assert.deepStrictEqual(
        previousShiftOtWithCurrentRole.map(ot => ot.id),
        ['current-auto-streaming'],
        'auto OT from a different tracked shift remains visible even if the member has current role'
    );
}

{
    const member = {
        id: 'display-active',
        shiftRole: 'day',
        roles: roles(CONFIG.ROLES.DAY),
        voice: { channelId: 'voice', streaming: true },
        guild: { voiceStates: { cache: new Map() } }
    };
    const user = {
        id: member.id,
        checkedIn: true,
        isFinished: false,
        dayOff: false,
        disconnected: false,
        attendanceStatus: 'WORKING',
        voiceStatus: 'LIVE_ON',
        scheduledEndAt: at('2026-05-20 21:00').toISOString()
    };

    assert.strictEqual(utils.assignDashboardUserDisplayState(user, member, {
        activeDisplayShift: 'day',
        isDashboardOvertime: false,
        isVoiceLiveOff: false,
        isPreShift: false,
        isStreaming: true,
        isVoiceConnected: true,
        hasLiveOffVoice: false,
        liveException: null,
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        now: at('2026-05-20 13:00')
    }), user);
    assert.strictEqual(user.fState, 'ACTIVE');
    assert.strictEqual(user.isOT, false);
}

{
    const member = {
        id: 'display-ot',
        shiftRole: 'night',
        roles: roles(CONFIG.ROLES.NIGHT),
        voice: { channelId: 'voice', streaming: true },
        guild: { voiceStates: { cache: new Map() } }
    };
    const user = {
        id: member.id,
        checkedIn: true,
        isFinished: false,
        dayOff: false,
        disconnected: false,
        attendanceStatus: 'WORKING',
        voiceStatus: 'LIVE_ON'
    };

    utils.assignDashboardUserDisplayState(user, member, {
        activeDisplayShift: 'day',
        isDashboardOvertime: true,
        isVoiceLiveOff: false,
        isPreShift: false,
        isStreaming: true,
        isVoiceConnected: true,
        hasLiveOffVoice: false,
        liveException: null,
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        now: at('2026-05-20 13:00')
    });
    assert.strictEqual(user.fState, 'OVERTIME');
    assert.strictEqual(user.isOT, true);
}

{
    const member = {
        id: 'previous-waiting',
        shiftRole: 'night',
        roles: roles(CONFIG.ROLES.NIGHT),
        voice: {},
        guild: { voiceStates: { cache: new Map() } }
    };
    const user = {
        id: member.id,
        checkedIn: false,
        isFinished: false,
        dayOff: false,
        disconnected: false
    };

    utils.assignDashboardUserDisplayState(user, member, {
        activeDisplayShift: 'day',
        isDashboardOvertime: false,
        isVoiceLiveOff: false,
        isPreShift: false,
        isStreaming: false,
        isVoiceConnected: false,
        hasLiveOffVoice: false,
        liveException: null,
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        now: at('2026-05-20 10:00')
    });
    assert.strictEqual(user.fState, 'OUT_OF_SCOPE');
    assert.strictEqual(user.isOT, false);
}

{
    const member = {
        id: 'live-finished-stale',
        shiftRole: 'day',
        roles: roles(CONFIG.ROLES.NIGHT),
        voice: { channelId: 'voice', streaming: true },
        guild: { voiceStates: { cache: new Map() } }
    };
    const user = {
        id: member.id,
        checkedIn: false,
        isFinished: true,
        dayOff: false,
        disconnected: false,
        attendanceStatus: 'FINISHED',
        voiceStatus: 'LIVE_ON',
        checkOutRaw: at('2026-05-20 11:00').toISOString()
    };

    utils.assignDashboardUserDisplayState(user, member, {
        activeDisplayShift: 'day',
        isDashboardOvertime: false,
        isVoiceLiveOff: false,
        isPreShift: false,
        isStreaming: true,
        isVoiceConnected: true,
        hasLiveOffVoice: false,
        liveException: null,
        bounds: { start: at('2026-05-20 09:00'), end: at('2026-05-20 21:00') },
        now: at('2026-05-20 13:00')
    });
    assert.strictEqual(user.fState, 'ACTIVE', 'live voice display overrides stale finished state');
}

{
    const members = [
        { id: '1001', displayName: 'Robin - P Night Time' },
        { id: '2002', displayName: 'Robin - H Night Time' },
        { id: '3003', user: { username: 'Daba - P Night Time' } },
        { id: '4004', displayName: '   - Empty Prefix' }
    ];
    const counts = utils.buildDashboardNameCounts(members);

    assert.strictEqual(utils.getDashboardBaseName(members[0]), 'Robin');
    assert.strictEqual(utils.getDashboardBaseName(members[2]), 'Daba');
    assert.strictEqual(utils.getDashboardBaseName(members[3]), 'Unknown');
    assert.strictEqual(counts.get('robin'), 2);
    assert.strictEqual(counts.get('daba'), 1);
    assert.strictEqual(utils.getDashboardDisplayName(members[0], counts), 'Robin#1001');
    assert.strictEqual(utils.getDashboardDisplayName(members[1], counts), 'Robin#2002');
    assert.strictEqual(utils.getDashboardDisplayName(members[2], counts), 'Daba');
}

{
    const members = [
        { id: 'day-user', roles: roles(CONFIG.ROLES.DAY) },
        { id: 'night-user', roles: roles(CONFIG.ROLES.NIGHT) },
        { id: 'shared-seat', roles: roles(CONFIG.ROLES.NIGHT) },
        { id: 'no-role', roles: roles() }
    ];
    const ids = utils.buildCurrentRoleMemberIds(members, CONFIG.ROLES.DAY, false);

    assert.deepStrictEqual([...ids].sort(), ['day-user', 'shared-seat']);
    assert.deepStrictEqual([...utils.buildCurrentRoleMemberIds(members, CONFIG.ROLES.DAY, true)], []);
}

{
    assert.deepStrictEqual(utils.getDashboardOvertimeCleanupDecision({ type: 'AUTO' }, {
        isCurrentRoleMember: false,
        isMainShiftTime: true,
        isStreaming: true
    }), { keep: true, action: 'keep-previous-shift-overtime' });

    assert.deepStrictEqual(utils.getDashboardOvertimeCleanupDecision({ type: 'PRE_OT' }, {
        isCurrentRoleMember: true,
        isMainShiftTime: true,
        isStreaming: false
    }), { keep: false, action: 'end-pre-shift-ot' });

    assert.deepStrictEqual(utils.getDashboardOvertimeCleanupDecision({ type: 'MANUAL' }, {
        isCurrentRoleMember: true,
        isMainShiftTime: true,
        isStreaming: false
    }), { keep: false, action: 'reserve-manual-ot' });

    assert.deepStrictEqual(utils.getDashboardOvertimeCleanupDecision({ type: 'MANUAL' }, {
        isCurrentRoleMember: true,
        isMainShiftTime: false,
        isStreaming: false
    }), { keep: true, action: 'keep-manual-or-pre-shift-overtime' });

    assert.deepStrictEqual(utils.getDashboardOvertimeCleanupDecision({ type: 'AUTO' }, {
        isCurrentRoleMember: true,
        isMainShiftTime: false,
        isStreaming: false
    }), { keep: true, action: 'keep-outside-main-shift' });

    assert.deepStrictEqual(utils.getDashboardOvertimeCleanupDecision({ type: 'AUTO' }, {
        isCurrentRoleMember: true,
        isMainShiftTime: true,
        isStreaming: true
    }), { keep: false, action: 'end-current-shift-streaming-overtime' });

    assert.deepStrictEqual(utils.getDashboardOvertimeCleanupDecision({ type: 'AUTO' }, {
        isCurrentRoleMember: true,
        isMainShiftTime: true,
        isStreaming: false
    }), { keep: false, action: 'remove-current-shift-overtime' });
}

{
    const now = at('2026-05-20 09:05');
    const previousShiftEnd = at('2026-05-20 09:00');
    assert.strictEqual(utils.shouldAutoFinishPreviousShiftMember({
        memberShift: 'night',
        activeDisplayShift: 'day',
        hasOvertime: false,
        hasLiveException: false,
        user: { checkedIn: true },
        previousShiftEnd,
        now
    }), true);

    assert.strictEqual(utils.shouldAutoFinishPreviousShiftMember({
        memberShift: 'day',
        activeDisplayShift: 'day',
        user: { checkedIn: true },
        previousShiftEnd,
        now
    }), false, 'current shift member is not auto-finished as previous shift');

    assert.strictEqual(utils.shouldAutoFinishPreviousShiftMember({
        memberShift: 'night',
        activeDisplayShift: 'day',
        hasOvertime: true,
        user: { checkedIn: true },
        previousShiftEnd,
        now
    }), false, 'overtime protects previous shift member from handoff finish');

    assert.strictEqual(utils.shouldAutoFinishPreviousShiftMember({
        memberShift: 'night',
        activeDisplayShift: 'day',
        hasLiveException: true,
        user: { checkedIn: true },
        previousShiftEnd,
        now
    }), false, 'live exception protects previous shift member from handoff finish');

    assert.strictEqual(utils.shouldAutoFinishPreviousShiftMember({
        memberShift: 'night',
        activeDisplayShift: 'day',
        user: { checkedIn: false, disconnected: false },
        previousShiftEnd,
        now
    }), false, 'idle previous shift member is not auto-finished');

    assert.strictEqual(utils.shouldAutoFinishPreviousShiftMember({
        memberShift: 'night',
        activeDisplayShift: 'day',
        user: { disconnected: true },
        previousShiftEnd,
        now: at('2026-05-20 08:55')
    }), false, 'previous shift member is not auto-finished before scheduled end');
}

console.log('dashboard-state tests passed');
