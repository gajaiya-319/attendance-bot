'use strict';

const assert = require('assert');
const {
    getExcludedUserIds,
    isExcludedUserId,
    purgeExcludedUserState
} = require('../src/utils/excludedUsers');

const CONFIG = {
    EXCEPTIONS: {
        EXCLUDED_USER_IDS: ['1239447405749993533', 'second-user']
    }
};

assert.deepStrictEqual([...getExcludedUserIds(CONFIG)], ['1239447405749993533', 'second-user']);
assert.strictEqual(isExcludedUserId(CONFIG, '1239447405749993533'), true);
assert.strictEqual(isExcludedUserId(CONFIG, { id: 'second-user' }), true);
assert.strictEqual(isExcludedUserId(CONFIG, { user: { id: 'regular-user' } }), false);

const state = {
    attendanceData: {
        '1239447405749993533': { id: '1239447405749993533' },
        'regular-user': { id: 'regular-user' }
    },
    overtimeUsers: [
        { id: '1239447405749993533' },
        { id: 'regular-user' }
    ],
    liveExceptions: {
        'second-user': { status: 'active' },
        'regular-user': { status: 'active' }
    },
    dayOffReservations: {
        excluded: { userId: '1239447405749993533' },
        regular: { userId: 'regular-user' }
    },
    attendanceEventLog: [
        { userId: 'second-user', type: 'clock_in' },
        { userId: 'regular-user', type: 'clock_in' }
    ]
};

const result = purgeExcludedUserState(state, CONFIG);
assert.strictEqual(result.changed, true);
assert.deepStrictEqual(result.removed, {
    attendanceUsers: 1,
    overtimeUsers: 1,
    liveExceptions: 1,
    dayOffReservations: 1,
    attendanceEvents: 1
});
assert.deepStrictEqual(Object.keys(state.attendanceData), ['regular-user']);
assert.deepStrictEqual(state.overtimeUsers.map(entry => entry.id), ['regular-user']);
assert.deepStrictEqual(Object.keys(state.liveExceptions), ['regular-user']);
assert.deepStrictEqual(Object.keys(state.dayOffReservations), ['regular']);
assert.deepStrictEqual(state.attendanceEventLog.map(event => event.userId), ['regular-user']);
assert.strictEqual(purgeExcludedUserState(state, CONFIG).changed, false, 'purge is idempotent');

console.log('excluded-users tests passed');
