const assert = require('assert');
const { createPayrollArchiveCommand } = require('../src/commands/admin/payrollArchiveCommand');

function createInteraction(userId = 'owner', period = null) {
    const interaction = {
        user: { id: userId, tag: `${userId}#0001` },
        member: { id: userId },
        deferred: false,
        replied: false,
        replyPayload: null,
        editPayload: null,
        options: {
            getString: name => (name === '기간' || name === 'period' ? period : null)
        },
        reply: async payload => {
            interaction.replied = true;
            interaction.replyPayload = payload;
        },
        deferReply: async payload => {
            interaction.deferred = true;
            interaction.deferPayload = payload;
        },
        editReply: async payload => {
            interaction.editPayload = payload;
        }
    };
    return interaction;
}

(async () => {
    {
        const calls = [];
        const command = createPayrollArchiveCommand({
            MessageFlags: { Ephemeral: 64 },
            isOwner: id => id === 'owner',
            payrollArchiveService: {
                saveCurrent: async payload => {
                    calls.push(payload);
                    return {
                        ok: true,
                        row: 2,
                        count: 2,
                        periodLabel: payload.periodLabel,
                        saved: [
                            { server: '파아그리오', totalAdena: 1000, playerShare: 650, ownerShare: 350, totalPeso: 26 },
                            { server: '하이네', totalAdena: 2000, playerShare: 1300, ownerShare: 700, totalPeso: 52 }
                        ]
                    };
                }
            }
        });
        const interaction = createInteraction('owner', '1회차');
        await command.execute(interaction, { autoDel: () => calls.push('autoDel') });
        assert.strictEqual(interaction.deferPayload.flags, 64);
        assert(interaction.editPayload.content.includes('급여 기록 완료: 1회차'));
        assert.strictEqual(calls[0].periodLabel, '1회차');
        assert.strictEqual(calls[0].savedBy, 'owner#0001');
        assert.strictEqual(calls[0].trigger, 'discord-급여기록');
        assert.strictEqual(calls[1], 'autoDel');
    }

    {
        const calls = [];
        const command = createPayrollArchiveCommand({
            MessageFlags: { Ephemeral: 64 },
            isOwner: id => id === 'owner',
            payrollArchiveService: {
                saveCurrent: async () => {
                    throw new Error('non-owner should not save');
                }
            }
        });
        const interaction = createInteraction('manager');
        await command.execute(interaction, { autoDel: () => calls.push('autoDel') });
        assert.strictEqual(interaction.replyPayload.flags, 64);
        assert(interaction.replyPayload.content.includes('서버주인만'));
        assert.deepStrictEqual(calls, ['autoDel']);
    }

    console.log('payroll-archive-command tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
