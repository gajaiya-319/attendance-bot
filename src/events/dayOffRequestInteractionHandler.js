'use strict';

const CUSTOM_IDS = {
    openModal: 'dayoff-request:open',
    submitModal: 'dayoff-request:submit'
};
const PANEL_EMOJIS = {
    calendar: '\uD83D\uDCC5',
    required: '\u2705'
};

function normalizeShift(input) {
    const raw = String(input || '').trim().toLowerCase();
    if (['day', 'd', 'day time', 'daytime'].includes(raw)) {
        return { shift: 'day', shiftLabel: 'Day Time' };
    }
    if (['night', 'n', 'night time', 'nighttime'].includes(raw)) {
        return { shift: 'night', shiftLabel: 'Night Time' };
    }
    return null;
}

function inferShiftFromMember(member, CONFIG) {
    const hasDayRole = Boolean(member?.roles?.cache?.has(CONFIG.ROLES.DAY));
    const hasNightRole = Boolean(member?.roles?.cache?.has(CONFIG.ROLES.NIGHT));
    if (hasDayRole && !hasNightRole) return { shift: 'day', shiftLabel: 'Day Time' };
    if (hasNightRole && !hasDayRole) return { shift: 'night', shiftLabel: 'Night Time' };
    return null;
}

function createDayOffRequestInteractionHandler({
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    MessageFlags,
    CONFIG,
    dayOffService,
    submitDayOffRequest,
    canPostPanel,
    logger = console
}) {
    if (!ActionRowBuilder || !ButtonBuilder || !ButtonStyle || !EmbedBuilder) {
        throw new TypeError('Discord message builders must be provided');
    }
    if (!ModalBuilder || !TextInputBuilder || !TextInputStyle) {
        throw new TypeError('Discord modal builders must be provided');
    }
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (!dayOffService || typeof dayOffService.parseDayOffCommandDate !== 'function') {
        throw new TypeError('dayOffService.parseDayOffCommandDate must be a function');
    }
    if (typeof submitDayOffRequest !== 'function') throw new TypeError('submitDayOffRequest must be a function');
    if (typeof canPostPanel !== 'function') throw new TypeError('canPostPanel must be a function');

    const aliases = ['dayoff-panel'];

    function buildPanelPayload() {
        const embed = new EmbedBuilder()
            .setTitle(`${PANEL_EMOJIS.calendar} Day Off Request`)
            .setColor('#2563EB')
            .setDescription('Please complete the leave request form according to the required format.')
            .addFields({
                name: `${PANEL_EMOJIS.required} Required`,
                value: 'Name, Leave date, Shift, Reason',
                inline: false
            });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(CUSTOM_IDS.openModal)
                .setLabel('Day Off Request (Click)')
                .setStyle(ButtonStyle.Primary)
        );

        return { embeds: [embed], components: [row] };
    }

    async function executePanelCommand(interaction, { autoDel = () => {} } = {}) {
        if (!canPostPanel(interaction.member, interaction.user)) {
            return interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
        }

        const channelId = dayOffService.getDayOffChannelId();
        const channel = channelId
            ? await interaction.client.channels.fetch(channelId).catch(() => null)
            : interaction.channel;
        if (!channel?.send) {
            return interaction.reply({ content: 'Day-off channel not found.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
        }

        await channel.send(buildPanelPayload());
        return interaction.reply({ content: 'Day-off request panel posted.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
    }

    async function handleButton(interaction) {
        if (interaction.customId !== CUSTOM_IDS.openModal) return false;

        const inferred = inferShiftFromMember(interaction.member, CONFIG);
        const modal = new ModalBuilder()
            .setCustomId(CUSTOM_IDS.submitModal)
            .setTitle('Day Off Request Form');

        const nameInput = new TextInputBuilder()
            .setCustomId('name')
            .setLabel('Name')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(80)
            .setValue(interaction.member?.displayName || interaction.user?.username || '');

        const dateInput = new TextInputBuilder()
            .setCustomId('date')
            .setLabel('Leave Date (YYYY-MM-DD)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('2026-06-03')
            .setMinLength(8)
            .setMaxLength(20);

        const shiftInput = new TextInputBuilder()
            .setCustomId('shift')
            .setLabel('Shift (day or night)')
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setPlaceholder('day or night')
            .setMaxLength(20);
        if (inferred) shiftInput.setValue(inferred.shift);

        const reasonInput = new TextInputBuilder()
            .setCustomId('reason')
            .setLabel('Reason')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setMaxLength(500);

        modal.addComponents(
            new ActionRowBuilder().addComponents(nameInput),
            new ActionRowBuilder().addComponents(dateInput),
            new ActionRowBuilder().addComponents(shiftInput),
            new ActionRowBuilder().addComponents(reasonInput)
        );

        return interaction.showModal(modal);
    }

    async function handleModalSubmit(interaction) {
        if (interaction.customId !== CUSTOM_IDS.submitModal) return false;

        const submittedName = interaction.fields.getTextInputValue('name')?.trim();
        const dateInput = interaction.fields.getTextInputValue('date')?.trim();
        const shiftInput = interaction.fields.getTextInputValue('shift')?.trim();
        const reason = interaction.fields.getTextInputValue('reason')?.trim();

        const leaveDate = dayOffService.parseDayOffCommandDate(dateInput);
        if (!submittedName) {
            return interaction.reply({ content: 'Name is required.', flags: MessageFlags.Ephemeral });
        }
        if (!leaveDate) {
            return interaction.reply({ content: 'Invalid date. Please use YYYY-MM-DD, for example 2026-06-03.', flags: MessageFlags.Ephemeral });
        }
        const normalizedShift = normalizeShift(shiftInput);
        if (!normalizedShift) {
            return interaction.reply({ content: 'Invalid shift. Please enter day or night.', flags: MessageFlags.Ephemeral });
        }
        if (!reason) {
            return interaction.reply({ content: 'Reason is required.', flags: MessageFlags.Ephemeral });
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return false;

        const result = await submitDayOffRequest({
            interaction,
            submittedName,
            leaveDate,
            reason,
            ...normalizedShift
        }).catch(error => {
            logger.error?.('[DAYOFF MODAL SUBMIT ERROR]', error);
            return { ok: false, message: 'Day-off request failed. Please contact management.' };
        });

        return interaction.editReply({
            content: result?.message || (result?.ok ? 'Day-off request submitted.' : 'Day-off request failed.')
        });
    }

    return {
        aliases,
        executePanelCommand,
        handleButton,
        handleModalSubmit,
        buildPanelPayload,
        normalizeShift
    };
}

module.exports = {
    CUSTOM_IDS,
    createDayOffRequestInteractionHandler,
    normalizeShift
};
