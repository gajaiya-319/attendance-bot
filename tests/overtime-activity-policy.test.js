const assert = require('assert');
const {
    buildAutoOtConfirmDmPayload,
    buildAutoOtConfirmCustomId,
    classifyOvertimeActivityRisk,
    findDeniedOvertimeActivity,
    findAllowedOvertimeActivity,
    getMemberActivityEntries,
    getMemberActivityNames,
    parseAutoOtConfirmCustomId
} = require('../src/utils/overtimeActivityPolicy');

{
    const member = {
        id: 'u1',
        presence: {
            activities: [
                { name: 'Visual Studio Code' },
                { name: 'League of Legends' }
            ]
        }
    };
    const denied = findDeniedOvertimeActivity(member, {
        OT_ACTIVITY_DENYLIST: ['Dota', 'League', 'Valorant', 'Steam']
    });
    assert.strictEqual(denied.name, 'League of Legends', 'denylist catches game activity names');
    assert.strictEqual(denied.matched, 'league', 'denylist stores normalized matched keyword');
}

{
    const member = {
        id: 'u2',
        presence: {
            activities: [
                { name: 'Streaming', details: 'Valorant ranked' }
            ]
        }
    };
    const denied = findDeniedOvertimeActivity(member, {
        OT_ACTIVITY_DENYLIST: ['Valorant']
    });
    assert.strictEqual(denied.name, 'Valorant ranked', 'denylist checks activity details too');
}

{
    const member = {
        id: 'u3',
        guild: {
            presences: {
                cache: new Map([['u3', { activities: [{ name: 'Steam' }] }]])
            }
        }
    };
    assert.deepStrictEqual(getMemberActivityNames(member), ['Steam'], 'activity names can come from guild presence cache');
    assert.strictEqual(findDeniedOvertimeActivity(member, { OT_ACTIVITY_DENYLIST: ['Steam'] }).name, 'Steam');
}

{
    const member = { id: 'u4', presence: { activities: [{ name: 'WorkBoard Live Monitor' }] } };
    const allowed = findAllowedOvertimeActivity(member, { OT_ACTIVITY_ALLOWLIST: ['WorkBoard'] });
    assert.strictEqual(allowed.name, 'WorkBoard Live Monitor', 'allowlist catches approved work activity names');
    const risk = classifyOvertimeActivityRisk(member, {
        OT_ACTIVITY_DENYLIST: ['Dota'],
        OT_ACTIVITY_ALLOWLIST: ['WorkBoard'],
        AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold'
    });
    assert.strictEqual(risk.status, 'allowed', 'approved activity is not blocked');
    assert.strictEqual(risk.shouldBlock, false, 'approved activity can proceed to OT confirmation');
}

{
    const member = { id: 'u5' };
    const risk = classifyOvertimeActivityRisk(member, {
        OT_ACTIVITY_DENYLIST: ['Dota'],
        AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold'
    });
    assert.strictEqual(risk.status, 'unknown', 'missing activity is explicitly classified');
    assert.strictEqual(risk.shouldBlock, true, 'strict unknown-activity policy blocks automatic OT');
    assert.strictEqual(risk.reason, 'activity-not-visible', 'unknown activity carries a reviewable reason');
}

{
    const member = { id: 'missing-allowlist-user' };
    const risk = classifyOvertimeActivityRisk(member, {
        OT_ACTIVITY_ALLOWLIST: ['Lineage Classic'],
        AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold'
    });
    assert.strictEqual(risk.status, 'unknown', 'missing activity stays unknown even when an allowlist is configured');
    assert.strictEqual(risk.reason, 'activity-not-visible', 'missing activity is not mislabeled as non-allowlisted');
    assert.strictEqual(risk.shouldBlock, true, 'hold mode blocks final OT start until activity evidence appears');
}

{
    const member = { id: 'u6', presence: { activities: [{ name: 'Unknown Game Launcher' }] } };
    const risk = classifyOvertimeActivityRisk(member, {
        OT_ACTIVITY_DENYLIST: ['Dota'],
        OT_ACTIVITY_ALLOWLIST: ['WorkBoard']
    });
    assert.strictEqual(risk.status, 'unverified', 'visible but non-allowlisted activity is unverified');
    assert.strictEqual(risk.shouldBlock, true, 'allowlist mode blocks non-work activity names');
}

{
    const member = { id: 'lineage-user', presence: { activities: [{ type: 0, name: 'Lineage Classic' }] } };
    const risk = classifyOvertimeActivityRisk(member, {
        OT_ACTIVITY_DENYLIST: ['Dota', 'League', 'Valorant', 'Steam'],
        OT_ACTIVITY_ALLOWLIST: ['Lineage Classic', '리니지 클래식'],
        AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold'
    });
    assert.strictEqual(risk.status, 'allowed', 'Lineage Classic is treated as approved work activity');
    assert.strictEqual(risk.shouldBlock, false, 'Lineage Classic is not blocked as personal gaming');
}

