'use strict';

const fs = require('fs');
const path = require('path');

const indexPath = path.join(__dirname, '..', 'index.js');
let src = fs.readFileSync(indexPath, 'utf8').replace(/\r\n/g, '\n');

const dashboardMarker = '/**\n * [ DASHBOARD RENDERER ]\n */';
const interactionMarker = '/**\n\n * [ INTERACTION HANDLER ]\n */';
const interactionMarkerAlt = '/**\n * [ INTERACTION HANDLER ]\n */';

const start = src.indexOf(dashboardMarker);
if (start < 0) throw new Error('dashboard marker not found');

let end = src.indexOf(interactionMarker, start + 1);
if (end < 0) end = src.indexOf(interactionMarkerAlt, start + 1);
if (end < 0) throw new Error('interaction marker not found');

const constantsBlock = `const DASHBOARD_LAYOUT_VERSION = 'classic-dashboard-wide-blank-v14';
const DASHBOARD_INSTANCE_TAG = \`pid:\${process.pid}\`;

`;

src = `${src.slice(0, start)}${dashboardMarker}\n${constantsBlock}${src.slice(end)}`;
fs.writeFileSync(indexPath, src, 'utf8');
console.log('removed phase2 sections from index.js');
