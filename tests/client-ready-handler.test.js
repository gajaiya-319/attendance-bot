const assert = require('assert');
const { createClientReadyHandler } = require('../src/events/clientReadyHandler');

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
    assert.strictEqual(cronSchedules.length, 4);
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
        'queue:guild1',
        'issues:guild1',
        'expire',
        'save'
    ]);

    const validation = createDeps({ commandIssues: ['bad command'] });
    await createClientReadyHandler(validation.deps)();
    assert.strictEqual(validation.calls.includes('cmdError:bad command'), true);
    assert.strictEqual(validation.calls.includes('health:command-register-ok'), false);

    assert.throws(() => createClientReadyHandler({}), /CONFIG/);

    console.log('client-ready-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
