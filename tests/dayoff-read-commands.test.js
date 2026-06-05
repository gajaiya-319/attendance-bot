const assert = require('assert');
const { createDayOffReadCommands } = require('../src/commands/admin/dayOffReadCommands');

function createInteraction(overrides = {}) {
    const interaction = {
        member: { admin: true },
        options: {
            getInteger: () => null,
            getString: () => null
        },
        replyPayload: null,
        reply: async payload => {
            interaction.replyPayload = payload;
        },
        ...overrides
    };
    return interaction;
}

(async () => {
    const calls = [];
    const commands = createDayOffReadCommands({
        MessageFlags: { Ephemeral: 64 },
        canRun: member => Boolean(member?.admin),
        buildDayOffLogEmbed: async limit => {
            calls.push(`log:${limit}`);
            return { title: 'Day Off Log', limit };
        },
        buildDayOffListEmbed: status => {
            calls.push(`list:${status}`);
            return { title: 'Day Off List', status };
        }
    });

    let deleted = false;
    const noPermInteraction = createInteraction({ member: { admin: false } });
    await commands.log.execute(noPermInteraction, {
        autoDel: () => {
            deleted = true;
        }
    });
    assert.strictEqual(noPermInteraction.replyPayload.content, 'No perms.');
    assert.strictEqual(deleted, true);

    const logInteraction = createInteraction({
        options: {
            getInteger: name => name === 'limit' ? 99 : null,
            getString: () => null
        }
    });
    await commands.log.execute(logInteraction);
    assert.deepStrictEqual(logInteraction.replyPayload, {
        embeds: [{ title: 'Day Off Log', limit: 30 }],
        flags: 64
    });

    const listInteraction = createInteraction({
        options: {
            getInteger: () => null,
            getString: name => name === 'status' ? 'approved' : null
        }
    });
    await commands.list.execute(listInteraction);
    assert.deepStrictEqual(listInteraction.replyPayload, {
        embeds: [{ title: 'Day Off List', status: 'approved' }],
        flags: 64
    });

    assert.deepStrictEqual(calls, ['log:30', 'list:approved']);
    assert.strictEqual(commands.log.aliases.includes('dayoff-log'), true);
    assert.strictEqual(commands.list.aliases.includes('\ud734\ubb34\ubaa9\ub85d'), true);

    console.log('dayoff-read-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
