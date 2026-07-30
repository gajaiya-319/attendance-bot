'use strict';

/**
 * Connect payroll summary recent 3-day view to Work list Paagrio/Valacas Great (IMPORTRANGE + local formulas).
 *
 *   node scripts/setup-payroll-summary-connected.js
 */

require('dotenv').config();

const { spawnSync } = require('child_process');
const path = require('path');

const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'apply-live-3day-summary-api.js')],
    { stdio: 'inherit', env: process.env }
);
process.exit(result.status || 0);
