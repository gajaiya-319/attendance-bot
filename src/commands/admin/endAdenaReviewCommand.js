'use strict';

const {
    summarizeEndAdenaQuality,
    formatEndAdenaQualityLine,
    formatEndAdenaQualityIssues
} = require('../../services/endAdenaQualityService');

const CUSTOM_ID_PREFIX = 'end-adena-review';

function instantMs(value) {
    const parsed = Date.parse(value || '');
    return Number.isFinite(parsed) ? parsed : null;
}

function operationWindow(operation) {
    const startAt = operation?.payload?.shiftStartAt || operation?.shiftStartAt || null;
    const endAt = operation?.payload?.shiftEndAt || operation?.shiftEndAt || null;
    const startMs = instantMs(startAt);
    const endMs = instantMs(endAt);
    if (startMs === null || endMs === null) return null;
    return {
        shift: String(operation?.shift || operation?.payload?.shift || '').toUpperCase(),
        startAt: new Date(startMs).toISOString(),
        endAt: new Date(endMs).toISOString(),
        startMs,
        endMs
    };
}

function reviewCount(result = {}) {
    const explicit = Number(result.needsReview);
    if (Number.isFinite(explicit)) return Math.max(0, Math.trunc(explicit));
    return ['awaitingApproval', 'invalidSubmissions', 'missing', 'unexpected', 'unexpectedPending', 'duplicates', 'pendingDuplicates', 'unresolved']
        .reduce((sum, key) => sum + (Array.isArray(result[key]) ? result[key].length : 0), 0) +
        (Array.isArray(result.repair?.failures) ? result.repair.failures.length : 0);
}

