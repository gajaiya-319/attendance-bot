'use strict';

function createNoticePanelWorkflow({
    client,
    CONFIG,
    moment,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    padWidth,
    getPanelInfo,
    setPanelMessageId,
    saveSystemAsync,
    logger = console
}) {
    if (!client) throw new TypeError('client must be provided');
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (!EmbedBuilder) throw new TypeError('EmbedBuilder must be provided');
    if (typeof getPanelInfo !== 'function') throw new TypeError('getPanelInfo must be a function');
    if (typeof setPanelMessageId !== 'function') throw new TypeError('setPanelMessageId must be a function');
    if (typeof saveSystemAsync !== 'function') throw new TypeError('saveSystemAsync must be a function');

    function getNoticeEmbed(type) {
        const isDay = type.toUpperCase() === 'DAY';
        const now = moment().tz(CONFIG.TIMEZONE);
        const noticeWidth = 44;
        const divider = '-'.repeat(noticeWidth);
        const clockLine = [
            '```ansi',
            `\u001b[1;37m${padWidth(`⏱️ PH TIME: ${now.format('hh:mm:ss A')}`, noticeWidth)}\u001b[0m`,
            `   \u001b[1;36m${padWidth('[ LIVE MONITORING ]', noticeWidth - 3)}\u001b[0m`,
            '```'
        ].join('\n');
        const P = '\u001b[1;35m';
        const G = '\u001b[1;32m';
        const W = '\u001b[1;37m';
        const R = '\u001b[0m';
        const colorTime = (t) => t
            .replace(/(\d{2})(:)(\d{2})(AM|PM)/g, `${P}$1${G}$2$3$4${R}`)
            .replace(/(\([\dh]+\))/g, `${W}$1${R}`);
        const formatHoursLine = (icon, label, timeText) =>
            `${icon} ${W}${padWidth(label, 11)}:${R} ${colorTime(timeText)}`;
        const regularLine = isDay
            ? formatHoursLine('📅', 'MON/WED-SUN', '09:00AM-09:00PM (12h)')
            : formatHoursLine('📅', 'MON/WED-SUN', '09:00PM-09:00AM (12h)');
        const tueLine = isDay
            ? formatHoursLine('🚨', 'TUE UPDATE', '09:00AM-07:00PM (10h)')
            : formatHoursLine('🚨', 'TUE UPDATE', '07:00PM-04:00AM (9h)');
        const workingHours = [
            regularLine,
            tueLine
        ].join('\n');
        const tueNote = isDay ? 'Early Out.' : 'Early Start & Out.';
        const formatRuleLine = (icon, label, text) => `${icon} **${padWidth(label, 10)}:** **${text}**`;
        const rules = [
            formatRuleLine('⛔', 'NO-SHOW', 'IMMEDIATE FIRE'),
            formatRuleLine('❌', 'ABSENCE', 'TERMINATED IMMEDIATELY'),
            formatRuleLine('⏳', 'LATE 2H', 'TREATED AS NO-SHOW'),
            '',
            '⚠️ **2 WARNINGS** = **INSTANT KICK**',
            '🛑 **Absence/Tardiness 2 times** = **DISMISSAL**'
        ].join('\n');
        const buttonGuide = [
            '🟢 **IN   :** **Start shift**',
            '🔴 **OUT  :** **End shift**',
            '🔵 **OFF  :** **Approved leave**',
            '🔥 **OT   :** **Extra hours**'
        ].join('\n');

        return new EmbedBuilder()
            .setTitle(isDay ? '☀️ ELITE DAY SHIFT PROTOCOL' : '🌙 ELITE NIGHT SHIFT PROTOCOL')
            .setDescription(`${clockLine}\n\n${divider}\n### ⏰ WORKING HOURS\n\`\`\`ansi\n${workingHours}\n\`\`\`\n⚠️ **TUE Note :** **${tueNote}**\n${divider}\n### 🚨 OPERATIONAL RULES\n${rules}\n\n⏳ **STRICT PUNCTUALITY**\n📢 **Be ready BEFORE the shift starts.**\n${divider}\n### 💡 BUTTON INSTRUCTIONS\n${buttonGuide}`)
            .setColor(isDay ? '#F1C40F' : '#3498DB')
            .setFooter({ text: 'BE BRIGHT. BE PROFESSIONAL. ✨' });
    }

    async function syncAutoPanels() {
        try {
            const panelInfo = getPanelInfo();
            for (const key of ['day', 'night']) {
                const chan = await client.channels.fetch(panelInfo[key].cId);
                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId('in').setLabel('CLOCK IN').setStyle(ButtonStyle.Success),
                    new ButtonBuilder().setCustomId('out').setLabel('CLOCK OUT').setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder().setCustomId('off').setLabel('DAY OFF').setStyle(ButtonStyle.Primary),
                    new ButtonBuilder().setCustomId('ot').setLabel('OVERTIME').setStyle(ButtonStyle.Danger)
                );
                const pMsg = panelInfo[key].mId ? await chan.messages.fetch(panelInfo[key].mId).catch(() => null) : null;
                if (!pMsg) {
                    const n = await chan.send({ embeds: [getNoticeEmbed(key)], components: [row] });
                    setPanelMessageId(key, n.id);
                    await saveSystemAsync();
                } else {
                    await pMsg.edit({ embeds: [getNoticeEmbed(key)], components: [row] }).catch(e => {
                        logger.error('[PANEL EDIT ERROR]', e);
                        setPanelMessageId(key, null);
                    });
                }
            }
        } catch (e) {
            logger.error('[PANEL SYNC ERROR]', e);
        }
    }

    return {
        getNoticeEmbed,
        syncAutoPanels
    };
}

module.exports = {
    createNoticePanelWorkflow
};
