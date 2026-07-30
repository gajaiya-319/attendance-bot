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
    const matched = Object.entries(channelIds || {}).find(([, id]) => id === channelId)?.[0] || null;
    return matched === 'HEINE' ? 'VALAKAS' : matched;
}

function normalizePayrollServer(server) {
    const upper = String(server || '').trim().toUpperCase();
    if (upper === 'HEINE' || upper === 'VALACAS' || upper === 'VALAKAS') return 'VALAKAS';
    return upper || null;
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
        if (!emoji) return true;
        return message.react(emoji).then(() => true).catch(error => {
            if (error?.code === 10008 || error?.status === 404) return;
            logger.error?.('[DEATH PENALTY REACT ERROR]', {
                messageId: message?.id || null,
                channelId: message?.channelId || null,
                authorId: message?.author?.id || null,
                authorName: message?.author?.username || null,
                emoji,
                code: error?.code || error?.status || error?.rawError?.code,
                message: error?.rawError?.message || error?.message
            });
            return false;
        });
    }

    async function sendStatusFallback(message, text) {
        if (!text) return false;
        const content = `${text}\n(Discord가 이 게시물의 봇 반응을 차단해서 체크 이모지 대신 메시지로 남깁니다.)`;
        const send = typeof message.reply === 'function'
            ? () => message.reply({ content, allowedMentions: { repliedUser: false } })
            : () => message.channel?.send?.({ content });
        return send()?.then(() => true).catch(error => {
            logger.warn?.('[DEATH PENALTY STATUS FALLBACK WARN]', {
                messageId: message?.id || null,
                channelId: message?.channelId || null,
                message: error?.message
            });
            return false;
        }) || false;
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

    async function syncStatusReactions(message, desiredEmojis) {
        const desired = new Set(desiredEmojis.filter(Boolean));
        const statusEmojis = [
            CONFIG.PURCHASE_APPROVAL_EMOJI,
            CONFIG.PURCHASE_CANCEL_EMOJI,
            CONFIG.PURCHASE_SUCCESS_EMOJI,
            CONFIG.PURCHASE_FAILURE_EMOJI,
            CONFIG.PURCHASE_PROCESSING_EMOJI
        ].filter(Boolean);

        for (const emoji of statusEmojis) {
            if (!desired.has(emoji) && hasReaction(message, emoji)) {
                await removeEmojiReaction(message, emoji);
            }
        }
        for (const emoji of desired) {
            if (!hasReaction(message, emoji)) await safeReact(message, emoji);
        }
    }

    async function handleMessageCreate(message) {
        try {
            if (!isEnabled() || message.author?.bot) return;
            const server = normalizePayrollServer(getServerForChannel(message.channelId, CONFIG.DEATH_PENALTY_CHANNEL_IDS));
            if (!server || isSafetyZonePost(message.content)) return;

            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
        } catch (error) {
            logger.error?.('[DEATH PENALTY MESSAGE CREATE ERROR]', error);
        }
    }

    async function syncMessageStatus(message, { pendingMessageIds = new Set() } = {}) {
        try {
            if (!isEnabled() || message.author?.bot) return false;
            const server = normalizePayrollServer(getServerForChannel(message.channelId, CONFIG.DEATH_PENALTY_CHANNEL_IDS));
            if (!server || isSafetyZonePost(message.content)) return false;

            const isQueued = pendingMessageIds.has(message.id);
            const isApproved = hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
            const isCancelled = hasReaction(message, CONFIG.PURCHASE_CANCEL_EMOJI) && !isApproved;

            if (isApproved) {
                await syncStatusReactions(message, [
                    CONFIG.PURCHASE_APPROVAL_EMOJI,
                    CONFIG.PURCHASE_SUCCESS_EMOJI
                ]);
                return true;
            }

            if (isCancelled && !isQueued) {
                await syncStatusReactions(message, [CONFIG.PURCHASE_CANCEL_EMOJI]);
                return true;
            }

            if (isQueued) {
                await syncStatusReactions(message, [CONFIG.PURCHASE_FAILURE_EMOJI]);
                return true;
            }

            await syncStatusReactions(message, [CONFIG.PURCHASE_PROCESSING_EMOJI]);
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

            const server = normalizePayrollServer(getServerForChannel(message.channelId, CONFIG.DEATH_PENALTY_CHANNEL_IDS));
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
                    messageId: message.id,
                    channelId: message.channelId,
                    server,
                    shift,
                    userName,
                    amount,
                    dayOfMonth: getShiftSheetDayOfMonth(moment, CONFIG.TIMEZONE, shift, message.createdAt || Date.now())
                };
                const result = await purchaseSheetService.addPurchase(payload, {
                    messageId: message.id,
                    channelId: message.channelId
                });

                if (result.ok) {
                    const finalServer = result.server || server;
                    await clearStatusReactions(message);
                    if (isCancel) {
                        const reacted = await safeReact(message, CONFIG.PURCHASE_CANCEL_EMOJI);
                        if (!reacted && !result.duplicate) {
                            await sendStatusFallback(message, `❌ 다이샷 취소 완료: ${userName} ${amount}`);
                        }
                    } else {
                        const approvalReacted = await safeReact(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
                        const successReacted = await safeReact(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
                        if (!approvalReacted && !successReacted && !result.duplicate) {
                            await sendStatusFallback(message, `✅ 다이샷 기록 완료: ${userName} +${amount}`);
                        }
                    }
                    logger.log?.(isCancel ? '[DEATH PENALTY CANCELLED]' : '[DEATH PENALTY RECORDED]', {
                        messageId: message.id,
                        server: finalServer,
                        shift,
                        userName,
                        amount,
                        range: result.range,
                        nextValue: result.nextValue,
                        duplicate: Boolean(result.duplicate)
                    });
                    if (typeof onGreatTabChanged === 'function') onGreatTabChanged();
                } else {
                    const finalServer = result.server || server;
                    const finalPayload = { ...payload, server: finalServer };
                    const queued = await opsQueueService?.enqueue?.({
                        kind: 'death-penalty',
                        action: isCancel ? 'cancel' : 'approve',
                        messageId: message.id,
                        channelId: message.channelId,
                        server: finalServer,
                        shift,
                        userName,
                        code: result.code,
                        errorMessage: result.errorMessage || null,
                        payload: finalPayload
                    });
                    await clearStatusReactions(message);
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    logger.warn?.('[DEATH PENALTY SHEET FAIL]', {
                        messageId: message.id,
                        code: result.code,
                        server: finalServer,
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
