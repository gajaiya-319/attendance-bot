'use strict';

function createDayOffMessageEventHandlers({
    MessagePermissionFlags,
    reviewerId,
    approvalEmoji,
    cancelEmoji,
    dayOffService,
    cleanupLocks,
    markMemberActivity,
    saveSystem,
    processDayOffMessage,
    approveDayOffMessage,
    cancelDayOffRequest,
    cancelDayOffApproval,
    logger = console
}) {
    if (!MessagePermissionFlags) throw new TypeError('MessagePermissionFlags must be provided');
    if (!dayOffService || typeof dayOffService.isDayOffChannel !== 'function') {
        throw new TypeError('dayOffService.isDayOffChannel must be a function');
    }
    if (!cleanupLocks || typeof cleanupLocks.has !== 'function') throw new TypeError('cleanupLocks.has must be a function');
    if (typeof markMemberActivity !== 'function') throw new TypeError('markMemberActivity must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof processDayOffMessage !== 'function') throw new TypeError('processDayOffMessage must be a function');
    if (typeof approveDayOffMessage !== 'function') throw new TypeError('approveDayOffMessage must be a function');
    if (typeof cancelDayOffRequest !== 'function') throw new TypeError('cancelDayOffRequest must be a function');
    if (typeof cancelDayOffApproval !== 'function') throw new TypeError('cancelDayOffApproval must be a function');

    function canReviewDayOff(member, user) {
        return Boolean(
            member?.permissions?.has(MessagePermissionFlags.Administrator) ||
            member?.permissions?.has(MessagePermissionFlags.ManageMessages) ||
            user.id === reviewerId
        );
    }

    async function resolveReactionMessage(reaction) {
        const resolvedReaction = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
        const emoji = resolvedReaction?.emoji?.name;
        if (!resolvedReaction || ![approvalEmoji, cancelEmoji].includes(emoji)) return null;
        const message = resolvedReaction.message.partial
            ? await resolvedReaction.message.fetch().catch(() => null)
            : resolvedReaction.message;
        return message ? { message, emoji } : null;
    }

    async function handleMessageCreate(message) {
        try {
            if (message.member && !message.author?.bot && markMemberActivity(message.member, 'message')) {
                await saveSystem();
            }
            await processDayOffMessage(message);
        } catch (error) {
            logger.error?.('[DAYOFF MESSAGE ERROR]', error);
        }
    }

    async function handleMessageUpdate(oldMessage, newMessage) {
        try {
            const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
            if (message) await processDayOffMessage(message);
        } catch (error) {
            logger.error?.('[DAYOFF UPDATE ERROR]', error);
        }
    }

    async function handleReactionAdd(reaction, user) {
        try {
            if (user.bot) return;
            const resolved = await resolveReactionMessage(reaction);
            const message = resolved?.message;
            if (!message || !dayOffService.isDayOffChannel(message)) return;
            if (cleanupLocks.has(message.id)) return;

            const member = await message.guild.members.fetch(user.id).catch(() => null);
            if (!canReviewDayOff(member, user)) return;

            if (resolved.emoji === approvalEmoji) {
                await approveDayOffMessage(message, member);
            } else if (resolved.emoji === cancelEmoji) {
                await cancelDayOffRequest(message, member);
            }
        } catch (error) {
            logger.error?.('[DAYOFF REACTION ADD ERROR]', error);
        }
    }

    async function handleReactionRemove(reaction, user) {
        try {
            if (user.bot) return;
            const resolved = await resolveReactionMessage(reaction);
            const message = resolved?.message;
            if (!message || !dayOffService.isDayOffChannel(message)) return;
            if (resolved.emoji !== approvalEmoji) return;
            if (cleanupLocks.has(message.id)) return;

            const member = await message.guild.members.fetch(user.id).catch(() => null);
            if (!canReviewDayOff(member, user)) return;

            await cancelDayOffApproval(message, member);
        } catch (error) {
            logger.error?.('[DAYOFF REACTION REMOVE ERROR]', error);
        }
    }

    return {
        create: handleMessageCreate,
        update: handleMessageUpdate,
        reactionAdd: handleReactionAdd,
        reactionRemove: handleReactionRemove
    };
}

module.exports = {
    createDayOffMessageEventHandlers
};
