'use strict';

const fsDefault = require('fs').promises;
const pathDefault = require('path');

function nowIso() {
    return new Date().toISOString();
}

function safeJson(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function createOpsQueueService({
    filePath = './logs/ops-pending.json',
    fs = fsDefault,
    path = pathDefault,
    logger = console
} = {}) {
    const locks = new Set();

    async function ensureDir() {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
    }

    async function readItems() {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed.items) ? parsed.items : [];
        } catch (error) {
            if (error?.code !== 'ENOENT') {
                logger.warn?.('[OPS QUEUE READ WARN]', error?.message || error);
            }
            return [];
        }
    }

    async function writeItems(items) {
        await ensureDir();
        const tmpPath = `${filePath}.tmp`;
        const payload = JSON.stringify({ updatedAt: nowIso(), items }, null, 2);
        await fs.writeFile(tmpPath, payload, 'utf8');
        await fs.rename(tmpPath, filePath);
    }

    function buildId(item) {
        return [
            item.kind || 'sheet',
            item.action || 'write',
            item.messageId || 'no-message',
            item.server || 'no-server',
            item.userName || 'no-user'
        ].join(':');
    }

    async function enqueue(input) {
        const item = {
            ...safeJson(input),
            id: input.id || buildId(input),
            status: 'pending',
            attempts: Number(input.attempts || 0),
            createdAt: input.createdAt || nowIso(),
            updatedAt: nowIso()
        };
        const items = await readItems();
        const index = items.findIndex(existing => existing.id === item.id);
        if (index === -1) {
            items.push(item);
        } else {
            items[index] = {
                ...items[index],
                ...item,
                attempts: items[index].attempts || item.attempts,
                createdAt: items[index].createdAt || item.createdAt,
                updatedAt: nowIso()
            };
        }
        await writeItems(items);
        logger.warn?.('[OPS QUEUE ENQUEUED]', {
            id: item.id,
            kind: item.kind,
            action: item.action,
            code: item.code,
            userName: item.userName
        });
        return item;
    }

    async function list({ includeDone = false } = {}) {
        const items = await readItems();
        return includeDone ? items : items.filter(item => item.status !== 'done');
    }

    async function remove(id) {
        const items = await readItems();
        const next = items.filter(item => item.id !== id);
        if (next.length !== items.length) await writeItems(next);
        return next.length !== items.length;
    }

    async function retryAll(executor) {
        if (typeof executor !== 'function') throw new TypeError('executor must be a function');
        if (locks.has('retry-all')) {
            return { ok: false, code: 'already-running', total: 0, succeeded: 0, failed: 0, kept: [] };
        }

        locks.add('retry-all');
        try {
            const items = await list();
            const kept = [];
            const results = [];
            let succeeded = 0;
            let failed = 0;

            for (const item of items) {
                const nextItem = {
                    ...item,
                    attempts: Number(item.attempts || 0) + 1,
                    lastTriedAt: nowIso(),
                    updatedAt: nowIso()
                };
                const result = await executor(nextItem).catch(error => ({
                    ok: false,
                    code: 'retry-exception',
                    errorMessage: error?.message || String(error)
                }));

                if (result?.ok) {
                    succeeded += 1;
                    results.push({ id: item.id, ok: true, range: result.range, summaryRange: result.summaryRange });
                } else {
                    failed += 1;
                    kept.push({
                        ...nextItem,
                        status: 'pending',
                        lastError: result?.errorMessage || result?.code || 'unknown',
                        lastCode: result?.code || 'unknown'
                    });
                    results.push({ id: item.id, ok: false, code: result?.code || 'unknown' });
                }
            }

            await writeItems(kept);
            return { ok: true, total: items.length, succeeded, failed, kept, results };
        } finally {
            locks.delete('retry-all');
        }
    }

    return {
        enqueue,
        list,
        remove,
        retryAll,
        readItems,
        writeItems
    };
}

module.exports = {
    createOpsQueueService
};
