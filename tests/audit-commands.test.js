const assert = require('assert');
const { createAuditCommands } = require('../src/commands/admin/auditCommands');

function createInteraction(overrides = {}) {
    const interaction = {
        member: { admin: true },
        guild: { id: 'guild1' },
        deferred: false,
        replied: false,
        replyPayload: null,
        editPayload: null,
        deferPayload: null,
        reply: async payload => {
            interaction.replyPayload = payload;
        },
        editReply: async payload => {
            interaction.editPayload = payload;
        },
        deferReply: async payload => {
            interaction.deferPayload = payload;
            interaction.deferred = true;
        },
        ...overrides
    };
    return interaction;
}

(async () => {
    const commands = createAuditCommands({
        MessageFlags: { Ephemeral: 64 },
        canRun: member => Boolean(member?.admin),
        buildPermissionCheckEmbed: async guild => ({ title: 'Permissions', guildId: guild.id }),
        buildDataAuditEmbed: () => ({ title: 'Data' }),
        buildStatusAuditEmbed: async guild => ({ title: 'Status', guildId: guild.id }),
        buildStatusTraceEmbed: member => ({ title: 'Trace', memberId: member.id }),
        buildTimeAuditEmbed: () => ({ title: 'Time' })
    });

    let deleted = false;
    const noPermInteraction = createInteraction({ member: { admin: false } });
    await commands.dataAudit.execute(noPermInteraction, {
        autoDel: () => {
            deleted = true;
        }
    });
    assert.strictEqual(noPermInteraction.replyPayload.content, 'No perms.');
    assert.strictEqual(deleted, true);

    const permissionInteraction = createInteraction();
    await commands.permissionCheck.execute(permissionInteraction);
    assert.deepStrictEqual(permissionInteraction.deferPayload, { flags: 64 });
    assert.deepStrictEqual(permissionInteraction.editPayload, {
        embeds: [{ title: 'Permissions', guildId: 'guild1' }]
    });

    const dataInteraction = createInteraction();
    await commands.dataAudit.execute(dataInteraction);
    assert.deepStrictEqual(dataInteraction.replyPayload, {
        embeds: [{ title: 'Data' }],
        flags: 64
    });

    const statusInteraction = createInteraction();
    await commands.statusAudit.execute(statusInteraction);
    assert.deepStrictEqual(statusInteraction.replyPayload.embeds, [{ title: 'Status', guildId: 'guild1' }]);

    const traceInteraction = createInteraction();
    await commands.statusTrace.execute(traceInteraction, {
        getTargetMember: () => ({ id: 'user1' }),
        replyMemberNotFound: async () => {
            throw new Error('should not be called');
        }
    });
    assert.deepStrictEqual(traceInteraction.replyPayload.embeds, [{ title: 'Trace', memberId: 'user1' }]);

    let missingTarget = false;
    await commands.statusTrace.execute(createInteraction(), {
        getTargetMember: () => null,
        replyMemberNotFound: async () => {
            missingTarget = true;
        }
    });
    assert.strictEqual(missingTarget, true);

    const timeInteraction = createInteraction();
    await commands.timeAudit.execute(timeInteraction);
    assert.deepStrictEqual(timeInteraction.replyPayload.embeds, [{ title: 'Time' }]);

    assert.strictEqual(commands.permissionCheck.aliases.includes('permission-check'), true);
    assert.strictEqual(commands.statusTrace.aliases.includes('\uc0c1\ud0dc\ucd94\uc801'), true);

    console.log('audit-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
