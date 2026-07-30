const assert = require('assert');
const moment = require('moment-timezone');
const {
    createClientReadyHandler,
    collectDueEndAdenaCloseReadiness,
    collectDueEndAdenaSummaryResets,
    collectDueEndAdenaApprovalReminders,
    collectDueEndAdenaApprovalDeadlineWarnings,
    collectDueEndAdenaReconciliations
} = require('../src/events/clientReadyHandler');

function at(value) {
    return moment.tz(value, 'YYYY-MM-DD HH:mm', 'Asia/Manila');
}

class FakeRest {
    constructor(options) {
        this.options = options;
        FakeRest.instances.push(this);
    }

    setToken(token) {
        this.token = token;
        return this;
    }

    async put(route, payload) {
        this.puts.push({ route, payload });
    }
}
FakeRest.instances = [];
FakeRest.prototype.puts = [];

function createDeps(overrides = {}) {
    FakeRest.instances = [];
    FakeRest.prototype.puts = [];
    const calls = [];
    const guild = { id: 'guild1' };
    const intervalCallbacks = [];
    const cronSchedules = [];
    const command = {
        name: 'visible',
        toJSON: () => ({ name: 'visible' })
    };
    const hiddenCommand = {
        name: 'hidden',
        toJSON: () => ({ name: 'hidden' })
    };
    const deps = {
        CONFIG: { GUILD_ID: 'guild1', TIMEZONE: 'Asia/Seoul' },
        REST: FakeRest,
        Routes: {
            applicationCommands: appId => `app:${appId}`,
            applicationGuildCommands: (appId, guildId) => `guild:${appId}:${guildId}`
        },
        client: {
            user: { id: 'app1' },
            guilds: {
                cache: {
                    get: id => ({ id })
                },
                fetch: async id => {
                    calls.push(`fetchGuild:${id}`);
                    return guild;
                }
            }
        },
        cron: {
            schedule: (rule, fn, options) => {
                cronSchedules.push({ rule, fn, options });
                calls.push(`cron:${rule}:${options.timezone}`);
            }
        },
        setIntervalFn: (fn, ms) => {
            intervalCallbacks.push(fn);
            calls.push(`interval:${ms}`);
        },
        getNow: () => at(overrides.now || '2026-05-21 20:50'),
        getShiftBounds: overrides.getShiftBounds || (shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })),
        token: 'token1',
        buildCommandDefinitions: () => [command, hiddenCommand],
        hiddenCommandAliases: new Set(['hidden']),
        validateCommandPayloads: () => overrides.commandIssues || [],
        formatDiscordRestError: error => `formatted:${error.message}`,
        writeRuntimeHealthFile: async stage => calls.push(`health:${stage}`),
        refreshGuildMembers: async (receivedGuild, options) => calls.push(`refresh:${receivedGuild.id}:${Boolean(options.force)}`),
        syncCurrentWorkerProfiles: async receivedGuild => calls.push(`profiles:${receivedGuild.id}`),
        syncVoiceStates: async () => calls.push('syncVoice'),
        reconcileAttendanceMembership: async receivedGuild => calls.push(`reconcile:${receivedGuild.id}`),
        checkGracePeriods: async () => calls.push('grace'),
        autoOvertimeCheck: async () => calls.push('ot'),
        checkLiveExceptions: async () => calls.push('exceptions'),
        checkScheduledAnnouncements: async () => calls.push('announcements'),
        checkDayOffReservations: async () => calls.push('dayoff'),
        reconcileRecentDayOffMessages: async () => calls.push('dayoffReconcile'),
        autoAssignGuestForUnassignedMembers: async receivedGuild => calls.push(`guest:${receivedGuild.id}`),
        syncWorkingRoles: async () => calls.push('working'),
        createScheduledBackupIfDue: async () => calls.push('backup'),
        syncAutoPanels: async () => calls.push('panels'),
        processOpsQueueAutoRetry: async receivedGuild => calls.push(`queue:${receivedGuild.id}`),
        checkOperationalIssues: async receivedGuild => calls.push(`issues:${receivedGuild.id}`),
        expireDayOffSessions: () => {
            calls.push('expire');
            return overrides.expireChanged ?? false;
        },
        cleanupOldDayOffReservations: () => {
            calls.push('cleanup');
            return overrides.cleanupChanged ?? false;
        },
        saveSystem: async () => calls.push('save'),
        renderDashboard: async () => calls.push('render'),
        performSmartReset: shift => calls.push(`reset:${shift}`),
        reportEndAdenaCloseReadiness: async input => {
            calls.push(`adenaReadiness:${input.shift}`);
            return {
                ok: true,
                shift: input.shift,
                approved: [],
                awaitingApproval: [],
                missing: [],
                notWorking: [],
                needsReview: 0
            };
        },
        resetEndAdenaSummary: async shift => {
            calls.push(`adenaReset:${shift}`);
            return { ok: true, shift, results: [] };
        },
        remindPendingEndAdenaApprovals: async input => {
            calls.push(`${input.urgent ? 'adenaDeadline' : 'adenaReminder'}:${input.shift}`);
            return { ok: true, shift: input.shift, pending: [] };
        },
        reconcileEndAdenaSummary: async input => {
            calls.push(`adenaReconcile:${input.shift}`);
            return {
                ok: true,
                shift: input.shift,
                submitted: [],
                missing: [],
                repair: { corrected: 0 },
                needsReview: 0
            };
        },
        recoverLateEndAdenaApprovals: async () => {
            calls.push('adenaLateRecovery');
            return { ok: true, recovered: 0 };
        },
        auditEndAdenaFreshness: async () => {
            calls.push('adenaFreshness');
            return { score: 100, ready: false, issueCount: 0 };
        },
        printStartupBanner: () => calls.push('banner'),
        getNowLabel: () => '2026-05-31 10:00:00',
        setCommandRegisterOk: ({ at, count }) => calls.push(`cmdOk:${at}:${count}`),
        setCommandRegisterError: error => calls.push(`cmdError:${error}`),
        loadSystem: () => calls.push('load'),
        logger: {
            log: message => calls.push(`log:${message}`),
            warn: message => calls.push(`warn:${message}`),
            error: message => calls.push(`error:${String(message).split('\n')[0]}`)
        }
    };
    return { deps, calls, intervalCallbacks, cronSchedules };
}

