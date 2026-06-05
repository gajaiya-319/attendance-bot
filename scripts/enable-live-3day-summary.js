'use strict';

/**
 * Apply live Great-tab formulas to 최근_3일_요약 on 급여토탈관리 (IMPORTRANGE from work list).
 *   node scripts/enable-live-3day-summary.js
 *   node scripts/enable-live-3day-summary.js --webapp   (legacy: bound spreadsheet only)
 */

require('dotenv').config();

async function runViaWebApp() {
    const url = process.env.RAW_ATTENDANCE_WEBAPP_URL;
    if (!url) {
        console.error('Missing RAW_ATTENDANCE_WEBAPP_URL in .env');
        process.exit(1);
    }
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'enable-live-3day-summary' })
    });
    const text = await response.text();
    const parsed = JSON.parse(text);
    if (!parsed.success) {
        console.error(parsed);
        process.exit(1);
    }
    console.log(JSON.stringify(parsed, null, 2));
}

async function main() {
    if (process.argv.includes('--webapp')) {
        return runViaWebApp();
    }
    if (process.argv.includes('--legacy-import')) {
        const { spawnSync } = require('child_process');
        const path = require('path');
        const script = path.join(__dirname, 'apply-live-3day-summary-api.js');
        const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
        if (result.status !== 0) process.exit(result.status || 1);
        return;
    }
    const { spawnSync } = require('child_process');
    const path = require('path');
    const script = path.join(__dirname, 'setup-payroll-summary-worklist.js');
    const result = spawnSync(process.execPath, [script], { stdio: 'inherit', env: process.env });
    if (result.status !== 0) process.exit(result.status || 1);
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
