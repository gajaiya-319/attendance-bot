'use strict';

function createDashboardMessageService({ client, logger = console, nowMs = () => Date.now() }) {
    if (!client) throw new TypeError('client must be provided');
    if (typeof nowMs !== 'function') throw new TypeError('nowMs must be a function');

    let lastStableKey = null;
    let lastEditAtMs = 0;

    async function findAllStatusMessages(channel, limit = 50) {
        try {
            const botId = client.user?.id;
            if (!botId) return [];
            const msgs = await channel.messages.fetch({ limit });
            const matched = msgs.filter(m => m.author?.id === botId && m.embeds?.[0]?.title?.includes('INTEGRATED OPS'));
            return Array.from(matched.values());
        } catch (e) {
            logger.error?.('[MSG FIND ALL ERROR]', e);
            return [];
        }
    }

    async function consolidateStatusMessages(channel, keepMessageId = null) {
        const messages = await findAllStatusMessages(channel);
        if (messages.length <= 1) {
            return {
                keptId: keepMessageId || messages[0]?.id || null,
                deleted: 0
            };
        }
        const keep = messages.find(m => m.id === keepMessageId) || messages[0];
        let deleted = 0;
        for (const msg of messages) {
            if (!msg?.id || msg.id === keep.id) continue;
            const ok = await channel.messages.delete(msg.id).then(() => true).catch(() => false);
            if (ok) deleted += 1;
        }
        return { keptId: keep.id, deleted };
    }

    async function findExistingStatusMessage(channel) {
        try {
            const botId = client.user?.id;
            if (!botId) return null;
            const msgs = await channel.messages.fetch({ limit: 20 });
            return msgs.find(m => m.author.id === botId && m.embeds?.[0]?.title?.includes('INTEGRATED OPS'));
        } catch (e) {
            logger.error?.('[MSG FIND ERROR]', e);
            return null;
        }
    }

    async function upsertStatusMessage(channel, {
        statusMessageId = null,
        embed,
        stableKey = null,
        forceEdit = false,
        minEditIntervalMs = 0
    }) {
        if (!channel) return { statusMessageId, created: false, updated: false, message: null };

        let msg = statusMessageId
            ? await channel.messages.fetch(statusMessageId).catch(() => null)
            : null;
        if (!msg) msg = await findExistingStatusMessage(channel);

        if (!msg) {
            const created = await channel.send({ embeds: [embed] });
            return {
                statusMessageId: created.id,
                created: true,
                updated: false,
                message: created
            };
        }

        const currentMs = nowMs();
        const canSkipEdit = Boolean(
            stableKey &&
            lastStableKey === stableKey &&
            !forceEdit &&
            (minEditIntervalMs <= 0 || currentMs - lastEditAtMs < minEditIntervalMs)
        );
        if (canSkipEdit) {
            return {
                statusMessageId: msg.id,
                created: false,
                updated: false,
                skipped: true,
                message: msg
            };
        }

        const editOk = await msg.edit({ embeds: [embed] })
            .then(() => true)
            .catch(() => false);
        if (editOk) {
            lastStableKey = stableKey || null;
            lastEditAtMs = currentMs;
        }

        return {
            statusMessageId: msg.id,
            created: false,
            updated: editOk,
            skipped: false,
            message: msg
        };
    }

    return {
        findExistingStatusMessage,
        findAllStatusMessages,
        consolidateStatusMessages,
        upsertStatusMessage
    };
}

module.exports = {
    createDashboardMessageService
};
