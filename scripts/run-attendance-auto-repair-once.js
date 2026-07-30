'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { CONFIG } = require('../src/config/constants');
const {
    auditAndRepairAttendanceState
} = require('../src/services/attendanceAutoRepairService');

function main() {
    const dataFile = process.argv[2] || 'attendanceData.json';
    const absoluteDataFile = path.resolve(dataFile);
    const state = JSON.parse(fs.readFileSync(absoluteDataFile, 'utf8'));
    const result = auditAndRepairAttendanceState(state, {
        CONFIG,
        moment,
        now: moment().tz(CONFIG.TIMEZONE),
        reason: 'manual-auto-repair-once'
    });

    if (result.changed) {
        const backupDir = path.resolve('backups');
        fs.mkdirSync(backupDir, { recursive: true });
        const stamp = moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD-HH-mm-ss');
        const backupPath = path.join(backupDir, `attendanceData-${stamp}-manual-auto-repair.json`);
        fs.copyFileSync(absoluteDataFile, backupPath);
        fs.writeFileSync(absoluteDataFile, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
        console.log(JSON.stringify({ ...result, backupPath }, null, 2));
        return;
    }

    console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}
