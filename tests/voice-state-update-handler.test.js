const assert = require('assert');
const { createVoiceStateUpdateHandler } = require('../src/events/voiceStateUpdateHandler');

function createHandler(overrides = {}) {
    const calls = [];
    const now = { tag: 'now' };
    const user = { id: 'user-state' };
    const handler = createVoiceStateUpdateHandler({
        markMemberActivity: (member, source) => {
            calls.push(`activity:${member.id}:${source}`);
            return overrides.activityChanged ?? true;
        },
        determineShift: member => {
            calls.push(`shift:${member.id}`);
            return overrides.shift === undefined ? 'night' : overrides.shift;
        },
        ensureUserData: (member, shift) => {
            calls.push(`user:${member.id}:${shift}`);
            return overrides.user === undefined ? user : overrides.user;
        },
        getNow: () => now,
        applyVoiceSnapshot: async (member, receivedUser, shift, snapshot, receivedNow) => {
            calls.push(`snapshot:${member.id}:${receivedUser === user}:${shift}:${snapshot.wasConnected}:${snapshot.isConnected}:${snapshot.wasStreaming}:${snapshot.isStreaming}:${receivedNow.tag}`);
            return Boolean(overrides.snapshotChanged);
        },
        saveSystem: async () => calls.push('save'),
        renderDashboard: () => calls.push('render'),
        logger: {
            error: (...args) => calls.push(`error:${args[0]}:${args[1].message}`)
        }
    });
    return { handler, calls };
}

(async () => {
    const member = { id: 'u1', user: { bot: false } };
    const oldState = { member, channelId: 'old', streaming: false };
    const newState = { member, channelId: 'new', streaming: true };

    const { handler: changedHandler, calls: changedCalls } = createHandler({ snapshotChanged: true });
    await changedHandler(oldState, newState);
    assert.deepStrictEqual(changedCalls, [
        'activity:u1:voice_state',
        'shift:u1',
        'user:u1:night',
        'snapshot:u1:true:night:true:true:false:true:now',
        'save',
        'render'
    ]);

    const { handler: activityOnlyHandler, calls: activityOnlyCalls } = createHandler({ snapshotChanged: false });
    await activityOnlyHandler(oldState, newState);
    assert.deepStrictEqual(activityOnlyCalls, [
        'activity:u1:voice_state',
        'shift:u1',
        'user:u1:night',
        'snapshot:u1:true:night:true:true:false:true:now',
        'save'
    ]);

    const { handler: noShiftHandler, calls: noShiftCalls } = createHandler({ shift: null });
    await noShiftHandler(oldState, newState);
    assert.deepStrictEqual(noShiftCalls, [
        'activity:u1:voice_state',
        'shift:u1',
        'save'
    ]);

    const { handler: botHandler, calls: botCalls } = createHandler();
    await botHandler({ member: { id: 'bot', user: { bot: true } } }, { member: { id: 'bot', user: { bot: true } } });
    assert.deepStrictEqual(botCalls, []);

    const { handler: errorHandler, calls: errorCalls } = createHandler({
        user: null
    });
    await errorHandler(oldState, newState);
    assert.deepStrictEqual(errorCalls, [
        'activity:u1:voice_state',
        'shift:u1',
        'user:u1:night'
    ]);

    assert.throws(() => createVoiceStateUpdateHandler({}), /markMemberActivity/);

    console.log('voice-state-update-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
