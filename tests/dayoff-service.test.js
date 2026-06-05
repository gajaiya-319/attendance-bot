const assert = require('assert');
const moment = require('moment-timezone');
const createDayOffService = require('../src/services/dayoffService');
const { padWidth, truncateWidth } = require('../src/utils/textFormat');

const CONFIG = {
    DAYOFF_CHANNEL: 'dayoff-channel',
    GUILD_ID: 'guild',
    TIMEZONE: 'Asia/Manila',
    ROLES: { DAY: 'day-role', NIGHT: 'night-role' }
};

function makeEmbedBuilder() {
    return class EmbedBuilderStub {
        constructor() { this.data = { fields: [] }; }
        setTitle(value) { this.data.title = value; return this; }
        setColor(value) { this.data.color = value; return this; }
        setDescription(value) { this.data.description = value; return this; }
        addFields(field) { this.data.fields.push(field); return this; }
        setFooter(value) { this.data.footer = value; return this; }
        setTimestamp() { this.data.timestamp = true; return this; }
    };
}

let reservations = {};
const service = createDayOffService({
    CONFIG,
    moment,
    EmbedBuilder: makeEmbedBuilder(),
    padWidth,
    truncateWidth,
    getReservations: () => reservations
});

assert.strictEqual(service.getDayOffChannelId(), 'dayoff-channel');
assert.strictEqual(service.isDayOffChannel({ guildId: 'guild', channelId: 'dayoff-channel' }), true);
assert.strictEqual(service.isDayOffChannel({ guildId: 'guild', channelId: 'other' }), false);
assert.strictEqual(service.normalizeDayOffName('Alice-01!'), 'alice01');
assert.strictEqual(service.normalizeDayOffName('\uD64D\uAE38\uB3D9!'), '\uD64D\uAE38\uB3D9');

const parsed = service.parseDayOffRequest({
    content: 'Name: Alice\nLeave date: May 21',
    guildId: 'guild',
    channelId: 'dayoff-channel',
    member: { displayName: 'Alice', roles: { cache: { has: id => id === 'day-role' } } },
    author: { username: 'Alice' }
});
assert.strictEqual(parsed.ok, true);
assert.strictEqual(parsed.shift, 'day');
assert.strictEqual(parsed.shiftLabel, 'Day Time');
assert.match(parsed.leaveDate, /^\d{4}-05-21$/);

const missingName = service.parseDayOffRequest({
    content: 'Leave date: May 21',
    member: { displayName: 'Alice', roles: { cache: { has: id => id === 'day-role' } } },
    author: { username: 'Alice' }
});
assert.strictEqual(missingName.ok, false);
assert.strictEqual(missingName.code, 'missing-name');

assert.strictEqual(service.parseDayOffCommandDate('2026-05-21'), '2026-05-21');
assert.strictEqual(service.parseDayOffCommandDate('bad-date'), null);

reservations = {
    a: { status: 'approved', leaveDate: '2026-05-21', name: 'Alice', shiftLabel: 'Day Time' },
    b: { status: 'pending', leaveDate: '2026-05-22', name: 'Bob', shiftLabel: 'Night Time' }
};
assert.strictEqual(service.getDayOffReservationsByStatus('approved').length, 1);
assert.match(service.formatDayOffReservationLine(reservations.a), /^OK 2026-05-21/);
assert.strictEqual(service.buildDayOffDm(reservations.a).includes('승인'), true);
assert.strictEqual(service.buildDayOffRejectDm({ ...reservations.a, rejectReason: 'No coverage' }).includes('No coverage'), true);
assert.strictEqual(service.hasApprovalReaction({ reactions: { cache: [{ emoji: { name: '\u2705' }, count: 1 }] } }), true);
assert.strictEqual(service.hasApprovalText({ content: 'Reason: Family Reunion (Approved by Sir Great on May 31, 2026)' }), true);
assert.strictEqual(service.hasApprovalText({ content: 'Reason: Family Reunion' }), false);
assert.strictEqual(service.buildDayOffListEmbed('all').data.title, 'DAY OFF Reservation List');

console.log('dayoff-service tests passed');
