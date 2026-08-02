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
    END_ADENA_SUMMARY_OWNER_ROLE_IDS: ['server-owner'],
    END_ADENA_SUMMARY_USER_IDS: ['zurin'],
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
        serverOwner: { roles: roles(['server-owner']) },
        manager: {
            roles: roles([]),
            permissions: { has: flag => flag === 'ManageMessages' }
        },
        head: { roles: roles(['head-manager']) },
        zurin: { roles: roles(['head-manager']) },
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
            ownerId: 'guild-owner',
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

function createHandler({
    purchaseSheetService,
    momentOverride = null,
    getShiftBounds = null,
    submissionValidationService = null,
    onApprovalRecorded = null,
    retryDelaysMs = [],
    waitFn = async () => {}
}) {
    return createEndAdenaReactionHandler({
        MessagePermissionFlags: {
            Administrator: 'Administrator',
            ManageMessages: 'ManageMessages'
        },
        CONFIG,
        moment: momentOverride || (() => ({ tz: () => ({ date: () => 1 }) })),
        getShiftBounds,
        purchaseSheetService,
        submissionValidationService,
        onApprovalRecorded,
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
assert.deepStrictEqual(parseEndAdenaMessage('GAINED ADENA 180,000'), {
    rawAmount: 180000,
    amount: 180000,
    requestedName: null
});
assert.deepStrictEqual(parseEndAdenaMessage('GAINED ADENA=180,000'), {
    rawAmount: 180000,
    amount: 180000,
    requestedName: null
});
assert.deepStrictEqual(parseEndAdenaMessage('-GAINED ADENA 133,000'), {
    rawAmount: 133000,
    amount: 133000,
    requestedName: null
});
assert.deepStrictEqual(parseEndAdenaMessage('NAME: Bellet\n-GAINED ADENA:111,125'), {
    rawAmount: 111125,
    amount: 111000,
    requestedName: 'Bellet'
});
assert.deepStrictEqual(parseEndAdenaMessage([
    'Name: Kauchinrei (OT)',
    '-START: 08/2/2026',
    '-START TIME: 12:00 AM KR TIME',
    '-GAINED ADENA : 130,000'
].join('\n')), {
    rawAmount: 130000,
    amount: 130000,
    requestedName: 'Kauchinrei',
    startDate: '08/2/2026',
    startTime: '12:00 AM',
    startTimezone: 'Asia/Seoul',
    submissionType: 'OVERTIME'
});
assert.strictEqual(parseEndAdenaMessage('END ADENA: 150,884'), null);
assert.strictEqual(getServerForChannel('paagrio-end', CONFIG.END_ADENA_CHANNEL_IDS), 'PAAGRIO');
assert.strictEqual(getServerForChannel('heine-end', CONFIG.END_ADENA_CHANNEL_IDS), 'VALAKAS');
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
        const message = createMessage({ calls });
        message.reply = async payload => {
            calls.push(`reply:${payload.content}`);
            return {
                edit: async next => {
                    calls.push(`edit:${next.content}`);
                    return this;
                }
            };
        };
        let valid = false;
        const handler = createHandler({
            submissionValidationService: {
                validate: async () => ({ valid, issues: valid ? [] : [{ code: 'attendance-not-found', severity: 'error' }] }),
                format: result => `validation:${result.valid}`
            },
            purchaseSheetService: {
                addAdena: async () => {
                    throw new Error('prevalidation must not write to sheet');
                }
            }
        });

        await handler.messageCreate(message);
        assert(calls.includes(`react:${CONFIG.PURCHASE_FAILURE_EMOJI}`));
        assert(calls.includes('reply:validation:false'));

        valid = true;
        await handler.messageUpdate(null, message);
        assert(calls.includes(`react:${CONFIG.PURCHASE_PROCESSING_EMOJI}`));
        assert(calls.includes('edit:validation:true'));
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        message.reply = async payload => {
            calls.push(`reply:${payload.content}`);
            return { edit: async () => null };
        };
        const handler = createHandler({
            submissionValidationService: {
                validate: async () => ({ valid: false, issues: [{ code: 'server-mismatch', severity: 'error' }] }),
                format: () => 'validation:blocked'
            },
            purchaseSheetService: {
                addAdena: async () => {
                    calls.push('sheet:must-not-run');
                    return { ok: true };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes(`react:${CONFIG.PURCHASE_FAILURE_EMOJI}`));
        assert(calls.includes('reply:validation:blocked'));
        assert.strictEqual(calls.includes('sheet:must-not-run'), false);
    }

    {
        const calls = [];
        const message = createMessage({ calls });
        const validationReply = {
            edit: async payload => {
                calls.push(`validation-edit:${payload.content}`);
                return validationReply;
            },
            delete: async () => calls.push('validation-delete')
        };
        message.reply = async payload => {
            calls.push(`validation-reply:${payload.content}`);
            return validationReply;
        };
        const handler = createHandler({
            submissionValidationService: {
                validate: async () => ({ valid: true, issues: [] }),
                format: () => 'validation:ready'
            },
            purchaseSheetService: {
                addAdena: async () => ({ ok: true, range: 'Paagrio Great!C4', nextValue: 140000 })
            }
        });

        await handler.messageCreate(message);
        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert(calls.includes('validation-reply:validation:ready'));
        assert(calls.includes('validation-edit:validation:ready'));
        assert(calls.includes('validation-delete'));
    }

    {
        const calls = [];
        const approvalReaction = createReaction({
            emoji: CONFIG.PURCHASE_APPROVAL_EMOJI,
            calls,
            users: ['head']
        });
        const failureReaction = createReaction({
            emoji: CONFIG.PURCHASE_FAILURE_EMOJI,
            calls,
            users: ['bot']
        });
        const message = createMessage({ calls, reactions: [approvalReaction, failureReaction] });
        message.reply = async () => ({ edit: async () => null });
        let valid = false;
        const handler = createHandler({
            submissionValidationService: {
                validate: async () => ({ valid, issues: valid ? [] : [{ code: 'name-not-found', severity: 'error' }] }),
                format: result => `validation:${result.valid}`
            },
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`sheet:resumed:${payload.userName}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 140000 };
                }
            }
        });

        await handler.messageCreate(message);
        valid = true;
        await handler.messageUpdate(null, message);
        assert(calls.includes('fetch:head'));
        assert(calls.includes('sheet:resumed:BitShelby'));
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
                    throw new Error('approved message edit should not write to sheet');
                }
            }
        });

        await handler.messageUpdate(null, message);

        assert.deepStrictEqual(calls, []);
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

        assert.deepStrictEqual(calls, ['fetch:manager']);
    }

    {
        const calls = [];
        const approvalEvents = [];
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
            getShiftBounds: (shift, input) => {
                assert.strictEqual(shift, 'day');
                const start = momentTimezone(input).tz(CONFIG.TIMEZONE).startOf('day').hour(9);
                return { start, end: start.clone().hour(21) };
            },
            onApprovalRecorded: async event => approvalEvents.push(event),
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
        assert.strictEqual(approvalEvents.length, 1);
        assert.strictEqual(approvalEvents[0].audit.reviewerId, 'head');
        assert.strictEqual(approvalEvents[0].audit.authorId, 'author');
        assert.match(approvalEvents[0].audit.shiftStartAt, /T01:00:00\.000Z$/);
        assert.match(approvalEvents[0].audit.shiftEndAt, /T13:00:00\.000Z$/);
    }

    {
        const calls = [];
        let writtenPayload = null;
        const message = createMessage({
            calls,
            createdAt: new Date('2026-07-29T20:31:11.319Z'),
            member: {
                displayName: 'Deia - P Day Time',
                roles: roles(['day'])
            },
            content: 'NAME: Deia\n-GAINED ADENA:60,000'
        });
        const handler = createHandler({
            momentOverride: momentTimezone,
            getShiftBounds: (_shift, input) => {
                const start = momentTimezone(input).tz(CONFIG.TIMEZONE).startOf('day').hour(9);
                return { start, end: start.clone().hour(21) };
            },
            submissionValidationService: {
                validate: async () => ({
                    valid: true,
                    issues: [],
                    shiftStartAt: '2026-07-29T01:00:00.000Z',
                    shiftEndAt: '2026-07-29T13:00:00.000Z',
                    shiftResolutionSource: 'attendance-session',
                    attendanceSessionId: 'day:2026-07-29-09-00:overtime',
                    attendanceSessionType: 'FORCED'
                })
            },
            purchaseSheetService: {
                addAdena: async payload => {
                    writtenPayload = payload;
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 60000 };
                }
            }
        });

        await handler.reactionAdd({
            partial: false,
            emoji: { name: CONFIG.PURCHASE_APPROVAL_EMOJI },
            message
        }, { id: 'head', bot: false });

        assert.strictEqual(writtenPayload.dayOfMonth, 29);
        assert.strictEqual(writtenPayload.audit.shiftStartAt, '2026-07-29T01:00:00.000Z');
        assert.strictEqual(writtenPayload.audit.shiftEndAt, '2026-07-29T13:00:00.000Z');
        assert.strictEqual(writtenPayload.audit.shiftResolutionSource, 'attendance-session');
        assert.strictEqual(writtenPayload.audit.attendanceSessionId, 'day:2026-07-29-09-00:overtime');
        assert.strictEqual(writtenPayload.audit.attendanceSessionType, 'FORCED');
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

        assert(calls.includes('sheet:VALAKAS:NIGHT:Bellet:111000:31'));
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

        assert(calls.includes('sheet:VALAKAS:NIGHT:Lancyy:120000:1'));
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
            momentOverride: () => ({ tz: () => ({ date: () => 31 }) }),
            purchaseSheetService: {
                addAdena: async () => {
                    throw new Error('explicit Zurin access should use summary write');
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
        }, { id: 'zurin', bot: false });

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
                    throw new Error('guild owner approval should use summary write');
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
        }, { id: 'guild-owner', bot: false });

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
                addAdena: async () => {
                    throw new Error('server owner role approval should use summary write');
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
        }, { id: 'serverOwner', bot: false });

        assert(calls.includes('summary:PAAGRIO:DAY:BitShelby:140000:140884:31'));
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
        }, { id: 'owner', bot: false });

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
            users: ['head']
        });
        const failureReaction = createReaction({
            emoji: CONFIG.PURCHASE_FAILURE_EMOJI,
            calls,
            users: ['bot']
        });
        const message = createMessage({
            calls,
            reactions: [approvalReaction, failureReaction],
            content: 'NAME: BitShelby\n-GAINED ADENA 180,000'
        });
        const handler = createHandler({
            purchaseSheetService: {
                addAdena: async payload => {
                    calls.push(`retry-sheet:${payload.server}:${payload.shift}:${payload.userName}:${payload.amount}:${payload.dayOfMonth}`);
                    return { ok: true, range: 'Paagrio Great!C4', nextValue: 180000 };
                }
            }
        });

        await handler.syncMessageStatus(message, { pendingMessageIds: new Set() });

        assert(calls.includes('fetch:head'));
        assert(calls.includes('retry-sheet:PAAGRIO:DAY:BitShelby:180000:1'));
        assert(calls.includes(`react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`));
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



