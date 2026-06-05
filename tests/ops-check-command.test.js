const assert = require('assert');
const { createOpsCheckCommand } = require('../src/commands/admin/opsCheckCommand');

(async () => {
    const command = createOpsCheckCommand({
        MessageFlags: { Ephemeral: 64 },
        buildOpsCheckEmbed: async guild => ({ title: 'Ops', guildId: guild.id }),
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

    let deferPayload = null;
    let editPayload = null;
    const adminInteraction = {
        member: { admin: true },
        guild: { id: 'guild1' },
        deferred: false,
        replied: false,
        deferReply: async payload => {
            deferPayload = payload;
            adminInteraction.deferred = true;
        },
        editReply: async payload => {
            editPayload = payload;
        }
    };

    await command.execute(adminInteraction);

    assert.strictEqual(command.aliases.includes('ops-check'), true);
    assert.strictEqual(command.aliases.includes('\uc6b4\uc601\uc810\uac80'), true);
    assert.deepStrictEqual(deferPayload, { flags: 64 });
    assert.deepStrictEqual(editPayload, {
        embeds: [{ title: 'Ops', guildId: 'guild1' }]
    });

    console.log('ops-check-command tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
