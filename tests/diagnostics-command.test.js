const assert = require('assert');
const { createDiagnosticsCommand } = require('../src/commands/admin/diagnosticsCommand');

(async () => {
    const embed = { title: 'Diagnostics' };
    const command = createDiagnosticsCommand({
        MessageFlags: { Ephemeral: 64 },
        buildDiagnosticsEmbed: guild => ({ ...embed, guildId: guild.id }),
        canRun: member => Boolean(member?.admin)
    });

    let replyPayload = null;
    let deleted = false;
    await command.execute({
        member: { admin: false },
        guild: { id: 'guild1' },
        reply: async payload => {
            replyPayload = payload;
        }
    }, {
        autoDel: () => {
            deleted = true;
        }
    });

    assert.strictEqual(replyPayload.content, 'No perms.');
    assert.strictEqual(replyPayload.flags, 64);
    assert.strictEqual(deleted, true);

    await command.execute({
        member: { admin: true },
        guild: { id: 'guild1' },
        reply: async payload => {
            replyPayload = payload;
        }
    });

    assert.strictEqual(command.aliases.includes('diagnostics'), true);
    assert.strictEqual(command.aliases.includes('\uc9c4\ub2e8'), true);
    assert.strictEqual(replyPayload.flags, 64);
    assert.deepStrictEqual(replyPayload.embeds, [{ title: 'Diagnostics', guildId: 'guild1' }]);

    console.log('diagnostics-command tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
