'use strict';

const assert = require('assert');
const {
    checkEnvSpec,
    SPREADSHEET_ID_RE,
    WEBAPP_URL_RE
} = require('../scripts/check-google-config');

assert.strictEqual(
    SPREADSHEET_ID_RE.test('1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk'),
    true
);

assert.strictEqual(
    WEBAPP_URL_RE.test('https://script.google.com/macros/s/AKfycbx3a9-T71S_zfRwf/exec'),
    true
);

const prev = { ...process.env };
try {
    process.env.TEST_SPREADSHEET = '1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk';
    const ok = checkEnvSpec({
        name: 'TEST_SPREADSHEET',
        required: true,
        validate: value => (SPREADSHEET_ID_RE.test(value) ? null : 'bad id')
    });
    assert.strictEqual(ok.status, 'ok');

    process.env.TEST_WEBAPP = 'not-a-url';
    const bad = checkEnvSpec({
        name: 'TEST_WEBAPP',
        required: true,
        validate: value => (WEBAPP_URL_RE.test(value) ? null : 'bad url')
    });
    assert.strictEqual(bad.status, 'fail');
} finally {
    process.env = prev;
}

console.log('check-google-config tests passed');
