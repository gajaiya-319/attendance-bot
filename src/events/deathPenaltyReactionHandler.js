'use strict';

const { getShiftSheetDayOfMonth } = require('../utils/shiftSheetDate');

function parseNameFromContent(content) {
    const match = String(content || '').match(/(?:^|\n)\s*-?\s*name\s*:\s*([^\n\r]+)/i);
    return match?.[1]?.trim() || null;
}

function getSheetName(member, parsedName = null) {
    if (parsedName) return parsedName;
    const rawName = String(member?.displayName || member?.user?.username || '');
    return rawName.split('-')[0].trim() || null;
}

function hasWorkerIdentity(member, roles) {
    if (member?.roles?.cache?.has?.(roles.DAY) || member?.roles?.cache?.has?.(roles.NIGHT)) return true;

    const profileName = String(member?.displayName || member?.user?.username || '').toLowerCase();
    return /\bday\s*time\b/.test(profileName) || /\bnight\s*time\b/.test(profileName);
}

function getPenaltySheetName(member, parsedName, roles) {
    if (!hasWorkerIdentity(member, roles) && parsedName) return parsedName;
    return getSheetName(member, parsedName);
}

function getMemberShift(member, roles) {
    if (member?.roles?.cache?.has(roles.DAY)) return 'DAY';
    if (member?.roles?.cache?.has(roles.NIGHT)) return 'NIGHT';

    const profileName = String(member?.displayName || member?.user?.username || '').toLowerCase();
    if (/\bday\s*time\b/.test(profileName)) return 'DAY';
    if (/\bnight\s*time\b/.test(profileName)) return 'NIGHT';
    return null;
}

function inferShiftFromPostTime(moment, timezone, message) {
    const createdAt = message?.createdAt || Date.now();
    const hour = moment(createdAt).tz(timezone).hour();
    return hour < 12 ? 'NIGHT' : 'DAY';
}

function hasReaction(message, emojiName) {
    return Boolean(message?.reactions?.cache?.find?.(reaction => (
        reaction.emoji?.name === emojiName &&
        (reaction.count === undefined || reaction.count > 0)
    )));
}

function getServerForChannel(channelId, channelIds) {
    return Object.entries(channelIds || {}).find(([, id]) => id === channelId)?.[0] || null;
}

function isSafetyZonePost(content) {
    return /\bsafety\s*zone\b/i.test(String(content || ''));
}

