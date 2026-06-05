const assert = require('assert');
const momentTimezone = require('moment-timezone');
const {
    createDeathPenaltyReactionHandler,
    getServerForChannel,
    isSafetyZonePost,
    parseNameFromContent,
    getPenaltySheetName
} = require('../src/events/deathPenaltyReactionHandler');

const CONFIG = {
    PURCHASE_SPREADSHEET_ID: 'sheet',
    PURCHASE_APPROVAL_EMOJI: '\u2705',
    PURCHASE_CANCEL_EMOJI: '\u274C',
    PURCHASE_PROCESSING_EMOJI: '\u23F3',
    PURCHASE_SUCCESS_EMOJI: '\uD83D\uDCCA',
    PURCHASE_FAILURE_EMOJI: '\u26A0\uFE0F',
    PURCHASE_OWNER_DM_IDS: ['owner'],
    DEATH_PENALTY_AMOUNT: 1000,
    DEATH_PENALTY_CHANNEL_IDS: {
        PAAGRIO: 'paagrio-penalty',
        HEINE: 'heine-penalty'
    },
    DEATH_PENALTY_REVIEWER_ROLE_IDS: ['head-manager', 'player-manager'],
    TIMEZONE: 'Asia/Manila',
    ROLES: {
        DAY: 'day',
        NIGHT: 'night'
    }
};

function roles(ids) {
    return { cache: { has: id => ids.includes(id) } };
}

function createReaction({ emoji, calls, users = ['bot'] }) {
    return {
        emoji: { name: emoji },
        count: users.length,
        remove: async () => calls.push(`removeAll:${emoji}`),
        users: {
            remove: async id => calls.push(`remove:${emoji}:${id}`)
        }
    };
}

function createMessage({ calls, channelId = 'paagrio-penalty', content = 'PK', reactions = [], createdAt = new Date('2026-06-01T01:00:00Z'), member = null }) {
    const authorMember = member || {
        displayName: 'Zeki - P Day time',
        roles: roles(['day'])
    };
    const reviewerMembers = {
        owner: {
            roles: roles([])
        },
        manager: {
            roles: roles([]),
            permissions: { has: flag => flag === 'ManageMessages' }
        },
        head: {
            roles: roles(['head-manager'])
        },
        player: {
            roles: roles(['player-manager'])
        },
        reviewer: {
            roles: roles([])
        }
    };

    return {
        id: 'msg1',
        content,
        createdAt,
        channelId,
        author: { id: 'author', bot: false },
        member: authorMember,
        client: { user: { id: 'bot' } },
        guild: {
            members: {
                fetch: async id => {
                    calls.push(`fetch:${id}`);
                    return reviewerMembers[id] || authorMember;
                }
            }
        },
        reactions: {
            cache: {
                find: predicate => reactions.find(predicate) || null
            }
        },
        react: async emoji => calls.push(`react:${emoji}`)
    };
}

function createHandler({ calls, message, purchaseSheetService, momentOverride = null }) {
    return createDeathPenaltyReactionHandler({
        MessagePermissionFlags: {
            Administrator: 'Administrator',
            ManageMessages: 'ManageMessages'
        },
        CONFIG,
        moment: momentOverride || (() => ({ tz: () => ({ date: () => 1 }) })),
        purchaseSheetService,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
    });
}

assert.strictEqual(getServerForChannel('paagrio-penalty', CONFIG.DEATH_PENALTY_CHANNEL_IDS), 'PAAGRIO');
assert.strictEqual(getServerForChannel('heine-penalty', CONFIG.DEATH_PENALTY_CHANNEL_IDS), 'HEINE');
assert.strictEqual(getServerForChannel('other', CONFIG.DEATH_PENALTY_CHANNEL_IDS), null);
assert.strictEqual(isSafetyZonePost('safety zone check'), true);
assert.strictEqual(isSafetyZonePost('SAFETYZONE'), true);
assert.strictEqual(isSafetyZonePost('PK screenshot'), false);
assert.strictEqual(parseNameFromContent('NAME: Lancyy\nPK'), 'Lancyy');
assert.strictEqual(
    getPenaltySheetName({ displayName: 'Lanceyy - Guest', roles: roles([]) }, 'Lancyy', CONFIG.ROLES),
    'Lancyy'
);

