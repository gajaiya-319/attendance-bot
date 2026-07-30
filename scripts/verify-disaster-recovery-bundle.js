'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { CONFIG } = require('../src/config/constants');
const { createDataStore } = require('../src/services/dataStore');
const { verifyBundle } = require('./lib/disaster-recovery');

const store = createDataStore({ config: CONFIG });
const outputDir = process.env.DR_BACKUP_DIR || path.resolve('..', 'attendance-bot-dr');
const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), 'attendance-bot-restore-drill-'));

try {
    const result = verifyBundle({
        filePath: process.argv[2] || null,
        outputDir,
        restoreDir,
        validateState: state => store.validateRestorableState(state)
    });
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error('[DISASTER RECOVERY VERIFY ERROR]', error?.message || error);
    process.exitCode = 1;
} finally {
    fs.rmSync(restoreDir, { recursive: true, force: true });
}
