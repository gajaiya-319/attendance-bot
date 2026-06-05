const assert = require('assert');
const momentTimezone = require('moment-timezone');
const {
    createEndAdenaReactionHandler,
    parseEndAdenaMessage,
    getServerForChannel,
    getMessageDayOfMonth,
    getSheetName,
    getEndAdenaSheetName,
    getMemberShift
} = require('../src/events/endAdenaReactionHandler');

const CONFIG = {
    PURCHASE_SPREADSHEET_ID: 'sheet',
    PURCHASE_APPROVAL_EMOJI: '\u2705',
    PURCHASE_CANCEL_EMOJI: '\u274C',
    PURCHASE_PROCESSING_EMOJI: '\u23F3',
    PURCHASE_SUCCESS_EMOJI: '\uD83D\uDCCA',
    PURCHASE_FAILURE_EMOJI: '\u26A0\uFE0F',
    PURCHASE_OWNER_DM_IDS: ['owner'],
    END_ADENA_CHANNEL_IDS: {
        PAAGRIO: 'paagrio-end',
        HEINE: 'heine-end'
    },
    END_ADENA_REVIEWER_ROLE_IDS: ['head-manager', 'player-manager'],
    TIMEZONE: 'Asia/Manila',
    ROLES: {
        DAY: 'day',
        NIGHT: 'night'
    }
};

function roles(ids) {
    return { cache: { has: id => ids.includes(id) } };
}

function createReaction({ emoji, calls, users = ['bot'], removeSucceeds = true }) {
    return {
        emoji: { name: emoji },
        count: users.length,
        remove: async () => {
            calls.push(`removeAll:${emoji}`);
            if (!removeSucceeds) throw new Error('missing-manage-messages');
        },
        users: {
            fetch: async () => new Map(users.map(id => [id, { id }])),
            remove: async id => calls.push(`remove:${emoji}:${id}`)
        }
    };
}

