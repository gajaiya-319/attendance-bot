const assert = require('assert');
const { createBackupCommands } = require('../src/commands/admin/backupCommands');

function createInteraction(overrides = {}) {
    const interaction = {
        member: { admin: true },
        user: { id: 'owner' },
        options: {
            getString: name => name === 'file' ? 'backup.json' : null
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
    const commands = createBackupCommands({
        MessageFlags: { Ephemeral: 64 },
        canRun: member => Boolean(member?.admin),
        isOwner: id => id === 'owner',
        ownerOnlyReply: async interaction => {
            interaction.ownerOnly = true;
        },
        saveSystem: async () => {
            calls.push('save');
        },
        createBackupSnapshot: async reason => {
            calls.push(`create:${reason}`);
            return 'backups/manual.json';
        },
        listBackupSnapshots: async () => ['a.json', 'b.json'],
        restoreBackupSnapshot: async file => {
            calls.push(`restore:${file}`);
            return file === 'backup.json' ? file : null;
        },
        renderDashboard: async () => {
            calls.push('render');
        }
    });

    let deleted = false;
    const noPermInteraction = createInteraction({ member: { admin: false } });
    await commands.create.execute(noPermInteraction, {
        autoDel: () => {
            deleted = true;
        }
    });
    assert.strictEqual(noPermInteraction.replyPayload.content, 'No perms.');
    assert.strictEqual(deleted, true);

    const createInteractionResult = createInteraction();
    await commands.create.execute(createInteractionResult);
    assert.strictEqual(createInteractionResult.replyPayload.content, 'Backup created: backups/manual.json');
    assert.deepStrictEqual(calls.slice(0, 2), ['save', 'create:manual']);

    const listInteraction = createInteraction();
    await commands.list.execute(listInteraction);
    assert.match(listInteraction.replyPayload.content, /a\.json/);
    assert.match(listInteraction.replyPayload.content, /b\.json/);

    const nonOwnerInteraction = createInteraction({ user: { id: 'not-owner' } });
    await commands.restore.execute(nonOwnerInteraction);
    assert.strictEqual(nonOwnerInteraction.ownerOnly, true);

    const restoreInteraction = createInteraction();
    await commands.restore.execute(restoreInteraction);
    assert.strictEqual(restoreInteraction.replyPayload.content, 'Restored backup: backup.json');
    assert.ok(calls.includes('restore:backup.json'));
    assert.ok(calls.includes('render'));

    assert.strictEqual(commands.create.aliases.includes('backup-create'), true);
    assert.strictEqual(commands.list.aliases.includes('backup-list'), true);
    assert.strictEqual(commands.restore.aliases.includes('backup-restore'), true);

    console.log('backup-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
