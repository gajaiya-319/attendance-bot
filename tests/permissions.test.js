const assert = require('assert');
const createPermissionUtils = require('../src/utils/permissions');

const PermissionFlagsBits = {
    Administrator: 1n,
    ManageMessages: 2n
};

const CONFIG = {
    OWNER_IDS: ['owner'],
    LIVE_EXCEPTION_MANAGER_ROLE_IDS: ['live-manager'],
    ANNOUNCEMENT_MANAGER_ROLE_IDS: ['announce-manager'],
    ROLES: {
        DAY: 'day',
        NIGHT: 'night',
        HEINE: 'heine',
        PAAGRIO: 'paagrio',
        WORKING: 'working',
        GUEST: 'guest'
    },
    EXCEPTIONS: {
        SHARED_SEAT_USER: 'shared-seat'
    }
};

function member(id, roles = [], permissions = []) {
    const roleSet = new Set(roles);
    const permissionSet = new Set(permissions);
    return {
        id,
        user: { bot: false },
        roles: { cache: { has: roleId => roleSet.has(roleId) } },
        permissions: { has: permission => permissionSet.has(permission) }
    };
}

const permissions = createPermissionUtils({ CONFIG, PermissionFlagsBits });

assert.strictEqual(permissions.isOwnerId('owner'), true);
assert.strictEqual(permissions.isOwnerId('someone'), false);
assert.strictEqual(permissions.hasWorkerServerRole(member('1', ['heine'])), true);
assert.strictEqual(permissions.hasWorkerServerRole(member('1', ['day'])), false);
assert.strictEqual(permissions.isAssignedWorker(member('1', ['day', 'paagrio'])), true);
assert.strictEqual(permissions.isAssignedWorker(member('1', ['day'])), false);
assert.strictEqual(permissions.isAssignedWorker(member('owner', ['night'])), true);
assert.strictEqual(permissions.isAssignedWorker(member('shared-seat', [])), true);
assert.strictEqual(permissions.hasManagedAttendanceRole(member('1', ['guest'])), true);
assert.strictEqual(permissions.canManageLiveException(member('1', ['live-manager'])), true);
assert.strictEqual(permissions.canManageLiveException(member('1', [], [PermissionFlagsBits.ManageMessages])), true);
assert.strictEqual(permissions.canManageAnnouncements(member('1', ['announce-manager'])), true);
assert.strictEqual(permissions.canManageAnnouncements(member('1', [])), false);

console.log('permissions tests passed');
