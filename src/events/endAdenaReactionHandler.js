'use strict';

const { getShiftSheetDayOfMonth } = require('../utils/shiftSheetDate');

function parseEndAdenaMessage(content) {
    const text = String(content || '');
    const adenaMatch = text.match(/gained\s*adena\s*:\s*([0-9][0-9,.\s]*)/i);
    if (!adenaMatch) return null;

    const rawAmount = Number.parseInt(adenaMatch[1].replace(/[\s,.]/g, ''), 10);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) return null;

    const nameMatch = text.match(/(?:^|\n)\s*-?\s*name\s*:\s*([^\n\r]+)/i);
    const requestedName = nameMatch?.[1]?.trim() || null;
    const amount = Math.floor(rawAmount / 1000) * 1000;
    if (amount <= 0) return null;

    return {
        rawAmount,
        amount,
        requestedName
    };
}

function getSheetName(member, parsedName) {
    const rawName = String(member?.displayName || member?.user?.username || '');
    const discordName = rawName.split('-')[0].trim();
    return discordName || parsedName || null;
}

function hasWorkerIdentity(member, roles) {
    if (member?.roles?.cache?.has?.(roles.DAY) || member?.roles?.cache?.has?.(roles.NIGHT)) return true;

    const profileName = String(member?.displayName || member?.user?.username || '').toLowerCase();
    return /\bday\s*time\b/.test(profileName) || /\bnight\s*time\b/.test(profileName);
}

