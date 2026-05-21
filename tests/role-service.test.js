const assert = require('assert');
const createRoleService = require('../src/services/roleService');

const CONFIG = {
    ROLES: {
        DAY: 'day',
        NIGHT: 'night',
        HEINE: 'heine',
        PAAGRIO: 'paagrio'
    }
};

function member(roles = []) {
    const roleSet = new Set(roles);
    return { roles: { cache: { has: roleId => roleSet.has(roleId) } } };
}

const service = createRoleService({ CONFIG });

assert.strictEqual(service.buildGuestNickname('Alice - Guest'), 'Alice - Guest');
assert.strictEqual(service.buildGuestNickname('Alice - H Day Time'), 'Alice - Guest');
assert.strictEqual(service.getWorkerNicknameBase('Alice - P Night Time'), 'Alice');
assert.deepStrictEqual(service.getWorkerRoleProfileFromMember(member(['heine', 'day'])), { server: 'HEINE', shift: 'DAY' });
assert.strictEqual(service.getWorkerRoleProfileFromMember(member(['heine', 'paagrio', 'day'])), null);
assert.deepStrictEqual(service.getWorkerRoleProfileFromNickname('Alice - P Night Time'), { server: 'PAAGRIO', shift: 'NIGHT' });
assert.strictEqual(service.getWorkerRoleProfileFromNickname('Alice'), null);
assert.strictEqual(service.buildWorkerNickname('Alice - Guest', { server: 'HEINE', shift: 'DAY' }), 'Alice - H Day Time');

console.log('role-service tests passed');
