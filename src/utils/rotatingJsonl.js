'use strict';

const fsDefault = require('fs').promises;

const appendLocks = new Map();

function isMissingFile(error) {
    return error?.code === 'ENOENT';
}

async function rotateFile({ fs, filePath, archiveCount }) {
    if (typeof fs.rename !== 'function') return false;

    if (typeof fs.unlink === 'function') {
        await fs.unlink(`${filePath}.${archiveCount}`).catch(error => {
            if (!isMissingFile(error)) throw error;
        });
    }

    for (let index = archiveCount - 1; index >= 1; index -= 1) {
        await fs.rename(`${filePath}.${index}`, `${filePath}.${index + 1}`).catch(error => {
            if (!isMissingFile(error)) throw error;
        });
    }

    await fs.rename(filePath, `${filePath}.1`);
    return true;
}

async function appendLine({ fs, filePath, line, maxBytes, archiveCount }) {
    if (typeof fs.stat === 'function' && maxBytes > 0 && archiveCount > 0) {
        const currentSize = await fs.stat(filePath)
            .then(stat => Number(stat.size || 0))
            .catch(error => {
                if (isMissingFile(error)) return 0;
                throw error;
            });
        const nextSize = currentSize + Buffer.byteLength(line, 'utf8');
        if (currentSize > 0 && nextSize > maxBytes) {
            await rotateFile({ fs, filePath, archiveCount });
        }
    }
    await fs.appendFile(filePath, line, 'utf8');
}

async function appendJsonLineWithRotation({
    filePath,
    record,
    fs = fsDefault,
    maxBytes = 5 * 1024 * 1024,
    archiveCount = 3
}) {
    if (!filePath) throw new TypeError('filePath is required');
    const line = `${JSON.stringify(record)}\n`;
    const lockKey = String(filePath);
    const previous = appendLocks.get(lockKey) || Promise.resolve();
    const operation = previous
        .catch(() => {})
        .then(() => appendLine({ fs, filePath, line, maxBytes, archiveCount }));
    appendLocks.set(lockKey, operation);

    try {
        await operation;
    } finally {
        if (appendLocks.get(lockKey) === operation) appendLocks.delete(lockKey);
    }
}

module.exports = {
    appendJsonLineWithRotation
};
