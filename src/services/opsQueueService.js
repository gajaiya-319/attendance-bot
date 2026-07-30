'use strict';

const fsDefault = require('fs').promises;
const pathDefault = require('path');
const { appendJsonLineWithRotation } = require('../utils/rotatingJsonl');

function nowIso() {
    return new Date().toISOString();
}

function safeJson(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function normalizeQueueServer(value) {
    const upper = String(value || '').trim().toUpperCase();
    if (upper === 'HEINE' || upper === 'VALACAS' || upper === 'VALAKAS') return 'VALAKAS';
    return upper || value || null;
}

function normalizeQueueItem(input = {}) {
    const item = safeJson(input);
    const server = normalizeQueueServer(item.server || item.payload?.server);
    const payload = item.payload
        ? { ...item.payload, server: normalizeQueueServer(item.payload.server || server) }
        : item.payload;
    return {
        ...item,
        server,
        payload,
        id: item.id ? String(item.id).replace(/:HEINE:/g, ':VALAKAS:') : item.id
    };
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
            return Array.isArray(parsed.items) ? parsed.items.map(normalizeQueueItem) : [];
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
        const payload = JSON.stringify({ updatedAt: nowIso(), items: items.map(normalizeQueueItem) }, null, 2);
        await fs.writeFile(tmpPath, payload, 'utf8');
        await fs.rename(tmpPath, filePath);
    }

    async function appendAudit(record = {}) {
        await ensureDir();
        const auditPath = `${filePath}.audit.jsonl`;
        const recordWithTimestamp = {
            at: nowIso(),
            ...safeJson(record)
        };
        await appendJsonLineWithRotation({
            filePath: auditPath,
            record: recordWithTimestamp,
            fs
        }).catch(error => {
            logger.warn?.('[OPS QUEUE AUDIT WARN]', error?.message || error);
        });
    }

    function buildId(item) {
        const server = normalizeQueueServer(item.server || item.payload?.server);
        return [
            item.kind || 'sheet',
            item.action || 'write',
            item.messageId || 'no-message',
            server || 'no-server',
            item.userName || 'no-user'
        ].join(':');
    }

    async function enqueue(input) {
        const normalizedInput = normalizeQueueItem(input);
        const server = normalizedInput.server;
        const payload = normalizedInput.payload;
        const item = {
            ...normalizedInput,
            server,
            payload,
            id: normalizedInput.id || buildId({ ...normalizedInput, server, payload }),
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
            server: item.server,
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
            let dropped = 0;

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
                } else if (result?.drop) {
                    dropped += 1;
                    results.push({
                        id: item.id,
                        ok: false,
                        dropped: true,
                        code: result?.code || result?.dropReason || 'dropped'
                    });
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
            return { ok: true, total: items.length, succeeded, failed, dropped, kept, results };
        } finally {
            locks.delete('retry-all');
        }
    }

    return {
        enqueue,
        list,
        remove,
        retryAll,
        appendAudit,
        readItems,
        writeItems
    };
}

module.exports = {
    createOpsQueueService,
    normalizeQueueServer,
    normalizeQueueItem
};
