'use strict';

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.js');
let src = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

const expireStart = src.indexOf('function expireDayOffSessions');
const timeStart = src.indexOf('/**\n * [ TIME LOGIC ]');
const dashboardStart = src.indexOf('/**\n * [ DASHBOARD RENDERER ]');

if (expireStart < 0 || timeStart < 0 || dashboardStart < 0) {
    throw new Error('phase3 markers not found');
}

src = `${src.slice(0, expireStart)}${src.slice(dashboardStart)}`;
fs.writeFileSync(indexPath, src, 'utf8');
console.log('removed clock/time-logic block from index.js');
