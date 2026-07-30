'use strict';

const { getShiftSheetDayOfMonth } = require('../utils/shiftSheetDate');
const { parseEndAdenaMessage } = require('../utils/endAdenaMessage');

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
    const matched = Object.entries(channelIds || {}).find(([, id]) => id === channelId)?.[0] || null;
    return matched === 'HEINE' ? 'VALAKAS' : matched;
}

function normalizePayrollServer(server) {
    const upper = String(server || '').trim().toUpperCase();
    if (upper === 'HEINE' || upper === 'VALACAS' || upper === 'VALAKAS') return 'VALAKAS';
    return upper || null;
}

function getMessageDayOfMonth(moment, timezone, message, shift = null, shiftStartAt = null) {
    return getShiftSheetDayOfMonth(moment, timezone, shift, shiftStartAt || message?.createdAt || Date.now());
}

function createEndAdenaReactionHandler({
    MessagePermissionFlags = {},
    CONFIG,
    moment,
    getShiftBounds = null,
    purchaseSheetService,
    submissionValidationService = null,
    opsQueueService = null,
    onGreatTabChanged = null,
    onApprovalRecorded = null,
    retryDelaysMs = [],
    waitFn = ms => new Promise(resolve => setTimeout(resolve, ms)),
    logger = console
}) {
    if (!CONFIG?.ROLES) throw new TypeError('CONFIG.ROLES must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (getShiftBounds !== null && typeof getShiftBounds !== 'function') throw new TypeError('getShiftBounds must be a function');
    if (submissionValidationService !== null && typeof submissionValidationService?.validate !== 'function') {
        throw new TypeError('submissionValidationService.validate must be a function');
    }
    if (onApprovalRecorded !== null && typeof onApprovalRecorded !== 'function') throw new TypeError('onApprovalRecorded must be a function');
    if (!purchaseSheetService || typeof purchaseSheetService.addAdena !== 'function') {
        throw new TypeError('purchaseSheetService.addAdena must be a function');
    }

    const locks = new Set();
    const validationReplies = new Map();

    function isEnabled() {
        return Boolean(CONFIG.PURCHASE_SPREADSHEET_ID && CONFIG.END_ADENA_CHANNEL_IDS);
    }

    function canReview(user, member) {
        const ownerIds = CONFIG.PURCHASE_OWNER_DM_IDS || CONFIG.OWNER_IDS || [];
        const roleIds = [
            ...(CONFIG.END_ADENA_REVIEWER_ROLE_IDS || CONFIG.DEATH_PENALTY_REVIEWER_ROLE_IDS || []),
            ...(CONFIG.END_ADENA_SUMMARY_OWNER_ROLE_IDS || CONFIG.SERVER_OWNER_ROLE_IDS || [])
        ];
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

    function hasSummaryOwnerRole(member) {
        const roleIds = CONFIG.END_ADENA_SUMMARY_OWNER_ROLE_IDS || CONFIG.SERVER_OWNER_ROLE_IDS || [];
        return roleIds.some(roleId => member?.roles?.cache?.has?.(roleId));
    }

    function hasSummaryUserAccess(user) {
        const userIds = CONFIG.END_ADENA_SUMMARY_USER_IDS || [];
        return userIds.includes(user.id);
    }

    function isSummaryOwner(user, message, member) {
        return Boolean(
            isOwner(user) ||
            hasSummaryUserAccess(user) ||
            hasSummaryOwnerRole(member) ||
            (message?.guild?.ownerId && message.guild.ownerId === user.id)
        );
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
        await message.react(emoji).catch(error => {
            if (error?.code === 10008 || error?.status === 404) return;
            logger.error?.('[END ADENA REACT ERROR]', error);
        });
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

    async function findValidationReply(message) {
        const cached = validationReplies.get(String(message.id));
        if (cached?.edit) return cached;
        const fetched = await message.channel?.messages?.fetch?.({ limit: 50 }).catch(() => null);
        if (!fetched?.values) return null;
        const botId = message.client?.user?.id;
        return [...fetched.values()].find(candidate => (
            candidate?.author?.id === botId &&
            (candidate.reference?.messageId || candidate.messageReference?.messageId) === message.id &&
            String(candidate.content || '').includes('\uc5d4\ub4dc\uc544\ub370\ub098 \uc0ac\uc804\uac80\uc99d')
        )) || null;
    }

    async function publishValidation(message, validation) {
        if (!submissionValidationService || typeof submissionValidationService.format !== 'function') return;
        const content = submissionValidationService.format(validation);
        const payload = { content, allowedMentions: { repliedUser: false } };
        const existing = await findValidationReply(message);
        if (existing?.edit) {
            const edited = await existing.edit(payload).catch(() => null);
            if (edited) validationReplies.set(String(message.id), edited);
            return;
        }
        const reply = await message.reply?.(payload).catch(error => {
            logger.warn?.('[END ADENA PREVALIDATION REPLY WARN]', error?.message || error);
            return null;
        });
        if (reply) validationReplies.set(String(message.id), reply);
    }

    async function deleteValidationReply(message) {
        const reply = await findValidationReply(message);
        if (!reply?.delete) {
            validationReplies.delete(String(message.id));
            return false;
        }
        const deleted = await reply.delete().then(() => true).catch(error => {
            logger.warn?.('[END ADENA PREVALIDATION DELETE WARN]', error?.message || error);
            return false;
        });
        if (deleted) validationReplies.delete(String(message.id));
        return deleted;
    }

    async function prevalidateMessage(message, { notify = true } = {}) {
        if (!submissionValidationService) return { enabled: false, valid: true, issues: [] };
        const server = normalizePayrollServer(getServerForChannel(message.channelId, CONFIG.END_ADENA_CHANNEL_IDS));
        if (!server) return { enabled: false, valid: true, issues: [] };
        const parsed = parseEndAdenaMessage(message.content);
        const member = message.member || await message.guild?.members?.fetch?.(message.author?.id).catch(() => null);
        const shift = getMemberShift(member, CONFIG.ROLES) || inferEndAdenaShiftFromPostTime(moment, CONFIG.TIMEZONE, message);
        const userName = getEndAdenaSheetName(member, parsed?.requestedName, CONFIG.ROLES);
        const validation = await submissionValidationService.validate({
            message,
            server,
            parsed,
            member,
            shift,
            userName
        });
        if (validation.valid) {
            await removeEmojiReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);
            if (!hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI)) await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
        } else {
            await removeEmojiReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
            await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
        }
        if (notify) await publishValidation(message, validation);
        return validation;
    }

    async function handleMessageCreate(message) {
        try {
            if (!isEnabled() || message.author?.bot) return;
            const server = normalizePayrollServer(getServerForChannel(message.channelId, CONFIG.END_ADENA_CHANNEL_IDS));
            if (!server) return;
            if (hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI)) return;

            if (submissionValidationService) {
                return prevalidateMessage(message, { notify: true });
            }
            if (!parseEndAdenaMessage(message.content)) return;

            await removeEmojiReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);
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
            if (submissionValidationService) {
                const validation = await prevalidateMessage(resolvedMessage, { notify: true });
                if (
                    validation.valid &&
                    hasReaction(resolvedMessage, CONFIG.PURCHASE_APPROVAL_EMOJI) &&
                    !hasReaction(resolvedMessage, CONFIG.PURCHASE_SUCCESS_EMOJI)
                ) {
                    await retryApprovedFailure(resolvedMessage);
                }
                return;
            }
            await handleMessageCreate(resolvedMessage);
        } catch (error) {
            logger.error?.('[END ADENA MESSAGE UPDATE ERROR]', error);
        }
    }

    async function getReactionUsers(message, emojiName) {
        const reaction = message.reactions?.cache?.find?.(item => item.emoji?.name === emojiName);
        if (!reaction?.users?.fetch) return [];
        const users = await reaction.users.fetch().catch(() => null);
        return users?.values ? [...users.values()] : [];
    }

    async function findApprovalReviewer(message) {
        const users = await getReactionUsers(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
        for (const approvalUser of users) {
            if (!approvalUser || approvalUser.bot) continue;
            const member = await message.guild?.members?.fetch?.(approvalUser.id).catch(() => null);
            if (canReview(approvalUser, member) || message.guild?.ownerId === approvalUser.id) {
                return approvalUser;
            }
        }
        return null;
    }

    async function retryApprovedFailure(message) {
        const reviewer = await findApprovalReviewer(message);
        if (!reviewer) return false;
        await handleReactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, reviewer);
        return true;
    }

    async function syncMessageStatus(message, { pendingMessageIds = new Set() } = {}) {
        try {
            if (!isEnabled() || message.author?.bot) return false;
            const server = normalizePayrollServer(getServerForChannel(message.channelId, CONFIG.END_ADENA_CHANNEL_IDS));
            if (!server || !parseEndAdenaMessage(message.content)) return false;

            const isQueued = pendingMessageIds.has(message.id);
            const isApproved = hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
            const isCancelled = hasReaction(message, CONFIG.PURCHASE_CANCEL_EMOJI) && !isApproved;
            const hasApproval = hasReaction(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
            const hasFailure = hasReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);

            if (isApproved) {
                await syncStatusReactions(message, [
                    CONFIG.PURCHASE_APPROVAL_EMOJI,
                    CONFIG.PURCHASE_SUCCESS_EMOJI
                ]);
                await deleteValidationReply(message);
                return true;
            }

            if (isCancelled && !isQueued) {
                await syncStatusReactions(message, [CONFIG.PURCHASE_CANCEL_EMOJI]);
                await deleteValidationReply(message);
                return true;
            }

            if (submissionValidationService) {
                const validation = await prevalidateMessage(message, { notify: false });
                if (!validation.valid) return true;
            }

            if (hasApproval && hasFailure && !isQueued) {
                const retried = await retryApprovedFailure(message);
                if (retried) return true;
            }

            if (isQueued) {
                await syncStatusReactions(message, [CONFIG.PURCHASE_FAILURE_EMOJI]);
                return true;
            }

            await syncStatusReactions(message, [CONFIG.PURCHASE_PROCESSING_EMOJI]);
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

            const server = normalizePayrollServer(getServerForChannel(message.channelId, CONFIG.END_ADENA_CHANNEL_IDS));
            if (!server) return;
            const reviewerMember = await message.guild?.members?.fetch?.(user.id).catch(() => null);
            if (!canReview(user, reviewerMember) && message.guild?.ownerId !== user.id) return;

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

            let validationContext = null;
            if (!isCancel && submissionValidationService) {
                validationContext = await prevalidateMessage(message, { notify: true });
                if (!validationContext.valid) return;
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

                if ((!validationContext?.shiftStartAt || isCancel) && typeof submissionValidationService?.resolveShiftContext === 'function') {
                    validationContext = await submissionValidationService.resolveShiftContext({
                        message,
                        shift,
                        userName
                    });
                }

                const amount = isCancel ? -parsed.amount : parsed.amount;
                const rawAmount = isCancel ? -parsed.rawAmount : parsed.rawAmount;
                const actionAt = new Date().toISOString();
                const messageCreatedAt = new Date(message.createdAt || Date.now()).toISOString();
                const fallbackShiftBounds = shift && typeof getShiftBounds === 'function'
                    ? getShiftBounds(shift.toLowerCase(), messageCreatedAt)
                    : null;
                const shiftStartAt = validationContext?.shiftStartAt || fallbackShiftBounds?.start?.toISOString?.() || null;
                const shiftEndAt = validationContext?.shiftEndAt || fallbackShiftBounds?.end?.toISOString?.() || null;
                const dayOfMonth = getMessageDayOfMonth(
                    moment,
                    CONFIG.TIMEZONE,
                    message,
                    shift,
                    validationContext?.shiftStartAt || null
                );
                const audit = {
                    action: isCancel ? 'cancel' : 'approve',
                    actionAt,
                    reviewerId: user.id,
                    reviewerName: reviewerMember?.displayName || user.globalName || user.username || user.id,
                    authorId: message.author?.id || null,
                    authorName: authorMember?.displayName || message.author?.globalName || message.author?.username || null,
                    messageCreatedAt,
                    shiftStartAt,
                    shiftEndAt,
                    shiftResolutionSource: validationContext?.shiftResolutionSource || validationContext?.source || (fallbackShiftBounds ? 'message-time' : null),
                    attendanceSessionId: validationContext?.attendanceSessionId || null,
                    attendanceSessionType: validationContext?.attendanceSessionType || null
                };
                const shouldWriteSummary = isSummaryOwner(user, message, reviewerMember) && typeof purchaseSheetService.addAdenaWithSummary === 'function';
                const payload = shouldWriteSummary
                    ? { server, shift: shift || null, userName, amount, rawAmount, dayOfMonth, messageId: message.id, channelId: message.channelId, audit }
                    : { server, shift: shift || null, userName, amount, rawAmount, dayOfMonth, messageId: message.id, channelId: message.channelId, audit };
                const result = await writeAdenaWithRetry(() => (
                    shouldWriteSummary
                    ? purchaseSheetService.addAdenaWithSummary(payload, { messageId: message.id, channelId: message.channelId, audit })
                    : purchaseSheetService.addAdena(payload, { messageId: message.id, channelId: message.channelId, audit })
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
                    const finalServer = result.server || server;
                    await clearStatusReactions(message);
                    if (isCancel) {
                        await safeReact(message, CONFIG.PURCHASE_CANCEL_EMOJI);
                    } else {
                        await safeReact(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
                        await safeReact(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
                    }
                    await deleteValidationReply(message);
                    logger.log?.(isCancel ? '[END ADENA CANCELLED]' : '[END ADENA RECORDED]', {
                        messageId: message.id,
                        server: finalServer,
                        shift: shift || null,
                        userName,
                        amount,
                        range: result.range,
                        summaryRange: result.summaryRange,
                        nextValue: result.nextValue,
                        duplicate: Boolean(result.duplicate)
                    });
                    if (typeof onGreatTabChanged === 'function') onGreatTabChanged();
                    if (!result.duplicate && typeof onApprovalRecorded === 'function') {
                        await onApprovalRecorded({
                            action: isCancel ? 'cancel' : 'approve',
                            server: finalServer,
                            shift: shift || null,
                            userName,
                            messageId: message.id,
                            channelId: message.channelId,
                            rawAmount,
                            audit,
                            result
                        }).catch(error => {
                            logger.warn?.('[END ADENA POST-APPROVAL HOOK WARN]', error?.message || error);
                        });
                    }
                } else {
                    const finalServer = result.server || server;
                    const finalPayload = { ...payload, server: finalServer };
                    const queued = await opsQueueService?.enqueue?.({
                        kind: 'end-adena',
                        action: isCancel ? 'cancel' : 'approve',
                        method: shouldWriteSummary ? 'addAdenaWithSummary' : 'addAdena',
                        messageId: message.id,
                        channelId: message.channelId,
                        server: finalServer,
                        shift: shift || null,
                        userName,
                        code: result.code,
                        errorMessage: result.errorMessage || null,
                        availableUsers: result.availableUsers || null,
                        ranges: result.ranges || (result.range ? [result.range] : null),
                        payload: finalPayload
                    });
                    await clearStatusReactions(message);
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    logger.warn?.('[END ADENA SHEET FAIL]', {
                        messageId: message.id,
                        code: result.code,
                        errorMessage: result.errorMessage || null,
                        server: finalServer,
                        shift: shift || null,
                        userName,
                        availableUsers: result.availableUsers || null,
                        ranges: result.ranges || (result.range ? [result.range] : null)
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
