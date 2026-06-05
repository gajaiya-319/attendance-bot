'use strict';

const fs = require('fs');
const path = require('path');

const appPath = path.join(__dirname, '../src/app/createAttendanceBotApp.js');
let src = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n');

src = src.replace(/^(\s+)workflowApi\.(\w+),$/gm, '$1$2: workflowApi.$2,');

fs.writeFileSync(appPath, src, 'utf8');
console.log('fixed workflowApi shorthand properties');
