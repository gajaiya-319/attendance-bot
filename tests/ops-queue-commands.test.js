const assert = require('assert');
const { createOpsQueueCommands, retryQueuedItem } = require('../src/commands/admin/opsQueueCommands');

const CONFIG = {
    PURCHASE_APPROVAL_EMOJI: '✅',
    PURCHASE_CANCEL_EMOJI: '❌',
    PURCHASE_SUCCESS_EMOJI: '📊',
    PURCHASE_FAILURE_EMOJI: '⚠️',
    PURCHASE_PROCESSING_EMOJI: '⏳'
};

function createInteraction() {
    const replies = [];
    const interaction = {
        member: { permissions: { has: () => true } },
        user: { id: 'owner' },
        deferred: false,
        replied: false,
        client: { channels: { fetch: async () => null } },
        deferReply: async () => {
            interaction.deferred = true;
            replies.push('defer');
        },
        editReply: async payload => {
            replies.push(payload.content);
        },
        reply: async payload => {
            replies.push(payload.content);
        },
        replies
    };
    return interaction;
}

(async () => {
    {
        const interaction = createInteraction();
        const commands = createOpsQueueCommands({
            MessageFlags: { Ephemeral: 64 },
            CONFIG,
            canRun: () => true,
            opsQueueService: {
                list: async () => [{
                    id: 'end-adena:approve:msg1:HEINE:Ding dong',
                    kind: 'end-adena',
                    action: 'approve',
                    server: 'HEINE',
                    shift: 'NIGHT',
                    userName: 'Ding dong',
                    code: 'user-not-found',
                    payload: { amount: 130000 }
                }]
            },
            purchaseSheetService: {}
        });

        assert(commands.pending.aliases.includes('작업대기'));
        assert(commands.retry.aliases.includes('작업재시도'));
        await commands.pending.execute(interaction);
        assert(interaction.replies.some(text => String(text).includes('시트 입력 대기 작업: 1개')));
        assert(interaction.replies.some(text => String(text).includes('Ding dong')));
    }

    {
        const interaction = createInteraction();
        let retriedPayload = null;
        const commands = createOpsQueueCommands({
            MessageFlags: { Ephemeral: 64 },
            CONFIG,
            canRun: () => true,
            opsQueueService: {
                list: async () => [],
                retryAll: async executor => {
                    const result = await executor({
                        kind: 'end-adena',
                        action: 'approve',
                        method: 'addAdena',
                        messageId: 'msg1',
                        channelId: 'chan1',
                        payload: {
                            server: 'HEINE',
                            shift: 'NIGHT',
                            userName: 'Ding dong',
                            amount: 130000,
                            dayOfMonth: 1
                        }
                    });
                    return { ok: true, total: 1, succeeded: result.ok ? 1 : 0, failed: result.ok ? 0 : 1 };
                }
            },
            purchaseSheetService: {
                addAdena: async payload => {
                    retriedPayload = payload;
                    return { ok: true, range: 'Heine Great!C9' };
                }
            }
        });

        await commands.retry.execute(interaction);
        assert.strictEqual(retriedPayload.userName, 'Ding dong');
        assert(interaction.replies.some(text => String(text).includes('성공: 1개')));
    }

    {
        const calls = [];
        const reactionCache = [
            {
                emoji: { name: '\u26A0' },
                users: {
                    remove: async id => calls.push(`remove:${id}`)
                },
                remove: async () => {
                    calls.push('removeAll');
                    return true;
                }
            }
        ];
        const message = {
            client: { user: { id: 'bot1' } },
            reactions: {
                cache: {
                    find: fn => reactionCache.find(fn)
                }
            },
            react: async emoji => calls.push(`react:${emoji}`)
        };
        const result = await retryQueuedItem({
            item: {
                kind: 'end-adena',
                action: 'approve',
                method: 'addAdena',
                channelId: 'chan1',
                messageId: 'msg1',
                payload: { userName: 'Giru Kun' }
            },
            client: {
                channels: {
                    fetch: async () => ({
                        messages: {
                            fetch: async () => message
                        }
                    })
                }
            },
            CONFIG,
            purchaseSheetService: {
                addAdena: async () => ({ ok: true })
            }
        });
        assert.strictEqual(result.ok, true);
        assert(calls.includes('remove:bot1'));
        assert(calls.includes(`react:${CONFIG.PURCHASE_APPROVAL_EMOJI}`));
        assert(calls.includes(`react:${CONFIG.PURCHASE_SUCCESS_EMOJI}`));
    }

    console.log('ops-queue-commands tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
