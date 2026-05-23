const assert = require('assert');
const createAdminService = require('../src/services/adminService');
const { truncateWidth } = require('../src/utils/textFormat');

let announceData = {
    1: null,
    2: { active: true, time: '12:30', roleId: 'role1', roleIds: ['role1', 'role2'], content: 'Hello workers' },
    3: { active: false, time: null, roleId: null, content: 'Paused notice' },
    4: 'old-message-format'
};

const service = createAdminService({
    getAnnounceData: () => announceData,
    truncateWidth
});

const list = service.formatAnnouncementList();
assert(list.includes('Slot 1: empty'));
assert(list.includes('Slot 2: ON 12:30 roles=<@&role1>,<@&role2> - Hello workers'));
assert(list.includes('Slot 3: OFF --:-- - Paused notice'));
assert(list.includes('Slot 4: invalid legacy data'));

const user = {};
assert.strictEqual(service.applyManualAdjustment(user, 'points', '15'), true);
assert.strictEqual(user.points, 15);
assert.strictEqual(service.applyManualAdjustment(user, 'checked-in', 'true'), true);
assert.strictEqual(user.checkedIn, true);
assert.strictEqual(service.applyManualAdjustment(user, 'status', 'none'), true);
assert.strictEqual(user.status, null);
assert.strictEqual(service.applyManualAdjustment(user, 'shift', 'night'), true);
assert.strictEqual(user.shift, 'night');
assert.strictEqual(service.applyManualAdjustment(user, 'points', 'nope'), false);
assert.strictEqual(service.applyManualAdjustment(user, 'checked-in', 'yes'), false);
assert.strictEqual(service.applyManualAdjustment(user, 'shift', 'mid'), false);
assert.strictEqual(service.applyManualAdjustment(user, 'unknown', '1'), false);

console.log('admin-service tests passed');
