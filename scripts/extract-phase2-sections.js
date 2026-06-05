'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'index.js');
const lines = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

function findLine(pred) {
    const idx = lines.findIndex(pred);
    if (idx < 0) throw new Error(`marker not found: ${pred}`);
    return idx;
}

function sliceExclusive(startLine, endLine) {
    return lines.slice(startLine, endLine).join('\n');
}

const dashboardStart = findLine(l => l.includes('[ DASHBOARD RENDERER ]'));
const voiceStart = findLine(l => l.includes('[ VOICE SYNC ENGINE ]'));
const membershipStart = findLine(l => l.includes('[ MEMBERSHIP & ROLES ]'));
const scheduledStart = findLine(l => l.includes('[ SCHEDULED JOBS ]'));
const interactionStart = findLine(l => l.includes('[ INTERACTION HANDLER ]'));

const outDir = path.join(root, 'src/workflows');
fs.writeFileSync(path.join(outDir, '_extract-dashboard.txt'), sliceExclusive(dashboardStart, voiceStart), 'utf8');
fs.writeFileSync(path.join(outDir, '_extract-voice.txt'), sliceExclusive(voiceStart, membershipStart), 'utf8');
fs.writeFileSync(path.join(outDir, '_extract-membership.txt'), sliceExclusive(membershipStart, scheduledStart), 'utf8');
fs.writeFileSync(path.join(outDir, '_extract-scheduled.txt'), sliceExclusive(scheduledStart, interactionStart), 'utf8');

console.log('phase2 extracts written:', {
    dashboard: voiceStart - dashboardStart,
    voice: membershipStart - voiceStart,
    membership: scheduledStart - membershipStart,
    scheduled: interactionStart - scheduledStart
});
