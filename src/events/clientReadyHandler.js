'use strict';

const HEARTBEAT_ATTENDANCE_MS = Number(process.env.HEARTBEAT_ATTENDANCE_MS || 60_000);
const HEARTBEAT_MAINTENANCE_MS = Number(process.env.HEARTBEAT_MAINTENANCE_MS || 300_000);

function collectDueEndAdenaCloseReadiness(now, getShiftBounds, completedKeys = new Set()) {
    if (!now?.clone || typeof getShiftBounds !== 'function') return [];
    const due = [];
    for (const shift of ['day', 'night']) {
        const bounds = getShiftBounds(shift, now);
        if (!bounds?.start?.clone || !bounds?.end?.clone) continue;
        const readinessAt = bounds.end.clone().subtract(20, 'minutes');
        const reportUntil = bounds.end.clone().subtract(10, 'minutes');
        const key = `${shift}:${bounds.end.toISOString()}`;
        if (now.isBefore(readinessAt) || !now.isBefore(reportUntil) || completedKeys.has(key)) continue;
        due.push({
            shift: shift.toUpperCase(),
            key,
            readinessAt: readinessAt.toISOString(),
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString(),
            bounds
        });
    }
    return due;
}

function collectDueEndAdenaSummaryResets(now, getShiftBounds, completedKeys = new Set()) {
    if (!now?.clone || typeof getShiftBounds !== 'function') return [];
    const currentMinute = now.format('YYYY-MM-DD HH:mm');
    const due = [];
    for (const shift of ['day', 'night']) {
        const bounds = getShiftBounds(shift, now);
        if (!bounds?.end?.clone) continue;
        const resetAt = bounds.end.clone().subtract(10, 'minutes');
        const key = `${shift}:${bounds.end.toISOString()}`;
        if (resetAt.format('YYYY-MM-DD HH:mm') !== currentMinute || completedKeys.has(key)) continue;
        due.push({
            shift: shift.toUpperCase(),
            key,
            resetAt: resetAt.toISOString(),
            shiftStartAt: bounds.start?.toISOString?.() || null,
            shiftEndAt: bounds.end.toISOString(),
            bounds
        });
    }
    return due;
}

function collectRecentEndAdenaShiftWindows(now, getShiftBounds, lookbackHours = 24) {
    const windows = new Map();
    for (let hours = 0; hours <= lookbackHours; hours += 6) {
        const reference = now.clone().subtract(hours, 'hours');
        for (const shift of ['day', 'night']) {
            const bounds = getShiftBounds(shift, reference);
            if (!bounds?.start?.clone || !bounds?.end?.clone) continue;
            windows.set(`${shift}:${bounds.end.toISOString()}`, { shift, bounds });
        }
    }
    return [...windows.values()];
}

function resolveSettlementDeadline(now, shift, bounds, resolveEndAdenaSettlementWindow) {
    const fallback = bounds.end.clone().add(60, 'minutes');
    if (typeof resolveEndAdenaSettlementWindow !== 'function') {
        return { deadline: fallback, settlement: null };
    }
    const settlement = resolveEndAdenaSettlementWindow({ shift: shift.toUpperCase(), bounds, at: now });
    if (!settlement) return { deadline: fallback, settlement: null };
    if (settlement.activeOvertime || !settlement.deadlineAt) return { deadline: null, settlement };
    const deadlineMs = Date.parse(settlement.deadlineAt);
    if (!Number.isFinite(deadlineMs)) return { deadline: fallback, settlement };
    return {
        deadline: bounds.end.clone().add(deadlineMs - bounds.end.valueOf(), 'milliseconds'),
        settlement
    };
}

