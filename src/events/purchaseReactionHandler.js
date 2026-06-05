'use strict';

function getPurchaseSheetDayOfMonth(moment, timezone, dateInput = Date.now()) {
    return moment(dateInput).tz(timezone).date();
}

function isInstructionalPurchasePost(text) {
    return /please\s+write|from\s+now\s+on|time\s+to\s+buy|you\s+acc\s+email|^-{5,}/im.test(String(text || ''));
}

function stripPurchaseNoise(text) {
    return String(text || '')
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, ' ')
        .replace(/(?:^|[^\w])\d*\s*(?:(?:haste|hast)\s*buff\w*|(?:haste|hast)|buff\w*)\b/ig, ' ')
        .replace(/\b\d+\s*(?:ea|each)?\s*(?:red\s*)?(?:potion|potions|pots?)\b/ig, ' ')
        .replace(/\b(?:red\s*)?(?:potion|potions|pots?)\b/ig, ' ')
        .replace(/\b(?:unli|unlimited)\b/ig, ' ')
        .replace(/\bbuy\b/ig, ' ')
        .replace(/\.?\s*\uD3EC\uC158\s*(?:\uC0AC\uAE30|\uAD6C\uB9E4)/ig, ' ')
        .replace(/\b\d+\s*(?:ea|each|\uAC1C)?\b/ig, ' ')
        .replace(/[-–—_:;,.()[\]{}]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function parsePotionQuantity(text) {
    const matches = [...String(text || '').matchAll(/\b(\d+)\s*(?:ea|each)?\s*(?:red\s*)?(?:potion|potions|pots?)\b/ig)];
    const quantity = matches.reduce((sum, match) => sum + Number.parseInt(match[1], 10), 0);
    return Number.isFinite(quantity) ? quantity : 0;
}

function parseHasteBuffQuantity(text) {
    const matches = [...String(text || '').matchAll(/(?:^|[^\w])(\d*)\s*(?:(?:haste|hast)\s*buff\w*|(?:haste|hast)|buff\w*)\b/ig)];
    const quantity = matches.reduce((sum, match) => {
        const parsed = Number.parseInt(match[1], 10);
        return sum + (Number.isFinite(parsed) && parsed > 0 ? parsed : 1);
    }, 0);
    return Number.isFinite(quantity) ? quantity : 0;
}

function parsePurchaseMessage(content, unitPrice) {
    const text = String(content || '').trim();
    if (isInstructionalPurchasePost(text)) return null;

    const hasteBuffQuantity = parseHasteBuffQuantity(text);
    if (hasteBuffQuantity > 0) {
        const potionQuantity = parsePotionQuantity(text);
        const amount = (hasteBuffQuantity * 9900) + (potionQuantity * unitPrice);
        const namePart = stripPurchaseNoise(text);
        return {
            quantity: Math.max(hasteBuffQuantity, potionQuantity, 1),
            amount,
            requestedName: namePart || null,
            itemLabel: potionQuantity > 0 ? 'haste buff + potion' : 'haste buff'
        };
    }

    const purchaseKeyword = '(?:\\.\\s*\\uD3EC\\uC158\\s*\\uC0AC\\uAE30|\\uD3EC\\uC158\\s*(?:\\uC0AC\\uAE30|\\uAD6C\\uB9E4))';
    const patterns = [
        /(?:^|\s)(\d+)\s*(?:ea|each)?\s*buy\b|\bbuy\s*(\d+)\s*(?:ea|each)?(?:\s|$)/i,
        /\b(\d+)\s*(?:ea|each)?\s*(?:red\s*)?(?:potion|potions|pots?)\b/i,
        new RegExp(`(?:^|\\s)${purchaseKeyword}\\s*(\\d+)\\s*(?:\\uAC1C|ea|each)?(?:\\s|$)`, 'i'),
        new RegExp(`(?:^|\\s)(\\d+)\\s*(?:\\uAC1C|ea|each)?\\s*${purchaseKeyword}(?:\\s|$)`, 'i')
    ];
    const match = patterns.map(pattern => text.match(pattern)).find(Boolean);
    if (!match) return null;

    const quantityText = match.slice(1).find(Boolean);
    const quantity = Number.parseInt(quantityText, 10);
    if (!Number.isFinite(quantity) || quantity <= 0) return null;

    const namePart = stripPurchaseNoise(text.replace(match[0], ' '));
    return {
        quantity,
        amount: quantity * unitPrice,
        requestedName: namePart || null
    };
}

function getSheetName(member, parsedName) {
    if (parsedName) return parsedName;
    const rawName = String(member?.displayName || member?.user?.username || '');
    return rawName.split('-')[0].trim() || null;
}

function getMemberSheetName(member) {
    const rawName = String(member?.displayName || member?.user?.username || '');
    return rawName.split('-')[0].trim() || null;
}

function hasWorkerIdentity(member, roles) {
    if (member?.roles?.cache?.has?.(roles.DAY) || member?.roles?.cache?.has?.(roles.NIGHT)) return true;

    const profileName = String(member?.displayName || member?.user?.username || '').toLowerCase();
    return /\bday\s*time\b/.test(profileName) || /\bnight\s*time\b/.test(profileName);
}

function getPurchaseSheetName(member, parsedName, roles) {
    if (!hasWorkerIdentity(member, roles) && parsedName) return parsedName;
    return getMemberSheetName(member) || parsedName || null;
}

function getMemberServer(member, roles) {
    if (member?.roles?.cache?.has(roles.HEINE)) return 'HEINE';
    if (member?.roles?.cache?.has(roles.PAAGRIO)) return 'PAAGRIO';
    return null;
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

function getReactionCount(message, emojiName) {
    const reaction = message?.reactions?.cache?.find?.(item => item.emoji?.name === emojiName);
    return reaction?.count || 0;
}

function formatPurchaseRequestOwnerDm({ userName, quantity, itemLabel = 'potion', amount = null }) {
    const requestText = itemLabel === 'haste buff'
        ? `haste buff ${Number(amount || 0).toLocaleString('en-US')}`
        : `포션을 ${quantity}개`;
    return [
        '\uD83E\uDDEA 포션 구매 신청 알림',
        '',
        `${userName}님이 ${requestText} 신청했습니다.`,
        '확인한 후 구매해 주세요. 감사합니다!'
    ].join('\n');
}

function formatPurchaseApprovedDm({ quantity, itemLabel = 'potion' }) {
    const itemText = itemLabel?.startsWith('haste buff')
        ? itemLabel
        : `${quantity} ${quantity === 1 ? 'potion' : 'potions'}`;
    const verb = itemLabel?.startsWith('haste buff') || quantity === 1 ? 'has' : 'have';
    return [
        `\u2705 Your ${itemText} ${verb} been purchased.`,
        `Please check your ${itemLabel?.startsWith('haste buff') ? 'buff' : 'potions'} when you have a moment.`,
        '\uD83E\uDDEA Thank you, and enjoy your hunt!'
    ].join('\n');
}

function createPurchaseReactionHandler({
    MessagePermissionFlags,
    CONFIG,
    moment,
    purchaseSheetService,
    opsQueueService = null,
    onGreatTabChanged = null,
    logger = console
}) {
    if (!MessagePermissionFlags) throw new TypeError('MessagePermissionFlags must be provided');
    if (!CONFIG?.ROLES) throw new TypeError('CONFIG.ROLES must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (!purchaseSheetService || typeof purchaseSheetService.addPurchase !== 'function') {
        throw new TypeError('purchaseSheetService.addPurchase must be a function');
    }

    const locks = new Set();

    function isEnabled() {
        return Boolean((CONFIG.PURCHASE_CHANNEL_ID || CONFIG.PURCHASE_CHANNEL_NAME) && CONFIG.PURCHASE_SPREADSHEET_ID);
    }

    function isPurchaseChannel(message) {
        if (CONFIG.PURCHASE_CHANNEL_ID && message.channelId === CONFIG.PURCHASE_CHANNEL_ID) return true;
        return Boolean(CONFIG.PURCHASE_CHANNEL_NAME && message.channel?.name === CONFIG.PURCHASE_CHANNEL_NAME);
    }

    function canApprove(member, user) {
        const ownerIds = CONFIG.PURCHASE_OWNER_DM_IDS || CONFIG.OWNER_IDS || [];
        return Boolean(ownerIds.includes(user.id));
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
        await message.react(emoji).catch(error => logger.error?.('[PURCHASE REACT ERROR]', error));
    }

    async function safeSendDm(user, content, label) {
        if (!user || typeof user.send !== 'function') return false;
        return user.send(content).then(() => true).catch(error => {
            logger.warn?.('[PURCHASE DM WARN]', {
                label,
                userId: user.id,
                message: error?.message
            });
            return false;
        });
    }

    async function fetchUser(client, id) {
        return client?.users?.fetch?.(id).catch(error => {
            logger.warn?.('[PURCHASE DM WARN]', {
                label: 'fetch-owner',
                userId: id,
                message: error?.message
            });
            return null;
        });
    }

    async function notifyOwners(message, parsed, userName) {
        const ownerIds = CONFIG.PURCHASE_OWNER_DM_IDS || CONFIG.OWNER_IDS || [];
        const content = formatPurchaseRequestOwnerDm({
            userName,
            quantity: parsed.quantity,
            itemLabel: parsed.itemLabel,
            amount: parsed.amount
        });
        for (const ownerId of ownerIds) {
            const owner = await fetchUser(message.client, ownerId);
            await safeSendDm(owner, content, 'owner-request');
        }
    }

    async function writePurchaseWithServerFallback({ server, shift, userName, amount, dayOfMonth }) {
        if (server) {
            return {
                server,
                result: await purchaseSheetService.addPurchase({ server, shift, userName, amount, dayOfMonth })
            };
        }

        const fallbackServers = Object.keys(CONFIG.PURCHASE_SERVER_TABS || {});
        let lastResult = null;
        for (const candidateServer of fallbackServers) {
            const result = await purchaseSheetService.addPurchase({
                server: candidateServer,
                shift,
                userName,
                amount,
                dayOfMonth
            });
            if (result.ok) return { server: candidateServer, result };
            lastResult = result;
            if (!['user-not-found', 'section-not-found', 'day-not-found', 'missing-config'].includes(result.code)) {
                return { server: candidateServer, result };
            }
        }
        return { server: null, result: lastResult || { ok: false, code: 'server-not-found' } };
    }

    async function removeBotReaction(message, emoji) {
        const reaction = message.reactions?.cache?.find?.(item => item.emoji?.name === emoji);
        if (!reaction) return;
        await reaction.users?.remove?.(message.client?.user?.id).catch(() => {});
    }

    async function removeEmojiReactions(message, emoji) {
        const reaction = message.reactions?.cache?.find?.(item => item.emoji?.name === emoji);
        if (!reaction) return;

        if (typeof reaction.remove === 'function') {
            const removed = await reaction.remove().then(() => true).catch(error => {
                logger.warn?.('[PURCHASE REACTION CLEANUP WARN]', {
                    messageId: message.id,
                    emoji,
                    method: 'reaction.remove',
                    message: error?.message
                });
                return false;
            });
            if (removed) return;
        }

        const users = await reaction.users?.fetch?.().catch(() => null);
        if (users?.values) {
            for (const reactionUser of users.values()) {
                await reaction.users?.remove?.(reactionUser.id).catch(error => logger.warn?.('[PURCHASE REACTION CLEANUP WARN]', {
                    messageId: message.id,
                    emoji,
                    method: 'users.remove',
                    userId: reactionUser.id,
                    message: error?.message
                }));
            }
            return;
        }

        await reaction.users?.remove?.(message.client?.user?.id).catch(error => logger.warn?.('[PURCHASE REACTION CLEANUP WARN]', {
            messageId: message.id,
            emoji,
            method: 'bot.remove',
            message: error?.message
        }));
    }

    async function clearPurchaseReactions(message) {
        if (typeof message.reactions?.removeAll === 'function') {
            const removed = await message.reactions.removeAll().then(() => true).catch(error => {
                logger.warn?.('[PURCHASE REACTION CLEANUP WARN]', {
                    messageId: message.id,
                    method: 'removeAll',
                    message: error?.message
                });
                return false;
            });
            if (removed) return;
        }

        await removeEmojiReactions(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
        await removeEmojiReactions(message, CONFIG.PURCHASE_CANCEL_EMOJI);
        await removeEmojiReactions(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
        await removeEmojiReactions(message, CONFIG.PURCHASE_FAILURE_EMOJI);
        await removeEmojiReactions(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
    }

    async function handleMessageCreate(message) {
        try {
            if (!isEnabled() || message.author?.bot || !isPurchaseChannel(message)) return;
            const parsed = parsePurchaseMessage(message.content, CONFIG.PURCHASE_UNIT_PRICE);
            if (!parsed) return;

            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);

            const authorMember = message.member || await message.guild?.members?.fetch?.(message.author.id).catch(() => null);
            if (!hasWorkerIdentity(authorMember, CONFIG.ROLES) && !parsed.requestedName) {
                await removeBotReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
                return;
            }
            const userName = getPurchaseSheetName(authorMember, parsed.requestedName, CONFIG.ROLES) || message.author?.username || 'Someone';
            await notifyOwners(message, parsed, userName);
        } catch (error) {
            logger.error?.('[PURCHASE MESSAGE CREATE ERROR]', error);
        }
    }

    async function syncMessageStatus(message, { pendingMessageIds = new Set() } = {}) {
        try {
            if (!isEnabled() || message.author?.bot || !isPurchaseChannel(message)) return false;
            const parsed = parsePurchaseMessage(message.content, CONFIG.PURCHASE_UNIT_PRICE);
            if (!parsed) return false;

            const isQueued = pendingMessageIds.has(message.id);
            const isApproved = hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
            const isCancelled = hasReaction(message, CONFIG.PURCHASE_CANCEL_EMOJI) && !isApproved;

            if (isApproved) {
                if (!hasReaction(message, CONFIG.PURCHASE_APPROVAL_EMOJI)) {
                    await safeReact(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
                }
                if (!hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI)) {
                    await safeReact(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
                }
                await removeBotReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
                await removeBotReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                return true;
            }

            if (isCancelled && !isQueued) {
                if (!hasReaction(message, CONFIG.PURCHASE_CANCEL_EMOJI)) {
                    await safeReact(message, CONFIG.PURCHASE_CANCEL_EMOJI);
                }
                await removeBotReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
                await removeBotReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                return true;
            }

            if (isQueued) {
                if (!hasReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI)) {
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                }
                await removeBotReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
                return true;
            }

            if (!isQueued) await removeEmojiReactions(message, CONFIG.PURCHASE_FAILURE_EMOJI);
            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
            return true;
        } catch (error) {
            logger.error?.('[PURCHASE STATUS SYNC ERROR]', error);
            return false;
        }
    }

    async function handleReactionAdd(reaction, user) {
        try {
            if (!isEnabled() || user.bot) return;
            const resolved = await resolveReaction(reaction);
            let message = resolved?.message;
            if (!message || !isPurchaseChannel(message)) return;
            message = typeof message.fetch === 'function'
                ? await message.fetch().catch(() => message)
                : message;
            const isCancel = resolved.emojiName === CONFIG.PURCHASE_CANCEL_EMOJI;
            const approvalCount = getReactionCount(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
            const cancelCount = getReactionCount(message, CONFIG.PURCHASE_CANCEL_EMOJI);
            if (
                locks.has(message.id) ||
                (!isCancel && hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI)) ||
                (!isCancel && approvalCount > 1 && cancelCount === 0) ||
                (isCancel && !hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI) && approvalCount === 0)
            ) return;

            const reviewer = await message.guild.members.fetch(user.id).catch(() => null);
            if (!canApprove(reviewer, user)) return;

            const parsed = parsePurchaseMessage(message.content, CONFIG.PURCHASE_UNIT_PRICE);
                if (!parsed) {
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    await removeBotReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
                    return;
                }

            locks.add(message.id);
            await safeReact(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
            try {
                const authorMember = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
                if (!hasWorkerIdentity(authorMember, CONFIG.ROLES) && !parsed.requestedName) {
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    await removeBotReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
                    return;
                }
                const server = getMemberServer(authorMember, CONFIG.ROLES);
                const shift = getMemberShift(authorMember, CONFIG.ROLES) ||
                    inferShiftFromPostTime(moment, CONFIG.TIMEZONE, message);
                const userName = getPurchaseSheetName(authorMember, parsed.requestedName, CONFIG.ROLES);
                if (!shift || !userName) {
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    await removeBotReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
                    logger.warn?.('[PURCHASE SKIP] Missing member server, shift, or sheet name.', {
                        messageId: message.id,
                        server,
                        shift,
                        userName
                    });
                    return;
                }

                const dayOfMonth = getPurchaseSheetDayOfMonth(moment, CONFIG.TIMEZONE, message.createdAt || Date.now());
                const amount = isCancel ? -parsed.amount : parsed.amount;
                const payload = {
                    server,
                    shift,
                    userName,
                    amount,
                    dayOfMonth
                };
                const write = await writePurchaseWithServerFallback(payload);
                const finalServer = write.server || server;
                const result = write.result;
                const finalPayload = { ...payload, server: finalServer };

                if (result.ok) {
                    await clearPurchaseReactions(message);
                    if (isCancel) {
                        await safeReact(message, CONFIG.PURCHASE_CANCEL_EMOJI);
                    } else {
                        await safeReact(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
                        await safeReact(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
                        await safeSendDm(message.author, formatPurchaseApprovedDm({
                            quantity: parsed.quantity,
                            itemLabel: parsed.itemLabel
                        }), 'requester-approved');
                    }
                    logger.log?.(isCancel ? '[PURCHASE CANCELLED]' : '[PURCHASE RECORDED]', {
                        messageId: message.id,
                        server: finalServer,
                        shift,
                        userName,
                        amount: isCancel ? -parsed.amount : parsed.amount,
                        range: result.range,
                        nextValue: result.nextValue
                    });
                    if (typeof onGreatTabChanged === 'function') onGreatTabChanged();
                } else {
                    const queued = await opsQueueService?.enqueue?.({
                        kind: 'purchase',
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
                    await clearPurchaseReactions(message);
                    await safeReact(message, CONFIG.PURCHASE_FAILURE_EMOJI);
                    logger.warn?.('[PURCHASE SHEET FAIL]', {
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
            logger.error?.('[PURCHASE REACTION ERROR]', error);
        }
    }

    return {
        messageCreate: handleMessageCreate,
        reactionAdd: handleReactionAdd,
        syncMessageStatus
    };
}

module.exports = {
    createPurchaseReactionHandler,
    parsePurchaseMessage,
    getSheetName,
    getPurchaseSheetName,
    getMemberServer,
    getMemberShift,
    formatPurchaseRequestOwnerDm,
    formatPurchaseApprovedDm,
    getPurchaseSheetDayOfMonth
};
