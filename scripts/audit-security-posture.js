'use strict';

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../src/config/constants');
const { runSecurityPostureAudit } = require('../src/services/securityPostureAuditService');

async function main() {
    const outputPath = process.env.SECURITY_AUDIT_FILE || 'logs/security-posture-audit.json';
    const result = await runSecurityPostureAudit({
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
        criticalCount: result.criticalCount,
        advisoryCount: result.advisoryCount,
        leastPrivilegeProfile: result.leastPrivilegeProfile,
        failures: result.failures,
        advisories: result.advisories
    }, null, 2));
    if (!result.ok) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        console.error('[SECURITY POSTURE AUDIT ERROR]', error?.message || error);
        process.exit(1);
    });
}

module.exports = { main };