function resultCount(value) {
    if (Array.isArray(value)) return value.length;
    const count = Number(value);
    return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function isBusinessComplete(operation) {
    if (typeof operation?.result?.businessComplete === 'boolean') {
        return operation.result.businessComplete;
    }
    return operation?.result?.ok !== false && reviewCount(operation?.result) === 0;
}

function sameWindow(operation, window) {
    const candidate = operationWindow(operation);
    return Boolean(candidate && window &&
        candidate.shift === window.shift &&
        candidate.startMs === window.startMs &&
        candidate.endMs === window.endMs);
}

function settlementPhase(now, bounds, settlement = {}) {
    const nowMs = typeof now?.valueOf === 'function' ? now.valueOf() : instantMs(now);
    const startMs = typeof bounds?.start?.valueOf === 'function' ? bounds.start.valueOf() : instantMs(bounds?.start);
    const endMs = typeof bounds?.end?.valueOf === 'function' ? bounds.end.valueOf() : instantMs(bounds?.end);
    if (nowMs === null || startMs === null || endMs === null) return 'unknown';
    if (settlement?.activeOvertime) return 'active-overtime';
    const deadlineMs = instantMs(settlement?.deadlineAt) ?? (endMs + 60 * 60_000);
    if (nowMs < startMs) return 'pre-shift';
    if (nowMs < endMs) return 'working';
    if (nowMs < deadlineMs) return 'approval-window';
    if (nowMs < deadlineMs + 60 * 60_000) return 'overdue';
    return 'settled';
}

function selectCurrentSettlementWindow(now, getShiftBounds, resolveSettlement) {
    if (!now?.clone || typeof getShiftBounds !== 'function') return null;
    const rank = {
        'active-overtime': 0,
        'approval-window': 1,
        overdue: 2,
        working: 3,
        'pre-shift': 4,
        settled: 5,
        unknown: 6
    };
    const candidates = [];
    for (const shift of ['day', 'night']) {
        const bounds = getShiftBounds(shift, now);
        if (!bounds?.start?.clone || !bounds?.end?.clone) continue;
        const settlement = typeof resolveSettlement === 'function'
            ? resolveSettlement({ shift: shift.toUpperCase(), bounds, at: now })
            : null;
        const phase = settlementPhase(now, bounds, settlement);
        candidates.push({
            shift: shift.toUpperCase(),
            bounds,
            settlement,
            phase,
            distanceMs: Math.abs(now.valueOf() - bounds.end.valueOf())
        });
    }
    return candidates.sort((left, right) => (
        (rank[left.phase] ?? 99) - (rank[right.phase] ?? 99) || left.distanceMs - right.distanceMs
    ))[0] || null;
}

function selectEndAdenaReview(logs = [], {
    shift = null,
    startMs = null,
    endMs = null
} = {}) {
    const normalizedShift = shift ? String(shift).toUpperCase() : null;
    const reconciliations = (logs || [])
        .filter(item => item?.kind === 'end-adena-reconciliation' && item?.status === 'success')
        .filter(item => operationWindow(item))
        .filter(item => !normalizedShift || operationWindow(item).shift === normalizedShift)
        .sort((a, b) => (instantMs(a.createdAt) || 0) - (instantMs(b.createdAt) || 0));

    const latestByWindow = new Map();
    for (const operation of reconciliations) {
        const window = operationWindow(operation);
        latestByWindow.set(`${window.shift}:${window.startMs}:${window.endMs}`, operation);
    }

    let selected = null;
    if (Number.isFinite(Number(startMs)) && Number.isFinite(Number(endMs)) && normalizedShift) {
        selected = latestByWindow.get(`${normalizedShift}:${Number(startMs)}:${Number(endMs)}`) || null;
    } else {
        selected = [...latestByWindow.values()]
            .sort((a, b) => (instantMs(b.createdAt) || 0) - (instantMs(a.createdAt) || 0))
            .find(operation => !isBusinessComplete(operation)) || null;
    }

    if (!selected) {
        return { found: false, businessComplete: true, needsReview: 0, pending: [] };
    }

    const window = operationWindow(selected);
    const reminders = (logs || [])
        .filter(item => ['end-adena-approval-reminder', 'end-adena-approval-deadline-warning'].includes(item?.kind) && item?.status === 'success')
        .filter(item => sameWindow(item, window))
        .sort((a, b) => (instantMs(b.createdAt) || 0) - (instantMs(a.createdAt) || 0));
    const reminder = reminders[0] || null;
    const approvedMessageIds = new Set((logs || [])
        .filter(item => item?.kind === 'end-adena' && item?.status === 'success')
        .filter(item => sameWindow(item, window))
        .map(item => String(item.messageId || item.payload?.messageId || ''))
        .filter(Boolean));
    const result = selected.result || {};
    const pendingSource = Array.isArray(result.pending) ? result.pending : reminder?.result?.pending;
    const pending = (Array.isArray(pendingSource) ? pendingSource : [])
        .filter(item => !approvedMessageIds.has(String(item.messageId || '')));

    return {
        found: true,
        shift: window.shift,
        shiftStartAt: window.startAt,
        shiftEndAt: window.endAt,
        startMs: window.startMs,
        endMs: window.endMs,
        completedAt: selected.createdAt || null,
        source: selected.source || null,
        workEndAt: selected.payload?.workEndAt || null,
        settlementDeadlineAt: selected.payload?.settlementDeadlineAt || null,
        overtimeExtensionMinutes: Number(selected.payload?.overtimeExtensionMinutes || 0),
        businessComplete: isBusinessComplete(selected),
        needsReview: reviewCount(result),
        expectedWorkersCount: resultCount(result.expectedWorkers),
        submittedCount: resultCount(result.submitted),
        approvedPostCount: resultCount(result.approvedPostCount),
        pending,
        awaitingApproval: Array.isArray(result.awaitingApproval) ? result.awaitingApproval : [],
        invalidSubmissions: Array.isArray(result.invalidSubmissions) ? result.invalidSubmissions : [],
        missing: Array.isArray(result.missing) ? result.missing : [],
        unexpected: Array.isArray(result.unexpected) ? result.unexpected : [],
        unexpectedPending: Array.isArray(result.unexpectedPending) ? result.unexpectedPending : [],
        duplicates: Array.isArray(result.duplicates) ? result.duplicates : [],
        pendingDuplicates: Array.isArray(result.pendingDuplicates) ? result.pendingDuplicates : [],
        unresolved: Array.isArray(result.unresolved) ? result.unresolved : [],
        sheetMismatches: Array.isArray(result.sheetMismatches) ? result.sheetMismatches : [],
        sheetRecordedCount: Number(result.sheetRecordedCount || 0),
        repairFailures: Array.isArray(result.repair?.failures)
            ? result.repair.failures
            : Array.isArray(result.repairFailures) ? result.repairFailures : []
    };
}

function itemName(item) {
    return item?.sheetUserName || item?.userName || item?.name || 'Unknown';
}

function appendItems(lines, label, items, formatter = itemName) {
    if (!items?.length) return;
    lines.push('', `${label} (${items.length})`);
    for (const item of items.slice(0, 10)) lines.push(`- ${formatter(item)}`);
    if (items.length > 10) lines.push(`- +${items.length - 10}`);
}

function buildCustomId(action, snapshot) {
    return [CUSTOM_ID_PREFIX, action, snapshot.shift, snapshot.startMs, snapshot.endMs].join(':');
}

function discordTime(value, style = 'F') {
    const parsed = instantMs(value);
    return parsed === null ? '\ud655\uc778 \uc911' : `<t:${Math.floor(parsed / 1000)}:${style}>`;
}

function parseCustomId(customId) {
    const [prefix, action, shift, start, end, extra] = String(customId || '').split(':');
    if (prefix !== CUSTOM_ID_PREFIX || extra || !['refresh', 'reconcile'].includes(action)) return null;
    if (!['DAY', 'NIGHT'].includes(shift)) return null;
    const startMs = Number(start);
    const endMs = Number(end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs >= endMs) return null;
    return { action, shift, startMs, endMs };
}

function renderReviewPayload(snapshot, {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
}) {
    if (!snapshot?.found) {
        return {
            content: [
                '**\uc5d4\ub4dc\uc544\ub370\ub098 \uad00\ub9ac\uc790 \ud655\uc778\uc13c\ud130**',
                '',
                '\ud604\uc7ac \ud655\uc778\uc774 \ud544\uc694\ud55c \ubbf8\uc644\ub8cc \uacb0\uc0b0\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.'
            ].join('\n'),
            components: []
        };
    }

    let statusLine = snapshot.businessComplete
        ? '\uc0c1\ud0dc: \uc815\uc0c1 \uc644\ub8cc'
        : `\uc0c1\ud0dc: \ud655\uc778 \ud544\uc694 ${snapshot.needsReview}\uac74`;
    if (snapshot.settlementPhase === 'active-overtime') {
        statusLine = `\uc0c1\ud0dc: \uc624\ubc84\ud0c0\uc784 \uc9c4\ud589 \uc911 (${snapshot.activeOvertimeCount || 0}\uba85)`;
    } else if (snapshot.settlementPhase === 'working') {
        statusLine = '\uc0c1\ud0dc: \uadfc\ubb34 \uc9c4\ud589 \uc911';
    } else if (snapshot.settlementPhase === 'approval-window') {
        statusLine = '\uc0c1\ud0dc: \ud1f4\uadfc \uc644\ub8cc, \uc2b9\uc778 \ub300\uae30 \uc2dc\uac04';
    } else if (snapshot.settlementPhase === 'overdue' && !snapshot.hasReconciliation) {
        statusLine = '\uc0c1\ud0dc: \uacb0\uc0b0 \uc2e4\ud589 \ud544\uc694';
    }

    const lines = [
        '**\uc5d4\ub4dc\uc544\ub370\ub098 \uad00\ub9ac\uc790 \ud655\uc778\uc13c\ud130**',
        `\uadfc\ubb34\uc870: ${snapshot.shift}`,
        `\uc608\uc815 \uadfc\ubb34: ${discordTime(snapshot.shiftStartAt, 't')} ~ ${discordTime(snapshot.shiftEndAt, 't')}`,
        statusLine,
        `\uc2b9\uc778 \ub300\uae30 \uc6d0\ubb38: ${snapshot.pending.length}\uac74`
    ];
    lines.push(formatEndAdenaQualityLine(snapshot.quality7d));
    const qualityIssues = formatEndAdenaQualityIssues(snapshot.quality7d);
    if (qualityIssues) lines.push(qualityIssues);
    if (snapshot.hasReconciliation !== false && snapshot.completedAt) {
        lines.push(`\ub9c8\uac10 \ub300\uc870: \uc2e4\ucd9c\uadfc ${snapshot.expectedWorkersCount || 0}\uba85 / \uc2b9\uc778 \uac8c\uc2dc\ubb3c ${snapshot.approvedPostCount || 0}\uac74 / \uc2dc\ud2b8 \uac80\uc99d ${snapshot.sheetRecordedCount || 0}\uba85`);
    }

    if (snapshot.settlementPhase === 'active-overtime') {
        appendItems(lines, '\uc624\ubc84\ud0c0\uc784 \uc9c4\ud589 \uc911', snapshot.activeOvertimeWorkers || []);
        lines.push('', '\uc2e4\uc81c \ud1f4\uadfc\uc774 \ud655\uc815\ub418\uba74 \uc2b9\uc778 \ub9c8\uac10\uc744 \uc790\ub3d9 \uacc4\uc0b0\ud569\ub2c8\ub2e4.');
    } else if (['working', 'pre-shift'].includes(snapshot.settlementPhase)) {
        lines.push('', '\uc2e4\uc81c \ud1f4\uadfc\uc774 \ud655\uc815\ub418\uba74 \uc2b9\uc778 \ub9c8\uac10\uc744 \uc790\ub3d9 \uacc4\uc0b0\ud569\ub2c8\ub2e4.');
    } else {
        if (snapshot.workEndAt) lines.push(`\uc2e4\uc81c \ub9c8\uc9c0\ub9c9 \ud1f4\uadfc: ${discordTime(snapshot.workEndAt)}`);
        if (snapshot.settlementDeadlineAt) lines.push(`\uc2b9\uc778 \ub9c8\uac10: ${discordTime(snapshot.settlementDeadlineAt)}`);
        if (snapshot.overtimeExtensionMinutes > 0) {
            lines.push(`\uc624\ubc84\ud0c0\uc784 \uc5f0\uc7a5: ${snapshot.overtimeExtensionMinutes}\ubd84`);
        }
    }

    appendItems(lines, '\uc2b9\uc778 \ub300\uae30', snapshot.pending, item => {
        const name = itemName(item);
        return item.url ? `[${name}](${item.url})` : name;
    });
    appendItems(lines, '\uc218\uc815 \ud544\uc694 \uac8c\uc2dc\ubb3c', snapshot.invalidSubmissions, item => {
        const name = itemName(item);
        const detail = `${name} (${(item.issueCodes || ['invalid-format']).join(', ')})`;
        return item.url ? `[${detail}](${item.url})` : detail;
    });
    appendItems(lines, '\ubbf8\uc81c\ucd9c', snapshot.missing);
    appendItems(lines, '\ube44\uadfc\ubb34 \uc81c\ucd9c', snapshot.unexpected);
    appendItems(lines, '\ube44\uadfc\ubb34 \uc2b9\uc778 \ub300\uae30', snapshot.unexpectedPending, item => {
        const name = itemName(item);
        return item.url ? `[${name}](${item.url})` : name;
    });
    appendItems(lines, '\uc911\ubcf5', snapshot.duplicates);
    appendItems(lines, '\uc2b9\uc778 \ub300\uae30 \uc911\ubcf5', snapshot.pendingDuplicates);
    appendItems(lines, '\uc2dc\ud2b8 \uae08\uc561 \ubd88\uc77c\uce58', snapshot.sheetMismatches, item => (
        `${itemName(item)}: ${Number(item.sheetValue || 0).toLocaleString('en-US')} -> ${Number(item.approvedValue || 0).toLocaleString('en-US')} (${item.recovered ? '\ubcf5\uad6c \uc644\ub8cc' : '\ubcf5\uad6c \uc2e4\ud328'})`
    ));
    appendItems(lines, '\uc608\uc678', snapshot.unresolved, item => `${itemName(item)} (${item.code || 'unknown'})`);
    appendItems(lines, '\uc790\ub3d9 \ubcf5\uad6c \uc2e4\ud328', snapshot.repairFailures, item => `${itemName(item)} (${item.error || item.code || 'failed'})`);
    lines.push('', '\uccb4\ud06c \uc2b9\uc778\uc740 \uc790\ub3d9\uc73c\ub85c \ucc98\ub9ac\ud558\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4.');
    lines.push('\uc218\ub3d9 \uc2b9\uc778 \ud6c4\uc5d0\ub294 \uc790\ub3d9 \uc7ac\uacb0\uc0b0\ub418\uba70, \ud544\uc694\ud558\uba74 \uc544\ub798 \uc7ac\uacb0\uc0b0\uc744 \uc0ac\uc6a9\ud558\uc138\uc694.');

    const buttons = [
        new ButtonBuilder()
            .setCustomId(buildCustomId('refresh', snapshot))
            .setLabel('\uc0c8\ub85c\uace0\uce68')
            .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
            .setCustomId(buildCustomId('reconcile', snapshot))
            .setLabel('\uc7ac\uacb0\uc0b0')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(snapshot.reconcileEnabled === undefined
                ? snapshot.businessComplete
                : !snapshot.reconcileEnabled)
    ];
    for (const [index, item] of snapshot.pending.filter(item => /^https?:\/\//.test(item.url || '')).slice(0, 3).entries()) {
        buttons.push(new ButtonBuilder()
            .setLabel(`\uc6d0\ubb38 ${index + 1}`)
            .setStyle(ButtonStyle.Link)
            .setURL(item.url));
    }

    return {
        content: lines.join('\n').slice(0, 1950),
        components: [new ActionRowBuilder().addComponents(buttons)]
    };
}

function createEndAdenaReviewCommand({
    MessageFlags,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    moment,
    timezone,
    payrollOperationLogService,
    endAdenaReconciliationService,
    getShiftBounds = null,
    getNow = () => moment().tz(timezone),
    canRun,
    writeAdminActionLog = async () => {}
}) {
    if (!MessageFlags || !ActionRowBuilder || !ButtonBuilder || !ButtonStyle) throw new TypeError('Discord builders must be provided');
    if (!moment || !timezone) throw new TypeError('moment and timezone must be provided');
    if (typeof payrollOperationLogService?.listRecent !== 'function') throw new TypeError('payrollOperationLogService.listRecent must be a function');
    if (typeof endAdenaReconciliationService?.run !== 'function') throw new TypeError('endAdenaReconciliationService.run must be a function');
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');

    const builders = { ActionRowBuilder, ButtonBuilder, ButtonStyle };

    async function inspect(options = {}) {
        const logs = await payrollOperationLogService.listRecent({ limit: 10_000 });
        const now = moment(getNow()).tz(timezone);
        const quality7d = summarizeEndAdenaQuality(logs, { now, days: 7 });
        const base = { ...selectEndAdenaReview(logs, options), quality7d };
        let shift = base.shift || null;
        let bounds = base.found
            ? { start: moment(base.shiftStartAt).tz(timezone), end: moment(base.shiftEndAt).tz(timezone) }
            : null;
        let settlement = null;
        if (!bounds && options.shift && Number.isFinite(Number(options.startMs)) && Number.isFinite(Number(options.endMs))) {
            shift = String(options.shift).toUpperCase();
            bounds = { start: moment(Number(options.startMs)).tz(timezone), end: moment(Number(options.endMs)).tz(timezone) };
        }
        if (bounds && typeof endAdenaReconciliationService.getSettlementWindow === 'function') {
            settlement = endAdenaReconciliationService.getSettlementWindow({ shift, bounds, at: now });
        } else if (!bounds) {
            const current = selectCurrentSettlementWindow(
                now,
                getShiftBounds,
                typeof endAdenaReconciliationService.getSettlementWindow === 'function'
                    ? options => endAdenaReconciliationService.getSettlementWindow(options)
                    : null
            );
            if (current) ({ shift, bounds, settlement } = current);
        }
        if (!bounds || !shift) return base;

        const activeOvertime = Boolean(settlement?.activeOvertime);
        const calculatedDeadlineAt = activeOvertime ? null : (settlement?.deadlineAt || base.settlementDeadlineAt || bounds.end.clone().add(60, 'minutes').toISOString());
        const calculatedWorkEndAt = activeOvertime ? null : (settlement?.workEndAt || base.workEndAt || bounds.end.toISOString());
        const phase = settlementPhase(now, bounds, { ...settlement, activeOvertime, deadlineAt: calculatedDeadlineAt });
        const settlementPending = activeOvertime || ['working', 'pre-shift'].includes(phase);
        const deadlineAt = settlementPending ? null : calculatedDeadlineAt;
        const workEndAt = settlementPending ? null : calculatedWorkEndAt;
        const hasReconciliation = Boolean(base.found);
        const reconcileEnabled = !activeOvertime && !['working', 'pre-shift', 'approval-window'].includes(phase) && (
            hasReconciliation ? !base.businessComplete : phase === 'overdue'
        );
        return {
            found: true,
            hasReconciliation,
            shift,
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString(),
            startMs: bounds.start.valueOf(),
            endMs: bounds.end.valueOf(),
            completedAt: base.completedAt || null,
            source: base.source || null,
            quality7d,
            businessComplete: hasReconciliation ? base.businessComplete : phase !== 'overdue',
            needsReview: base.needsReview || 0,
            expectedWorkersCount: base.expectedWorkersCount || 0,
            submittedCount: base.submittedCount || 0,
            approvedPostCount: base.approvedPostCount || 0,
            pending: base.pending || [],
            awaitingApproval: base.awaitingApproval || [],
            invalidSubmissions: base.invalidSubmissions || [],
            missing: base.missing || [],
            unexpected: base.unexpected || [],
            unexpectedPending: base.unexpectedPending || [],
            duplicates: base.duplicates || [],
            pendingDuplicates: base.pendingDuplicates || [],
            unresolved: base.unresolved || [],
            sheetMismatches: base.sheetMismatches || [],
            sheetRecordedCount: base.sheetRecordedCount || 0,
            repairFailures: base.repairFailures || [],
            settlementPhase: phase,
            activeOvertime,
            activeOvertimeCount: Number(settlement?.activeOvertimeCount || 0),
            activeOvertimeWorkers: settlement?.activeOvertimeWorkers || [],
            workEndAt,
            settlementDeadlineAt: deadlineAt,
            overtimeExtensionMinutes: Number(settlement?.extensionMinutes ?? base.overtimeExtensionMinutes ?? 0),
            reconcileEnabled
        };
    }

    async function audit(action, interaction, snapshot, extra = []) {
        return writeAdminActionLog(action, interaction.member, null, [
            snapshot?.shift ? `shift=${snapshot.shift}` : null,
            snapshot?.shiftStartAt ? `shiftStartAt=${snapshot.shiftStartAt}` : null,
            snapshot?.shiftEndAt ? `shiftEndAt=${snapshot.shiftEndAt}` : null,
            `needsReview=${snapshot?.needsReview || 0}`,
            ...extra
        ].filter(Boolean)).catch(() => null);
    }

    async function execute(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) {
            return interaction.reply({ content: '\uad8c\ud55c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;
        const snapshot = await inspect();
        await audit('END_ADENA_REVIEW_OPEN', interaction, snapshot);
        return interaction.editReply(renderReviewPayload(snapshot, builders));
    }

    async function handleButton(interaction) {
        const parsed = parseCustomId(interaction.customId);
        if (!parsed) return false;
        if (!canRun(interaction.member)) {
            return interaction.reply({ content: '\uad8c\ud55c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.', flags: MessageFlags.Ephemeral });
        }
        await interaction.deferUpdate();
        let snapshot = await inspect(parsed);
        if (parsed.action === 'reconcile') {
            const bounds = {
                start: moment(parsed.startMs).tz(timezone),
                end: moment(parsed.endMs).tz(timezone)
            };
            const result = await endAdenaReconciliationService.run({
                shift: parsed.shift,
                bounds,
                at: moment().tz(timezone),
                guild: interaction.guild,
                source: 'admin-review'
            });
            snapshot = await inspect(parsed);
            await audit('END_ADENA_REVIEW_RECONCILE', interaction, snapshot, [
                `technicalOk=${Boolean(result?.ok)}`,
                `businessComplete=${Boolean(result?.businessComplete)}`
            ]);
        } else {
            await audit('END_ADENA_REVIEW_REFRESH', interaction, snapshot);
        }
        return interaction.editReply(renderReviewPayload(snapshot, builders));
    }

    return {
        aliases: ['\uc5d4\ub4dc\uc544\ub370\ub098\ud655\uc778', 'end-adena-review'],
        execute,
        handleButton,
        isButton: customId => Boolean(parseCustomId(customId))
    };
}

module.exports = {
    CUSTOM_ID_PREFIX,
    reviewCount,
    isBusinessComplete,
    settlementPhase,
    selectCurrentSettlementWindow,
    selectEndAdenaReview,
    buildCustomId,
    parseCustomId,
    renderReviewPayload,
    createEndAdenaReviewCommand
};
