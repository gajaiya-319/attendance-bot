const assert = require('assert');
const { createAnnouncementCommands } = require('../src/commands/admin/announcementCommands');

function createInteraction(overrides = {}) {
    const interaction = {
        member: { manager: true },
        replyPayload: null,
        reply: async payload => {
            interaction.replyPayload = payload;
        },
        ...overrides
    };
    return interaction;
}

(async () => {
    const announceData = { 1: null, 2: { active: true, time: '10:00', content: 'Old' } };
    const calls = [];
    const commands = createAnnouncementCommands({
        MessageFlags: { Ephemeral: 64 },
        canRun: member => Boolean(member?.manager),
        getAnnounceData: () => announceData,
        saveSystem: async () => {
            calls.push('save');
        },
        formatAnnouncementList: () => 'Slot 1: ON 09:00 - Hello'
    });

    let deleted = false;
    const noPermInteraction = createInteraction({ member: { manager: false } });
    await commands.set.execute(noPermInteraction, {
        autoDel: () => {
            deleted = true;
        },
        getSlot: () => 1,
        getAnnounceTime: () => '09:00',
        getAnnounceContent: () => 'Hello'
    });
    assert.strictEqual(noPermInteraction.replyPayload.content, 'No perms.');
    assert.strictEqual(deleted, true);

    const setInteraction = createInteraction();
    deleted = false;
    await commands.set.execute(setInteraction, {
        autoDel: () => {
            deleted = true;
        },
        getSlot: () => 1,
        getAnnounceTime: () => '09:00',
        getAnnounceContent: () => 'Hello',
        getAnnounceRoles: () => [{ id: 'role1' }, { id: 'role2' }, { id: 'role1' }]
    });
    assert.strictEqual(announceData[1].active, true);
    assert.strictEqual(announceData[1].roleId, 'role1');
    assert.deepStrictEqual(announceData[1].roleIds, ['role1', 'role2']);
    assert.strictEqual(setInteraction.replyPayload.content, 'Announcement slot 1 saved for 09:00. Targets: <@&role1> <@&role2>');
    assert.strictEqual(deleted, true);

    const badSetInteraction = createInteraction();
    await commands.set.execute(badSetInteraction, {
        getSlot: () => 7,
        getAnnounceTime: () => '9am',
        getAnnounceContent: () => 'Bad'
    });
    assert.strictEqual(badSetInteraction.replyPayload.content, 'Invalid slot or time. Use slot 1-6 and HH:mm.');

    const cancelInteraction = createInteraction();
    await commands.cancel.execute(cancelInteraction, {
        getSlot: () => 2
    });
    assert.strictEqual(announceData[2].active, false);
    assert.strictEqual(cancelInteraction.replyPayload.content, 'Announcement slot 2 disabled.');

    const badCancelInteraction = createInteraction();
    await commands.cancel.execute(badCancelInteraction, {
        getSlot: () => 0
    });
    assert.strictEqual(badCancelInteraction.replyPayload.content, 'Invalid slot. Use 1-6.');

    const listInteraction = createInteraction();
    await commands.list.execute(listInteraction);
    assert.match(listInteraction.replyPayload.content, /Slot 1/);

    assert.ok(calls.length >= 2, 'set and cancel save state');
    assert.strictEqual(commands.set.aliases.includes('set-announce'), true);
    assert.strictEqual(commands.cancel.aliases.includes('\uacf5\uc9c0\ucde8\uc18c'), true);
    assert.strictEqual(commands.list.aliases.includes('list-announce'), true);

    console.log('announcement-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
