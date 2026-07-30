'use strict';

function ownerDmIds(CONFIG = {}) {
    const fromPurchase = Array.isArray(CONFIG.PURCHASE_OWNER_DM_IDS) ? CONFIG.PURCHASE_OWNER_DM_IDS : [];
    const fromOwners = Array.isArray(CONFIG.OWNER_IDS) ? CONFIG.OWNER_IDS : [];
    return [...new Set([...fromPurchase, ...fromOwners].filter(Boolean))];
}

async function notifyPayrollOwners({ client, CONFIG, content, logger = console } = {}) {
    if (!client || !content) return { sent: 0, failed: 0, fallbackSent: 0 };
    const ids = ownerDmIds(CONFIG);
    let sent = 0;
    let failed = 0;
    let fallbackSent = 0;
    const text = String(content).slice(0, 1900);

    for (const id of ids) {
        try {
            if (!client.users?.fetch) throw new Error('Discord user fetch is unavailable');
            const user = await client.users.fetch(id);
            await user.send({ content: text });
            sent += 1;
        } catch (error) {
            failed += 1;
            logger.warn?.('[PAYROLL OWNER DM]', id, error?.message || error);
        }
    }

    if (failed > 0 || sent === 0) {
        try {
            const channelId = CONFIG?.LOG_CHANNEL;
            const channel = channelId
                ? client.channels?.cache?.get?.(channelId) || await client.channels?.fetch?.(channelId).catch(() => null)
                : null;
            if (channel?.send) {
                await channel.send({
                    content: `⚠️ **관리자 DM 대체 알림**\n${text}`.slice(0, 2000)
                });
                fallbackSent = 1;
            }
        } catch (error) {
            logger.error?.('[PAYROLL OWNER FALLBACK CHANNEL]', error?.message || error);
        }
    }

    return { sent, failed, fallbackSent, ids };
}

module.exports = {
    ownerDmIds,
    notifyPayrollOwners
};
