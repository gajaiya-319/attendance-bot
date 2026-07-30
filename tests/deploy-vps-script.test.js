'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const script = fs.readFileSync(path.resolve(__dirname, '../scripts/deploy-vps.ps1'), 'utf8');

assert(script.includes('[int]$CanarySoakSeconds = 130'));
assert(script.includes('CanarySoakSeconds must be at least 60 seconds.'));
assert(script.includes('canary_pid="`$(pm2 pid'));
assert(script.includes("sleep '$CanarySoakSeconds'"));
assert(script.includes('npm run ops:wait -- --timeout=1 --interval=1'));
assert(script.includes('post_canary_pid="`$(pm2 pid'));
assert(script.includes('PM2 PID changed from'));

const startIndex = script.indexOf("pm2 startOrReload ecosystem.config.js");
const captureIndex = script.indexOf('canary_pid="`$(pm2 pid');
const soakIndex = script.indexOf("sleep '$CanarySoakSeconds'");
const strictHealthIndex = script.indexOf('npm run ops:wait -- --timeout=1 --interval=1');
const pidCheckIndex = script.indexOf('PM2 PID changed from');
const evidenceIndex = script.indexOf('node scripts/record-operational-evidence.js --allow-unhealthy');
const releaseRollbackIndex = script.indexOf('trap - ERR', evidenceIndex);

assert(startIndex >= 0 && startIndex < captureIndex);
assert(captureIndex < soakIndex);
assert(soakIndex < strictHealthIndex);
assert(strictHealthIndex < pidCheckIndex);
assert(pidCheckIndex < evidenceIndex);
assert(evidenceIndex < releaseRollbackIndex);

console.log('deploy-vps-script tests passed');
