'use strict';

function createVoiceStateUpdateHandler({
    markMemberActivity,
    determineShift,
    ensureUserData,
    getNow,
    applyVoiceSnapshot,
    saveSystem,
    renderDashboard,
    logger = console
}) {
    if (typeof markMemberActivity !== 'function') throw new TypeError('markMemberActivity must be a function');
    if (typeof determineShift !== 'function') throw new TypeError('determineShift must be a function');
    if (typeof ensureUserData !== 'function') throw new TypeError('ensureUserData must be a function');
    if (typeof getNow !== 'function') throw new TypeError('getNow must be a function');
    if (typeof applyVoiceSnapshot !== 'function') throw new TypeError('applyVoiceSnapshot must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof renderDashboard !== 'function') throw new TypeError('renderDashboard must be a function');

    return async function handleVoiceStateUpdate(oldState, newState) {
        try {
            const member = newState.member || oldState.member;
            if (!member || member.user?.bot) return;

            const activityChanged = markMemberActivity(member, 'voice_state');
            const shift = determineShift(member);
            if (!shift) {
                if (activityChanged) await saveSystem();
                return;
            }

            const user = ensureUserData(member, shift);
            if (!user) return;

            const now = getNow();
            const changed = await applyVoiceSnapshot(member, user, shift, {
                source: 'voice_state',
                wasConnected: Boolean(oldState.channelId),
                isConnected: Boolean(newState.channelId),
                wasStreaming: Boolean(oldState.streaming),
                isStreaming: Boolean(newState.streaming)
            }, now);

            if (changed) {
                await saveSystem();
                renderDashboard();
            } else if (activityChanged) {
                await saveSystem();
            }
        } catch (error) {
            logger.error?.('[VOICE AUTOMATION ERROR]', error);
        }
    };
}

module.exports = {
    createVoiceStateUpdateHandler
};