(async () => {
    const { deps, calls, intervalCallbacks, cronSchedules } = createDeps({ expireChanged: true });
    const handler = createClientReadyHandler(deps);
    await handler();

    assert.strictEqual(FakeRest.instances.length, 1);
    assert.strictEqual(FakeRest.instances[0].token, 'token1');
    assert.deepStrictEqual(FakeRest.instances[0].puts.map(entry => entry.route), [
        'app:app1',
        'guild:app1:guild1'
    ]);
    assert.deepStrictEqual(FakeRest.instances[0].puts[1].payload.body, [{ name: 'visible' }]);
    assert.strictEqual(intervalCallbacks.length, 2);
    assert.strictEqual(cronSchedules.length, 5);
    assert.deepStrictEqual(calls.slice(0, 15), [
        'load',
        'health:client-ready-start',
        'cmdOk:2026-05-31 10:00:00:1',
        'log:[COMMAND REGISTER] Registered 1 guild commands.',
        'health:command-register-ok',
        'fetchGuild:guild1',
        'refresh:guild1:true',
        'profiles:guild1',
        'log:[HEARTBEAT] attendance 60s · maintenance 300s',
        'interval:60000',
        'interval:300000',
        'cron:30 21 * * 0,1,3,4,5,6:Asia/Seoul',
        'cron:30 19 * * 2:Asia/Seoul',
        'cron:30 9 * * 0,1,2,4,5,6:Asia/Seoul',
        'cron:30 4 * * 3:Asia/Seoul'
    ]);
    assert.strictEqual(cronSchedules[4].rule, '5 * * * * *');
    await cronSchedules[4].fn();
    await cronSchedules[4].fn();
    assert.strictEqual(calls.includes('adenaReset:DAY'), true);
    assert.strictEqual(calls.filter(call => call === 'adenaReset:DAY').length, 1, 'same shift boundary resets once');
    assert.strictEqual(calls.includes('adenaReset:NIGHT'), false);
    assert.strictEqual(calls.includes('health:client-ready-complete'), true);
    assert.strictEqual(calls.includes('banner'), true);

    const beforeAttendance = calls.length;
    await intervalCallbacks[0]();
    assert.deepStrictEqual(calls.slice(beforeAttendance), [
        'syncVoice',
        'reconcile:guild1',
        'grace',
        'ot',
        'exceptions',
        'announcements',
        'dayoff',
        'guest:guild1',
        'working',
        'render'
    ]);

    const beforeMaintenance = calls.length;
    await intervalCallbacks[1]();
    assert.deepStrictEqual(calls.slice(beforeMaintenance), [
        'backup',
        'panels',
        'dayoffReconcile',
        'refresh:guild1:true',
        'profiles:guild1',
        'adenaLateRecovery',
        'adenaFreshness',
        'queue:guild1',
        'issues:guild1',
        'expire',
        'save'
    ]);

    const validation = createDeps({ commandIssues: ['bad command'] });
    await createClientReadyHandler(validation.deps)();
    assert.strictEqual(validation.calls.includes('cmdError:bad command'), true);
    assert.strictEqual(validation.calls.includes('health:command-register-ok'), false);

    const queued = createDeps();
    const queuedJobs = [];
    queued.deps.backgroundJobQueueService = {
        enqueue: job => {
            queuedJobs.push(job);
            return { accepted: true, key: job.key };
        }
    };
    await createClientReadyHandler(queued.deps)();
    assert(queuedJobs.some(job => job.key === 'maintenance-worker-profiles'));
    assert(queuedJobs.some(job => job.key === 'maintenance-dayoff-reconcile'));
    assert(queuedJobs.some(job => job.key === 'maintenance-end-adena-freshness'));
    assert.strictEqual(queued.calls.includes('profiles:guild1'), false);
    assert.strictEqual(queued.calls.includes('dayoffReconcile'), false);

    const staggered = createDeps();
    staggered.deps.syncLiveThreeDayPayrollSummary = async () => staggered.calls.push('payrollLiveSummary');
    await createClientReadyHandler(staggered.deps)();
    assert(staggered.cronSchedules.some(entry => entry.rule === '5 * * * * *'));
    assert(staggered.cronSchedules.some(entry => entry.rule === '35 * * * * *'));

    assert.throws(() => createClientReadyHandler({}), /CONFIG/);

    const normalDayReadiness = collectDueEndAdenaCloseReadiness(
        at('2026-05-21 20:40'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(normalDayReadiness.map(item => item.shift), ['DAY']);

    const catchUpReadiness = collectDueEndAdenaCloseReadiness(
        at('2026-05-21 20:45'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(catchUpReadiness.map(item => item.shift), ['DAY']);

    const expiredReadiness = collectDueEndAdenaCloseReadiness(
        at('2026-05-21 20:50'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(expiredReadiness, []);

    const tuesdayDayReadiness = collectDueEndAdenaCloseReadiness(
        at('2026-05-19 18:40'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-19 09:00' : '2026-05-19 19:00'),
            end: at(shift === 'day' ? '2026-05-19 19:00' : '2026-05-20 04:00')
        })
    );
    assert.deepStrictEqual(tuesdayDayReadiness.map(item => item.shift), ['DAY']);

    const normalDay = collectDueEndAdenaSummaryResets(
        at('2026-05-21 20:50'),
        shift => ({ end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00') })
    );
    assert.deepStrictEqual(normalDay.map(item => item.shift), ['DAY']);

    const tuesdayDay = collectDueEndAdenaSummaryResets(
        at('2026-05-19 18:50'),
        shift => ({ end: at(shift === 'day' ? '2026-05-19 19:00' : '2026-05-20 04:00') })
    );
    assert.deepStrictEqual(tuesdayDay.map(item => item.shift), ['DAY']);

    const tuesdayNight = collectDueEndAdenaSummaryResets(
        at('2026-05-20 03:50'),
        shift => ({ end: at(shift === 'night' ? '2026-05-20 04:00' : '2026-05-20 21:00') })
    );
    assert.deepStrictEqual(tuesdayNight.map(item => item.shift), ['NIGHT']);

    const overriddenEnd = collectDueEndAdenaSummaryResets(
        at('2026-06-03 21:50'),
        shift => ({ end: at(shift === 'day' ? '2026-06-03 22:00' : '2026-06-04 10:00') })
    );
    assert.deepStrictEqual(overriddenEnd.map(item => item.shift), ['DAY']);

    const normalDayReminder = collectDueEndAdenaApprovalReminders(
        at('2026-05-21 21:45'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(normalDayReminder.map(item => item.shift), ['DAY']);

    const expiredDayReminder = collectDueEndAdenaApprovalReminders(
        at('2026-05-21 22:00'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(expiredDayReminder, []);

    const normalDayDeadlineWarning = collectDueEndAdenaApprovalDeadlineWarnings(
        at('2026-05-21 21:55'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(normalDayDeadlineWarning.map(item => item.shift), ['DAY']);
    assert.strictEqual(normalDayDeadlineWarning[0].deadlineAt, at('2026-05-21 22:00').toISOString());

    const expiredDayDeadlineWarning = collectDueEndAdenaApprovalDeadlineWarnings(
        at('2026-05-21 22:00'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(expiredDayDeadlineWarning, []);

    const dynamicBounds = shift => ({
        start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
        end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
    });
    const activeOvertimeResolver = () => ({ activeOvertime: true, deadlineAt: null });
    assert.deepStrictEqual(collectDueEndAdenaApprovalReminders(
        at('2026-05-21 21:55'),
        dynamicBounds,
        new Set(),
        activeOvertimeResolver
    ), []);
    assert.deepStrictEqual(collectDueEndAdenaApprovalDeadlineWarnings(
        at('2026-05-21 21:55'),
        dynamicBounds,
        new Set(),
        activeOvertimeResolver
    ), []);
    assert.deepStrictEqual(collectDueEndAdenaReconciliations(
        at('2026-05-21 22:00'),
        dynamicBounds,
        new Set(),
        activeOvertimeResolver
    ), []);

    const closedOvertimeResolver = ({ bounds }) => ({
        activeOvertime: false,
        workEndAt: bounds.end.clone().add(63, 'minutes').toISOString(),
        extensionMinutes: 63,
        deadlineAt: bounds.end.clone().add(123, 'minutes').toISOString()
    });
    const dynamicReminder = collectDueEndAdenaApprovalReminders(
        at('2026-05-21 22:48'),
        dynamicBounds,
        new Set(),
        closedOvertimeResolver
    );
    assert.deepStrictEqual(dynamicReminder.map(item => item.shift), ['DAY']);
    assert.strictEqual(dynamicReminder[0].remindAt, at('2026-05-21 22:48').toISOString());
    assert.strictEqual(dynamicReminder[0].settlement.extensionMinutes, 63);

    const dynamicWarning = collectDueEndAdenaApprovalDeadlineWarnings(
        at('2026-05-21 22:58'),
        dynamicBounds,
        new Set(),
        closedOvertimeResolver
    );
    assert.deepStrictEqual(dynamicWarning.map(item => item.shift), ['DAY']);
    assert.strictEqual(dynamicWarning[0].deadlineAt, at('2026-05-21 23:03').toISOString());

    const dynamicReconciliation = collectDueEndAdenaReconciliations(
        at('2026-05-21 23:03'),
        dynamicBounds,
        new Set(),
        closedOvertimeResolver
    );
    assert.deepStrictEqual(dynamicReconciliation.map(item => item.shift), ['DAY']);
    assert.strictEqual(dynamicReconciliation[0].reconcileAt, at('2026-05-21 23:03').toISOString());

    const normalDayReconciliation = collectDueEndAdenaReconciliations(
        at('2026-05-21 22:00'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(normalDayReconciliation.map(item => item.shift), ['DAY']);

    const normalDayCatchUp = collectDueEndAdenaReconciliations(
        at('2026-05-21 22:37'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(normalDayCatchUp.map(item => item.shift), ['DAY']);
    assert.strictEqual(normalDayCatchUp[0].reconcileAt, at('2026-05-21 22:00').toISOString());

    const completedDayKey = `day:${at('2026-05-21 21:00').toISOString()}`;
    const completedDayCatchUp = collectDueEndAdenaReconciliations(
        at('2026-05-21 22:37'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        }),
        new Set([completedDayKey])
    );
    assert.deepStrictEqual(completedDayCatchUp, []);

    const expiredDayCatchUp = collectDueEndAdenaReconciliations(
        at('2026-05-21 23:00'),
        shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    );
    assert.deepStrictEqual(expiredDayCatchUp, []);

    const tuesdayNightReconciliation = collectDueEndAdenaReconciliations(
        at('2026-05-20 05:00'),
        shift => ({
            start: at(shift === 'night' ? '2026-05-19 19:00' : '2026-05-20 09:00'),
            end: at(shift === 'night' ? '2026-05-20 04:00' : '2026-05-20 21:00')
        })
    );
    assert.deepStrictEqual(tuesdayNightReconciliation.map(item => item.shift), ['NIGHT']);

    const reconciliationSchedule = createDeps({
        now: '2026-05-21 22:00',
        getShiftBounds: shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    });
    await createClientReadyHandler(reconciliationSchedule.deps)();
    await reconciliationSchedule.cronSchedules[4].fn();
    assert.strictEqual(reconciliationSchedule.calls.includes('adenaReconcile:DAY'), true);

    const reminderSchedule = createDeps({
        now: '2026-05-21 21:45',
        getShiftBounds: shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    });
    await createClientReadyHandler(reminderSchedule.deps)();
    await reminderSchedule.cronSchedules[4].fn();
    assert.strictEqual(reminderSchedule.calls.includes('adenaReminder:DAY'), true);

    const deadlineSchedule = createDeps({
        now: '2026-05-21 21:55',
        getShiftBounds: shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    });
    await createClientReadyHandler(deadlineSchedule.deps)();
    await deadlineSchedule.cronSchedules[4].fn();
    assert.strictEqual(deadlineSchedule.calls.includes('adenaDeadline:DAY'), true);

    const readinessSchedule = createDeps({
        now: '2026-05-21 20:40',
        getShiftBounds: shift => ({
            start: at(shift === 'day' ? '2026-05-21 09:00' : '2026-05-21 21:00'),
            end: at(shift === 'day' ? '2026-05-21 21:00' : '2026-05-22 09:00')
        })
    });
    await createClientReadyHandler(readinessSchedule.deps)();
    await readinessSchedule.cronSchedules[4].fn();
    assert.strictEqual(readinessSchedule.calls.includes('adenaReadiness:DAY'), true);

    console.log('client-ready-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
