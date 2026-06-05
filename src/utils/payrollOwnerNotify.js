'use strict';

function ownerDmIds(CONFIG = {}) {
    const fromPurchase = Array.isArray(CONFIG.PURCHASE_OWNER_DM_IDS) ? CONFIG.PURCHASE_OWNER_DM_IDS : [];
    const fromOwners = Array.isArray(CONFIG.OWNER_IDS) ? CONFIG.OWNER_IDS : [];
    return [...new Set([...fromPurchase, ...fromOwners].filter(Boolean))];
}

async function notifyPayrollOwners({ client, CONFIG, content, logger = console } = {}) {
    if (!client?.users?.fetch || !content) return { sent: 0, failed: 0 };
    const ids = ownerDmIds(CONFIG);
    let sent = 0;
    let failed = 0;
    const text = String(content).slice(0, 1900);

    for (const id of ids) {
        try {
            const user = await client.users.fetch(id);
            await user.send({ content: text });
            sent += 1;
        } catch (error) {
            failed += 1;
            logger.warn?.('[PAYROLL OWNER DM]', id, error?.message || error);
        }
    }
    return { sent, failed, ids };
}

module.exports = {
    ownerDmIds,
    notifyPayrollOwners
};
