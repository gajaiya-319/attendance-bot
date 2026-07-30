'use strict';

const crypto = require('crypto');

const VALID_FINAL_STATUSES = new Set([
    'UNKNOWN',
    'WORKING',
    'OVERTIME',
    'FINISHED',
    'DAY_OFF',
    'ABSENT'
]);

function hashValue(value, salt = 'attendance-staging-replay') {
    return crypto
        .createHash('sha256')
        .update(`${salt}:${String(value || 'anonymous')}`)
        .digest('hex');
}

function sanitizeTransition(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
    const transition = {};
    if (value.from != null) transition.from = String(value.from);
    if (value.to != null) transition.to = String(value.to);
    return Object.keys(transition).length ? transition : undefined;
}

function anonymizeAttendanceEvents(events = [], { salt = 'attendance-staging-replay' } = {}) {
    const identities = new Map();

    function identityFor(event, index) {
        const sourceKey = String(event?.userId || event?.userName || `anonymous-${index}`);
        if (!identities.has(sourceKey)) {
            const digest = hashValue(sourceKey, salt);
            identities.set(sourceKey, {
                userId: `stg_${digest.slice(0, 12)}`,
                userName: `Worker-${digest.slice(12, 18)}`
            });
        }
        return identities.get(sourceKey);
    }

    return (Array.isArray(events) ? events : []).map((event, index) => {
        const identity = identityFor(event, index);
        const meta = {};
        const attendanceStatus = sanitizeTransition(event?.meta?.attendanceStatus);
        const voiceStatus = sanitizeTransition(event?.meta?.voiceStatus);
        if (attendanceStatus) meta.attendanceStatus = attendanceStatus;
        if (voiceStatus) meta.voiceStatus = voiceStatus;
        if (event?.meta?.sessionId) meta.sessionId = `session_${hashValue(event.meta.sessionId, salt).slice(0, 12)}`;
        if (event?.meta?.transitionId) meta.transitionId = `transition_${hashValue(event.meta.transitionId, salt).slice(0, 12)}`;

        return {
            id: event?.id ? `event_${hashValue(event.id, salt).slice(0, 16)}` : null,
            at: event?.at || null,
            recordedAt: event?.recordedAt || null,
            type: String(event?.type || 'unknown'),
            source: String(event?.source || 'system'),
            userId: identity.userId,
            userName: identity.userName,
            shift: event?.shift || null,
            attendanceStatus: event?.attendanceStatus || null,
            voiceStatus: event?.voiceStatus || null,
            sessionId: event?.sessionId
                ? `session_${hashValue(event.sessionId, salt).slice(0, 12)}`
                : (meta.sessionId || null),
            confidence: event?.confidence || 'observed',
            meta
        };
    });
}

function validateProjectedRecords(records = []) {
    const issues = [];
    const keys = new Set();

    for (const record of records || []) {
        const key = `${record?.userId || 'missing-user'}:${record?.workDate || 'missing-date'}`;
        if (keys.has(key)) issues.push(`duplicate-projection:${key}`);
        keys.add(key);

        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(record?.workDate || ''))) {
            issues.push(`invalid-work-date:${key}`);
        }
        if (!VALID_FINAL_STATUSES.has(record?.finalStatus)) {
            issues.push(`invalid-final-status:${key}:${record?.finalStatus || 'missing'}`);
        }
        if (record?.clockInAt && record?.clockOutAt && Date.parse(record.clockOutAt) < Date.parse(record.clockInAt)) {
            issues.push(`clock-out-before-clock-in:${key}`);
        }
        if (Number(record?.overtimeMinutes || 0) < 0 || Number(record?.overtimeMinutes || 0) > 24 * 60) {
            issues.push(`invalid-overtime-minutes:${key}`);
        }
        if (Array.isArray(record?.flags) && new Set(record.flags).size !== record.flags.length) {
            issues.push(`duplicate-flags:${key}`);
        }
    }
    return issues;
}

function equalValue(actual, expected) {
    return JSON.stringify(actual) === JSON.stringify(expected);
}

function compareExpectedRecords(records = [], expectedRecords = []) {
    const failures = [];
    for (const expected of expectedRecords || []) {
        const record = records.find(item => (
            String(item.userId || '') === String(expected.userId || '') &&
            String(item.workDate || '') === String(expected.workDate || '')
        ));
        const label = `${expected.userId || 'unknown'}:${expected.workDate || 'unknown'}`;
        if (!record) {
            failures.push(`missing-record:${label}`);
            continue;
        }
        for (const [field, value] of Object.entries(expected.fields || {})) {
            if (!equalValue(record[field], value)) {
                failures.push(`field-mismatch:${label}:${field}:expected=${JSON.stringify(value)}:actual=${JSON.stringify(record[field])}`);
            }
        }
        for (const flag of expected.flagsInclude || []) {
            if (!record.flags?.includes(flag)) failures.push(`missing-flag:${label}:${flag}`);
        }
        for (const flag of expected.flagsExclude || []) {
            if (record.flags?.includes(flag)) failures.push(`unexpected-flag:${label}:${flag}`);
        }
    }
    return failures;
}

