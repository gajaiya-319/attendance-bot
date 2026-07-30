'use strict';

const fs = require('fs');
const path = require('path');
const { runOpsHealthCheck } = require('./ops-health-check');
const { verifyBundle } = require('./lib/disaster-recovery');
const { recordOperationalEvidence } = require('./lib/operational-evidence');
const { CONFIG } = require('../src/config/constants');
const allowUnhealthy = process.argv.slice(2).includes('--allow-unhealthy');

function pendingAttendanceCount(filePath = 'logs/raw-attendance-pending.json') {
    try {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return Array.isArray(parsed?.items) ? parsed.items.length : 0;
    } catch (error) {
        if (error?.code === 'ENOENT') return 0;
        throw error;
    }
}

try {
    const health = runOpsHealthCheck();
    const outputDir = process.env.DR_BACKUP_DIR || path.resolve('..', 'attendance-bot-dr');
    const disasterRecovery = verifyBundle({ outputDir });
    const result = recordOperationalEvidence({
        health,
        disasterRecovery,
        pendingAttendanceCount: pendingAttendanceCount(),
        timeZone: CONFIG.TIMEZONE
    });
    console.log(JSON.stringify({
        healthy: result.latest.healthy,
        operationalScore: result.latest.operationalScore,
        scoreComponents: result.latest.scoreComponents,
        dailyHealthy: result.current.healthy,
        dailyOperationalScore: result.current.operationalScore,
        endAdenaFreshnessStatus: result.latest.endAdenaFreshnessStatus,
        endAdenaProvisional: result.latest.endAdenaProvisional,
        consecutiveHealthyDays: result.consecutiveHealthyDays,
        certified: result.latest.certified,
        dailyCertified: result.current.certified,
        consecutiveCertifiedDays: result.consecutiveCertifiedDays,
        qualified7Days: result.qualified7Days,
        qualified30Days: result.qualified30Days
    }, null, 2));
    if (!result.latest.healthy && !allowUnhealthy) process.exitCode = 1;
} catch (error) {
    console.error('[OPERATIONAL EVIDENCE ERROR]', error?.message || error);
    process.exit(1);
}
