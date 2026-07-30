'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createBundle, safeRelativePath, verifyBundle } = require('../scripts/lib/disaster-recovery');

const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-dr-source-'));
const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-dr-output-'));
const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-dr-restore-'));

try {
    const state = { attendanceData: {}, overtimeUsers: [], version: 1 };
    fs.mkdirSync(path.join(rootDir, 'logs'), { recursive: true });
    fs.mkdirSync(path.join(rootDir, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(rootDir, 'attendanceData.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(rootDir, 'logs', 'runtime-health.json'), JSON.stringify({ stage: 'ok' }));
    fs.writeFileSync(path.join(rootDir, 'backups', 'attendanceData-test.json'), JSON.stringify(state));

    const created = createBundle({
        rootDir,
        outputDir,
        validateState: value => value?.attendanceData ? [] : ['invalid'],
        now: new Date('2026-07-27T00:00:00.000Z')
    });
    assert.strictEqual(created.ok, true);
    assert.strictEqual(created.fileCount, 3);
    assert(fs.existsSync(created.outputPath));

    const verified = verifyBundle({
        filePath: created.outputPath,
        restoreDir,
        validateState: value => value?.attendanceData ? [] : ['invalid']
    });
    assert.strictEqual(verified.ok, true);
    assert.strictEqual(verified.restoreDrill, true);
    assert.deepStrictEqual(
        JSON.parse(fs.readFileSync(path.join(restoreDir, 'attendanceData.json'), 'utf8')),
        state
    );
    assert.throws(() => safeRelativePath('../secret'), /Unsafe/);
    console.log('disaster-recovery tests passed');
} finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
    fs.rmSync(restoreDir, { recursive: true, force: true });
}