(async () => {
    {
        const calls = [];
        const message = createMessage({ calls, content: 'screenshot only' });
        const handler = createHandler({
            calls,
            message,
            purchaseSheetService: {
                addPurchase: async () => {
                    throw new Error('messageCreate should not write to sheet');
                }
            }
        });

        await handler.messageCreate(message);

        assert.deepStrictEqual(calls, [
            `react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({ calls, content: 'safety zone check' });
        const handler = createHandler({
            calls,
            message,
            purchaseSheetService: {
                addPurchase: async () => {
                    throw new Error('safety zone should be ignored');
                }
            }
        });

        await handler.messageCreate(message);
        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert.deepStrictEqual(calls, []);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            calls,
            message,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!H12', nextValue: 1000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert.deepStrictEqual(calls, [
            'fetch:owner',
            `react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`,
            'sheet:PAAGRIO:DAY:Zeki:1000:1',
            `react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`,
            `react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            channelId: 'heine-penalty',
            createdAt: new Date('2026-06-01T01:00:00Z'),
            member: {
                displayName: 'Chog - H Night Time',
                roles: roles(['night'])
            }
        });
        const handler = createHandler({
            calls,
            message,
            momentOverride: momentTimezone,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Heine Great!L35', nextValue: 1000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert(calls.includes('sheet:HEINE:NIGHT:Chog:1000:31'));
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            channelId: 'heine-penalty',
            content: 'NAME: Lancyy\nPK',
            createdAt: new Date('2026-06-02T01:47:00Z'),
            member: {
                displayName: 'Lanceyy - Guest',
                roles: roles([])
            }
        });
        const handler = createHandler({
            calls,
            message,
            momentOverride: momentTimezone,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Heine Great!L35', nextValue: 1000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes('sheet:HEINE:NIGHT:Lancyy:1000:1'));
    }

    {
        const calls = [];
        const successReaction = createReaction({
            emoji: CONFIG.PURCHASE_SUCCESS_EMOJI,
            calls
        });
        const message = createMessage({ calls, reactions: [successReaction] });
        const handler = createHandler({
            calls,
            message,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!H12', nextValue: 0 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_CANCEL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert.deepStrictEqual(calls, [
            'fetch:owner',
            `react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`,
            'sheet:PAAGRIO:DAY:Zeki:-1000:1',
            `removeAll:${CONFIG.PURCHASE_SUCCESS_EMOJI}`,
            `react:${CONFIG.PURCHASE_CANCEL_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            calls,
            message,
            purchaseSheetService: {
                addPurchase: async () => {
                    throw new Error('non-reviewer should be ignored');
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'reviewer', bot: false });

        assert.deepStrictEqual(calls, ['fetch:reviewer']);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            calls,
            message,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!H12', nextValue: 1000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert.deepStrictEqual(calls, [
            'fetch:head',
            `react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`,
            'sheet:PAAGRIO:DAY:Zeki:1000:1',
            `react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`,
            `react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            calls,
            message,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!H12', nextValue: 1000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'manager', bot: false });

        assert.deepStrictEqual(calls, [
            'fetch:manager',
            `react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`,
            'sheet:PAAGRIO:DAY:Zeki:1000:1',
            `react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`,
            `react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            calls,
            message,
            purchaseSheetService: {
                addPurchase: async () => ({ ok: false, code: 'sheet-api-error' })
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert.deepStrictEqual(calls, [
            'fetch:owner',
            `react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`,
            `react:${CONFIG.PURCHASE_FAILURE_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createDeathPenaltyReactionHandler({
            MessagePermissionFlags: {
                Administrator: 'Administrator',
                ManageMessages: 'ManageMessages'
            },
            CONFIG,
            moment: () => ({ tz: () => ({ date: () => 1 }) }),
            purchaseSheetService: {
                addPurchase: async () => ({ ok: false, code: 'sheet-api-error' })
            },
            opsQueueService: {
                enqueue: async item => {
                    calls.push(`queue:${item.kind}:${item.action}:${item.userName}`);
                    return { ok: true };
                }
            },
            logger: { log: () => {}, warn: () => {}, error: () => {} }
        });
        message.guild.members.fetch = async id => {
            calls.push(`fetch:${id}`);
            return id === 'owner' ? { roles: roles([]) } : message.member;
        };

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert.deepStrictEqual(calls, [
            'fetch:owner',
            `react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`,
            'queue:death-penalty:approve:Zeki',
            `react:${CONFIG.PURCHASE_FAILURE_EMOJI}`
        ]);
    }

    console.log('death-penalty-reaction-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