function createMessage({
    calls,
    channelId = 'paagrio-end',
    content = 'NAME: BitShelby\n-GAINED ADENA: 140,884',
    createdAt = new Date('2026-05-31T05:00:00Z'),
    reactions = [],
    member = null
}) {
    const authorMember = member || {
        displayName: 'BitShelby - H Day Time',
        roles: roles(['day'])
    };
    const reviewerMembers = {
        owner: { roles: roles([]) },
        manager: {
            roles: roles([]),
            permissions: { has: flag => flag === 'ManageMessages' }
        },
        head: { roles: roles(['head-manager']) },
        reviewer: { roles: roles([]) }
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

function createHandler({ purchaseSheetService, momentOverride = null, retryDelaysMs = [], waitFn = async () => {} }) {
    return createEndAdenaReactionHandler({
        MessagePermissionFlags: {
            Administrator: 'Administrator',
            ManageMessages: 'ManageMessages'
        },
        CONFIG,
        moment: momentOverride || (() => ({ tz: () => ({ date: () => 1 }) })),
        purchaseSheetService,
        retryDelaysMs,
        waitFn,
        logger: { log: () => {}, warn: () => {}, error: () => {} }
    });
}

assert.deepStrictEqual(parseEndAdenaMessage('GAINED ADENA: 140,884'), {
    rawAmount: 140884,
    amount: 140000,
    requestedName: null
});
assert.deepStrictEqual(parseEndAdenaMessage('GAINED ADENA: 300.701'), {
    rawAmount: 300701,
    amount: 300000,
    requestedName: null
});
assert.deepStrictEqual(parseEndAdenaMessage('NAME: Bellet\n-GAINED ADENA:111,125'), {
    rawAmount: 111125,
    amount: 111000,
    requestedName: 'Bellet'
});
assert.strictEqual(parseEndAdenaMessage('END ADENA: 150,884'), null);
assert.strictEqual(getServerForChannel('paagrio-end', CONFIG.END_ADENA_CHANNEL_IDS), 'PAAGRIO');
assert.strictEqual(getServerForChannel('heine-end', CONFIG.END_ADENA_CHANNEL_IDS), 'HEINE');
assert.strictEqual(
    getMessageDayOfMonth(
        input => ({
            tz: timezone => ({
                date: () => {
                    assert.strictEqual(input.toISOString(), '2026-05-31T05:00:00.000Z');
                    assert.strictEqual(timezone, 'Asia/Manila');
                    return 31;
                }
            })
        }),
        'Asia/Manila',
        { createdAt: new Date('2026-05-31T05:00:00Z') }
    ),
    31
);
assert.strictEqual(
    getMessageDayOfMonth(
        momentTimezone,
        'Asia/Manila',
        { createdAt: new Date('2026-06-01T01:00:00Z') },
        'NIGHT'
    ),
    31
);
assert.strictEqual(
    getSheetName({ displayName: 'BitShelby - H Day Time', user: { username: 'ignored' } }, 'WrongName'),
    'BitShelby'
);
assert.strictEqual(
    getSheetName(null, 'FallbackName'),
    'FallbackName'
);
assert.strictEqual(
    getEndAdenaSheetName(
        { displayName: 'Lanceyy - Guest', user: { username: 'alt' }, roles: roles([]) },
        'Lancyy',
        CONFIG.ROLES
    ),
    'Lancyy'
);

(async () => {
    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            purchaseSheetService: {
                addAdena: async () => {
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
        const momentInputs = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            momentOverride: input => {
                momentInputs.push(input);
                return { tz: () => ({ date: () => 31 }) };
            },
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 140000 };
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
            'sheet:PAAGRIO:DAY:BitShelby:140000:31',
            `react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`,
            `react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`
        ]);
        assert.strictEqual(momentInputs[0], message.createdAt);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 140000 };
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
            'sheet:PAAGRIO:DAY:BitShelby:140000:1',
            `react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`,
            `react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            content: 'NAME: WrongName\n-GAINED ADENA: 140,884',
            member: {
                displayName: 'BitShelby - H Day Time',
                roles: roles(['day'])
            }
        });
        const handler = createHandler({
            momentOverride: input => {
                assert.strictEqual(input, message.createdAt);
                return { tz: () => ({ date: () => 31 }) };
            },
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 140000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes('sheet:PAAGRIO:DAY:BitShelby:140000:31'));
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            channelId: 'heine-end',
            createdAt: new Date('2026-06-01T01:00:00Z'),
            member: {
                displayName: 'Bellet - H Night Time',
                roles: roles(['night'])
            },
            content: 'NAME: Bellet\n-GAINED ADENA:111,125'
        });
        const handler = createHandler({
            momentOverride: momentTimezone,
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Heine Great!L35', nextValue: 111000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes('sheet:HEINE:NIGHT:Bellet:111000:31'));
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            channelId: 'heine-end',
            createdAt: new Date('2026-06-02T01:47:00Z'),
            member: {
                displayName: 'Lanceyy - Guest',
                roles: roles([])
            },
            content: 'NAME: Lancyy\n-GAINED ADENA:120,000'
        });
        const handler = createHandler({
            momentOverride: momentTimezone,
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Heine Great!L35', nextValue: 120000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes('sheet:HEINE:NIGHT:Lancyy:120000:1'));
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            channelId: 'paagrio-end',
            createdAt: new Date('2026-06-02T13:47:00Z'),
            member: {
                displayName: 'AltAccount - Guest',
                roles: roles([])
            },
            content: 'NAME: Zeki\n-GAINED ADENA:120,000'
        });
        const handler = createHandler({
            momentOverride: momentTimezone,
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 120000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes('sheet:PAAGRIO:DAY:Zeki:120000:2'));
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            content: 'NAME: BitShelby\n-GAINED ADENA: 140,884'
        });
        const handler = createHandler({
            momentOverride: input => {
                assert.strictEqual(input, message.createdAt);
                return { tz: () => ({ date: () => 31 }) };
            },
            purchaseSheetService: {
                addAdena: async () => {
                    throw new Error('owner approval should use summary write');
                },
                addAdenaWithSummary: async payload => {
                    calls.push(`summary:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.rawAmount}:${payload.dayOfMonth}`);
                    return {
                        ok: true,
                        range: 'Paagrio Great!C4',
                        summaryRange: 'Paagrio Great!L59',
                        nextValue: 140000,
                        summaryNextValue: 140884
                    };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert(calls.includes('summary:PAAGRIO:DAY:BitShelby:140000:140884:31'));
    }

    {
        const calls = [];
        const message = createMessage({
            calls,
            content: 'NAME: BitShelby\n-GAINED ADENA: 140,884'
        });
        const handler = createHandler({
            momentOverride: input => {
                assert.strictEqual(input, message.createdAt);
                return { tz: () => ({ date: () => 31 }) };
            },
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 140000 };
                },
                addAdenaWithSummary: async () => {
                    throw new Error('manager approval should not use summary write');
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes('sheet:PAAGRIO:DAY:BitShelby:140000:31'));
    }

    {
        const calls = [];
        const successReaction = createReaction({
            emoji: CONFIG.PURCHASE_SUCCESS_EMOJI,
            calls
        });
        const message = createMessage({ calls, reactions: [successReaction] });
        const handler = createHandler({
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 0 };
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
            'sheet:PAAGRIO:DAY:BitShelby:-140000:1',
            `removeAll:${CONFIG.PURCHASE_SUCCESS_EMOJI}`,
            `react:${CONFIG.PURCHASE_CANCEL_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const successReaction = createReaction({
            emoji: CONFIG.PURCHASE_SUCCESS_EMOJI,
            calls
        });
        const message = createMessage({ calls, reactions: [successReaction] });
        const handler = createHandler({
            purchaseSheetService: {
                addAdena: async () => {
                    throw new Error('cancel should reverse summary too');
                },
                addAdenaWithSummary: async payload => {
                    calls.push(`summary:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.rawAmount}:${payload.dayOfMonth}`);
                    return {
                        ok: true,
                        range: 'Paagrio Great!C4',
                        summaryRange: 'Paagrio Great!L59',
                        nextValue: 0,
                        summaryNextValue: 0
                    };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_CANCEL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes('summary:PAAGRIO:DAY:BitShelby:-140000:-140884:1'));
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const handler = createHandler({
            purchaseSheetService: {
                addAdena: async () => {
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
            purchaseSheetService: {
                addAdena: async () => ({ ok: false, code: 'sheet-api-error' })
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
        const handler = createEndAdenaReactionHandler({
            MessagePermissionFlags: {
                Administrator: 'Administrator',
                ManageMessages: 'ManageMessages'
            },
            CONFIG,
            moment: () => ({ tz: () => ({ date: () => 1 }) }),
            purchaseSheetService: {
                addAdena: async () => ({ ok: false, code: 'sheet-api-error' })
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
            'queue:end-adena:approve:BitShelby',
            `react:${CONFIG.PURCHASE_FAILURE_EMOJI}`
        ]);
    }

    {
        const calls = [];
        const waits = [];
        const message = createMessage({ calls });
        let attempts = 0;
        const handler = createHandler({
            retryDelaysMs: [3000, 10000],
            waitFn: async ms => waits.push(ms),
            purchaseSheetService: {
                addAdena: async payload => {
                    attempts += 1;
                    calls.push(`attempt:${attempts}:${payload.userName}`);
                    if (attempts < 3) return { ok: false, code: 'sheet-api-error' };
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 140000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'owner', bot: false });

        assert.deepStrictEqual(waits, [3000, 10000]);
        assert(calls.includes('attempt:1:BitShelby'));
        assert(calls.includes('attempt:2:BitShelby'));
        assert(calls.includes('attempt:3:BitShelby'));
        assert.strictEqual(calls.slice(-2)[0], `react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`);
        assert.strictEqual(calls.slice(-1)[0], `react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`);
    }

    {
        const calls = [];
        const approvalReaction = createReaction({
            emoji: CONFIG.PURCHASE_APPROVAL_EMOJI,
            calls,
            users: ['head'],
            removeSucceeds: false
        });
        const cancelReaction = createReaction({
            emoji: CONFIG.PURCHASE_CANCEL_EMOJI,
            calls,
            users: ['owner'],
            removeSucceeds: false
        });
        const failureReaction = createReaction({
            emoji: CONFIG.PURCHASE_FAILURE_EMOJI,
            calls,
            users: ['bot'],
            removeSucceeds: false
        });
        const processingReaction = createReaction({
            emoji: CONFIG.PURCHASE_PROCESSING_EMOJI,
            calls,
            users: ['bot'],
            removeSucceeds: false
        });
        const message = createMessage({
            calls,
            reactions: [approvalReaction, cancelReaction, failureReaction, processingReaction]
        });
        const handler = createHandler({
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 140000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes(`remove:${CONFIG.PURCHASE_APPROVAL_EMOJI}:head`));
        assert(calls.includes(`remove:${CONFIG.PURCHASE_CANCEL_EMOJI}:owner`));
        assert(calls.includes(`remove:${CONFIG.PURCHASE_FAILURE_EMOJI}:bot`));
        assert(calls.includes(`remove:${CONFIG.PURCHASE_PROCESSING_EMOJI}:bot`));
        assert.strictEqual(calls.slice(-2)[0], `react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`);
        assert.strictEqual(calls.slice(-1)[0], `react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`);
    }

    console.log('end-adena-reaction-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});



