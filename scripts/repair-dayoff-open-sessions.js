'use strict';

const fs = require('fs');
const path = require('path');

const file = 'attendanceData.json';
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
const backup = path.join('backups', `attendanceData-${stamp}-before-dayoff-session-repair.json`);
const db = JSON.parse(fs.readFileSync(file, 'utf8'));

fs.copyFileSync(file, backup);

const users = db.attendanceData || db.users || db;
const repaired = [];

for (const user of Object.values(users || {})) {
    if (!user || !user.dayOff || !Array.isArray(user.sessions)) continue;
    const open = user.sessions.filter(session => session && !session.clockOutAt);
    if (!open.length) continue;

    for (const session of open) {
        const closeAt = session.clockInAt || user.dayOffExpireAt || new Date().toISOString();
        session.clockOutAt = closeAt;
        session.clockOutDetectedAt = new Date().toISOString();
        session.clockOutSource = 'dayoff-session-repair';
        session.clockOutReason = 'Close open session for DAY_OFF user';
        session.workedMinutes = 0;
        session.grossMinutes = 0;
        session.liveOffMinutes = 0;
        session.dcMinutes = 0;
        session.creditedMinutes = 0;
    }

    user.activeSessionId = null;
    repaired.push({ id: user.id, name: user.name, closed: open.length });
}

fs.writeFileSync(file, JSON.stringify(db, null, 2));
fs.copyFileSync(file, 'attendanceData.json.bak');

console.log(JSON.stringify({ backup, repaired }, null, 2));
