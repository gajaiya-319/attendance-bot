'use strict';

const fsDefault = require('fs').promises;
const pathDefault = require('path');

function nowIso() {
    return new Date().toISOString();
}

function monthKey(date = new Date()) {
    return date.toISOString().slice(0, 7);
}

function safeJson(value) {
    return JSON.parse(JSON.stringify(value || {}));
}

function createPayrollOperationLogService({
    dir = './logs',
    fs = fsDefault,
    path = pathDefault,
    logger = console
} = {}) {
    function filePathFor(date = new Date()) {
        return path.join(dir, `payroll-operations-${monthKey(date)}.jsonl`);
    }

    async function ensureDir() {
        await fs.mkdir(dir, { recursive: true });
    }

    async function record(input = {}) {
        const entry = {
            id: input.id || [
                input.kind || 'sheet',
                input.action || 'write',
                input.messageId || 'no-message',
                input.server || input.payload?.server || 'no-server',
                input.userName || input.payload?.userName || 'no-user',
                input.createdAt || nowIso()
            ].join(':'),
            createdAt: input.createdAt || nowIso(),
            kind: input.kind || 'sheet',
            action: input.action || 'write',
            messageId: input.messageId || null,
            channelId: input.channelId || null,
            server: input.server || input.payload?.server || null,
            shift: input.shift || input.payload?.shift || null,
            userName: input.userName || input.payload?.userName || null,
            payload: safeJson(input.payload),
            source: input.source || 'bot'
        };
        try {
            await ensureDir();
            await fs.appendFile(filePathFor(new Date(entry.createdAt)), JSON.stringify(entry) + '\n', 'utf8');
        } catch (error) {
            logger.error?.('[PAYROLL OPERATION LOG ERROR]', error?.message || error);
        }
        return entry;
    }

    async function listRecent({ limit = 200 } = {}) {
        try {
            const filePath = filePathFor();
            const raw = await fs.readFile(filePath, 'utf8');
            return raw.split(/\r?\n/)
                .filter(Boolean)
                .slice(-Math.max(1, limit))
                .map(line => {
                    try {
                        return JSON.parse(line);
                    } catch (_) {
                        return null;
                    }
                })
                .filter(Boolean);
        } catch (error) {
            if (error?.code !== 'ENOENT') logger.warn?.('[PAYROLL OPERATION LOG READ WARN]', error?.message || error);
            return [];
        }
    }

    return {
        record,
        listRecent,
        filePathFor
    };
}

module.exports = {
    createPayrollOperationLogService
};
