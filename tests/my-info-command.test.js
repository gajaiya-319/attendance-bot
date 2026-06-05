const assert = require('assert');
const { createMyInfoCommand } = require('../src/commands/user/myInfoCommand');

class FakeEmbedBuilder {
    constructor() {
        this.data = { fields: [] };
    }

    setTitle(title) {
        this.data.title = title;
        return this;
    }

    setColor(color) {
        this.data.color = color;
        return this;
    }
}

(async () => {
    const state = {
        user1: {
            name: 'Tester',
            points: 42,
            totalNormal: 3,
            totalLate: 1,
            totalAbsent: 0,
            totalEarly: 2,
            totalOT: 4,
            offCount: 1
        }
    };
    const command = createMyInfoCommand({
        EmbedBuilder: FakeEmbedBuilder,
        MessageFlags: { Ephemeral: 64 },
        safeAddFields: (embed, ...fields) => {
            embed.data.fields.push(...fields);
            return embed;
        },
        getAttendanceData: () => state
    });

    let replyPayload = null;
    await command.execute({
        user: { id: 'user1' },
        reply: async payload => {
            replyPayload = payload;
        }
    });

    assert.strictEqual(command.aliases.includes('my-info'), true);
    assert.strictEqual(command.aliases.includes('내정보'), true);
    assert.strictEqual(replyPayload.flags, 64);
    assert.strictEqual(replyPayload.embeds[0].data.title, 'Tester STATUS');
    assert.strictEqual(replyPayload.embeds[0].data.fields[0].name, 'Total Points');
    assert.match(replyPayload.embeds[0].data.fields[1].value, /Overtime: 4/);

    await command.execute({
        user: { id: 'missing' },
        reply: async payload => {
            replyPayload = payload;
        }
    });

    assert.strictEqual(replyPayload.content, 'No data.');

    console.log('my-info-command tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
