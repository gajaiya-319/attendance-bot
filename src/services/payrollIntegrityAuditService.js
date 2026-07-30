'use strict';

const fsDefault = require('fs').promises;
const pathDefault = require('path');
const cryptoDefault = require('crypto');
const { notifyPayrollOwners: notifyPayrollOwnersDefault } = require('../utils/payrollOwnerNotify');

const DAY_MS = 24 * 60 * 60 * 1000;
const SHEET_MUTATION_KINDS = new Set(['purchase', 'death-penalty', 'end-adena']);
const SHEET_MUTATION_ACTIONS = new Set(['approve', 'cancel']);

function isSuccessfulOperation(entry = {}) {
    if (entry.result?.duplicate === true || entry.result?.skipped === true || entry.status === 'skipped') return false;
    return entry.status === 'success' || entry.result?.ok === true;
}

function isSuccessfulSheetMutation(entry = {}) {
    return SHEET_MUTATION_KINDS.has(String(entry.kind || '')) &&
        SHEET_MUTATION_ACTIONS.has(String(entry.action || '')) &&
        isSuccessfulOperation(entry);
}

function operationIdentity(entry = {}) {
    const messageId = String(entry.messageId || entry.payload?.messageId || '').trim();
    if (!messageId) return null;
    return [
        entry.kind || 'sheet',
        entry.action || 'write',
        messageId,
        entry.server || entry.payload?.server || 'no-server'
    ].join(':');
}

function findDuplicateMessageOperations(entries = [], {
    now = new Date(),
    windowMs = DAY_MS
} = {}) {
    const cutoff = now.valueOf() - windowMs;
    const grouped = new Map();

    for (const entry of entries) {
        if (!isSuccessfulSheetMutation(entry)) continue;
        const createdAt = new Date(entry.createdAt || 0).valueOf();
        if (!Number.isFinite(createdAt) || createdAt < cutoff) continue;
        const identity = operationIdentity(entry);
        if (!identity) continue;
        const rows = grouped.get(identity) || [];
        rows.push(entry);
        grouped.set(identity, rows);
    }

    return [...grouped.entries()]
        .filter(([, rows]) => rows.length > 1)
        .map(([identity, rows]) => ({
            code: 'duplicate-message-operation',
            identity,
            count: rows.length,
            kind: rows[0]?.kind || null,
            action: rows[0]?.action || null,
            messageId: rows[0]?.messageId || rows[0]?.payload?.messageId || null,
            server: rows[0]?.server || rows[0]?.payload?.server || null,
            userName: rows[0]?.userName || rows[0]?.payload?.userName || null
        }));
}

function collectSheetAuditIssues(report = {}) {
    const issues = [];
    const ignoredCodes = new Set([
        'period-mismatch',
        'great-tab-no-current-payroll-totals',
        'great-tab-no-payroll-totals'
    ]);

    for (const audit of report.audited || []) {
        if (audit.changed && !audit.roundingOnly) {
            issues.push({
                code: 'payroll-value-mismatch',
                server: audit.serverKey || audit.server,
                periodLabel: audit.periodLabel || null,
                confidence: audit.confidence || 'REVIEW',
                totalAdenaDelta: audit.evidence?.totalAdenaDelta || 0,
                rowNumber: audit.rowNumber || null
            });
            continue;
        }
        if (!audit.ok && audit.code && !ignoredCodes.has(audit.code)) {
            issues.push({
                code: audit.code,
                server: audit.serverKey || audit.server,
                errorMessage: audit.errorMessage || null
            });
        }
    }
    return issues;
}

function issueFingerprint(issues, crypto = cryptoDefault) {
    const stable = issues
        .map(issue => ({
            code: issue.code,
            server: issue.server || null,
            periodLabel: issue.periodLabel || null,
            messageId: issue.messageId || null,
            identity: issue.identity || null,
            count: issue.count || null,
            totalAdenaDelta: issue.totalAdenaDelta || null
        }))
        .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return crypto.createHash('sha256').update(JSON.stringify(stable)).digest('hex');
}

