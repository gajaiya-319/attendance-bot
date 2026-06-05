'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const indexPath = path.join(root, 'index.js');
const outPath = path.join(root, 'src/app/createAttendanceBotApp.js');
const appSourcePath = fs.existsSync(outPath) && fs.statSync(outPath).size > 20000
    ? outPath
    : indexPath;

let src = fs.readFileSync(appSourcePath, 'utf8').replace(/\r\n/g, '\n');
if (appSourcePath === outPath) {
    const fnStart = src.indexOf('function createAttendanceBotApp');
    const fnBodyStart = src.indexOf('{', fnStart) + 1;
    const loginFn = src.indexOf('    function login() {');
    src = src.slice(fnBodyStart, loginFn);
}

const start = src.indexOf('const {\n    CONFIG,');
const end = src.lastIndexOf('client.once(Events.ClientReady');
if (start < 0 || end < 0) throw new Error('app body markers not found');

let body = src.slice(start, end).trimEnd();

const forwarderStart = body.indexOf('let workflowRuntime;');
const forwarderEnd = body.indexOf('function printStartupBanner() {');
if (forwarderStart < 0 || forwarderEnd < 0) throw new Error('forwarder block not found');

const { WORKFLOW_ROOT_METHODS } = require('../src/app/workflowApi');
const clockPath = path.join(root, 'src/workflows/clockWorkflow.js');
const clockSrc = fs.readFileSync(clockPath, 'utf8');
const factoryStart = clockSrc.indexOf('function createClockWorkflow(deps) {');
const clockNames = [...clockSrc.slice(factoryStart).matchAll(/^(?:async )?function (\w+)/gm)].map(m => m[1]);
const delegateNames = [...new Set([
    ...WORKFLOW_ROOT_METHODS.map(([name]) => name),
    ...clockNames
])];
const delegateFns = delegateNames
    .map(name => `function ${name}(...args) { return workflowApi.${name}(...args); }`)
    .join('\n');

const apiBlock = `const { createWorkflowApi } = require('./workflowApi');
const { api: workflowApi, wire: wireWorkflowRuntime, getRuntime: getWorkflowRuntime } = createWorkflowApi();
let workflowRuntime;

${delegateFns}

`;

body = body.slice(0, forwarderStart) + apiBlock + body.slice(forwarderEnd);

const cleanupFn = `function cleanupOldDayOffReservations(now = moment().tz(CONFIG.TIMEZONE)) {
    const cutoff = now.clone().subtract(14, 'days');
    let changed = false;
    for (const messageId of Object.keys(dayOffReservations)) {
        const reservation = dayOffReservations[messageId];
        if (!reservation?.leaveDate) continue;
        if (!moment(reservation.leaveDate, 'YYYY-MM-DD').isBefore(cutoff, 'day')) continue;
        delete dayOffReservations[messageId];
        changed = true;
    }
    return changed;
}

`;

body = body.replace(/function printStartupBanner\(\) \{/, `${cleanupFn}function printStartupBanner() {`);

const wireMarker = 'workflowRuntime = createWorkflowRuntime({';
const wireIdx = body.indexOf(wireMarker);
const interactionMarker = body.includes('/**\n\n * [ INTERACTION HANDLER ]\n */')
    ? '/**\n\n * [ INTERACTION HANDLER ]\n */'
    : '/**\n * [ INTERACTION HANDLER ]\n */';
const interactionIdx = body.indexOf(interactionMarker, wireIdx);
if (wireIdx < 0 || interactionIdx < 0) throw new Error('workflow/interaction markers not found');
let initInner = body.slice(wireIdx + wireMarker.length, interactionIdx).trimEnd();
initInner = initInner.replace(/\}\);\s*$/, '').trimEnd();
body = `${body.slice(0, wireIdx)}workflowRuntime = createWorkflowRuntime({\n${initInner}\n});\nwireWorkflowRuntime(workflowRuntime);\n\n${body.slice(interactionIdx)}`;

body = body.replace(/require\('\.\/src\//g, "require('../");
body = body.replace(/require\('\.\/time-logic'\)/g, "require('../../time-logic')");
body = body.replace(/token: process\.env\.TOKEN/g, 'token');

const header = `'use strict';

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const moment = require('moment-timezone');
const cron = require('node-cron');
const { google } = require('googleapis');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    Events,
    REST,
    Routes,
    MessageFlags,
    PermissionFlagsBits,
    Partials
} = require('discord.js');

function createAttendanceBotApp(options = {}) {
    const token = options.token || process.env.TOKEN;
    if (!token) {
        throw new Error('Missing TOKEN in .env');
    }

`;

const footer = `

    function login() {
        return client.login(token);
    }

    return {
        client,
        login,
        getWorkflowRuntime,
        workflowApi,
        saveSystemAsync,
        loadSystem,
        printStartupBanner
    };
}

module.exports = {
    createAttendanceBotApp
};
`;

fs.writeFileSync(outPath, header + body + footer, 'utf8');
console.log('wrote', outPath);
