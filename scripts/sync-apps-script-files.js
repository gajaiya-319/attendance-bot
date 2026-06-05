'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targetDir = path.join(__dirname, 'apps-script');

const files = [
    {
        source: path.join(__dirname, 'raw-attendance-apps-script.js'),
        target: path.join(targetDir, 'Code.js')
    },
    {
        source: path.join(__dirname, 'AttendanceDashboard.html'),
        target: path.join(targetDir, 'AttendanceDashboard.html')
    }
];

const claspConfig = {
    scriptId: '17VhyIgIvZNuFT-0xNjz9nnwHIUhNYXhNPWBpIDaeFmpUlJaiA260otHX',
    rootDir: './scripts/apps-script'
};

const manifest = {
    timeZone: 'Asia/Manila',
    dependencies: {},
    exceptionLogging: 'STACKDRIVER',
    runtimeVersion: 'V8'
};

function copyFile(source, target) {
    if (!fs.existsSync(source)) throw new Error(`Missing source file: ${source}`);
    fs.copyFileSync(source, target);
    console.log(`Synced ${path.relative(root, source)} -> ${path.relative(root, target)}`);
}

function main() {
    fs.mkdirSync(targetDir, { recursive: true });
    for (const file of files) copyFile(file.source, file.target);
    fs.writeFileSync(path.join(root, '.clasp.json'), `${JSON.stringify(claspConfig, null, 2)}\n`);
    fs.writeFileSync(path.join(targetDir, 'appsscript.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    console.log('Apps Script sync files are ready.');
}

main();
