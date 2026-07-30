'use strict';

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../src/config/constants');
const { runExternalDependencySmoke } = require('../src/services/externalDependencySmokeService');

async function main() {
    const outputPath = process.env.EXTERNAL_SMOKE_FILE || 'logs/external-dependency-smoke.json';
    const result = await runExternalDependencySmoke({
        CONFIG,
        token: process.env.TOKEN || process.env.DISCORD_TOKEN
    });
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(result, null, 2) + '\n', 'utf8');
    fs.renameSync(temporary, outputPath);
    console.log(JSON.stringify({
        ok: result.ok,
        checkedAt: result.checkedAt,
        checkCount: result.checkCount,
        failureCount: result.failureCount,
        failures: result.failures.map(item => ({ name: item.name, error: item.error, status: item.status }))
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        console.error('[EXTERNAL DEPENDENCY SMOKE ERROR]', error?.message || error);
        process.exit(1);
    });
}

module.exports = { main };
