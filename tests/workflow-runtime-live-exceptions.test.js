const assert = require('assert');
const { createMembershipWorkflow } = require('../src/workflows/membershipWorkflow');

(async () => {
    const liveExceptions = { u1: { status: 'active' } };
    const membership = createMembershipWorkflow({
        client: { guilds: { cache: { get: () => null } } },
        CONFIG: { GUILD_ID: 'g1', TIMEZONE: 'Asia/Seoul', ROLES: {} },
        moment: require('moment-timezone'),
        getAttendanceData: () => ({ u1: { checkedIn: true, dayOff: false, isFinished: false } }),
        getOvertimeUsers: () => [],
        setOvertimeUsers: () => {},
        saveSystemAsync: async () => {},
        refreshGuildMembers: async () => {},
        updateWorkingRole: async () => {},
        ensureUserData: () => ({}),
        determineShift: () => 'day',
        getMemberShiftRole: () => null,
        isAssignedWorker: () => false,
        hasManagedAttendanceRole: () => false,
        roleService: {},
        getWorkerProfileForRawSync: () => null,
        getLiveExceptions: () => liveExceptions
    });

    await membership.reconcileAttendanceMembership(null);
    assert.strictEqual(typeof liveExceptions.u1.status, 'string');

    console.log('workflow-runtime-live-exceptions tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
