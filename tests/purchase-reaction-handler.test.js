const assert = require('assert');
const momentTimezone = require('moment-timezone');
const {
    createPurchaseReactionHandler,
    parsePurchaseMessage,
    getSheetName,
    getPurchaseSheetName,
    getPurchaseSheetDayOfMonth,
    getMemberServer,
    getMemberShift,
    formatPurchaseRequestOwnerDm,
    formatPurchaseApprovedDm
} = require('../src/events/purchaseReactionHandler');

const CONFIG = {
    PURCHASE_CHANNEL_ID: 'purchase-channel',
    PURCHASE_CHANNEL_NAME: 'red-potion-buy',
    PURCHASE_SPREADSHEET_ID: 'sheet',
    PURCHASE_APPROVAL_EMOJI: '\u2705',
    PURCHASE_CANCEL_EMOJI: '\u274C',
    PURCHASE_PROCESSING_EMOJI: '\u23F3',
    PURCHASE_SUCCESS_EMOJI: '\uD83D\uDCCA',
    PURCHASE_FAILURE_EMOJI: '\u26A0\uFE0F',
    PURCHASE_UNIT_PRICE: 3000,
    TIMEZONE: 'Asia/Manila',
    PURCHASE_OWNER_DM_IDS: ['owner'],
    OWNER_IDS: ['owner'],
    ROLES: {
        HEINE: 'heine',
        PAAGRIO: 'paagrio',
        DAY: 'day',
        NIGHT: 'night'
    }
};
CONFIG.PURCHASE_SERVER_TABS = {
    HEINE: 'Heine Great',
    PAAGRIO: 'Paagrio Great'
};

function roles(ids) {
    return { cache: { has: id => ids.includes(id) } };
}

function createHandler({ message, calls, purchaseSheetService, opsQueueService = null, momentOverride = null }) {
    const authorMember = message.member;
    const reviewerMember = {
        permissions: { has: flag => flag === 'ManageMessages' }
    };

    message.guild = {
        members: {
            fetch: async id => {
                calls.push(`fetch:${id}`);
                return id === 'reviewer' ? reviewerMember : authorMember;
            }
        }
    };

    return createPurchaseReactionHandler({
        MessagePermissionFlags: {
            Administrator: 'Administrator',
            ManageMessages: 'ManageMessages'
        },
        CONFIG,
        moment: momentOverride || (() => ({ tz: () => ({ date: () => 1 }) })),
        purchaseSheetService,
        opsQueueService,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
    });
}

function createReaction({ emoji, calls, users = ['bot'] }) {
    return {
        emoji: { name: emoji },
        count: users.length,
        remove: async () => calls.push(`removeAll:${emoji}`),
        users: {
            fetch: async () => new Map(users.map(id => [id, { id }])),
            remove: async id => calls.push(`remove:${emoji}:${id}`)
        }
    };
}

function createMessage({ calls, content = 'Gab 2ea buy', reactions = [], createdAt = new Date('2026-06-01T01:00:00Z'), member = null }) {
    const authorMember = member || {
        displayName: 'Gab - P Night Time',
        roles: roles(['paagrio', 'night'])
    };

    return {
        id: 'msg1',
        content,
        createdAt,
        channelId: 'purchase-channel',
        channel: { name: 'red-potion-buy' },
        author: { id: 'author', bot: false },
        member: authorMember,
        client: {
            user: { id: 'bot' },
            users: {
                fetch: async id => ({
                    id,
                    send: async content => calls.push(`ownerDm:${id}:${content}`)
                })
            }
        },
        reactions: {
            removeAll: async () => calls.push('removeAllReactions'),
            cache: {
                find: predicate => {
                    return reactions.find(predicate) || null;
                }
            }
        },
        react: async emoji => calls.push(`react:${emoji}`)
    };
}

