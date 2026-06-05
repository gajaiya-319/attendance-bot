const assert = require('assert');
const { createMaintenanceCommands } = require('../src/commands/admin/maintenanceCommands');

(async () => {
    const calls = [];
    let replyPayload = null;
    const commands = createMaintenanceCommands({
        MessageFlags: { Ephemeral: 64 },
        canRun: () => true,
        maintenanceOverrideService: {
            setOverride: async input => {
                calls.push(['set', input]);
                return {
                    ok: true,
                    date: input.date,
                    override: {
                        enabled: true,
                        windowStart: input.windowStart,
                        windowEnd: input.windowEnd
                    }
                };
            },
            listOverrides: () => [],
            deleteOverride: async () => ({ ok: true, date: '2026-06-03' })
        },
        syncVoiceStates: async () => calls.push('sync'),
        renderDashboard: async () => calls.push('render')
    });

    await commands.root.execute({
        member: {},
        options: {
            getSubcommand: () => '\uc124\uc815',
            getString: name => ({
                '\ub0a0\uc9dc': '2026-06-03',
                '\uc0ac\uc6a9': 'true',
                '\uc810\uac80\uc2dc\uc791': '23:00',
                '\uc810\uac80\uc885\ub8cc': '01:00'
            }[name] ?? null)
        },
        reply: payload => {
            replyPayload = payload;
            return Promise.resolve();
        }
    });

    assert.strictEqual(calls[0][0], 'set');
    assert.strictEqual(calls[0][1].windowStart, '23:00');
    assert.strictEqual(calls[0][1].windowEnd, '01:00');
    assert.deepStrictEqual(calls.slice(1), ['sync', 'render']);
    assert(replyPayload.content.includes('moved-maintenance-date 2026-06-03: ON'));
    assert(replyPayload.content.includes('same-as-tuesday day=09:00-19:00 night=19:00-04:00'));
    assert(replyPayload.content.includes('maintenance-window after shifted night shift 23:00-01:00'));
    assert(replyPayload.content.includes('Future Tuesdays remain on the normal Tuesday maintenance schedule.'));

    console.log('maintenance-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
