'use strict';

const fs = require('fs');
const { execFileSync } = require('child_process');

const allowedDirectAddFields = new Set([
    'index.js:safeAddFields',
    'scripts/audit-embed-fields.js:auditEmbedFields',
    'src/app/createCoreHelpers.js:safeAddFields',
    'src/events/dayOffRequestInteractionHandler.js:buildPanelPayload',
    'src/services/dayoffService.js:buildDayOffListEmbed'
]);

function normalizePath(file) {
    return String(file || '').replace(/\\/g, '/');
}

function getTrackedFiles() {
    return execFileSync('git', ['ls-files', '*.js'], { encoding: 'utf8' })
        .split(/\r?\n/)
        .filter(Boolean)
        .map(normalizePath)
        .filter(file => file !== 'attendance-bot.js')
        .filter(file => !file.startsWith('tests/'))
        .filter(file => !file.startsWith('backups/'))
        .filter(file => !file.includes('/node_modules/'));
}

function getFunctionName(line) {
    const functionMatch = line.match(/^\s*(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (functionMatch) return functionMatch[1];

    const assignmentMatch = line.match(/^\s*(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z0-9_$]+\s*=>)/);
    if (assignmentMatch) return assignmentMatch[1];

    return null;
}

function auditEmbedFields(files = getTrackedFiles()) {
    const findings = [];

    for (const file of files.map(normalizePath)) {
        if (!fs.existsSync(file)) continue;
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        let functionName = '<top-level>';
        lines.forEach((line, index) => {
            const nextFunctionName = getFunctionName(line);
            if (nextFunctionName) functionName = nextFunctionName;
            if (!line.includes('.addFields')) return;
            const key = `${file}:${functionName}`;
            if (allowedDirectAddFields.has(key)) return;
            findings.push({
                file,
                line: index + 1,
                functionName,
                text: line.trim()
            });
        });
    }

    return findings;
}

if (require.main === module) {
    const findings = auditEmbedFields();
    if (findings.length) {
        console.error('Embed field audit failed: use safeAddFields() or a bounded renderer before addFields().');
        for (const finding of findings) {
            console.error(`${finding.file}:${finding.line} ${finding.text}`);
        }
        process.exit(1);
    }

    console.log('Embed field audit passed: direct addFields calls are reviewed.');
}

module.exports = {
    auditEmbedFields
};