function runAttendanceReplayScenario(scenario, {
    projectAttendanceFromEventLog,
    projectionOptions
}) {
    const inputBefore = JSON.stringify(scenario.events || []);
    const records = projectAttendanceFromEventLog(scenario.events || [], projectionOptions);
    const reversedRecords = projectAttendanceFromEventLog([...(scenario.events || [])].reverse(), projectionOptions);
    const failures = [
        ...validateProjectedRecords(records),
        ...compareExpectedRecords(records, scenario.expectedRecords || [])
    ];

    if (JSON.stringify(records) !== JSON.stringify(reversedRecords)) {
        failures.push('non-deterministic-event-order');
    }
    if (JSON.stringify(scenario.events || []) !== inputBefore) {
        failures.push('input-events-mutated');
    }

    return {
        id: scenario.id,
        type: 'attendance',
        ok: failures.length === 0,
        eventCount: (scenario.events || []).length,
        recordCount: records.length,
        failures
    };
}

function comparePayrollSnapshot(snapshot, expected = {}) {
    const failures = [];
    for (const [cell, value] of Object.entries(expected.cells || {})) {
        if (!equalValue(snapshot.cells?.[cell], value)) {
            failures.push(`cell-mismatch:${cell}:expected=${JSON.stringify(value)}:actual=${JSON.stringify(snapshot.cells?.[cell])}`);
        }
    }
    for (const field of ['successfulOperations', 'duplicateResults', 'updateRequests', 'batchUpdateRequests']) {
        if (expected[field] != null && snapshot[field] !== expected[field]) {
            failures.push(`snapshot-mismatch:${field}:expected=${expected[field]}:actual=${snapshot[field]}`);
        }
    }
    return failures;
}

async function runPayrollReplayScenario(scenario, { createPayrollHarness }) {
    const harness = createPayrollHarness(scenario);
    const events = Array.isArray(scenario.events) ? scenario.events : [];
    const batches = new Map();
    events.forEach((event, index) => {
        const batch = Number.isFinite(Number(event.batch)) ? Number(event.batch) : index;
        const items = batches.get(batch) || [];
        items.push(event);
        batches.set(batch, items);
    });

    const results = [];
    for (const batch of [...batches.keys()].sort((a, b) => a - b)) {
        const batchResults = await Promise.all(batches.get(batch).map(event => harness.apply(event)));
        results.push(...batchResults);
    }

    const snapshot = harness.snapshot(results, scenario.expected?.cells || {});
    const failures = comparePayrollSnapshot(snapshot, scenario.expected || {});
    return {
        id: scenario.id,
        type: 'payroll',
        ok: failures.length === 0,
        eventCount: events.length,
        successfulOperations: snapshot.successfulOperations,
        duplicateResults: snapshot.duplicateResults,
        failures
    };
}

async function runStagingReplaySuite(fixture, dependencies) {
    const results = [];
    for (const scenario of fixture.attendanceScenarios || []) {
        results.push(runAttendanceReplayScenario(scenario, dependencies));
    }
    for (const scenario of fixture.payrollScenarios || []) {
        results.push(await runPayrollReplayScenario(scenario, dependencies));
    }
    const failures = results.flatMap(result => result.failures.map(failure => `${result.id}:${failure}`));
    return {
        ok: failures.length === 0,
        fixtureVersion: fixture.version || null,
        scenarioCount: results.length,
        passedCount: results.filter(result => result.ok).length,
        failedCount: results.filter(result => !result.ok).length,
        failures,
        results
    };
}

function summarizeRuntimeReplay(events, {
    projectAttendanceFromEventLog,
    projectionOptions,
    salt
}) {
    const anonymized = anonymizeAttendanceEvents(events, { salt });
    const records = projectAttendanceFromEventLog(anonymized, projectionOptions);
    const reversedRecords = projectAttendanceFromEventLog([...anonymized].reverse(), projectionOptions);
    const issues = validateProjectedRecords(records);
    if (JSON.stringify(records) !== JSON.stringify(reversedRecords)) issues.push('non-deterministic-event-order');

    const statusCounts = {};
    const flagCounts = {};
    for (const record of records) {
        statusCounts[record.finalStatus] = (statusCounts[record.finalStatus] || 0) + 1;
        for (const flag of record.flags || []) flagCounts[flag] = (flagCounts[flag] || 0) + 1;
    }

    return {
        ok: issues.length === 0,
        anonymized: true,
        eventCount: anonymized.length,
        recordCount: records.length,
        statusCounts,
        flagCounts,
        issueCount: issues.length,
        issues
    };
}

module.exports = {
    anonymizeAttendanceEvents,
    compareExpectedRecords,
    comparePayrollSnapshot,
    runAttendanceReplayScenario,
    runPayrollReplayScenario,
    runStagingReplaySuite,
    summarizeRuntimeReplay,
    validateProjectedRecords
};
