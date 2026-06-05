'use strict';

/**
 * Push live Great-tab totals into 최근_3일_요약 (no IMPORTRANGE — uses Sheets API).
 *   node scripts/sync-live-3day-summary-values.js
 */

require('dotenv').config();

const { syncLiveThreeDaySummaryValues } = require('./lib/payroll-live-summary-sync');

async function main() {
    const result = await syncLiveThreeDaySummaryValues();
    if (!result.ok) {
        console.error(result);
        process.exit(1);
    }
    console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
