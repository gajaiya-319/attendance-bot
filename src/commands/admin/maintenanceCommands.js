'use strict';

const KO = {
    root: '\uc810\uac80',
    set: '\uc124\uc815',
    list: '\ubaa9\ub85d',
    delete: '\uc0ad\uc81c',
    date: '\ub0a0\uc9dc',
    enabled: '\uc0ac\uc6a9',
    dayStart: '\uc8fc\uac04\uc2dc\uc791',
    dayEnd: '\uc8fc\uac04\uc885\ub8cc',
    nightStart: '\uc57c\uac04\uc2dc\uc791',
    nightEnd: '\uc57c\uac04\uc885\ub8cc',
    windowDate: '\uc810\uac80\ub0a0\uc9dc',
    windowStart: '\uc810\uac80\uc2dc\uc791',
    windowEnd: '\uc810\uac80\uc885\ub8cc',
    reason: '\uc0ac\uc720'
};

function formatOverride(entry) {
    const status = entry.enabled ? 'ON' : 'OFF';
    const parts = [`moved-maintenance-date ${entry.date}: ${status}`];
    if (entry.enabled) {
        parts.push(`day ${entry.dayStart || '09:00'}-${entry.dayEnd || '19:00'}`);
        parts.push(`night ${entry.nightStart || '19:00'}-${entry.nightEnd || '04:00'}`);
        parts.push(`same-as-tuesday day=${entry.dayStart || '09:00'}-${entry.dayEnd || '19:00'} night=${entry.nightStart || '19:00'}-${entry.nightEnd || '04:00'}`);
        parts.push(`maintenance-window ${entry.windowDate || 'after shifted night shift'} ${entry.windowStart || '04:00'}-${entry.windowEnd || '09:00'}`);
    }
    if (entry.movedFrom) parts.push(`moved from: ${entry.movedFrom}`);
    if (entry.movedTo) parts.push(`moved to: ${entry.movedTo}`);
    if (entry.reason) parts.push(`reason: ${entry.reason}`);
    return parts.join(' | ');
}

function createMaintenanceCommands({
    MessageFlags,
    maintenanceOverrideService,
    canRun,
    renderDashboard,
    syncVoiceStates,
    logger = console
}) {
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (!maintenanceOverrideService) throw new TypeError('maintenanceOverrideService must be provided');
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');

    async function refreshRuntime() {
        await syncVoiceStates?.().catch(error => logger.warn?.('[MAINTENANCE OVERRIDE SYNC]', error));
        await renderDashboard?.({ forceMemberRefresh: true }).catch(error => logger.warn?.('[MAINTENANCE OVERRIDE DASHBOARD]', error));
    }

    function getStringOption(interaction, ...names) {
        for (const name of names) {
            const value = interaction.options.getString(name);
            if (value != null && value !== '') return value;
        }
        return null;
    }

    function adminOnly(interaction, autoDel) {
        return interaction.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral }).then(() => autoDel?.());
    }

    async function executeSet(interaction, { autoDel } = {}) {
        if (!canRun(interaction.member)) return adminOnly(interaction, autoDel);
        const result = await maintenanceOverrideService.setOverride({
            date: getStringOption(interaction, KO.date, 'date'),
            enabled: getStringOption(interaction, KO.enabled, 'enabled'),
            dayStart: getStringOption(interaction, KO.dayStart, 'day-start'),
            dayEnd: getStringOption(interaction, KO.dayEnd, 'day-end'),
            nightStart: getStringOption(interaction, KO.nightStart, 'night-start'),
            nightEnd: getStringOption(interaction, KO.nightEnd, 'night-end'),
            windowDate: getStringOption(interaction, KO.windowDate, 'window-date'),
            windowStart: getStringOption(interaction, KO.windowStart, 'window-start'),
            windowEnd: getStringOption(interaction, KO.windowEnd, 'window-end'),
            reason: getStringOption(interaction, KO.reason, 'reason')
        });
        if (!result.ok) {
            return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral }).then(() => autoDel?.());
        }
        await refreshRuntime();
        const autoCancelledLine = result.autoCancelledDate
            ? `${result.autoCancelledDate}: OFF (auto)`
            : null;
        return interaction.reply({
            content: [
                'Maintenance override saved.',
                formatOverride({ date: result.date, ...result.override }),
                autoCancelledLine,
                result.override.enabled
                    ? 'The selected date is treated as the moved maintenance date using the same Tuesday maintenance hours. Future Tuesdays remain on the normal Tuesday maintenance schedule.'
                    : 'The selected date cancels the maintenance rule and uses normal shift hours for that date only.'
            ].filter(Boolean).join('\n'),
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel?.());
    }

    async function executeList(interaction, { autoDel } = {}) {
        if (!canRun(interaction.member)) return adminOnly(interaction, autoDel);
        const entries = maintenanceOverrideService.listOverrides();
        const content = entries.length
            ? entries.map(formatOverride).join('\n')
            : 'No maintenance overrides.';
        return interaction.reply({ content, flags: MessageFlags.Ephemeral }).then(() => autoDel?.());
    }

    async function executeDelete(interaction, { autoDel } = {}) {
        if (!canRun(interaction.member)) return adminOnly(interaction, autoDel);
        const result = await maintenanceOverrideService.deleteOverride(getStringOption(interaction, KO.date, 'date'));
        if (!result.ok) {
            return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral }).then(() => autoDel?.());
        }
        await refreshRuntime();
        return interaction.reply({
            content: `Maintenance override deleted: ${result.date}`,
            flags: MessageFlags.Ephemeral
        }).then(() => autoDel?.());
    }

    return {
        root: {
            aliases: [KO.root],
            execute: async (interaction, context = {}) => {
                const subcommand = interaction.options.getSubcommand?.();
                if (subcommand === KO.set) return executeSet(interaction, context);
                if (subcommand === KO.list) return executeList(interaction, context);
                if (subcommand === KO.delete) return executeDelete(interaction, context);
                return interaction.reply({ content: 'Unknown maintenance command.', flags: MessageFlags.Ephemeral }).then(() => context.autoDel?.());
            }
        }
    };
}

module.exports = {
    createMaintenanceCommands
};
