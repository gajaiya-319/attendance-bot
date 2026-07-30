'use strict';

function parseEndAdenaMessage(content) {
    const text = String(content || '');
    const adenaMatch = text.match(/gained\s*adena\s*(?:[:\uFF1A=-]\s*)?([0-9][0-9,.\s]*)/i);
    if (!adenaMatch) return null;

    const rawAmount = Number.parseInt(adenaMatch[1].replace(/[\s,.]/g, ''), 10);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) return null;

    const nameMatch = text.match(/(?:^|\n)\s*-?\s*name\s*:\s*([^\n\r]+)/i);
    const requestedName = nameMatch?.[1]?.trim() || null;
    const amount = Math.floor(rawAmount / 1000) * 1000;
    if (amount <= 0) return null;

    return { rawAmount, amount, requestedName };
}

module.exports = { parseEndAdenaMessage };
