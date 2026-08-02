'use strict';

function parseEndAdenaMessage(content) {
    const text = String(content || '');
    const adenaMatch = text.match(/gained\s*adena\s*(?:[:\uFF1A=-]\s*)?([0-9][0-9,.\s]*)/i);
    if (!adenaMatch) return null;

    const rawAmount = Number.parseInt(adenaMatch[1].replace(/[\s,.]/g, ''), 10);
    if (!Number.isFinite(rawAmount) || rawAmount <= 0) return null;

    const nameMatch = text.match(/(?:^|\n)\s*-?\s*name\s*:\s*([^\n\r]+)/i);
    const rawRequestedName = nameMatch?.[1]?.trim() || null;
    const explicitOvertime = /\(\s*(?:ot|overtime)\s*\)/i.test(rawRequestedName || '');
    const requestedName = rawRequestedName
        ? rawRequestedName.replace(/\s*\(\s*(?:ot|overtime)\s*\)\s*/ig, ' ').trim()
        : null;
    const startDateMatch = text.match(/(?:^|\n)\s*-?\s*start\s*:\s*([0-9]{1,4}[./-][0-9]{1,2}[./-][0-9]{1,4})/i);
    const startTimeMatch = text.match(/(?:^|\n)\s*-?\s*start\s*time\s*:\s*([0-9]{1,2}(?::[0-9]{1,2})?\s*(?:am|pm)?)([^\n\r]*)/i);
    const amount = Math.floor(rawAmount / 1000) * 1000;
    if (amount <= 0) return null;

    const parsed = { rawAmount, amount, requestedName };
    if (startDateMatch) parsed.startDate = startDateMatch[1].trim();
    if (startTimeMatch) {
        parsed.startTime = startTimeMatch[1].trim().replace(/\s+/g, ' ').toUpperCase();
        if (/(?:\bkr\s*time\b|\bkst\b|\bkorea\s*time\b)/i.test(startTimeMatch[2] || '')) {
            parsed.startTimezone = 'Asia/Seoul';
        }
    }
    if (explicitOvertime) parsed.submissionType = 'OVERTIME';
    return parsed;
}

module.exports = { parseEndAdenaMessage };
