'use strict';

const KO = {
    endAdena: '\uc5d4\ub4dc\uc544\ub370\ub098',
    deathPenalty: '\ub2e4\uc774\ud328\ub110\ud2f0',
    purchase: '\ud3ec\uc158',
    sheetJob: '\uc2dc\ud2b8\uc791\uc5c5',
    approve: '\uc2b9\uc778',
    cancel: '\ucde8\uc18c',
    waiting: '\ub300\uae30\uc911',
    reason: '\uc0ac\uc720',
    noPermission: '\uad8c\ud55c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.',
    noPending: '\u2705 \ud604\uc7ac \ub300\uae30 \uc911\uc778 \uc2e4\ud328 \uc791\uc5c5\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.',
    pendingTitle: '\u26a0\ufe0f \uc2dc\ud2b8 \uc785\ub825 \ub300\uae30 \uc791\uc5c5',
    more: '\uac1c\uac00 \ub354 \uc788\uc2b5\ub2c8\ub2e4.',
    alreadyRunning: '\u23f3 \uc774\ubbf8 \uc7ac\uc2dc\ub3c4\uac00 \uc9c4\ud589 \uc911\uc785\ub2c8\ub2e4. \uc7a0\uc2dc \ud6c4 \ub2e4\uc2dc \ud655\uc778\ud574 \uc8fc\uc138\uc694.',
    retryDone: '\ud83d\udd01 \uc2e4\ud328 \uc791\uc5c5 \uc7ac\uc2dc\ub3c4 \uc644\ub8cc',
    total: '\uc804\uccb4',
    success: '\uc131\uacf5',
    failed: '\uc2e4\ud328 \uc720\uc9c0',
    pendingHint: '\uc544\uc9c1 \uc2e4\ud328\ud55c \ud56d\ubaa9\uc740 `/\uc791\uc5c5\ub300\uae30`\ub85c \ud655\uc778\ud560 \uc218 \uc788\uc2b5\ub2c8\ub2e4.'
};

function formatAmount(value) {
    return Number(value || 0).toLocaleString('en-US');
}

function typeLabel(item) {
    if (item.kind === 'end-adena') return KO.endAdena;
    if (item.kind === 'death-penalty') return KO.deathPenalty;
    if (item.kind === 'purchase') return KO.purchase;
    return item.kind || KO.sheetJob;
}

function formatPendingItem(item, index) {
    const parts = [
        `${index + 1}. ${typeLabel(item)}`,
        item.action === 'cancel' ? KO.cancel : KO.approve,
        item.server || '-',
        item.shift || '-',
        item.userName || '-',
        formatAmount(item.payload?.amount ?? item.payload?.rawAmount ?? 0)
    ];
    const reason = item.lastCode || item.code || item.lastError || KO.waiting;
    return `${parts.join(' / ')}\n   ${KO.reason}: ${reason}\n   ID: ${item.id}`;
}

async function fetchQueuedMessage(client, item) {
    if (!client || !item.channelId || !item.messageId) return null;
    const channel = await client.channels?.fetch?.(item.channelId).catch(() => null);
    return channel?.messages?.fetch?.(item.messageId).catch(() => null) || null;
}

function normalizeEmojiName(value) {
    return String(value || '').replace(/\uFE0F/g, '');
}

function findEmojiReaction(message, emoji) {
    const target = normalizeEmojiName(emoji);
    return message?.reactions?.cache?.find?.(item => (
        normalizeEmojiName(item.emoji?.name || item.emoji?.identifier || item.emoji?.id) === target
    ));
}

async function removeEmojiReaction(message, emoji) {
    const reaction = findEmojiReaction(message, emoji);
    if (!reaction) return;
    const botId = message.client?.user?.id;
    if (botId) {
        await reaction.users?.remove?.(botId).catch(() => {});
    }
    if (typeof reaction.remove === 'function') {
        const removed = await reaction.remove().then(() => true).catch(() => false);
        if (removed) return;
    }
    const users = await reaction.users?.fetch?.().catch(() => null);
    if (users?.values) {
        for (const user of users.values()) {
            await reaction.users?.remove?.(user.id).catch(() => {});
        }
        return;
    }
    await reaction.users?.remove?.(message.client?.user?.id).catch(() => {});
}

