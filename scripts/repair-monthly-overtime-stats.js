'use strict';

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { CONFIG } = require('../src/config/constants');
const {
    reconcileMonthlyOvertimeStats
} = require('../src/utils/monthlyAttendanceStats');

const dataFile = path.resolve(process.argv[2] || CONFIG.FILES?.DATA || 'attendanceData.json');
const timezone = CONFIG.TIMEZONE || 'Asia/Manila';
const now = moment().tz(timezone);
const overtimePoints = Number(CONFIG.POINTS?.OT || 15);

function getUsers(db) {
    if (db && db.attendanceData && typeof db.attendanceData === 'object') return db.attendanceData;
    if (db && db.users && typeof db.users === 'object') return db.users;
    return db || {};
}

function main() {
    if (!fs.existsSync(dataFile)) {
        throw new Error(`Data file not found: ${dataFile}`);
    }

    const raw = fs.readFileSync(dataFile, 'utf8');
    const db = JSON.parse(raw);
    const users = getUsers(db);
    const changes = [];

    for (const [id, user] of Object.entries(users)) {
        if (!user || typeof user !== 'object') continue;
        const beforeOt = Number(user.monthlyStats?.totalOT || 0);
        const beforePoints = Number(user.monthlyStats?.points || 0);
        const stats = reconcileMonthlyOvertimeStats(user, {
            moment,
            at: now,
            timezone,
            overtimePoints,
            points: CONFIG.POINTS || {}
        });
        if (stats.totalOT !== beforeOt || stats.points !== beforePoints) {
            changes.push({
                id,
                name: user.name || id,
                totalOT: `${beforeOt} -> ${stats.totalOT}`,
                points: `${beforePoints} -> ${stats.points}`
            });
        }
    }

    if (!changes.length) {
        console.log('No monthly overtime stat repairs needed.');
        return;
    }

    const stamp = now.format('YYYY-MM-DD-HH-mm-ss');
    const backupDir = path.resolve('backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backupFile = path.join(backupDir, `attendanceData-${stamp}-before-monthly-ot-repair.json`);
    fs.copyFileSync(dataFile, backupFile);
    fs.writeFileSync(dataFile, JSON.stringify(db, null, 2) + '\n', 'utf8');

    console.log(`Repaired ${changes.length} user(s).`);
    console.table(changes);
    console.log(`Backup: ${backupFile}`);
}

main();
