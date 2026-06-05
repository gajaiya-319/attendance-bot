'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

const watched = [
    'checkedIn',
    'isFinished',
    'dayOff',
    'disconnected',
    'attendanceStatus',
    'voiceStatus'
];

const allowedFiles = new Set([
    'src/services/attendanceService.js',
    'src/services/stateTransitionPolicy.js',
    'src/utils/statePolicy.js'
]);

const allowedIndexFunctions = new Set([
    'normalizeManualAdjustmentState',
    'applyVoiceSnapshot',
    'normalizeCurrentShiftSession',
    'checkGracePeriods',
    'autoOvertimeCheck',
    'grantLiveException',
    'checkLiveExceptions',
    'renderDashboardCore'
]);

function getTrackedFiles() {
    return execFileSync('git', ['ls-files', '*.js'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean)
        .filter(file => file !== 'attendance-bot.js')
        .filter(file => !file.startsWith('tests/'))
        .filter(file => !file.startsWith('backups/'))
        .filter(file => !file.includes('/node_modules/'));
}

function currentFunctionName(line) {
    const functionMatch = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)/);
    if (functionMatch) return functionMatch[1];
    const constFunctionMatch = line.match(/^\s*const\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(/);
    if (constFunctionMatch) return constFunctionMatch[1];
    return null;
}

function auditStateWrites(files = getTrackedFiles()) {
    const findings = [];
    const assignment = new RegExp(`\\b(?:user|u)\\.(${watched.join('|')})\\s*=(?!=)`);

    for (const file of files) {
        if (!fs.existsSync(file)) continue;
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        let functionName = null;
        lines.forEach((line, index) => {
            const nextFunctionName = currentFunctionName(line);
            if (nextFunctionName) functionName = nextFunctionName;
            const match = line.match(assignment);
            if (!match) return;
            if (allowedFiles.has(file)) return;
            if (file === 'index.js' && allowedIndexFunctions.has(functionName)) return;
            findings.push({
                file,
                line: index + 1,
                functionName,
                field: match[1],
                text: line.trim()
            });
        });
    }

    return findings;
}

if (require.main === module) {
    const findings = auditStateWrites();
    if (findings.length) {
        console.log('State write audit warnings:');
        for (const finding of findings) {
            console.log(`${finding.file}:${finding.line} ${finding.functionName || '<top-level>'} ${finding.text}`);
        }
        process.exitCode = 0;
    } else {
        console.log('State write audit passed: no unreviewed direct state writes.');
    }
}

module.exports = {
    auditStateWrites
};
