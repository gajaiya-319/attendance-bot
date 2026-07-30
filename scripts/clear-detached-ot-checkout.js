'use strict';

const fs = require('fs');

const [, , file = 'attendanceData.json', ...ids] = process.argv;

if (!ids.length) {
    console.error('Usage: node scripts/clear-detached-ot-checkout.js <attendanceData.json> <userId> [...]');
    process.exit(1);
}

const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const root = data.attendanceData || data;
let changed = 0;

for (const id of ids) {
    const user = root[id];
    if (!user) continue;
    const isOvertime = Array.isArray(data.overtimeUsers) && data.overtimeUsers.some(entry => entry.id === id);
    if (!isOvertime || user.attendanceStatus !== 'OVERTIME') continue;

    user.checkOutTime = null;
    user.checkOutRaw = null;
    user.lastClockOutSource = null;
    user.lastClockOutReason = null;
    user.lastClockOutDetectedAt = null;
    changed += 1;
}

fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ changed }, null, 2));
