const fs = require('fs');
const path = require('path');

const file = path.join(process.cwd(), 'logs', 'ops-pending.json');
const permanentCodes = new Set([
    'user-not-found',
    'day-not-found',
    'unknown-kind',
    'missing-profile',
    'invalid-payload'
]);

function getPermanentCode(item) {
    return String(item?.lastCode || item?.code || item?.lastError || '').trim();
}

function main() {
    let data = { items: [] };
    try {
        data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const originalItems = Array.isArray(data.items) ? data.items : [];
    const items = originalItems.filter(item => !permanentCodes.has(getPermanentCode(item)));
    const removed = originalItems.length - items.length;
    const nextData = {
        ...data,
        updatedAt: new Date().toISOString(),
        items
    };

    fs.writeFileSync(file, `${JSON.stringify(nextData, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
        before: originalItems.length,
        removed,
        after: items.length
    }, null, 2));
}

main();