function createDeathPenaltyReactionHandler({
    MessagePermissionFlags = {},
    CONFIG,
    moment,
    purchaseSheetService,
    opsQueueService = null,
    onGreatTabChanged = null,
    logger = console
}) {
    if (!CONFIG?.ROLES) throw new TypeError('CONFIG.ROLES must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (!purchaseSheetService || typeof purchaseSheetService.addPurchase !== 'function') {
        throw new TypeError('purchaseSheetService.addPurchase must be a function');
    }

    const locks = new Set();

    function isEnabled() {
        return Boolean(CONFIG.PURCHASE_SPREADSHEET_ID && CONFIG.DEATH_PENALTY_CHANNEL_IDS);
    }

    function canReview(user, member) {
        const ownerIds = CONFIG.PURCHASE_OWNER_DM_IDS || CONFIG.OWNER_IDS || [];
        const roleIds = CONFIG.DEATH_PENALTY_REVIEWER_ROLE_IDS || [];
        return Boolean(
            ownerIds.includes(user.id) ||
            roleIds.some(roleId => member?.roles?.cache?.has?.(roleId)) ||
            member?.permissions?.has?.(MessagePermissionFlags.Administrator || 'Administrator') ||
            member?.permissions?.has?.(MessagePermissionFlags.ManageMessages || 'ManageMessages')
        );
    }

    async function resolveReaction(reaction) {
        const resolvedReaction = reaction.partial ? await reaction.fetch().catch(() => null) : reaction;
        if (!resolvedReaction) return null;
        const emojiName = resolvedReaction.emoji?.name;
        if (emojiName !== CONFIG.PURCHASE_APPROVAL_EMOJI && emojiName !== CONFIG.PURCHASE_CANCEL_EMOJI) return null;
        const message = resolvedReaction.message?.partial
            ? await resolvedReaction.message.fetch().catch(() => null)
            : resolvedReaction.message;
        return message ? { reaction: resolvedReaction, message, emojiName } : null;
    }

    async function safeReact(message, emoji) {
        if (!emoji) return;
        await message.react(emoji).catch(error => logger.error?.('[DEATH PENALTY REACT ERROR]', error));
    }

    async function removeEmojiReaction(message, emoji) {
        const reaction = message.reactions?.cache?.find?.(item => item.emoji?.name === emoji);
        if (!reaction) return;
        if (typeof reaction.remove === 'function') {
            const removed = await reaction.remove().then(() => true).catch(() => false);
            if (removed) return;
        }
        await reaction.users?.remove?.(message.client?.user?.id).catch(() => {});
    }

    async function clearStatusReactions(message) {
        await removeEmojiReaction(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
        await removeEmojiReaction(message, CONFIG.PURCHASE_CANCEL_EMOJI);
        await removeEmojiReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
        await removeEmojiReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);
        await removeEmojiReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
    }

    async function handleMessageCreate(message) {
        try {
            if (!isEnabled() || message.author?.bot) return;
            const server = getServerForChannel(message.channelId, CONFIG.DEATH_PENALTY_CHANNEL_IDS);
            if (!server || isSafetyZonePost(message.content)) return;

            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
        } catch (error) {
            logger.error?.('[DEATH PENALTY MESSAGE CREATE ERROR]', error);
        }
    }

    async function syncMessageStatus(message, { pendingMessageIds = new Set() } = {}) {
        try {
            if (!isEnabled() || message.author?.bot) return false;
            const server = getServerForChannel(message.channelId, CONFIG.DEATH_PENALTY_CHANNEL_IDS);
            if (!server || isSafetyZonePost(message.content)) return false;

            const isQueued = pendingMessageIds.has(message.id);
            const isApproved = hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
            const isCancelled = hasReaction(message, CONFIG.PURCHASE_CANCEL_EMOJI) && !isApproved;

            if (isApproved) {
                await clearStatusReactions(message);
                await safeReact(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
                await safeReact(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
                return true;
            }

            if (isCancelled && !isQueued) {
                await clearStatusReactions(message);
                await safeReact(message, CONFIG.PURCHASE_CANCEL_EMOJI);
                return true;
            }

            if (isQueued) {
                await clearStatusReactions(message);
                await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                return true;
            }

            await removeEmojiReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);
            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
            return true;
        } catch (error) {
            logger.error?.('[DEATH PENALTY STATUS SYNC ERROR]', error);
            return false;
        }
    }

    async function handleReactionAdd(reaction, user) {
        try {
            if (!isEnabled() || user.bot) return;
            const resolved = await resolveReaction(reaction);
            let message = resolved?.message;
            if (!message) return;
            message = typeof message.fetch === 'function'
                ? await message.fetch().catch(() => message)
                : message;

            const server = getServerForChannel(message.channelId, CONFIG.DEATH_PENALTY_CHANNEL_IDS);
            if (!server) return;
            if (isSafetyZonePost(message.content)) return;
            const reviewerMember = await message.guild?.members?.fetch?.(user.id).catch(() => null);
            if (!canReview(user, reviewerMember)) return;

            const isCancel = resolved.emojiName === CONFIG.PURCHASE_CANCEL_EMOJI;
            if (
                locks.has(message.id) ||
                (!isCancel && hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI)) ||
                (isCancel && !hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI))
            ) return;

            locks.add(message.id);
            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
            try {
                const authorMember = message.member || await message.guild?.members?.fetch?.(message.author.id).catch(() => null);
                const shift = getMemberShift(authorMember, CONFIG.ROLES) ||
                    inferShiftFromPostTime(moment, CONFIG.TIMEZONE, message);
                const userName = getPenaltySheetName(authorMember, parseNameFromContent(message.content), CONFIG.ROLES);
                if (!shift || !userName) {
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    logger.warn?.('[DEATH PENALTY SKIP] Missing shift or sheet name.', {
                        messageId: message.id,
                        server,
                        shift,
                        userName
                    });
                    return;
                }

                const amount = isCancel ? -CONFIG.DEATH_PENALTY_AMOUNT : CONFIG.DEATH_PENALTY_AMOUNT;
                const payload = {
                    payrollKind: 'death-penalty',
                    server,
                    shift,
                    userName,
                    amount,
                    dayOfMonth: getShiftSheetDayOfMonth(moment, CONFIG.TIMEZONE, shift, message.createdAt || Date.now())
                };
                const result = await purchaseSheetService.addPurchase(payload);

                if (result.ok) {
                    await clearStatusReactions(message);
                    if (isCancel) {
                        await safeReact(message, CONFIG.PURCHASE_CANCEL_EMOJI);
                    } else {
                        await safeReact(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
                        await safeReact(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
                    }
                    logger.log?.(isCancel ? '[DEATH PENALTY CANCELLED]' : '[DEATH PENALTY RECORDED]', {
                        messageId: message.id,
                        server,
                        shift,
                        userName,
                        amount,
                        range: result.range,
                        nextValue: result.nextValue
                    });
                    if (typeof onGreatTabChanged === 'function') onGreatTabChanged();
                } else {
                    const queued = await opsQueueService?.enqueue?.({
                        kind: 'death-penalty',
                        action: isCancel ? 'cancel' : 'approve',
                        messageId: message.id,
                        channelId: message.channelId,
                        server,
                        shift,
                        userName,
                        code: result.code,
                        errorMessage: result.errorMessage || null,
                        payload
                    });
                    await clearStatusReactions(message);
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    logger.warn?.('[DEATH PENALTY SHEET FAIL]', {
                        messageId: message.id,
                        code: result.code,
                        server,
                        shift,
                        userName
                    });
                }
            } finally {
                locks.delete(message.id);
            }
        } catch (error) {
            logger.error?.('[DEATH PENALTY REACTION ERROR]', error);
        }
    }

    return {
        messageCreate: handleMessageCreate,
        reactionAdd: handleReactionAdd,
        syncMessageStatus
    };
}

module.exports = {
    createDeathPenaltyReactionHandler,
    getServerForChannel,
    isSafetyZonePost,
    parseNameFromContent,
    getSheetName,
    getPenaltySheetName,
    getMemberShift
};
