'use strict';

function normalizeEndAdenaName(value) {
    return String(value || '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/\b(?:over\s*time|overtime|ot)\b/gi, ' ')
        .replace(/[*_~`]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function operationCreatedAt(operation) {
    const value = Date.parse(operation?.createdAt || '');
    return Number.isFinite(value) ? value : 0;
}

function auditForOperation(operation) {
    return operation?.payload?.audit || operation?.audit || {};
}

function sameInstant(left, right) {
    const leftMs = Date.parse(left || '');
    const rightMs = Date.parse(right || '');
    return Number.isFinite(leftMs) && Number.isFinite(rightMs) && leftMs === rightMs;
}

function operationMatchesShiftWindow(operation, { shiftStartAt, shiftEndAt } = {}) {
    const audit = auditForOperation(operation);
    if (!audit.shiftStartAt && !audit.shiftEndAt) return true;
    return sameInstant(audit.shiftStartAt, shiftStartAt) && sameInstant(audit.shiftEndAt, shiftEndAt);
}

function selectEndAdenaOperations(operations, { shift, from, to, shiftStartAt = from, shiftEndAt = null }) {
    const normalizedShift = String(shift || '').trim().toUpperCase();
    const fromMs = new Date(from).getTime();
    const toMs = new Date(to).getTime();
    return (operations || [])
        .filter(operation => operation?.kind === 'end-adena')
        .filter(operation => operation?.status === 'success')
        .filter(operation => String(operation?.shift || operation?.payload?.shift || '').toUpperCase() === normalizedShift)
        .filter(operation => operationMatchesShiftWindow(operation, { shiftStartAt, shiftEndAt }))
        .filter(operation => operationCreatedAt(operation) >= fromMs && operationCreatedAt(operation) <= toMs)
        .sort((a, b) => operationCreatedAt(a) - operationCreatedAt(b));
}

function reduceEndAdenaOperations(operations, { fromZero = false } = {}) {
    let expectedValue = 0;
    const approvedMessageIds = new Set();
    const cancelledMessageIds = new Set();
    const submissionSegmentByMessage = new Map();
    const approvedAmountByMessage = new Map();
    for (const operation of operations || []) {
        const action = String(operation.action || '').toLowerCase();
        const messageId = operation.messageId || operation.payload?.messageId || null;
        const audit = auditForOperation(operation);
        const reportedNextValue = Number(operation.result?.summaryNextValue);
        const rawAmount = Number(operation.payload?.rawAmount ?? operation.payload?.amount);
        if (Number.isFinite(reportedNextValue)) {
            expectedValue = Math.max(0, Math.trunc(reportedNextValue));
        } else if (Number.isFinite(rawAmount)) {
            expectedValue = action === 'cancel' || rawAmount < 0
                ? Math.max(0, expectedValue + Math.trunc(rawAmount))
                : Math.max(0, Math.trunc(rawAmount));
        }
        if (messageId) {
            if (action === 'cancel') cancelledMessageIds.add(messageId);
            else {
                approvedMessageIds.add(messageId);
                if (Number.isFinite(rawAmount)) approvedAmountByMessage.set(messageId, Math.trunc(rawAmount));
                const sessionId = audit.attendanceSessionId || operation.payload?.attendanceSessionId || null;
                const sessionType = String(audit.attendanceSessionType || operation.payload?.attendanceSessionType || '').toUpperCase();
                submissionSegmentByMessage.set(
                    messageId,
                    sessionId && sessionType && sessionType !== 'REGULAR'
                        ? `overtime:${sessionId}`
                        : 'regular-or-legacy'
                );
            }
        }
    }
    for (const messageId of cancelledMessageIds) {
        approvedMessageIds.delete(messageId);
        submissionSegmentByMessage.delete(messageId);
        approvedAmountByMessage.delete(messageId);
    }
    const segmentCounts = new Map();
    for (const messageId of approvedMessageIds) {
        const segment = submissionSegmentByMessage.get(messageId) || 'regular-or-legacy';
        segmentCounts.set(segment, (segmentCounts.get(segment) || 0) + 1);
    }
    const duplicate = [...segmentCounts.values()].some(count => count > 1);
    const hasCompleteRawAmounts = approvedAmountByMessage.size === approvedMessageIds.size;
    if (fromZero && approvedMessageIds.size > 0 && hasCompleteRawAmounts) {
        expectedValue = Math.max(0, [...approvedAmountByMessage.values()].reduce((sum, amount) => sum + amount, 0));
    } else if (!duplicate && segmentCounts.size > 1 && hasCompleteRawAmounts) {
        expectedValue = Math.max(0, [...approvedAmountByMessage.values()].reduce((sum, amount) => sum + amount, 0));
    }
    return {
        expectedValue,
        submitted: approvedMessageIds.size > 0 && expectedValue > 0,
        duplicate,
        approvedMessageIds: [...approvedMessageIds],
        cancelledMessageIds: [...cancelledMessageIds],
        submissionSegments: [...new Set(submissionSegmentByMessage.values())]
    };
}

function hasSuccessfulSummaryReset(operations, { shift, shiftStartAt, shiftEndAt } = {}) {
    const normalizedShift = String(shift || '').trim().toUpperCase();
    return (operations || []).some(operation => (
        operation?.kind === 'end-adena-summary-reset' &&
        operation?.status === 'success' &&
        String(operation?.shift || operation?.payload?.shift || '').toUpperCase() === normalizedShift &&
        sameInstant(operation?.payload?.shiftStartAt, shiftStartAt) &&
        sameInstant(operation?.payload?.shiftEndAt, shiftEndAt)
    ));
}

module.exports = {
    normalizeEndAdenaName,
    operationCreatedAt,
    auditForOperation,
    operationMatchesShiftWindow,
    selectEndAdenaOperations,
    reduceEndAdenaOperations,
    hasSuccessfulSummaryReset
};
