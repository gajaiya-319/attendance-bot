'use strict';

/**
 * Reset 월간_누적_요약 to Raw_Data-only layout on Work list + 급여토탈.
 *   node scripts/restore-monthly-summary-simple.js
 */

require('dotenv').config();
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

execSync('node scripts/apply-live-3day-summary-api.js --formulas-only', { cwd: root, stdio: 'inherit' });

console.log(JSON.stringify({
    ok: true,
    note: '월간_누적_요약: Raw_Data SUMIF 5~7행만 (월마감 이력/진행중 블록 제거).'
}, null, 2));
