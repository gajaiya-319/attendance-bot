'use strict';

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.js');
const lines = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n').split('\n');

const noticeStart = lines.findIndex(line => line.includes('[ NOTICE PANEL ]'));
const interactionStart = lines.findIndex(line => line.includes('[ INTERACTION HANDLER ]'));

if (noticeStart < 0 || interactionStart < 0 || interactionStart <= noticeStart) {
    throw new Error(`markers not found: notice=${noticeStart}, interaction=${interactionStart}`);
}

const before = lines.slice(0, noticeStart);
const after = lines.slice(interactionStart);
const rebuilt = [...before, ...after];
fs.writeFileSync(indexPath, `${rebuilt.join('\n')}\n`, 'utf8');
console.log(`removed ${interactionStart - noticeStart} lines from index.js`);