{
    const member = { id: 'custom-status-user', presence: { activities: [{ type: 4, name: 'Custom Status', state: 'Lineage Classic' }] } };
    assert.deepStrictEqual(getMemberActivityEntries(member), [], 'custom status is ignored as work evidence');
    const risk = classifyOvertimeActivityRisk(member, {
        OT_ACTIVITY_ALLOWLIST: ['Lineage Classic'],
        AUTO_OT_UNKNOWN_ACTIVITY_POLICY: 'hold'
    });
    assert.strictEqual(risk.status, 'unknown', 'custom status is treated as missing trusted activity evidence');
    assert.strictEqual(risk.shouldBlock, true, 'custom status Lineage text does not bypass verification');
}

{
    const customId = buildAutoOtConfirmCustomId('start', 'u1', 'token123');
    assert.deepStrictEqual(parseAutoOtConfirmCustomId(customId), {
        action: 'start',
        userId: 'u1',
        token: 'token123'
    });
    assert.strictEqual(parseAutoOtConfirmCustomId('ot:start:u1:token123'), null, 'wrong prefix is ignored');
    assert.strictEqual(parseAutoOtConfirmCustomId(buildAutoOtConfirmCustomId('bad', 'u1', 'token123')), null, 'wrong action is ignored');
}

{
    const payload = buildAutoOtConfirmDmPayload({
        userId: 'u1',
        token: 'token123',
        expiresAt: null
    });
    assert(payload.content.includes('Are you planning to do OT?'), 'initial DM asks for OT confirmation');
    assert(payload.content.includes('LIVE must stay ON to count as OT'), 'DM states that LIVE must stay on for OT');
    assert(payload.content.includes('Voice-channel presence alone is not OT'), 'DM states that voice-only presence is not OT');
    assert(payload.content.includes('If LIVE is OFF when you press Start OT'), 'DM warns that the button rechecks LIVE state');
    assert(payload.content.includes('stays open until you choose Start OT or Cancel'), 'default DM remains open until a decision');
    assert(payload.content.includes('Activity evidence: not verified'), 'default DM shows the activity evidence state');

    const reminderPayload = buildAutoOtConfirmDmPayload({
        userId: 'u1',
        token: 'token123',
        expiresAt: null,
        reminder: true,
        reminderCount: 2
    });
    assert(reminderPayload.content.includes('OT confirmation reminder'), 'reminder DM is explicit');
    assert(reminderPayload.content.includes('Reminder #2'), 'reminder DM includes count');

    const allowedPayload = buildAutoOtConfirmDmPayload({
        userId: 'u1',
        token: 'token123',
        expiresAt: null,
        activityStatus: 'allowed',
        activityNames: ['Lineage Classic']
    });
    assert(allowedPayload.content.includes('Activity evidence: Lineage Classic'), 'DM shows approved visible activity evidence');

    const unknownPayload = buildAutoOtConfirmDmPayload({
        userId: 'u1',
        token: 'token123',
        expiresAt: null,
        activityStatus: 'unknown',
        activityNames: []
    });
    assert(unknownPayload.content.includes('Activity evidence: not visible'), 'DM shows when Discord activity is hidden');
    assert(unknownPayload.content.includes('Start OT will not start automatically'), 'hidden activity warning explains the button guard');

    const fallbackPayload = buildAutoOtConfirmDmPayload({
        userId: 'u1',
        token: 'token123',
        expiresAt: null,
        activityStatus: 'unknown',
        activityNames: [],
        activityFallback: 'continuous-live'
    });
    assert(fallbackPayload.content.includes('Activity evidence: not visible'), 'fallback DM still says activity is hidden');
    assert(fallbackPayload.content.includes('Fallback evidence: continuous LIVE from shift end'), 'fallback DM explains continuous live evidence');
    assert(!fallbackPayload.content.includes('Start OT will not start automatically'), 'fallback DM does not claim hidden activity always blocks OT');

    const lateReturnPayload = buildAutoOtConfirmDmPayload({
        userId: 'u1',
        token: 'token123',
        expiresAt: null,
        activityStatus: 'unknown',
        activityNames: [],
        activityFallback: 'late-return-live'
    });
    assert(lateReturnPayload.content.includes('Fallback evidence: LIVE is on now'), 'late-return DM explains live-on-now evidence');
    assert(lateReturnPayload.content.includes('new OT session from now'), 'late-return DM says OT starts from now');
    assert(!lateReturnPayload.content.includes('Start OT will not start automatically'), 'late-return hidden activity can proceed through DM confirmation');
}

console.log('overtime-activity-policy tests passed');
