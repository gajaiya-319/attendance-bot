const assert = require('assert');
const {
    CUSTOM_IDS,
    createDayOffRequestInteractionHandler,
    normalizeShift
} = require('../src/events/dayOffRequestInteractionHandler');

class ActionRowBuilder {
    constructor() { this.components = []; }
    addComponents(...components) { this.components.push(...components); return this; }
}

class ButtonBuilder {
    constructor() { this.data = {}; }
    setCustomId(value) { this.data.customId = value; return this; }
    setLabel(value) { this.data.label = value; return this; }
    setStyle(value) { this.data.style = value; return this; }
}

class EmbedBuilder {
    constructor() { this.data = { fields: [] }; }
    setTitle(value) { this.data.title = value; return this; }
    setColor(value) { this.data.color = value; return this; }
    setDescription(value) { this.data.description = value; return this; }
    addFields(field) { this.data.fields.push(field); return this; }
}

class ModalBuilder {
    constructor() { this.data = { components: [] }; }
    setCustomId(value) { this.data.customId = value; return this; }
    setTitle(value) { this.data.title = value; return this; }
    addComponents(...rows) { this.data.components.push(...rows); return this; }
}

class TextInputBuilder {
    constructor() { this.data = {}; }
    setCustomId(value) { this.data.customId = value; return this; }
    setLabel(value) { this.data.label = value; return this; }
    setStyle(value) { this.data.style = value; return this; }
    setRequired(value) { this.data.required = value; return this; }
    setMaxLength(value) { this.data.maxLength = value; return this; }
    setMinLength(value) { this.data.minLength = value; return this; }
    setValue(value) { this.data.value = value; return this; }
    setPlaceholder(value) { this.data.placeholder = value; return this; }
}

function createHandler(overrides = {}) {
    return createDayOffRequestInteractionHandler({
        ActionRowBuilder,
        ButtonBuilder,
        ButtonStyle: { Primary: 1 },
        EmbedBuilder,
        ModalBuilder,
        TextInputBuilder,
        TextInputStyle: { Short: 1, Paragraph: 2 },
        MessageFlags: { Ephemeral: 64 },
        CONFIG: { ROLES: { DAY: 'day-role', NIGHT: 'night-role' } },
        dayOffService: {
            getDayOffChannelId: () => 'dayoff-channel',
            parseDayOffCommandDate: value => value === '2026-06-03' ? value : null
        },
        submitDayOffRequest: async payload => ({ ok: true, message: `submitted:${payload.leaveDate}:${payload.shift}` }),
        canPostPanel: () => true,
        ...overrides
    });
}

(async () => {
    assert.deepStrictEqual(normalizeShift('day'), { shift: 'day', shiftLabel: 'Day Time' });
    assert.deepStrictEqual(normalizeShift('night'), { shift: 'night', shiftLabel: 'Night Time' });
    assert.strictEqual(normalizeShift('middle'), null);

    const handler = createHandler();
    const panel = handler.buildPanelPayload();
    assert.strictEqual(panel.embeds[0].data.title, '📅 Day Off Request');
    assert.match(panel.embeds[0].data.description, /required format/);
    assert.strictEqual(panel.embeds[0].data.fields[0].name, '✅ Required');
    assert.strictEqual(panel.embeds[0].data.fields[0].value, 'Name, Leave date, Shift, Reason');
    assert.strictEqual(panel.components[0].components[0].data.label, 'Day Off Request (Click)');

    let shownModal = null;
    await handler.handleButton({
        customId: CUSTOM_IDS.openModal,
        user: { username: 'Alice' },
        member: {
            displayName: 'Alice',
            roles: { cache: { has: id => id === 'day-role' } }
        },
        showModal: async modal => { shownModal = modal; return 'modal-shown'; }
    });
    assert.strictEqual(shownModal.data.customId, CUSTOM_IDS.submitModal);
    assert.strictEqual(shownModal.data.title, 'Day Off Request Form');
    const shiftInput = shownModal.data.components[2].components[0];
    assert.strictEqual(shiftInput.data.value, 'day');

    let replyPayload = null;
    await handler.handleModalSubmit({
        customId: CUSTOM_IDS.submitModal,
        fields: {
            getTextInputValue: id => ({
                name: 'Alice',
                date: 'bad-date',
                shift: 'day',
                reason: 'Family'
            })[id]
        },
        reply: async payload => { replyPayload = payload; return payload; }
    });
    assert.match(replyPayload.content, /Invalid date/);

    let editedReply = null;
    await handler.handleModalSubmit({
        customId: CUSTOM_IDS.submitModal,
        deferred: true,
        fields: {
            getTextInputValue: id => ({
                name: 'Alice',
                date: '2026-06-03',
                shift: 'night',
                reason: 'Family'
            })[id]
        },
        deferReply: async () => {},
        editReply: async payload => { editedReply = payload; return payload; }
    });
    assert.strictEqual(editedReply.content, 'submitted:2026-06-03:night');

    console.log('dayoff-request-interaction-handler tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