assert.deepStrictEqual(parsePurchaseMessage('Gab 2ea buy', 3000), {
    quantity: 2,
    amount: 6000,
    requestedName: 'Gab'
});
assert.deepStrictEqual(parsePurchaseMessage('katsuki 2ea buy', 3000), {
    quantity: 2,
    amount: 6000,
    requestedName: 'katsuki'
});
assert.deepStrictEqual(parsePurchaseMessage('jure 2 ea buy', 3000), {
    quantity: 2,
    amount: 6000,
    requestedName: 'jure'
});
assert.deepStrictEqual(parsePurchaseMessage('Gab buy 2', 3000), {
    quantity: 2,
    amount: 6000,
    requestedName: 'Gab'
});
assert.deepStrictEqual(parsePurchaseMessage('1 each buy', 1000), {
    quantity: 1,
    amount: 1000,
    requestedName: null
});
assert.deepStrictEqual(parsePurchaseMessage('buy 1', 1000), {
    quantity: 1,
    amount: 1000,
    requestedName: null
});
assert.deepStrictEqual(parsePurchaseMessage('1 buy', 1000), {
    quantity: 1,
    amount: 1000,
    requestedName: null
});
assert.deepStrictEqual(parsePurchaseMessage('1  buy', 1000), {
    quantity: 1,
    amount: 1000,
    requestedName: null
});
assert.deepStrictEqual(parsePurchaseMessage('buy 1ea', 1000), {
    quantity: 1,
    amount: 1000,
    requestedName: null
});
assert.deepStrictEqual(parsePurchaseMessage('Great buy 1', 1000), {
    quantity: 1,
    amount: 1000,
    requestedName: 'Great'
});
assert.deepStrictEqual(parsePurchaseMessage('Zurin .\uD3EC\uC158\uC0AC\uAE30 2\uAC1C', 3000), {
    quantity: 2,
    amount: 6000,
    requestedName: 'Zurin'
});
assert.deepStrictEqual(parsePurchaseMessage('Jure 2\uAC1C \uD3EC\uC158\uAD6C\uB9E4', 3000), {
    quantity: 2,
    amount: 6000,
    requestedName: 'Jure'
});
assert.deepStrictEqual(parsePurchaseMessage('Lance haste buff', 3000), {
    quantity: 1,
    amount: 9900,
    requestedName: 'Lance',
    itemLabel: 'haste buff'
});
assert.deepStrictEqual(parsePurchaseMessage('Zurin buffffoooo', 3000), {
    quantity: 1,
    amount: 9900,
    requestedName: 'Zurin',
    itemLabel: 'haste buff'
});
assert.deepStrictEqual(parsePurchaseMessage('katsuki haste buff ggangtong779@gmail.com', 3000), {
    quantity: 1,
    amount: 9900,
    requestedName: 'katsuki',
    itemLabel: 'haste buff'
});
assert.deepStrictEqual(parsePurchaseMessage('lance haste buff goodluck319@naver.com', 3000), {
    quantity: 1,
    amount: 9900,
    requestedName: 'lance',
    itemLabel: 'haste buff'
});
assert.deepStrictEqual(parsePurchaseMessage('Chog haste buff', 3000), {
    quantity: 1,
    amount: 9900,
    requestedName: 'Chog',
    itemLabel: 'haste buff'
});
assert.deepStrictEqual(parsePurchaseMessage('Daba - pogibro1@outlook.com\n2 potion\nhaste buff', 3000), {
    quantity: 2,
    amount: 15900,
    requestedName: 'Daba',
    itemLabel: 'haste buff + potion'
});
assert.deepStrictEqual(parsePurchaseMessage('1 HASTE BUFF\n1 RED POTION  pogibro1003@gmail.com', 3000), {
    quantity: 1,
    amount: 12900,
    requestedName: null,
    itemLabel: 'haste buff + potion'
});
assert.deepStrictEqual(parsePurchaseMessage('1HASTE BUFF\n1RED POTION  [pogibro1004@gmail.com]', 3000), {
    quantity: 1,
    amount: 12900,
    requestedName: null,
    itemLabel: 'haste buff + potion'
});
assert.deepStrictEqual(parsePurchaseMessage('1HAST BUFF\n1RED POTION', 3000), {
    quantity: 1,
    amount: 12900,
    requestedName: null,
    itemLabel: 'haste buff + potion'
});
assert.deepStrictEqual(parsePurchaseMessage('2potion haste buff kasy12101@gmail.com', 3000), {
    quantity: 2,
    amount: 15900,
    requestedName: null,
    itemLabel: 'haste buff + potion'
});
assert.deepStrictEqual(parsePurchaseMessage('Tonstar 2potion haste buff kasy12101@gmail.com', 3000), {
    quantity: 2,
    amount: 15900,
    requestedName: 'Tonstar',
    itemLabel: 'haste buff + potion'
});
assert.deepStrictEqual(parsePurchaseMessage('Ryuji\ngajaiya@gmail.com\n\nunli haste buff', 3000), {
    quantity: 1,
    amount: 9900,
    requestedName: 'Ryuji',
    itemLabel: 'haste buff'
});
assert.deepStrictEqual(parsePurchaseMessage('Ryuji\ngajaiya@gmail.com\n\n1pots', 3000), {
    quantity: 1,
    amount: 3000,
    requestedName: 'Ryuji'
});
assert.deepStrictEqual(parsePurchaseMessage('shijiro buy 2 ea pots\ngajaiya03@gmail.com', 3000), {
    quantity: 2,
    amount: 6000,
    requestedName: 'shijiro'
});
assert.strictEqual(parsePurchaseMessage('he time to buy potions is from 9 a.m. to 12 p.m.', 3000), null);
assert.strictEqual(parsePurchaseMessage('ex:\n\n1HAST BUFF\n1RED POTION\npogibro1002 <--- you acc email\n\nPlease write it like this from now on', 3000), null);
assert.strictEqual(parsePurchaseMessage('buy now', 3000), null);
assert.strictEqual(getSheetName({ displayName: 'Gab - P Night Time' }, null), 'Gab');
assert.strictEqual(
    getPurchaseSheetName({ displayName: 'Alt - Guest', roles: roles([]) }, 'Lancyy', CONFIG.ROLES),
    'Lancyy'
);
assert.strictEqual(
    getPurchaseSheetName({ displayName: 'Mark - Trainee - H Day Time', roles: roles(['day']) }, '1', CONFIG.ROLES),
    'Mark'
);
assert.strictEqual(getMemberServer({ roles: roles(['paagrio']) }, CONFIG.ROLES), 'PAAGRIO');
assert.strictEqual(getMemberShift({ roles: roles(['night']) }, CONFIG.ROLES), 'NIGHT');
assert.strictEqual(getPurchaseSheetDayOfMonth(momentTimezone, CONFIG.TIMEZONE, new Date('2026-06-01T01:00:00Z')), 1);
assert(formatPurchaseRequestOwnerDm({ userName: 'Gab', quantity: 2 }).includes('Gab님이 포션을 2개 신청했습니다.'));
assert(formatPurchaseApprovedDm({ quantity: 2 }).includes('Please check your potions'));

