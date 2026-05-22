const assert = require('assert');
const moment = require('moment-timezone');
const createDashboardStateUtils = require('../src/utils/dashboardState');

const CONFIG = {
    TIMEZONE: 'Asia/Manila',
    FINISHED_VISIBLE_AFTER_MINS: 30,
    ROLES: {
        DAY: 'day-role',
        NIGHT: 'night-role'
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
    getActiveLiveException: () => null,
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

    assert.strictEqual(state, 'LIVE_EXCEPTION', 'active live exception overrides stale FINISHED state');
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

console.log('dashboard-state tests passed');
