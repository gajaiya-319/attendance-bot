'use strict';

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');

const file = path.resolve(process.argv[2] || 'attendanceData.json');
const timezone = process.env.TZ || 'Asia/Manila';
const cutoff = process.argv[3] || moment().tz(timezone).subtract(1, 'day').format('YYYY-MM-DD');
const raw = fs.readFileSync(file, 'utf8');
const data = JSON.parse(raw);
const reservations = data.dayOffReservations || {};
const removed = [];

for (const [messageId, reservation] of Object.entries(reservations)) {
    if (
        reservation?.source === 'channel-reconcile' &&
        reservation?.recoveredAt &&
        reservation?.leaveDate < cutoff
    ) {
        removed.push({
            messageId,
            name: reservation.name,
            leaveDate: reservation.leaveDate,
            status: reservation.status
        });
        delete reservations[messageId];
    }
}

if (removed.length) {
    const stamp = moment().tz(timezone).format('YYYYMMDDHHmm');
    const backup = path.resolve('backups', `attendanceData-${stamp}-before-stale-dayoff-reconcile-cleanup.json`);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(file, backup);
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify({ cutoff, removedCount: removed.length, removed }, null, 2));