(async () => {
    {
        const calls = [];
        const message = createMessage({ calls });
        message.author.send = async content => calls.push(`authorDm:${content}`);
        const handler = createHandler({
            message,
            calls,
            purchaseSheetService: {
                addPurchase: async () => {
                    throw new Error('messageCreate should not write to sheet');
                }
            }
        });

        await handler.messageCreate(message);

        assert.strictEqual(calls[0], `react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`);
        assert(calls[1].startsWith('ownerDm:owner:'));
        assert(calls[1].includes('Gab님이 포션을 2개 신청했습니다.'));
        assert(calls[1].includes('확인한 후 구매해 주세요.'));
    }

    {
        const calls = [];
        const cancelReaction = createReaction({
            emoji: CONFIG.PURCHASE_CANCEL_EMOJI,
            calls,
            users: ['reviewer', 'bot']
        });
        const message = createMessage({ calls, reactions: [cancelReaction] });
        message.author.send = async content => calls.push(`authorDm:${content}`);
        const handler = createHandler({
            message,
            calls,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!H35', nextValue: 9000 };
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
            'sheet:PAAGRIO:NIGHT:Gab:6000:1',
            'removeAllReactions',
            `react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`,
            `react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`,
            `authorDm:${formatPurchaseApprovedDm({ quantity: 2 })}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            createdAt: new Date('2026-06-01T01:00:00Z')
        });
        const handler = createHandler({
            message,
            calls,
            momentOverride: momentTimezone,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!H35', nextValue: 6000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert(calls.includes('sheet:PAAGRIO:NIGHT:Gab:6000:1'));
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            content: 'Gab haste buff',
            createdAt: new Date('2026-06-01T01:00:00Z')
        });
        message.author.send = async content => calls.push(`authorDm:${content}`);
        const handler = createHandler({
            message,
            calls,
            momentOverride: momentTimezone,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!H35', nextValue: 9900 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert(calls.includes('sheet:PAAGRIO:NIGHT:Gab:9900:1'));
        assert(calls.some(call => call.includes('Your haste buff has been purchased.')));
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            content: 'Lancyy 1 buy',
            createdAt: new Date('2026-06-02T01:47:00Z'),
            member: {
                displayName: 'Lanceyy - Guest',
                roles: roles([])
            }
        });
        const handler = createHandler({
            message,
            calls,
            momentOverride: momentTimezone,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    if (payload.server === 'HEINE') return { ok: false, code: 'user-not-found' };
                    return { ok: true, range: 'Paagrio Great!H35', nextValue: 3000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert(calls.includes('sheet:HEINE:NIGHT:Lancyy:3000:2'));
        assert(calls.includes('sheet:PAAGRIO:NIGHT:Lancyy:3000:2'));
    }

    {
        const calls = [];
        const successReaction = createReaction({
            emoji: CONFIG.PURCHASE_SUCCESS_EMOJI,
            calls
        });
        const approvalReaction = createReaction({
            emoji: CONFIG.PURCHASE_APPROVAL_EMOJI,
            calls,
            users: ['reviewer']
        });
        const message = createMessage({ calls, reactions: [successReaction, approvalReaction] });
        const handler = createHandler({
            message,
            calls,
            purchaseSheetService: {
                addPurchase: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!H35', nextValue: 3000 };
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
            'sheet:PAAGRIO:NIGHT:Gab:-6000:1',
            'removeAllReactions',
            `react:${CONFIG.PURCHASE_CANCEL_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            message,
            calls,
            purchaseSheetService: {
                addPurchase: async () => {
                    throw new Error('cancel without a recorded purchase should be ignored');
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_CANCEL_EMOJI },
            message
        }, { id: 'reviewer', bot: false });

        assert.deepStrictEqual(calls, []);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            message,
            calls,
            purchaseSheetService: {
                addPurchase: async () => {
                    throw new Error('non-owner approval should be ignored');
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
            message,
            calls,
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
            'removeAllReactions',
            `react:${CONFIG.PURCHASE_FAILURE_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            message,
            calls,
            purchaseSheetService: {
                addPurchase: async () => ({ ok: false, code: 'sheet-api-error' })
            },
            opsQueueService: {
                enqueue: async item => {
                    calls.push(`queue:${item.kind}:${item.action}:${item.userName}`);
                    return { ok: true };
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
            'queue:purchase:approve:Gab',
            'removeAllReactions',
            `react:${CONFIG.PURCHASE_FAILURE_EMOJI}`
        ]);
    }

    console.log('purchase-reaction-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
