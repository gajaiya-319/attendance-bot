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
    const knownFilePaths = new Set();

    function filePathFor(date = new Date()) {
        return path.join(dir, `payroll-operations-${monthKey(date)}.jsonl`);
    }

    async function ensureDir() {
        await fs.mkdir(dir, { recursive: true });
    }

    async function record(input = {}) {
        const audit = input.audit || input.payload?.audit || {};
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
            messageId: input.messageId || input.payload?.messageId || null,
            channelId: input.channelId || input.payload?.channelId || null,
            server: input.server || input.payload?.server || null,
            shift: input.shift || input.payload?.shift || null,
            userName: input.userName || input.payload?.userName || null,
            status: input.status || input.result?.status || null,
            reviewerId: input.reviewerId || audit.reviewerId || null,
            reviewerName: input.reviewerName || audit.reviewerName || null,
            actionAt: input.actionAt || audit.actionAt || null,
            messageCreatedAt: input.messageCreatedAt || audit.messageCreatedAt || null,
            shiftStartAt: input.shiftStartAt || audit.shiftStartAt || null,
            shiftEndAt: input.shiftEndAt || audit.shiftEndAt || null,
            result: safeJson(input.result),
            payload: safeJson(input.payload),
            source: input.source || 'bot'
        };
        try {
            await ensureDir();
            const targetPath = filePathFor(new Date(entry.createdAt));
            knownFilePaths.add(targetPath);
            await fs.appendFile(targetPath, JSON.stringify(entry) + '\n', 'utf8');
        } catch (error) {
            logger.error?.('[PAYROLL OPERATION LOG ERROR]', error?.message || error);
        }
        return entry;
    }

    async function listCandidateFiles(date = new Date()) {
        const candidates = new Set([filePathFor(date), ...knownFilePaths]);
        if (typeof fs.readdir === 'function') {
            try {
                const names = await fs.readdir(dir);
                for (const name of names || []) {
                    if (/^payroll-operations-\d{4}-\d{2}\.jsonl$/.test(name)) {
                        candidates.add(path.join(dir, name));
                    }
                }
            } catch (error) {
                if (error?.code !== 'ENOENT') logger.warn?.('[PAYROLL OPERATION LOG LIST WARN]', error?.message || error);
            }
        }
        return [...candidates];
    }

    async function listRecent({ limit = 200, date = new Date() } = {}) {
        const rows = [];
        try {
            const filePaths = await listCandidateFiles(date);
            for (const filePath of filePaths) {
                const raw = await fs.readFile(filePath, 'utf8').catch(error => {
                    if (error?.code !== 'ENOENT') logger.warn?.('[PAYROLL OPERATION LOG READ WARN]', error?.message || error);
                    return '';
                });
                for (const line of raw.split(/\r?\n/).filter(Boolean)) {
                    try {
                        rows.push(JSON.parse(line));
                    } catch (_) {
                        // Ignore malformed historical lines.
                    }
                }
            }
            return rows
                .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
                .slice(-Math.max(1, limit));
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
