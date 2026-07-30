'use strict';

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');
const { runRecoveryDrill } = require('../src/services/recoveryDrillService');

async function main() {
    const outputPath = process.env.RECOVERY_DRILL_FILE || 'logs/recovery-drill.json';
    const result = await runRecoveryDrill();
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, outputPath);
    console.log(JSON.stringify({
        ok: result.ok,
        checkedAt: result.checkedAt,
        isolated: result.isolated,
        scenarioCount: result.scenarioCount,
        failureCount: result.failureCount,
        failures: result.failures
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        console.error('[RECOVERY DRILL ERROR]', error?.message || error);
        process.exit(1);
    });
}

module.exports = { main };
