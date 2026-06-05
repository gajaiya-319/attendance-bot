'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

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
        'logs/admin-audit.jsonl',
        'logs/runtime-health.json',
        'backups/backup-audit-reviewed.json',
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

function walkJavaScriptFiles(dir, results = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        const relativePath = fullPath.replace(/\\/g, '/');
        if (entry.isDirectory()) {
            if (['.git', 'node_modules', 'outputs'].includes(entry.name)) continue;
            if (relativePath.includes('/backups')) continue;
            walkJavaScriptFiles(fullPath, results);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            if (relativePath.startsWith('backups/')) continue;
            results.push(relativePath);
        }
    }
    return results;
}

function getJavaScriptFiles() {
    return walkJavaScriptFiles('.')
        .map(file => file.replace(/^\.\//, ''))
        .filter(file => !file.startsWith('backups/'))
        .sort();
}

function checkJavaScriptSyntax() {
    const files = getJavaScriptFiles();
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

function runStateInvariantAudit() {
    if (!require('fs').existsSync('attendanceData.json')) {
        console.log('State invariant audit skipped: attendanceData.json not found.');
        return;
    }
    run('node', ['scripts/audit-state-invariants.js', 'attendanceData.json']);
}

function runStateWriteAudit() {
    if (!require('fs').existsSync('scripts/audit-state-writes.js')) {
        console.log('State write audit skipped: script not found.');
        return;
    }
    run('node', ['scripts/audit-state-writes.js']);
}

function runBackupAudit() {
    if (!require('fs').existsSync('scripts/audit-backups.js')) {
        console.log('Backup audit skipped: script not found.');
        return;
    }
    run('node', ['scripts/audit-backups.js', '5', '--warn-only']);
}

function runEmbedFieldAudit() {
    if (!require('fs').existsSync('scripts/audit-embed-fields.js')) {
        console.log('Embed field audit skipped: script not found.');
        return;
    }
    run('node', ['scripts/audit-embed-fields.js']);
}

function runMojibakeAudit() {
    if (!require('fs').existsSync('scripts/audit-mojibake.js')) {
        console.log('Mojibake audit skipped: script not found.');
        return;
    }
    run('node', ['scripts/audit-mojibake.js']);
}

function runRawAttendanceDashboardAudit() {
    if (!require('fs').existsSync('scripts/audit-raw-attendance-dashboard.js')) {
        console.log('Raw attendance dashboard audit skipped: script not found.');
        return;
    }
    run('node', ['scripts/audit-raw-attendance-dashboard.js']);
}

function runGoogleConfigCheck() {
    if (!fs.existsSync('scripts/check-google-config.js')) {
        console.log('Google config check skipped: script not found.');
        return;
    }
    run('node', ['scripts/check-google-config.js']);
}

function isRuntimeDataPath(path) {
    return [
        'attendanceData.json',
        'attendanceData.json.bak',
        'logs/dayoff-logs.jsonl',
        'logs/admin-audit.jsonl',
        'logs/runtime-health.json',
        'backups/backup-audit-reviewed.json'
    ].includes(path) || path.startsWith('backups/attendanceData-');
}

function printGitStatusSummary() {
    const status = getLines(run('git', ['status', '--short'], { capture: true }));
    const runtime = status.filter(line => isRuntimeDataPath(line.slice(3)));
    const legacy = status.filter(line => [
        'attendance-bot.js',
        'backups/index-final-tested-2026-05-19.js',
        'state-policy.js'
    ].includes(line.slice(3)));
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

    if (interesting.length) {
        console.log('\nReview these non-runtime changes before deploy:');
        console.log(interesting.join('\n'));
    } else {
        console.log('\nNo unreviewed source changes detected.');
    }
    if (runtime.length) console.log(`Runtime data changes hidden from review list: ${runtime.length}`);
    if (legacy.length) console.log(`Known legacy local files hidden from review list: ${legacy.length}`);
}

function main() {
    assertRuntimeDataUntracked();
    checkJavaScriptSyntax();
    runNpmTest();
    runStateInvariantAudit();
    runStateWriteAudit();
    runBackupAudit();
    runEmbedFieldAudit();
    runMojibakeAudit();
    runRawAttendanceDashboardAudit();
    runGoogleConfigCheck();
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