function collectDueEndAdenaReconciliations(
    now,
    getShiftBounds,
    completedKeys = new Set(),
    resolveEndAdenaSettlementWindow = null
) {
    if (!now?.clone || typeof getShiftBounds !== 'function') return [];
    const due = [];
    for (const { shift, bounds } of collectRecentEndAdenaShiftWindows(now, getShiftBounds)) {
        const { deadline: reconcileAt, settlement } = resolveSettlementDeadline(
            now,
            shift,
            bounds,
            resolveEndAdenaSettlementWindow
        );
        if (!reconcileAt) continue;
        const catchUpUntil = reconcileAt.clone().add(60, 'minutes');
        const key = `${shift}:${bounds.end.toISOString()}`;
        if (now.isBefore(reconcileAt) || !now.isBefore(catchUpUntil) || completedKeys.has(key)) continue;
        due.push({
            shift: shift.toUpperCase(),
            key,
            reconcileAt: reconcileAt.toISOString(),
            settlement,
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString(),
            bounds
        });
    }
    return due;
}

function collectDueEndAdenaApprovalReminders(
    now,
    getShiftBounds,
    completedKeys = new Set(),
    resolveEndAdenaSettlementWindow = null
) {
    if (!now?.clone || typeof getShiftBounds !== 'function') return [];
    const due = [];
    for (const { shift, bounds } of collectRecentEndAdenaShiftWindows(now, getShiftBounds)) {
        const { deadline, settlement } = resolveSettlementDeadline(
            now,
            shift,
            bounds,
            resolveEndAdenaSettlementWindow
        );
        if (!deadline) continue;
        const remindAt = deadline.clone().subtract(15, 'minutes');
        const remindUntil = deadline;
        const key = `${shift}:${bounds.end.toISOString()}`;
        if (now.isBefore(remindAt) || !now.isBefore(remindUntil) || completedKeys.has(key)) continue;
        due.push({
            shift: shift.toUpperCase(),
            key,
            remindAt: remindAt.toISOString(),
            settlement,
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString(),
            bounds
        });
    }
    return due;
}

function collectDueEndAdenaApprovalDeadlineWarnings(
    now,
    getShiftBounds,
    completedKeys = new Set(),
    resolveEndAdenaSettlementWindow = null
) {
    if (!now?.clone || typeof getShiftBounds !== 'function') return [];
    const due = [];
    for (const { shift, bounds } of collectRecentEndAdenaShiftWindows(now, getShiftBounds)) {
        const { deadline, settlement } = resolveSettlementDeadline(
            now,
            shift,
            bounds,
            resolveEndAdenaSettlementWindow
        );
        if (!deadline) continue;
        const warnAt = deadline.clone().subtract(5, 'minutes');
        const warnUntil = deadline;
        const key = `${shift}:${bounds.end.toISOString()}`;
        if (now.isBefore(warnAt) || !now.isBefore(warnUntil) || completedKeys.has(key)) continue;
        due.push({
            shift: shift.toUpperCase(),
            key,
            warnAt: warnAt.toISOString(),
            deadlineAt: warnUntil.toISOString(),
            settlement,
            shiftStartAt: bounds.start.toISOString(),
            shiftEndAt: bounds.end.toISOString(),
            bounds
        });
    }
    return due;
}

