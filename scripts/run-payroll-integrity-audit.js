'use strict';

require('dotenv').config();

const { CONFIG } = require('../src/config/constants');
const { createPayrollIntegrityAuditService } = require('../src/services/payrollIntegrityAuditService');
const { createPayrollOperationLogService } = require('../src/services/payrollOperationLogService');
const { runPayrollRawAudit } = require('./audit-payroll-rawdata-vs-great');

async function main() {
    const service = createPayrollIntegrityAuditService({
        payrollOperationLogService: createPayrollOperationLogService({ logger: console }),
        auditRunner: runPayrollRawAudit,
        CONFIG,
        client: null,
        logger: console
    });
    const result = await service.runDailyAudit('manual-operations');
    console.log(JSON.stringify({
        ok: result.ok,
        issueCount: result.issues.length,
        issues: result.issues,
        state: result.state
    }, null, 2));
}

main().catch(error => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