function getEndAdenaSheetName(member, parsedName, roles) {
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

function inferEndAdenaShiftFromPostTime(moment, timezone, message) {
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

function getMessageDayOfMonth(moment, timezone, message, shift = null) {
    return getShiftSheetDayOfMonth(moment, timezone, shift, message?.createdAt || Date.now());
}

function createEndAdenaReactionHandler({
    MessagePermissionFlags = {},
    CONFIG,
    moment,
    purchaseSheetService,
    opsQueueService = null,
    onGreatTabChanged = null,
    retryDelaysMs = [],
    waitFn = ms => new Promise(resolve => setTimeout(resolve, ms)),
    logger = console
}) {
    if (!CONFIG?.ROLES) throw new TypeError('CONFIG.ROLES must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (!purchaseSheetService || typeof purchaseSheetService.addAdena !== 'function') {
        throw new TypeError('purchaseSheetService.addAdena must be a function');
    }

    const locks = new Set();

    function isEnabled() {
        return Boolean(CONFIG.PURCHASE_SPREADSHEET_ID && CONFIG.END_ADENA_CHANNEL_IDS);
    }

    function canReview(user, member) {
        const ownerIds = CONFIG.PURCHASE_OWNER_DM_IDS || CONFIG.OWNER_IDS || [];
        const roleIds = CONFIG.END_ADENA_REVIEWER_ROLE_IDS || CONFIG.DEATH_PENALTY_REVIEWER_ROLE_IDS || [];
        return Boolean(
            ownerIds.includes(user.id) ||
            roleIds.some(roleId => member?.roles?.cache?.has?.(roleId)) ||
            member?.permissions?.has?.(MessagePermissionFlags.Administrator || 'Administrator') ||
            member?.permissions?.has?.(MessagePermissionFlags.ManageMessages || 'ManageMessages')
        );
    }

    function isOwner(user) {
        const ownerIds = CONFIG.PURCHASE_OWNER_DM_IDS || CONFIG.OWNER_IDS || [];
        return ownerIds.includes(user.id);
    }

    async function writeAdenaWithRetry(writeFn, context) {
        let result = await writeFn();
        for (let attempt = 0; !result.ok && result.code === 'sheet-api-error' && attempt < retryDelaysMs.length; attempt += 1) {
            const delayMs = retryDelaysMs[attempt];
            logger.warn?.('[END ADENA SHEET RETRY QUEUED]', {
                ...context,
                attempt: attempt + 2,
                delayMs,
                code: result.code
            });
            await waitFn(delayMs);
            result = await writeFn();
        }
        return result;
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
        await message.react(emoji).catch(error => logger.error?.('[END ADENA REACT ERROR]', error));
    }

    async function removeEmojiReaction(message, emoji) {
        const reaction = message.reactions?.cache?.find?.(item => item.emoji?.name === emoji);
        if (!reaction) return;
        if (typeof reaction.remove === 'function') {
            const removed = await reaction.remove().then(() => true).catch(() => false);
            if (removed) return;
        }
        const users = await reaction.users?.fetch?.().catch(() => null);
        if (users?.values) {
            for (const reactionUser of users.values()) {
                await reaction.users?.remove?.(reactionUser.id).catch(() => {});
            }
            return;
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
            const server = getServerForChannel(message.channelId, CONFIG.END_ADENA_CHANNEL_IDS);
            if (!server || !parseEndAdenaMessage(message.content)) return;

            if (!hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI)) {
                await removeEmojiReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);
            }
            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
        } catch (error) {
            logger.error?.('[END ADENA MESSAGE CREATE ERROR]', error);
        }
    }

    async function handleMessageUpdate(oldMessage, newMessage) {
        const message = newMessage || oldMessage;
        try {
            const resolvedMessage = message?.partial && typeof message.fetch === 'function'
                ? await message.fetch().catch(() => null)
                : message;
            if (!resolvedMessage || resolvedMessage.author?.bot) return;
            await handleMessageCreate(resolvedMessage);
        } catch (error) {
            logger.error?.('[END ADENA MESSAGE UPDATE ERROR]', error);
        }
    }

    async function syncMessageStatus(message, { pendingMessageIds = new Set() } = {}) {
        try {
            if (!isEnabled() || message.author?.bot) return false;
            const server = getServerForChannel(message.channelId, CONFIG.END_ADENA_CHANNEL_IDS);
            if (!server || !parseEndAdenaMessage(message.content)) return false;

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
            logger.error?.('[END ADENA STATUS SYNC ERROR]', error);
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

            const server = getServerForChannel(message.channelId, CONFIG.END_ADENA_CHANNEL_IDS);
            if (!server) return;
            const reviewerMember = await message.guild?.members?.fetch?.(user.id).catch(() => null);
            if (!canReview(user, reviewerMember)) return;

            const isCancel = resolved.emojiName === CONFIG.PURCHASE_CANCEL_EMOJI;
            if (
                locks.has(message.id) ||
                (!isCancel && hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI)) ||
                (isCancel && !hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI))
            ) return;

            const parsed = parseEndAdenaMessage(message.content);
            if (!parsed) {
                await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                return;
            }

            locks.add(message.id);
            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
            try {
                const authorMember = message.member || await message.guild?.members?.fetch?.(message.author.id).catch(() => null);
                const shift = getMemberShift(authorMember, CONFIG.ROLES) ||
                    inferEndAdenaShiftFromPostTime(moment, CONFIG.TIMEZONE, message);
                const userName = getEndAdenaSheetName(authorMember, parsed.requestedName, CONFIG.ROLES);
                if (!userName) {
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    logger.warn?.('[END ADENA SKIP] Missing shift or sheet name.', {
                        messageId: message.id,
                        server,
                        shift: shift || null,
                        userName
                    });
                    return;
                }

                const amount = isCancel ? -parsed.amount : parsed.amount;
                const rawAmount = isCancel ? -parsed.rawAmount : parsed.rawAmount;
                const dayOfMonth = getMessageDayOfMonth(moment, CONFIG.TIMEZONE, message, shift);
                const shouldWriteSummary = (isOwner(user) || isCancel) && typeof purchaseSheetService.addAdenaWithSummary === 'function';
                const payload = shouldWriteSummary
                    ? { server, shift: shift || null, userName, amount, rawAmount, dayOfMonth }
                    : { server, shift: shift || null, userName, amount, dayOfMonth };
                const result = await writeAdenaWithRetry(() => (
                    shouldWriteSummary
                    ? purchaseSheetService.addAdenaWithSummary(payload)
                    : purchaseSheetService.addAdena(payload)
                ), {
                    messageId: message.id,
                    server,
                    shift: shift || null,
                    userName,
                    amount,
                    rawAmount,
                    dayOfMonth,
                    summary: shouldWriteSummary
                });

                if (result.ok) {
                    await clearStatusReactions(message);
                    if (isCancel) {
                        await safeReact(message, CONFIG.PURCHASE_CANCEL_EMOJI);
                    } else {
                        await safeReact(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
                        await safeReact(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
                    }
                    logger.log?.(isCancel ? '[END ADENA CANCELLED]' : '[END ADENA RECORDED]', {
                        messageId: message.id,
                        server,
                        shift: shift || null,
                        userName,
                        amount,
                        range: result.range,
                        summaryRange: result.summaryRange,
                        nextValue: result.nextValue
                    });
                    if (typeof onGreatTabChanged === 'function') onGreatTabChanged();
                } else {
                    const queued = await opsQueueService?.enqueue?.({
                        kind: 'end-adena',
                        action: isCancel ? 'cancel' : 'approve',
                        method: shouldWriteSummary ? 'addAdenaWithSummary' : 'addAdena',
                        messageId: message.id,
                        channelId: message.channelId,
                        server,
                        shift: shift || null,
                        userName,
                        code: result.code,
                        errorMessage: result.errorMessage || null,
                        payload
                    });
                    await clearStatusReactions(message);
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    logger.warn?.('[END ADENA SHEET FAIL]', {
                        messageId: message.id,
                        code: result.code,
                        server,
                        shift: shift || null,
                        userName
                    });
                }
            } finally {
                locks.delete(message.id);
            }
        } catch (error) {
            logger.error?.('[END ADENA REACTION ERROR]', error);
        }
    }

    return {
        messageCreate: handleMessageCreate,
        messageUpdate: handleMessageUpdate,
        reactionAdd: handleReactionAdd,
        syncMessageStatus
    };
}

module.exports = {
    createEndAdenaReactionHandler,
    parseEndAdenaMessage,
    getServerForChannel,
    getMessageDayOfMonth,
    getSheetName,
    getEndAdenaSheetName,
    getMemberShift
};