async function clearStatusReactions(message, CONFIG) {
    await removeEmojiReaction(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
    await removeEmojiReaction(message, CONFIG.PURCHASE_CANCEL_EMOJI);
    await removeEmojiReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI);
    await removeEmojiReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI);
    await removeEmojiReaction(message, CONFIG.PURCHASE_PROCESSING_EMOJI);
}

async function markMessageResult(client, CONFIG, item, ok) {
    const message = await fetchQueuedMessage(client, item);
    if (!message) return;
    await clearStatusReactions(message, CONFIG);
    if (!ok) {
        await message.react(CONFIG.PURCHASE_FAILURE_EMOJI).catch(() => {});
        return;
    }
    if (item.action === 'cancel') {
        await message.react(CONFIG.PURCHASE_CANCEL_EMOJI).catch(() => {});
        return;
    }
    await message.react(CONFIG.PURCHASE_APPROVAL_EMOJI).catch(() => {});
    await message.react(CONFIG.PURCHASE_SUCCESS_EMOJI).catch(() => {});
}

async function retryQueuedItem({ item, client, CONFIG, purchaseSheetService }) {
    let result;
    if (item.kind === 'end-adena') {
        result = item.method === 'addAdenaWithSummary'
            ? await purchaseSheetService.addAdenaWithSummary(item.payload)
            : await purchaseSheetService.addAdena(item.payload);
    } else if (item.kind === 'death-penalty' || item.kind === 'purchase') {
        result = await purchaseSheetService.addPurchase(item.payload);
    } else {
        result = { ok: false, code: 'unknown-kind' };
    }

    await markMessageResult(client, CONFIG, item, Boolean(result?.ok));
    return result;
}

function createOpsQueueCommands({
    MessageFlags,
    CONFIG,
    opsQueueService,
    purchaseSheetService,
    canRun,
    logger = console
}) {
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (!opsQueueService || typeof opsQueueService.list !== 'function') throw new TypeError('opsQueueService.list must be a function');
    if (!purchaseSheetService) throw new TypeError('purchaseSheetService must be provided');
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');

    async function executePending(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) {
            return interaction.reply({ content: KO.noPermission, flags: MessageFlags.Ephemeral }).then(() => autoDel());
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;

        const items = await opsQueueService.list();
        if (!items.length) {
            return interaction.editReply({ content: KO.noPending }).then(() => autoDel());
        }

        const lines = [
            `${KO.pendingTitle}: ${items.length}\uac1c`,
            '',
            ...items.slice(0, 10).map(formatPendingItem)
        ];
        if (items.length > 10) lines.push(`\n${items.length - 10}${KO.more}`);
        return interaction.editReply({ content: lines.join('\n') }).then(() => autoDel());
    }

    async function executeRetry(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) {
            return interaction.reply({ content: KO.noPermission, flags: MessageFlags.Ephemeral }).then(() => autoDel());
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;

        const summary = await opsQueueService.retryAll(item => retryQueuedItem({
            item,
            client: interaction.client,
            CONFIG,
            purchaseSheetService
        }));
        if (!summary.ok && summary.code === 'already-running') {
            return interaction.editReply({ content: KO.alreadyRunning }).then(() => autoDel());
        }

        logger.log?.('[OPS QUEUE RETRY]', {
            total: summary.total,
            succeeded: summary.succeeded,
            failed: summary.failed
        });

        const lines = [
            KO.retryDone,
            `${KO.total}: ${summary.total}\uac1c`,
            `${KO.success}: ${summary.succeeded}\uac1c`,
            `${KO.failed}: ${summary.failed}\uac1c`
        ];
        if (summary.failed > 0) {
            lines.push('', KO.pendingHint);
        }
        return interaction.editReply({ content: lines.join('\n') }).then(() => autoDel());
    }

    return {
        pending: {
            aliases: ['\uc791\uc5c5\ub300\uae30', 'ops-pending'],
            execute: executePending
        },
        retry: {
            aliases: ['\uc791\uc5c5\uc7ac\uc2dc\ub3c4', 'ops-retry'],
            execute: executeRetry
        }
    };
}

module.exports = {
    createOpsQueueCommands,
    formatPendingItem,
    retryQueuedItem
};
