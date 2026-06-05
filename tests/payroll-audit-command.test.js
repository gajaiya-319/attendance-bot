const assert = require('assert');
const {
    createPayrollAuditCommand,
    renderPayrollAudit,
    duplicateEntries
} = require('../src/commands/admin/payrollAuditCommand');

const logs = [
    {
        id: '1',
        messageId: 'msg1',
        kind: 'end-adena',
        action: 'approve',
        server: 'HEINE',
        shift: 'NIGHT',
        userName: 'Ding dong',
        payload: { rawAmount: 130000 }
    },
    {
        id: '2',
        messageId: 'msg1',
        kind: 'end-adena',
        action: 'approve',
        server: 'HEINE',
        shift: 'NIGHT',
        userName: 'Ding dong',
        payload: { rawAmount: 130000 }
    }
];

assert.strictEqual(duplicateEntries(logs).length, 1);
const rendered = renderPayrollAudit({
    pending: [{ kind: 'purchase' }, { kind: 'death-penalty' }],
    logs
});
assert(rendered.includes('\uae09\uc5ec \uac80\uc0ac'));
assert(rendered.includes('\uc2dc\ud2b8 \uc2e4\ud328 \ub300\uae30: 2\uac1c'));
assert(rendered.includes('\uc911\ubcf5 \uc758\uc2ec: 1\uac1c'));

function createInteraction() {
    const replies = [];
    const interaction = {
        member: { permissions: { has: () => true } },
        deferred: false,
        replied: false,
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
    const interaction = createInteraction();
    const command = createPayrollAuditCommand({
        MessageFlags: { Ephemeral: 64 },
        canRun: () => true,
        opsQueueService: { list: async () => [{ kind: 'purchase' }] },
        payrollOperationLogService: { listRecent: async () => logs }
    });
    assert(command.aliases.includes('\uae09\uc5ec\uac80\uc0ac'));
    await command.execute(interaction);
    assert(interaction.replies.some(text => String(text).includes('\uc2dc\ud2b8 \uc2e4\ud328 \ub300\uae30: 1\uac1c')));
    console.log('payroll-audit-command tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
