const assert = require('assert');
const createPermissionUtils = require('../src/utils/permissions');

const PermissionFlagsBits = {
    Administrator: 1n,
    ManageMessages: 2n
};

const CONFIG = {
    OWNER_IDS: ['owner'],
    ALLOW_DISCORD_ADMIN_COMMANDS: false,
    LIVE_EXCEPTION_MANAGER_ROLE_IDS: ['live-manager'],
    ANNOUNCEMENT_MANAGER_ROLE_IDS: ['announce-manager'],
    OPS_MANAGER_ROLE_IDS: ['ops-manager'],
    DAYOFF_MANAGER_ROLE_IDS: ['dayoff-manager'],
    DAYOFF_REVIEWER_ID: 'dayoff-reviewer',
    END_ADENA_REVIEWER_ROLE_IDS: ['adena-reviewer'],
    END_ADENA_SUMMARY_OWNER_ROLE_IDS: ['adena-owner'],
    END_ADENA_SUMMARY_USER_IDS: ['adena-user'],
    ROLES: {
        DAY: 'day',
        NIGHT: 'night',
        HEINE: 'heine',
        PAAGRIO: 'paagrio',
        WORKING: 'working',
        GUEST: 'guest'
    },
    EXCEPTIONS: {
        SHARED_SEAT_USER: 'shared-seat',
        EXCLUDED_USER_IDS: ['excluded-user']
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
assert.strictEqual(permissions.isAssignedWorker(member('excluded-user', ['day', 'paagrio'])), false);
assert.strictEqual(permissions.hasManagedAttendanceRole(member('1', ['guest'])), true);
assert.strictEqual(permissions.hasManagedAttendanceRole(member('excluded-user', ['guest'])), false);
assert.strictEqual(permissions.canManageLiveException(member('1', ['live-manager'])), true);
assert.strictEqual(permissions.canManageLiveException(member('1', [], [PermissionFlagsBits.ManageMessages])), false);
assert.strictEqual(permissions.canManageLiveException(member('1', [], [PermissionFlagsBits.Administrator])), false);
assert.strictEqual(permissions.canManageAnnouncements(member('1', ['announce-manager'])), true);
assert.strictEqual(permissions.canManageAnnouncements(member('1', [])), false);
assert.strictEqual(permissions.canRunOperationalCommand(member('1', ['ops-manager'])), true);
assert.strictEqual(permissions.canRunOperationalCommand(member('owner')), true);
assert.strictEqual(permissions.canRunOperationalCommand(member('excluded-user', ['ops-manager'])), false);
assert.strictEqual(permissions.canRunOperationalCommand(member('1', [], [PermissionFlagsBits.Administrator])), false);
assert.strictEqual(permissions.canManageDayOff(member('dayoff-reviewer')), true);
assert.strictEqual(permissions.canManageDayOff(member('1', ['dayoff-manager'])), true);
assert.strictEqual(permissions.canReviewEndAdena(member('adena-user')), false);
assert.strictEqual(permissions.canReviewEndAdena(member('1', ['adena-reviewer'])), true);
assert.strictEqual(permissions.canReviewEndAdena(member('1', ['adena-owner'])), true);
assert.strictEqual(permissions.canReviewEndAdena(member('1')), false);

const permissive = createPermissionUtils({
    CONFIG: { ...CONFIG, ALLOW_DISCORD_ADMIN_COMMANDS: true },
    PermissionFlagsBits
});
assert.strictEqual(permissive.canRunOperationalCommand(member('1', [], [PermissionFlagsBits.Administrator])), true);

console.log('permissions tests passed');
