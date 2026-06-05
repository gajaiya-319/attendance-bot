'use strict';

const HEARTBEAT_ATTENDANCE_MS = Number(process.env.HEARTBEAT_ATTENDANCE_MS || 60_000);
const HEARTBEAT_MAINTENANCE_MS = Number(process.env.HEARTBEAT_MAINTENANCE_MS || 300_000);

function createClientReadyHandler({
    CONFIG,
    REST,
    Routes,
    client,
    cron,
    setIntervalFn = setInterval,
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
    autoAssignGuestForUnassignedMembers,
    syncWorkingRoles,
    syncCurrentWorkerProfiles = async () => {},
    syncLiveThreeDayPayrollSummary = null,
    syncPayrollReactionStatuses = null,
    createScheduledBackupIfDue,
    syncAutoPanels,
    processOpsQueueAutoRetry = async () => {},
    checkOperationalIssues = async () => {},
    expireDayOffSessions,
    cleanupOldDayOffReservations,
    saveSystem,
    renderDashboard,
    performSmartReset,
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
    if (typeof buildCommandDefinitions !== 'function') throw new TypeError('buildCommandDefinitions must be a function');
    if (!hiddenCommandAliases || typeof hiddenCommandAliases.has !== 'function') throw new TypeError('hiddenCommandAliases.has must be a function');
    if (typeof validateCommandPayloads !== 'function') throw new TypeError('validateCommandPayloads must be a function');
    if (typeof formatDiscordRestError !== 'function') throw new TypeError('formatDiscordRestError must be a function');
    if (typeof writeRuntimeHealthFile !== 'function') throw new TypeError('writeRuntimeHealthFile must be a function');
    if (typeof refreshGuildMembers !== 'function') throw new TypeError('refreshGuildMembers must be a function');
    if (typeof syncCurrentWorkerProfiles !== 'function') throw new TypeError('syncCurrentWorkerProfiles must be a function');
    if (typeof processOpsQueueAutoRetry !== 'function') throw new TypeError('processOpsQueueAutoRetry must be a function');
    if (typeof checkOperationalIssues !== 'function') throw new TypeError('checkOperationalIssues must be a function');
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
        await runTick('maintenance', isRunningRef, [
            () => createScheduledBackupIfDue(),
            () => syncAutoPanels(),
            () => typeof syncPayrollReactionStatuses === 'function' ? syncPayrollReactionStatuses() : null,
            () => processOpsQueueAutoRetry(guild()),
            () => checkOperationalIssues(guild()),
            async () => {
                const housekeepingChanged = expireDayOffSessions() || cleanupOldDayOffReservations();
                if (housekeepingChanged) await saveSystem();
            }
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

        logger.log?.(
            `[HEARTBEAT] attendance ${HEARTBEAT_ATTENDANCE_MS / 1000}s · maintenance ${HEARTBEAT_MAINTENANCE_MS / 1000}s`
        );
        setIntervalFn(() => runAttendanceHeartbeatTick(attendanceRunning), HEARTBEAT_ATTENDANCE_MS);
        setIntervalFn(() => runMaintenanceHeartbeatTick(maintenanceRunning), HEARTBEAT_MAINTENANCE_MS);

        cron.schedule('30 21 * * 0,1,3,4,5,6', () => performSmartReset('day'), { timezone: CONFIG.TIMEZONE });
        cron.schedule('30 19 * * 2', () => performSmartReset('day'), { timezone: CONFIG.TIMEZONE });
        cron.schedule('30 9 * * 0,1,2,4,5,6', () => performSmartReset('night'), { timezone: CONFIG.TIMEZONE });
        cron.schedule('30 4 * * 3', () => performSmartReset('night'), { timezone: CONFIG.TIMEZONE });

        if (typeof syncLiveThreeDayPayrollSummary === 'function') {
            cron.schedule('*/1 * * * *', () => {
                syncLiveThreeDayPayrollSummary().catch(error => {
                    logger.warn?.('[PAYROLL LIVE SYNC CRON]', error?.message || error);
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
        syncCurrentWorkerProfiles(fetchedGuild).catch(error => {
            logger.log?.(`[CURRENT WORKER PROFILE BOOTSTRAP SKIP] ${error?.code || error?.message || 'unknown'}`);
        });

        registerSchedules();
        if (typeof syncLiveThreeDayPayrollSummary === 'function') {
            syncLiveThreeDayPayrollSummary().catch(error => {
                logger.warn?.('[PAYROLL LIVE SYNC BOOT]', error?.message || error);
            });
        }
        if (typeof syncPayrollReactionStatuses === 'function') {
            await syncPayrollReactionStatuses().catch(error => {
                logger.warn?.('[PAYROLL STATUS SYNC BOOT]', error?.message || error);
            });
        }
        await writeRuntimeHealthFile('client-ready-complete');
        printStartupBanner();
    };
}

module.exports = {
    createClientReadyHandler,
    HEARTBEAT_ATTENDANCE_MS,
    HEARTBEAT_MAINTENANCE_MS
};
