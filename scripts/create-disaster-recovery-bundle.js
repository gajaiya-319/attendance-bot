'use strict';

const path = require('path');
const { CONFIG } = require('../src/config/constants');
const { createDataStore } = require('../src/services/dataStore');
const { createBundle } = require('./lib/disaster-recovery');

const store = createDataStore({ config: CONFIG });
const outputDir = process.env.DR_BACKUP_DIR || path.resolve('..', 'attendance-bot-dr');

try {
    const result = createBundle({
        rootDir: process.cwd(),
        outputDir,
        validateState: state => store.validateRestorableState(state)
    });
    console.log(JSON.stringify(result, null, 2));
} catch (error) {
    console.error('[DISASTER RECOVERY BACKUP ERROR]', error?.message || error);
    process.exit(1);
}
