'use strict';

const { execFileSync } = require('child_process');

function run(command, args, options = {}) {
    const label = [command, ...args].join(' ');
    console.log(`\n> ${label}`);
    return execFileSync(command, args, {
        encoding: 'utf8',
        stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
        shell: Boolean(options.shell)
    });
}

function getLines(text) {
    return String(text || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
}

function assertRuntimeDataUntracked() {
    const tracked = getLines(run('git', [
        'ls-files',
        'attendanceData.json',
        'attendanceData.json.bak',
        'logs/dayoff-logs.jsonl',
        'backups/attendanceData-*.json'
    ], { capture: true }));

    if (tracked.length) {
        throw new Error([
            'Runtime attendance data is still tracked by Git:',
            ...tracked.map(file => `- ${file}`)
        ].join('\n'));
    }
    console.log('Runtime data tracking check passed.');
}

function getTrackedJavaScriptFiles() {
    return getLines(run('git', ['ls-files', '*.js'], { capture: true }))
        .filter(file => !file.startsWith('backups/'))
        .filter(file => !file.includes('/node_modules/'));
}

function checkJavaScriptSyntax() {
    const files = getTrackedJavaScriptFiles();
    for (const file of files) {
        run('node', ['--check', file]);
    }
    console.log(`Checked JavaScript syntax for ${files.length} files.`);
}

function runNpmTest() {
    if (process.platform === 'win32') {
        run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', 'test']);
        return;
    }
    run('npm', ['test']);
}

function isRuntimeDataPath(path) {
    return [
        'attendanceData.json',
        'attendanceData.json.bak',
        'logs/dayoff-logs.jsonl'
    ].includes(path) || path.startsWith('backups/attendanceData-');
}

function printGitStatusSummary() {
    const status = getLines(run('git', ['status', '--short'], { capture: true }));
    const interesting = status.filter(line => {
        const path = line.slice(3);
        if (isRuntimeDataPath(path)) return false;
        return ![
            'attendance-bot.js',
            'backups/index-final-tested-2026-05-19.js',
            'state-policy.js'
        ].includes(path);
    });

    console.log('\n> git status --short');
    if (!status.length) {
        console.log('Working tree is clean.');
        return;
    }

    console.log(status.join('\n'));
    if (interesting.length) {
        console.log('\nReview these non-runtime changes before deploy:');
        console.log(interesting.join('\n'));
    } else {
        console.log('\nOnly known local legacy files are dirty.');
    }
}

function main() {
    assertRuntimeDataUntracked();
    checkJavaScriptSyntax();
    runNpmTest();
    printGitStatusSummary();
    console.log('\nPredeploy check passed.');
}

try {
    main();
} catch (error) {
    console.error('\nPredeploy check failed.');
    console.error(error.message || error);
    process.exit(1);
}
