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
assert.strictEqual(service.buildGuestNickname('Ryuji - P Day Time Manager'), 'Ryuji - Guest');
assert.strictEqual(service.getWorkerNicknameBase('Alice - P Night Time'), 'Alice');
assert.strictEqual(service.getWorkerNicknameBase('Ryuji - P Day Time Manager'), 'Ryuji');
assert.strictEqual(service.getWorkerNicknameBase('Mitzu shin - Traine H Night Time'), 'Mitzu shin');
assert.strictEqual(service.getWorkerNicknameBase('Daba - P Night time(Ryuji)'), 'Daba');
assert.deepStrictEqual(service.getWorkerRoleProfileFromMember(member(['heine', 'day'])), { server: 'HEINE', shift: 'DAY' });
assert.strictEqual(service.getWorkerRoleProfileFromMember(member(['heine', 'paagrio', 'day'])), null);
assert.deepStrictEqual(service.getWorkerRoleProfileFromNickname('Alice - P Night Time'), { server: 'PAAGRIO', shift: 'NIGHT' });
assert.deepStrictEqual(service.getWorkerRoleProfileFromNickname('Ryuji - P Day Time Manager'), { server: 'PAAGRIO', shift: 'DAY' });
assert.deepStrictEqual(service.getWorkerRoleProfileFromNickname('Mitzu shin - Traine H Night Time'), { server: 'HEINE', shift: 'NIGHT' });
assert.strictEqual(service.getWorkerRoleProfileFromNickname('Alice'), null);
assert.strictEqual(service.buildWorkerNickname('Alice - Guest', { server: 'HEINE', shift: 'DAY' }), 'Alice - H Day Time');

console.log('role-service tests passed');
