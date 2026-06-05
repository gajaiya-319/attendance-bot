const assert = require('assert');
const { createDayOffMessageEventHandlers } = require('../src/events/dayOffMessageEventHandlers');

function createHandlers(overrides = {}) {
    const calls = [];
    const member = {
        id: 'reviewer',
        permissions: {
            has: flag => flag === 'ManageMessages'
        }
    };
    const message = {
        id: 'msg1',
        member: { id: 'author-member' },
        author: { bot: false },
        guild: {
            members: {
                fetch: async id => {
                    calls.push(`fetch:${id}`);
                    return overrides.reviewerMember === undefined ? member : overrides.reviewerMember;
                }
            }
        }
    };
    const handlers = createDayOffMessageEventHandlers({
        MessagePermissionFlags: {
            Administrator: 'Administrator',
            ManageMessages: 'ManageMessages'
        },
        reviewerId: 'reviewer-user',
        approvalEmoji: '✅',
        cancelEmoji: '❌',
        dayOffService: {
            isDayOffChannel: value => value?.id === 'msg1'
        },
        cleanupLocks: {
            has: id => overrides.lockedIds?.includes(id) || false
        },
        markMemberActivity: (receivedMember, source) => {
            calls.push(`activity:${receivedMember.id}:${source}`);
            return overrides.activityChanged ?? true;
        },
        saveSystem: async () => calls.push('save'),
        processDayOffMessage: async receivedMessage => calls.push(`process:${receivedMessage.id}`),
        approveDayOffMessage: async (receivedMessage, reviewer) => calls.push(`approve:${receivedMessage.id}:${reviewer?.id || 'none'}`),
        cancelDayOffRequest: async (receivedMessage, reviewer) => calls.push(`request-cancel:${receivedMessage.id}:${reviewer?.id || 'none'}`),
        cancelDayOffApproval: async (receivedMessage, reviewer) => calls.push(`cancel:${receivedMessage.id}:${reviewer?.id || 'none'}`),
        logger: {
            error: (label, error) => calls.push(`error:${label}:${error.message}`)
        }
    });
    return { handlers, calls, message };
}

function reactionFor(message, options = {}) {
    return {
        partial: Boolean(options.partial),
        emoji: { name: options.emoji || '✅' },
        message: options.messagePartial
            ? {
                partial: true,
                fetch: async () => message
            }
            : message,
        fetch: async () => ({
            partial: false,
            emoji: { name: options.emoji || '✅' },
            message: options.messagePartial
                ? {
                    partial: true,
                    fetch: async () => message
                }
                : message
        })
    };
}

(async () => {
    const { handlers: createHandlersInstance, calls: createCalls, message } = createHandlers();
    await createHandlersInstance.create(message);
    assert.deepStrictEqual(createCalls, [
        'activity:author-member:message',
        'save',
        'process:msg1'
    ]);

    const { handlers: updateHandlers, calls: updateCalls, message: updateMessage } = createHandlers();
    await updateHandlers.update({}, {
        partial: true,
        fetch: async () => updateMessage
    });
    assert.deepStrictEqual(updateCalls, ['process:msg1']);

    const { handlers: addHandlers, calls: addCalls, message: addMessage } = createHandlers();
    await addHandlers.reactionAdd(reactionFor(addMessage), { id: 'user1', bot: false });
    assert.deepStrictEqual(addCalls, [
        'fetch:user1',
        'approve:msg1:reviewer'
    ]);

    const { handlers: cancelRequestHandlers, calls: cancelRequestCalls, message: cancelRequestMessage } = createHandlers();
    await cancelRequestHandlers.reactionAdd(reactionFor(cancelRequestMessage, { emoji: '❌' }), { id: 'user1', bot: false });
    assert.deepStrictEqual(cancelRequestCalls, [
        'fetch:user1',
        'request-cancel:msg1:reviewer'
    ]);

    const { handlers: lockedHandlers, calls: lockedCalls, message: lockedMessage } = createHandlers({ lockedIds: ['msg1'] });
    await lockedHandlers.reactionAdd(reactionFor(lockedMessage), { id: 'user1', bot: false });
    assert.deepStrictEqual(lockedCalls, []);

    const { handlers: removeHandlers, calls: removeCalls, message: removeMessage } = createHandlers();
    await removeHandlers.reactionRemove(reactionFor(removeMessage, { messagePartial: true }), { id: 'reviewer-user', bot: false });
    assert.deepStrictEqual(removeCalls, [
        'fetch:reviewer-user',
        'cancel:msg1:reviewer'
    ]);

    const { handlers: cancelRemoveHandlers, calls: cancelRemoveCalls, message: cancelRemoveMessage } = createHandlers();
    await cancelRemoveHandlers.reactionRemove(reactionFor(cancelRemoveMessage, { emoji: '❌' }), { id: 'reviewer-user', bot: false });
    assert.deepStrictEqual(cancelRemoveCalls, []);

    const { handlers: lockedRemoveHandlers, calls: lockedRemoveCalls, message: lockedRemoveMessage } = createHandlers({ lockedIds: ['msg1'] });
    await lockedRemoveHandlers.reactionRemove(reactionFor(lockedRemoveMessage), { id: 'reviewer-user', bot: false });
    assert.deepStrictEqual(lockedRemoveCalls, []);

    const { handlers: botHandlers, calls: botCalls, message: botMessage } = createHandlers();
    await botHandlers.reactionAdd(reactionFor(botMessage), { id: 'bot', bot: true });
    assert.deepStrictEqual(botCalls, []);

    assert.throws(() => createDayOffMessageEventHandlers({}), /MessagePermissionFlags/);

    console.log('dayoff-message-event-handlers tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
