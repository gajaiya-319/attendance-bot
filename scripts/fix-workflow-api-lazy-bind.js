'use strict';

const fs = require('fs');
const path = require('path');

const appPath = path.join(path.join(__dirname, '..'), 'src/app/createAttendanceBotApp.js');
let src = fs.readFileSync(appPath, 'utf8').replace(/\r\n/g, '\n');

src = src.replace(/(\w+): workflowApi\.(\w+)/g, '$1: (...args) => workflowApi.$2(...args)');

fs.writeFileSync(appPath, src, 'utf8');
console.log('lazy-bound workflowApi method references');