function formatIntegrityAlert(issues, report) {
    const lines = [
        `⚠️ **일일 급여 데이터 정합성 확인 필요 (${issues.length}건)**`,
        `검사 시각: ${report.generatedAt || new Date().toISOString()}`,
        '자동 수정은 실행하지 않았습니다.',
        ''
    ];

    for (const issue of issues.slice(0, 10)) {
        if (issue.code === 'duplicate-message-operation') {
            lines.push(`• 중복 기록: ${issue.userName || '-'} / ${issue.server || '-'} / 메시지 ${issue.messageId} / ${issue.count}회`);
        } else if (issue.code === 'payroll-value-mismatch') {
            lines.push(`• 시트 값 불일치: ${issue.server || '-'} / ${issue.periodLabel || '-'} / 아데나 차이 ${Number(issue.totalAdenaDelta || 0).toLocaleString('en-US')}`);
        } else {
            lines.push(`• 감사 실패: ${issue.server || '-'} / ${issue.code}${issue.errorMessage ? ` / ${issue.errorMessage}` : ''}`);
        }
    }
    if (issues.length > 10) lines.push(`• 그 외 ${issues.length - 10}건`);
    lines.push('', '확인 후 `/작업대기`와 급여 시트를 점검해 주세요.');
    return lines.join('\n');
}

function createPayrollIntegrityAuditService({
    payrollOperationLogService,
    auditRunner,
    client = null,
    CONFIG = {},
    notifyPayrollOwners = notifyPayrollOwnersDefault,
    fs = fsDefault,
    path = pathDefault,
    crypto = cryptoDefault,
    stateFile = './logs/payroll-integrity-audit-state.json',
    logger = console
} = {}) {
    if (typeof auditRunner !== 'function') throw new TypeError('auditRunner must be a function');

    async function readState() {
        try {
            return JSON.parse(await fs.readFile(stateFile, 'utf8'));
        } catch (error) {
            if (error?.code !== 'ENOENT') logger.warn?.('[PAYROLL INTEGRITY STATE READ]', error?.message || error);
            return {};
        }
    }

    async function writeState(value) {
        await fs.mkdir(path.dirname(stateFile), { recursive: true });
        await fs.writeFile(stateFile, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    }

    async function runDailyAudit(trigger = 'daily-cron', now = new Date()) {
        let report;
        let auditRunIssue = null;
        try {
            report = await auditRunner({
                apply: false,
                allServers: true,
                log: true
            });
        } catch (error) {
            auditRunIssue = {
                code: 'audit-run-failed',
                server: 'ALL',
                errorMessage: error?.message || String(error)
            };
            report = {
                ok: false,
                generatedAt: now.toISOString(),
                audited: [],
                errorMessage: auditRunIssue.errorMessage
            };
        }
        const entries = payrollOperationLogService?.listRecent
            ? await payrollOperationLogService.listRecent({ limit: 10000, date: now })
            : [];
        const issues = [
            ...(auditRunIssue ? [auditRunIssue] : []),
            ...collectSheetAuditIssues(report),
            ...findDuplicateMessageOperations(entries, { now })
        ];
        const fingerprint = issueFingerprint(issues, crypto);
        const previous = await readState();
        const repeated = Boolean(
            issues.length &&
            previous.lastAlertFingerprint === fingerprint &&
            now.valueOf() - new Date(previous.lastAlertAt || 0).valueOf() < DAY_MS
        );

        let notification = { sent: 0, failed: 0, skipped: true };
        if (issues.length && !repeated) {
            notification = await notifyPayrollOwners({
                client,
                CONFIG,
                logger,
                content: formatIntegrityAlert(issues, report)
            });
        }
        const alertDelivered = Number(notification.sent || 0) > 0;

        const state = {
            lastRunAt: now.toISOString(),
            trigger,
            issueCount: issues.length,
            lastFingerprint: fingerprint,
            lastAlertAt: alertDelivered ? now.toISOString() : (previous.lastAlertAt || null),
            lastAlertFingerprint: alertDelivered ? fingerprint : (previous.lastAlertFingerprint || null),
            repeatedAlertSuppressed: repeated
        };
        await writeState(state);
        logger.log?.('[PAYROLL INTEGRITY AUDIT]', {
            trigger,
            issueCount: issues.length,
            repeatedAlertSuppressed: repeated,
            notified: notification.sent || 0
        });
        return {
            ok: true,
            trigger,
            report,
            issues,
            repeatedAlertSuppressed: repeated,
            notification,
            state
        };
    }

    return { runDailyAudit };
}

module.exports = {
    createPayrollIntegrityAuditService,
    findDuplicateMessageOperations,
    isSuccessfulSheetMutation,
    collectSheetAuditIssues,
    formatIntegrityAlert,
    issueFingerprint
};
