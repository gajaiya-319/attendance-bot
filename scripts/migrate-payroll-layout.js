'use strict';

/**
 * One-time helper: POST to deployed Apps Script web app to run migratePayrollToNewLayout.
 * Requires RAW_ATTENDANCE_WEBAPP_URL in .env (same web app as attendance).
 *
 *   node scripts/migrate-payroll-layout.js
 *   node scripts/migrate-payroll-layout.js --append-current-great
 */

require('dotenv').config();

const url = process.env.RAW_ATTENDANCE_WEBAPP_URL;
if (!url) {
    console.error('Missing RAW_ATTENDANCE_WEBAPP_URL in .env');
    process.exit(1);
}

const appendCurrentGreat = process.argv.includes('--append-current-great');

async function main() {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            mode: 'migrate-payroll-layout',
            periodLabel: '레이아웃 이관',
            savedBy: 'migrate-payroll-layout.js',
            appendCurrentGreat
        })
    });
    const text = await response.text();
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch {
        console.error('Non-JSON response:', text.slice(0, 500));
        process.exit(1);
    }
    if (!parsed.success) {
        console.error('Migration failed:', parsed);
        process.exit(1);
    }
    console.log(JSON.stringify(parsed, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
