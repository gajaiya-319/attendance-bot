'use strict';

const { buildLeastPrivilegeProfile } = require('../src/services/securityPostureAuditService');

function main() {
    const profile = buildLeastPrivilegeProfile();
    console.log(JSON.stringify({
        purpose: 'Attendance Bot least-privilege Discord role',
        ...profile,
        verification: [
            'npm run ops:security-audit',
            'npm run ops:health'
        ]
    }, null, 2));
}

if (require.main === module) main();

module.exports = { main };
