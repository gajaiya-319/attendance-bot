'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const appPath = path.join(root, 'src/app/createAttendanceBotApp.js');
let src = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n');

const { WORKFLOW_ROOT_METHODS } = require('../src/app/workflowApi');
const clockSrc = fs.readFileSync(path.join(root, 'src/workflows/clockWorkflow.js'), 'utf8');
const factoryStart = clockSrc.indexOf('function createClockWorkflow(deps) {');
const clockNames = [...clockSrc.slice(factoryStart).matchAll(/^(?:async )?function (\w+)/gm)].map(m => m[1]);
const delegateNames = [...new Set([
    ...WORKFLOW_ROOT_METHODS.map(([name]) => name),
    ...clockNames
])].filter(n => n !== 'createClockWorkflow');

const forwarderStart = src.indexOf('function createClockWorkflow(...args)');
if (forwarderStart < 0) {
    const alt = src.indexOf('function resetFinishedForPreClockIn(...args)');
    if (alt < 0) throw new Error('delegate block not found');
}
const forwarderEnd = src.indexOf('function cleanupOldDayOffReservations');
if (forwarderEnd < 0) throw new Error('cleanupOldDayOffReservations not found');

src = src.slice(0, forwarderStart) + src.slice(forwarderEnd);

const sorted = [...delegateNames].sort((a, b) => b.length - a.length);
for (const name of sorted) {
    const re = new RegExp(`(?<!workflowApi\\.)\\b${name}\\b(?=\\s*[(,])`, 'g');
    src = src.replace(re, `workflowApi.${name}`);
}

fs.writeFileSync(appPath, src, 'utf8');
console.log('stripped delegates, replaced', delegateNames.length, 'names');
