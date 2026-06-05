'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const lines = fs.readFileSync(path.join(root, 'index.js'), 'utf8').replace(/\r\n/g, '\n').split('\n');

function findLine(pred) {
    const idx = lines.findIndex(pred);
    if (idx < 0) throw new Error(`marker not found: ${pred}`);
    return idx;
}

function sliceExclusive(startLine, endLine) {
    return lines.slice(startLine, endLine).join('\n');
}

const expireStart = findLine(l => l.startsWith('function expireDayOffSessions'));
const expireEnd = expireStart + lines.slice(expireStart).findIndex((l, i) => i > 0 && l.startsWith('function cleanupOldDayOffReservations'));
const expireBlock = lines.slice(expireStart, expireEnd).join('\n');

const timeStart = findLine(l => l.includes('[ TIME LOGIC ]'));
const dashboardStart = findLine(l => l.includes('[ DASHBOARD RENDERER ]'));

const clockBody = `${expireBlock}\n\n${sliceExclusive(timeStart, dashboardStart)}`;
const outDir = path.join(root, 'src/workflows');
fs.writeFileSync(path.join(outDir, '_extract-clock.txt'), clockBody, 'utf8');

console.log('phase3 clock extract written:', clockBody.split('\n').length, 'lines');