function createClientReadyHandler({
    CONFIG,
    REST,
    Routes,
    client,
    cron,
    setIntervalFn = setInterval,
    waitFn = ms => new Promise(resolve => setTimeout(resolve, ms)),
    getNow = null,
    getShiftBounds = null,
    token,
    buildCommandDefinitions,
    hiddenCommandAliases,
    validateCommandPayloads,
    formatDiscordRestError,
    writeRuntimeHealthFile,
    refreshGuildMembers,
    syncVoiceStates,
    reconcileAttendanceMembership,
    checkGracePeriods,
    autoOvertimeCheck,
    checkLiveExceptions,
    checkScheduledAnnouncements,
    checkDayOffReservations,
    reconcileRecentDayOffMessages = async () => {},
    autoAssignGuestForUnassignedMembers,
    syncWorkingRoles,
    syncCurrentWorkerProfiles = async () => {},
    backgroundJobQueueService = null,
    syncLiveThreeDayPayrollSummary = null,
    syncPayrollReactionStatuses = null,
    sendDailyCloseReport = null,
    createScheduledBackupIfDue,
    syncAutoPanels,
    processOpsQueueAutoRetry = async () => {},
    checkOperationalIssues = async () => {},
    runAutoAuditRepair = null,
    expireDayOffSessions,
    cleanupOldDayOffReservations,
    saveSystem,
    renderDashboard,
    performSmartReset,
    reportEndAdenaCloseReadiness = null,
    resetEndAdenaSummary = null,
    remindPendingEndAdenaApprovals = null,
    reconcileEndAdenaSummary = null,
    resolveEndAdenaSettlementWindow = null,
    recoverLateEndAdenaApprovals = null,
    auditEndAdenaFreshness = null,
    printStartupBanner,
    getNowLabel,
    setCommandRegisterOk,
    setCommandRegisterError,
    loadSystem,
    logger = console
}) {
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (typeof REST !== 'function') throw new TypeError('REST must be a constructor');
    if (!Routes) throw new TypeError('Routes must be provided');
    if (!client) throw new TypeError('client must be provided');
    if (!cron || typeof cron.schedule !== 'function') throw new TypeError('cron.schedule must be a function');
    if (typeof setIntervalFn !== 'function') throw new TypeError('setIntervalFn must be a function');
    if (typeof waitFn !== 'function') throw new TypeError('waitFn must be a function');
    if (getNow !== null && typeof getNow !== 'function') throw new TypeError('getNow must be a function');
    if (getShiftBounds !== null && typeof getShiftBounds !== 'function') throw new TypeError('getShiftBounds must be a function');
    if (typeof buildCommandDefinitions !== 'function') throw new TypeError('buildCommandDefinitions must be a function');
    if (!hiddenCommandAliases || typeof hiddenCommandAliases.has !== 'function') throw new TypeError('hiddenCommandAliases.has must be a function');
    if (typeof validateCommandPayloads !== 'function') throw new TypeError('validateCommandPayloads must be a function');
    if (typeof formatDiscordRestError !== 'function') throw new TypeError('formatDiscordRestError must be a function');
    if (typeof writeRuntimeHealthFile !== 'function') throw new TypeError('writeRuntimeHealthFile must be a function');
    if (typeof refreshGuildMembers !== 'function') throw new TypeError('refreshGuildMembers must be a function');
    if (typeof syncCurrentWorkerProfiles !== 'function') throw new TypeError('syncCurrentWorkerProfiles must be a function');
    if (typeof processOpsQueueAutoRetry !== 'function') throw new TypeError('processOpsQueueAutoRetry must be a function');
    if (typeof checkOperationalIssues !== 'function') throw new TypeError('checkOperationalIssues must be a function');
    if (runAutoAuditRepair !== null && typeof runAutoAuditRepair !== 'function') throw new TypeError('runAutoAuditRepair must be a function');
    if (reportEndAdenaCloseReadiness !== null && typeof reportEndAdenaCloseReadiness !== 'function') throw new TypeError('reportEndAdenaCloseReadiness must be a function');
    if (resetEndAdenaSummary !== null && typeof resetEndAdenaSummary !== 'function') throw new TypeError('resetEndAdenaSummary must be a function');
    if (remindPendingEndAdenaApprovals !== null && typeof remindPendingEndAdenaApprovals !== 'function') throw new TypeError('remindPendingEndAdenaApprovals must be a function');
    if (reconcileEndAdenaSummary !== null && typeof reconcileEndAdenaSummary !== 'function') throw new TypeError('reconcileEndAdenaSummary must be a function');
    if (resolveEndAdenaSettlementWindow !== null && typeof resolveEndAdenaSettlementWindow !== 'function') throw new TypeError('resolveEndAdenaSettlementWindow must be a function');
    if (recoverLateEndAdenaApprovals !== null && typeof recoverLateEndAdenaApprovals !== 'function') throw new TypeError('recoverLateEndAdenaApprovals must be a function');
    if (auditEndAdenaFreshness !== null && typeof auditEndAdenaFreshness !== 'function') throw new TypeError('auditEndAdenaFreshness must be a function');
    if (typeof loadSystem !== 'function') throw new TypeError('loadSystem must be a function');

    async function runTick(label, isRunningRef, steps) {
        if (isRunningRef.value) {
            logger.warn?.(`[HEARTBEAT WARN] ${label}: previous tick still running, skipping.`);
            return;
        }
        isRunningRef.value = true;
        try {
            for (const step of steps) {
                await step();
            }
        } catch (error) {
            logger.error?.(`[HEARTBEAT ERROR] ${label}`, error);
        } finally {
            isRunningRef.value = false;
        }
    }

    function guild() {
        return client.guilds.cache.get(CONFIG.GUILD_ID);
    }

    function scheduleBackgroundJob(key, task, { priority = 0, timeoutMs = 60_000 } = {}) {
        if (typeof backgroundJobQueueService?.enqueue === 'function') {
            return backgroundJobQueueService.enqueue({ key, task, priority, timeoutMs });
        }
        return task();
    }

    async function runAttendanceHeartbeatTick(isRunningRef) {
        await runTick('attendance', isRunningRef, [
            () => syncVoiceStates(),
            () => reconcileAttendanceMembership(guild()),
            () => checkGracePeriods(),
            () => autoOvertimeCheck(),
            () => checkLiveExceptions(),
            () => checkScheduledAnnouncements(),
            () => checkDayOffReservations(),
            () => autoAssignGuestForUnassignedMembers(guild()),
            () => syncWorkingRoles(),
            () => renderDashboard({ reconcileSession: true })
        ]);
    }

    async function runMaintenanceHeartbeatTick(isRunningRef) {
        const autoAuditStep = typeof runAutoAuditRepair === 'function'
            ? () => scheduleBackgroundJob('maintenance-auto-audit', () => runAutoAuditRepair(guild()), {
                priority: 40,
                timeoutMs: 120_000
            })
            : async () => {
                scheduleBackgroundJob('maintenance-ops-retry', () => processOpsQueueAutoRetry(guild()), {
                    priority: 45,
                    timeoutMs: 90_000
                });
                scheduleBackgroundJob('maintenance-ops-check', () => checkOperationalIssues(guild()), {
                    priority: 40,
                    timeoutMs: 120_000
                });
            };

        await runTick('maintenance', isRunningRef, [
            () => scheduleBackgroundJob('maintenance-backup', () => createScheduledBackupIfDue(), {
                priority: 100,
                timeoutMs: 30_000
            }),
            () => scheduleBackgroundJob('maintenance-auto-panels', () => syncAutoPanels(), {
                priority: 70,
                timeoutMs: 45_000
            }),
            () => scheduleBackgroundJob('maintenance-dayoff-reconcile', () => reconcileRecentDayOffMessages(), {
                priority: 65,
                timeoutMs: 60_000
            }),
            () => scheduleBackgroundJob('maintenance-member-refresh', () => refreshGuildMembers(guild(), { force: true }), {
                priority: 80,
                timeoutMs: 90_000
            }),
            () => scheduleBackgroundJob('maintenance-worker-profiles', () => syncCurrentWorkerProfiles(guild()), {
                priority: 60,
                timeoutMs: 90_000
            }),
            () => typeof syncPayrollReactionStatuses === 'function'
                ? scheduleBackgroundJob('maintenance-payroll-status', () => syncPayrollReactionStatuses(), {
                    priority: 55,
                    timeoutMs: 120_000
                })
                : null,
            () => typeof recoverLateEndAdenaApprovals === 'function'
                ? scheduleBackgroundJob('maintenance-end-adena-late-recovery', () => recoverLateEndAdenaApprovals(), {
                    priority: 58,
                    timeoutMs: 180_000
                })
                : null,
            () => typeof auditEndAdenaFreshness === 'function'
                ? scheduleBackgroundJob('maintenance-end-adena-freshness', () => auditEndAdenaFreshness(), {
                    priority: 59,
                    timeoutMs: 180_000
                })
                : null,
            autoAuditStep,
            () => scheduleBackgroundJob('maintenance-housekeeping', async () => {
                const housekeepingChanged = expireDayOffSessions() || cleanupOldDayOffReservations();
                if (housekeepingChanged) await saveSystem();
                if (typeof backgroundJobQueueService?.getStats === 'function') {
                    await writeRuntimeHealthFile('running', {
                        backgroundQueue: backgroundJobQueueService.getStats()
                    });
                }
            }, { priority: 90, timeoutMs: 30_000 })
        ]);
    }

    async function registerCommands() {
        const rest = new REST({ version: '10' }).setToken(token);
        const commandList = buildCommandDefinitions();
        const visibleCommandList = commandList
            .filter(command => !hiddenCommandAliases.has(command.name))
            .map(command => command.toJSON());
        const commandIssues = validateCommandPayloads(visibleCommandList);

        try {
            if (commandIssues.length) {
                const message = commandIssues.join(' | ');
                setCommandRegisterError(message);
                logger.error?.('[COMMAND VALIDATION ERROR]\n' + commandIssues.join('\n'));
            } else {
                await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
                await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: visibleCommandList });
                setCommandRegisterOk({
                    at: getNowLabel(),
                    count: visibleCommandList.length
                });
                logger.log?.(`[COMMAND REGISTER] Registered ${visibleCommandList.length} guild commands.`);
                await writeRuntimeHealthFile('command-register-ok');
            }
        } catch (error) {
            const formatted = formatDiscordRestError(error, visibleCommandList);
            setCommandRegisterError(formatted);
            logger.error?.('[REST ERROR]\n' + formatted);
            await writeRuntimeHealthFile('command-register-error');
        }
    }

    function registerSchedules() {
        const attendanceRunning = { value: false };
        const maintenanceRunning = { value: false };
        const completedEndAdenaReadinessKeys = new Set();
        const completedEndAdenaResetKeys = new Set();
        const completedEndAdenaApprovalReminderKeys = new Set();
        const completedEndAdenaApprovalDeadlineWarningKeys = new Set();
        const completedEndAdenaReconciliationKeys = new Set();

        logger.log?.(
            `[HEARTBEAT] attendance ${HEARTBEAT_ATTENDANCE_MS / 1000}s · maintenance ${HEARTBEAT_MAINTENANCE_MS / 1000}s`
        );
        setIntervalFn(() => runAttendanceHeartbeatTick(attendanceRunning), HEARTBEAT_ATTENDANCE_MS);
        setIntervalFn(() => runMaintenanceHeartbeatTick(maintenanceRunning), HEARTBEAT_MAINTENANCE_MS);

        cron.schedule('30 21 * * 0,1,3,4,5,6', () => scheduleBackgroundJob('smart-reset-day', () => performSmartReset('day'), { priority: 100, timeoutMs: 120_000 }), { timezone: CONFIG.TIMEZONE });
        cron.schedule('30 19 * * 2', () => scheduleBackgroundJob('smart-reset-day', () => performSmartReset('day'), { priority: 100, timeoutMs: 120_000 }), { timezone: CONFIG.TIMEZONE });
        cron.schedule('30 9 * * 0,1,2,4,5,6', () => scheduleBackgroundJob('smart-reset-night', () => performSmartReset('night'), { priority: 100, timeoutMs: 120_000 }), { timezone: CONFIG.TIMEZONE });
        cron.schedule('30 4 * * 3', () => scheduleBackgroundJob('smart-reset-night', () => performSmartReset('night'), { priority: 100, timeoutMs: 120_000 }), { timezone: CONFIG.TIMEZONE });

        if (
            (
                typeof reportEndAdenaCloseReadiness === 'function' ||
                typeof resetEndAdenaSummary === 'function' ||
                typeof remindPendingEndAdenaApprovals === 'function' ||
                typeof reconcileEndAdenaSummary === 'function'
            ) &&
            typeof getNow === 'function' &&
            typeof getShiftBounds === 'function'
        ) {
            cron.schedule('5 * * * * *', async () => {
                const now = getNow();
                const jobs = [];
                const dueReadinessReports = typeof reportEndAdenaCloseReadiness === 'function'
                    ? collectDueEndAdenaCloseReadiness(now, getShiftBounds, completedEndAdenaReadinessKeys)
                    : [];
                for (const due of dueReadinessReports) {
                    completedEndAdenaReadinessKeys.add(due.key);
                    while (completedEndAdenaReadinessKeys.size > 32) {
                        completedEndAdenaReadinessKeys.delete(completedEndAdenaReadinessKeys.values().next().value);
                    }
                    jobs.push(scheduleBackgroundJob(
                        `end-adena-close-readiness-${due.shift.toLowerCase()}`,
                        async () => {
                            const result = await reportEndAdenaCloseReadiness({
                                shift: due.shift,
                                bounds: due.bounds,
                                at: now.clone()
                            });
                            if (!result?.ok) {
                                completedEndAdenaReadinessKeys.delete(due.key);
                                throw new Error(`End Adena readiness report failed for ${due.shift}: ${result?.code || 'unknown'}`);
                            }
                            logger.log?.('[END ADENA CLOSE READINESS]', {
                                shift: due.shift,
                                shiftEndAt: due.shiftEndAt,
                                approved: result.approved?.length || 0,
                                awaitingApproval: result.awaitingApproval?.length || 0,
                                missing: result.missing?.length || 0,
                                notWorking: result.notWorking?.length || 0,
                                needsReview: result.needsReview || 0,
                                skipped: Boolean(result.skipped)
                            });
                            return result;
                        },
                        { priority: 99, timeoutMs: 120_000 }
                    ));
                }
                const dueResets = typeof resetEndAdenaSummary === 'function'
                    ? collectDueEndAdenaSummaryResets(now, getShiftBounds, completedEndAdenaResetKeys)
                    : [];
                for (const due of dueResets) {
                    completedEndAdenaResetKeys.add(due.key);
                    while (completedEndAdenaResetKeys.size > 32) {
                        completedEndAdenaResetKeys.delete(completedEndAdenaResetKeys.values().next().value);
                    }
                    jobs.push(scheduleBackgroundJob(
                        `end-adena-summary-reset-${due.shift.toLowerCase()}`,
                        async () => {
                            let result = null;
                            for (let attempt = 1; attempt <= 3; attempt += 1) {
                                result = await resetEndAdenaSummary(due.shift, due);
                                if (result?.ok) {
                                    logger.log?.('[END ADENA SUMMARY RESET]', { ...due, attempt, ...result });
                                    return result;
                                }
                                if (attempt < 3) {
                                    logger.warn?.('[END ADENA SUMMARY RESET RETRY]', {
                                        shift: due.shift,
                                        attempt,
                                        nextAttempt: attempt + 1
                                    });
                                    await waitFn(attempt * 10_000);
                                }
                            }
                            const failed = (result?.results || [])
                                .filter(item => !item.ok)
                                .map(item => `${item.server || 'unknown'}:${item.code || 'unknown'}`)
                                .join(', ');
                            throw new Error(`End Adena summary reset failed for ${due.shift}${failed ? ` (${failed})` : ''}`);
                        },
                        { priority: 98, timeoutMs: 120_000 }
                    ));
                }
                const dueReminders = typeof remindPendingEndAdenaApprovals === 'function'
                    ? collectDueEndAdenaApprovalReminders(
                        now,
                        getShiftBounds,
                        completedEndAdenaApprovalReminderKeys,
                        resolveEndAdenaSettlementWindow
                    )
                    : [];
                for (const due of dueReminders) {
                    completedEndAdenaApprovalReminderKeys.add(due.key);
                    while (completedEndAdenaApprovalReminderKeys.size > 32) {
                        completedEndAdenaApprovalReminderKeys.delete(completedEndAdenaApprovalReminderKeys.values().next().value);
                    }
                    jobs.push(scheduleBackgroundJob(
                        `end-adena-approval-reminder-${due.shift.toLowerCase()}`,
                        () => remindPendingEndAdenaApprovals({
                            shift: due.shift,
                            bounds: due.bounds,
                            at: now.clone(),
                            settlement: due.settlement || null
                        }),
                        { priority: 97, timeoutMs: 120_000 }
                    ));
                }
                const dueDeadlineWarnings = typeof remindPendingEndAdenaApprovals === 'function'
                    ? collectDueEndAdenaApprovalDeadlineWarnings(
                        now,
                        getShiftBounds,
                        completedEndAdenaApprovalDeadlineWarningKeys,
                        resolveEndAdenaSettlementWindow
                    )
                    : [];
                for (const due of dueDeadlineWarnings) {
                    completedEndAdenaApprovalDeadlineWarningKeys.add(due.key);
                    while (completedEndAdenaApprovalDeadlineWarningKeys.size > 32) {
                        completedEndAdenaApprovalDeadlineWarningKeys.delete(completedEndAdenaApprovalDeadlineWarningKeys.values().next().value);
                    }
                    jobs.push(scheduleBackgroundJob(
                        `end-adena-approval-deadline-warning-${due.shift.toLowerCase()}`,
                        () => remindPendingEndAdenaApprovals({
                            shift: due.shift,
                            bounds: due.bounds,
                            at: now.clone(),
                            urgent: true,
                            settlement: due.settlement || null
                        }),
                        { priority: 99, timeoutMs: 120_000 }
                    ));
                }
                const dueReconciliations = typeof reconcileEndAdenaSummary === 'function'
                    ? collectDueEndAdenaReconciliations(
                        now,
                        getShiftBounds,
                        completedEndAdenaReconciliationKeys,
                        resolveEndAdenaSettlementWindow
                    )
                    : [];
                for (const due of dueReconciliations) {
                    completedEndAdenaReconciliationKeys.add(due.key);
                    while (completedEndAdenaReconciliationKeys.size > 32) {
                        completedEndAdenaReconciliationKeys.delete(completedEndAdenaReconciliationKeys.values().next().value);
                    }
                    jobs.push(scheduleBackgroundJob(
                        `end-adena-reconciliation-${due.shift.toLowerCase()}`,
                        async () => {
                            const result = await reconcileEndAdenaSummary({
                                shift: due.shift,
                                bounds: due.bounds,
                                at: now.clone(),
                                settlement: due.settlement || null
                            });
                            if (!result?.ok) {
                                throw new Error(`End Adena reconciliation failed for ${due.shift}: ${result?.code || 'repair-failed'}`);
                            }
                            logger.log?.('[END ADENA RECONCILIATION]', {
                                shift: due.shift,
                                shiftEndAt: due.shiftEndAt,
                                submitted: result.submitted?.length || 0,
                                missing: result.missing?.length || 0,
                                corrected: result.repair?.corrected || 0,
                                needsReview: result.needsReview || 0
                            });
                            return result;
                        },
                        { priority: 97, timeoutMs: 180_000 }
                    ));
                }
                await Promise.all(jobs);
            }, { timezone: CONFIG.TIMEZONE });
        }

        if (typeof sendDailyCloseReport === 'function') {
            cron.schedule('25 21 * * 0,1,3,4,5,6', () => scheduleBackgroundJob(
                'daily-close-day',
                () => sendDailyCloseReport('day'),
                { priority: 95, timeoutMs: 120_000 }
            ), { timezone: CONFIG.TIMEZONE });
            cron.schedule('25 19 * * 2', () => scheduleBackgroundJob(
                'daily-close-day',
                () => sendDailyCloseReport('day'),
                { priority: 95, timeoutMs: 120_000 }
            ), { timezone: CONFIG.TIMEZONE });
            cron.schedule('25 9 * * 0,1,2,4,5,6', () => scheduleBackgroundJob(
                'daily-close-night',
                () => sendDailyCloseReport('night'),
                { priority: 95, timeoutMs: 120_000 }
            ), { timezone: CONFIG.TIMEZONE });
            cron.schedule('25 4 * * 3', () => scheduleBackgroundJob(
                'daily-close-night',
                () => sendDailyCloseReport('night'),
                { priority: 95, timeoutMs: 120_000 }
            ), { timezone: CONFIG.TIMEZONE });
        }

        if (typeof syncLiveThreeDayPayrollSummary === 'function') {
            cron.schedule('35 * * * * *', () => {
                scheduleBackgroundJob('payroll-live-summary', () => syncLiveThreeDayPayrollSummary(), {
                    priority: 50,
                    timeoutMs: 90_000
                });
            }, { timezone: CONFIG.TIMEZONE });
        }
    }

    return async function handleClientReady() {
        await loadSystem();
        await writeRuntimeHealthFile('client-ready-start');
        await registerCommands();

        const fetchedGuild = await client.guilds.fetch(CONFIG.GUILD_ID);
        await refreshGuildMembers(fetchedGuild, { force: true });
        scheduleBackgroundJob('maintenance-worker-profiles', () => syncCurrentWorkerProfiles(fetchedGuild), {
            priority: 90,
            timeoutMs: 90_000
        });

        registerSchedules();
        if (typeof syncLiveThreeDayPayrollSummary === 'function') {
            scheduleBackgroundJob('payroll-live-summary', () => syncLiveThreeDayPayrollSummary(), {
                priority: 80,
                timeoutMs: 90_000
            });
        }
        if (typeof syncPayrollReactionStatuses === 'function') {
            scheduleBackgroundJob('maintenance-payroll-status', () => syncPayrollReactionStatuses(), {
                priority: 85,
                timeoutMs: 120_000
            });
        }
        scheduleBackgroundJob('maintenance-dayoff-reconcile', () => reconcileRecentDayOffMessages(), {
            priority: 80,
            timeoutMs: 60_000
        });
        if (typeof recoverLateEndAdenaApprovals === 'function') {
            scheduleBackgroundJob('maintenance-end-adena-late-recovery', () => recoverLateEndAdenaApprovals(), {
                priority: 82,
                timeoutMs: 180_000
            });
        }
        if (typeof auditEndAdenaFreshness === 'function') {
            scheduleBackgroundJob('maintenance-end-adena-freshness', () => auditEndAdenaFreshness(), {
                priority: 83,
                timeoutMs: 180_000
            });
        }
        await writeRuntimeHealthFile('client-ready-complete', {
            backgroundQueue: backgroundJobQueueService?.getStats?.() || null
        });
        printStartupBanner();
    };
}

module.exports = {
    createClientReadyHandler,
    collectDueEndAdenaCloseReadiness,
    collectDueEndAdenaSummaryResets,
    collectDueEndAdenaApprovalReminders,
    collectDueEndAdenaApprovalDeadlineWarnings,
    collectDueEndAdenaReconciliations,
    HEARTBEAT_ATTENDANCE_MS,
    HEARTBEAT_MAINTENANCE_MS
};
