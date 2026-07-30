'use strict';

const assert = require('assert');
const fs = require('fs').promises;
const os = require('os');
const path = require('path');
const { appendJsonLineWithRotation } = require('../src/utils/rotatingJsonl');

(async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'rotating-jsonl-'));
    const filePath = path.join(directory, 'audit.jsonl');

    try {
        await appendJsonLineWithRotation({ filePath, record: { id: 1, value: 'a'.repeat(40) }, maxBytes: 80, archiveCount: 2 });
        await appendJsonLineWithRotation({ filePath, record: { id: 2, value: 'b'.repeat(40) }, maxBytes: 80, archiveCount: 2 });
        assert.match(await fs.readFile(`${filePath}.1`, 'utf8'), /"id":1/);
        assert.match(await fs.readFile(filePath, 'utf8'), /"id":2/);

        await Promise.all([
            appendJsonLineWithRotation({ filePath, record: { id: 3 }, maxBytes: 1024, archiveCount: 2 }),
            appendJsonLineWithRotation({ filePath, record: { id: 4 }, maxBytes: 1024, archiveCount: 2 })
        ]);
        const activeIds = (await fs.readFile(filePath, 'utf8'))
            .trim()
            .split(/\r?\n/)
            .map(line => JSON.parse(line).id);
        assert.deepStrictEqual(activeIds, [2, 3, 4], 'concurrent appends remain serialized and complete');
    } finally {
        await fs.rm(directory, { recursive: true, force: true });
    }

    console.log('rotating-jsonl tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
