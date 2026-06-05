const assert = require('assert');
const { createButtonInteractionContext } = require('../src/events/buttonInteractionContext');

function createInteraction(overrides = {}) {
    const interaction = {
        customId: 'in',
        user: { id: 'u1' },
        member: { id: 'fallback', displayName: 'Fallback' },
        guild: {
            members: {
                fetch: async () => ({ id: 'u1', displayName: 'Robin' })
            }
        },
        replyPayload: null,
        reply: async payload => {
            interaction.replyPayload = payload;
        },
        ...overrides
    };
    return interaction;
}

function createContext(overrides = {}) {
    const calls = [];
    const now = {
        toISOString: () => '2026-05-30T09:00:00.000Z'
    };
    const users = new Map();
    const context = createButtonInteractionContext({
        MessageFlags: { Ephemeral: 64 },
        refreshGuildMembers: async (guild, options) => calls.push(`refresh:${options.force}:${options.minIntervalMs}`),
        markMemberActivity: member => {
            calls.push(`activity:${member.displayName}`);
            return true;
        },
        saveSystem: async () => calls.push('save'),
        determineShift: member => member.shift || 'night',
        ensureUserData: (member, shift) => {
            if (!users.has(member.id)) users.set(member.id, { id: member.id, name: member.displayName, shift });
            return users.get(member.id);
        },
        isCooldown: user => Boolean(user.cooldown),
        getNow: () => now,
        onAction: (type, member, user, shift) => calls.push(`action:${type}:${member.displayName}:${shift}`),
        ...overrides
    });
    return { context, calls, users };
}

(async () => {
    const { context, calls, users } = createContext();
    const interaction = createInteraction();
    const result = await context.prepare(interaction, { autoDel: () => {} });
    assert.strictEqual(result.handled, false);
    assert.strictEqual(result.member.displayName, 'Robin');
    assert.strictEqual(result.shift, 'night');
    assert.strictEqual(result.type, 'in');
    assert.strictEqual(users.get('u1').manualPanelTouchedAt, '2026-05-30T09:00:00.000Z');
    assert.deepStrictEqual(calls, [
        'refresh:true:0',
        'activity:Robin',
        'save',
        'action:in:Robin:night'
    ]);

    let noRoleDelay = 'unset';
    const { context: noRoleContext } = createContext({ determineShift: () => null });
    const noRoleInteraction = createInteraction();
    const noRole = await noRoleContext.prepare(noRoleInteraction, {
        autoDel: delay => {
            noRoleDelay = delay;
        }
    });
    assert.strictEqual(noRole.handled, true);
    await noRole.response;
    assert.deepStrictEqual(noRoleInteraction.replyPayload, {
        content: 'No role.',
        flags: 64
    });
    assert.strictEqual(noRoleDelay, undefined);

    let cooldownDelay = null;
    const { context: cooldownContext } = createContext({
        ensureUserData: () => ({ cooldown: true })
    });
    const cooldownInteraction = createInteraction();
    const cooldown = await cooldownContext.prepare(cooldownInteraction, {
        autoDel: delay => {
            cooldownDelay = delay;
        }
    });
    assert.strictEqual(cooldown.handled, true);
    await cooldown.response;
    assert.deepStrictEqual(cooldownInteraction.replyPayload, {
        content: 'Cooldown (3s).',
        flags: 64
    });
    assert.strictEqual(cooldownDelay, 2000);

    const { context: fallbackContext } = createContext();
    const fallbackInteraction = createInteraction({
        guild: {
            members: {
                fetch: async () => {
                    throw new Error('fetch failed');
                }
            }
        }
    });
    const fallback = await fallbackContext.prepare(fallbackInteraction, { autoDel: () => {} });
    assert.strictEqual(fallback.member.displayName, 'Fallback');

    console.log('button-interaction-context tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
