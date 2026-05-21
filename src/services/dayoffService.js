'use strict';

const DAYOFF_STATUS_EMOJIS = ['\u274C', '\u2705', '\u23F3', '\uD83D\uDD01'];
const DAYOFF_APPROVAL_EMOJI = '\u2705';

function createDayOffService({ CONFIG, moment, EmbedBuilder, padWidth, truncateWidth, getReservations }) {
    function getDayOffChannelId() {
        return CONFIG.DAYOFF_CHANNEL || CONFIG.DAYOFF_CHAN || null;
    }

    function isDayOffChannel(message) {
        const channelId = getDayOffChannelId();
        return Boolean(channelId && message?.guildId === CONFIG.GUILD_ID && message.channelId === channelId);
    }

    function getMonthNumber(monthText) {
        const clean = (monthText || '').trim();
        for (const fmt of ['MMMM', 'MMM']) {
            const parsed = moment.tz(clean, fmt, true, CONFIG.TIMEZONE);
            if (parsed.isValid()) return parsed.month();
        }
        return null;
    }

    function normalizeDayOffName(name) {
        return String(name || '')
            .toLowerCase()
            .replace(/[^a-z0-9\uAC00-\uD7A3]/g, '');
    }

    function parseDayOffRequest(message) {
        const content = message.content || '';
        const contentText = content.toLowerCase();
        const dayPattern = /\bday\s*time\b|\bday\b|\uB0AE|\uC8FC\uAC04/;
        const nightPattern = /\bnight\s*time\b|\bnight\b|\uBC24|\uC57C\uAC04/;
        const contentHasDay = dayPattern.test(contentText);
        const contentHasNight = nightPattern.test(contentText);
        const hasDayRole = Boolean(message.member?.roles?.cache?.has(CONFIG.ROLES.DAY));
        const hasNightRole = Boolean(message.member?.roles?.cache?.has(CONFIG.ROLES.NIGHT));
        let shift = null;

        if (hasDayRole && !hasNightRole) {
            shift = 'day';
        } else if (hasNightRole && !hasDayRole) {
            shift = 'night';
        } else if (hasDayRole && hasNightRole) {
            if (contentHasDay && !contentHasNight) shift = 'day';
            if (contentHasNight && !contentHasDay) shift = 'night';
        }

        const shiftLabel = shift === 'day' ? 'Day Time' : shift === 'night' ? 'Night Time' : null;
        const nameMatch = content.match(/^\s*name\s*:?\s*(.+)$/im);
        const submittedName = nameMatch?.[1]?.trim() || null;
        const displayName = (message.member?.displayName || message.author?.username || 'Unknown').trim();
        const nameMismatch = Boolean(
            submittedName &&
            normalizeDayOffName(submittedName) &&
            normalizeDayOffName(submittedName) !== normalizeDayOffName(displayName)
        );
        const leaveLine = content.match(/leave\s*date\s*:?\s*([A-Za-z]+)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);

        if (!submittedName) {
            return {
                ok: false,
                code: 'missing-name',
                emoji: '\u274C',
                displayName,
                submittedName,
                nameMismatch: false,
                shift,
                shiftLabel
            };
        }

        if (!leaveLine) {
            const hasLeaveDate = /leave\s*date/i.test(content);
            return {
                ok: false,
                code: hasLeaveDate ? 'invalid-month' : 'missing-date',
                emoji: hasLeaveDate ? '?' : '?',
                displayName,
                submittedName,
                nameMismatch,
                shift,
                shiftLabel
            };
        }

        const month = getMonthNumber(leaveLine[1]);
        if (month === null) {
            return { ok: false, code: 'invalid-month', emoji: '\u2753', displayName, submittedName, nameMismatch, shift, shiftLabel };
        }

        const now = moment().tz(CONFIG.TIMEZONE);
        const year = leaveLine[3] ? Number(leaveLine[3]) : now.year();
        const date = moment.tz({ year, month, day: Number(leaveLine[2]), hour: 0, minute: 0 }, CONFIG.TIMEZONE);
        if (!date.isValid() || date.month() !== month) {
            return { ok: false, code: 'invalid-date', emoji: '\u274C', displayName, submittedName, nameMismatch, shift, shiftLabel };
        }

        if (!shift) {
            return { ok: false, code: 'missing-shift', emoji: '\u274C', displayName, submittedName, nameMismatch, shift, shiftLabel };
        }

        return {
            ok: true,
            code: 'valid',
            emoji: '\u274C',
            displayName,
            submittedName,
            nameMismatch,
            shift,
            shiftLabel,
            leaveDate: date.format('YYYY-MM-DD')
        };
    }

    function buildDayOffDm(reservation) {
        return [
            'Your day-off request has been approved.',
            '',
            `Name: ${reservation.name}`,
            `Shift: ${reservation.shiftLabel}`,
            `Leave Date: ${reservation.leaveDate}`,
            '',
            'Please make sure your schedule is adjusted accordingly.',
            'Enjoy your day off and come back well rested.'
        ].join('\n');
    }

    function buildDayOffRejectDm(reservation) {
        const reason = reservation.rejectReason || 'Rejected by Graet';
        return [
            'Your day-off request has been rejected.',
            '',
            `Name: ${reservation.name}`,
            `Shift: ${reservation.shiftLabel}`,
            `Leave Date: ${reservation.leaveDate}`,
            `Rejected by: ${reservation.rejectedByName || 'Management'}`,
            `Reason: ${reason}`,
            '',
            'Please contact management if you need clarification.'
        ].join('\n');
    }

    function hasApprovalReaction(message) {
        const reaction = message.reactions.cache.find(r => r.emoji.name === DAYOFF_APPROVAL_EMOJI);
        return Boolean(reaction && reaction.count > 0);
    }

    function parseDayOffCommandDate(input) {
        const raw = (input || '').trim();
        const formats = ['YYYY-MM-DD', 'YYYY/M/D', 'MMM D YYYY', 'MMMM D YYYY', 'MMM D', 'MMMM D'];
        for (const fmt of formats) {
            const parsed = moment.tz(raw, fmt, true, CONFIG.TIMEZONE);
            if (parsed.isValid()) {
                if (!/Y/.test(fmt)) parsed.year(moment().tz(CONFIG.TIMEZONE).year());
                return parsed.format('YYYY-MM-DD');
            }
        }
        return null;
    }

    function getDayOffReservationsByStatus(status = 'all') {
        const today = moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD');
        return Object.values(getReservations())
            .filter(Boolean)
            .filter(r => {
                if (status === 'all') return true;
                if (status === 'today') return r.leaveDate === today && ['approved', 'applied'].includes(r.status);
                return r.status === status;
            })
            .sort((a, b) => `${a.leaveDate}${a.name}`.localeCompare(`${b.leaveDate}${b.name}`));
    }

    function formatDayOffReservationLine(reservation) {
        const statusIcon = reservation.status === 'approved'
            ? 'OK'
            : reservation.status === 'pending'
                ? 'WAIT'
                : reservation.status === 'worked'
                    ? 'WORK'
                    : reservation.status === 'cancelled'
                        ? 'CANCEL'
                        : reservation.status === 'rejected'
                            ? 'REJECT'
                            : 'INFO';
        return `${statusIcon} ${reservation.leaveDate} | ${padWidth(truncateWidth(reservation.name || 'Unknown', 14), 15)} | ${reservation.shiftLabel || '-'}`;
    }

    function buildDayOffListEmbed(status = 'all') {
        const rows = getDayOffReservationsByStatus(status);
        const statusName = {
            all: 'All',
            pending: 'Pending',
            approved: 'Approved',
            today: 'Today',
            worked: 'Worked',
            cancelled: 'Cancelled',
            rejected: 'Rejected'
        }[status] || 'All';

        const content = rows.length
            ? rows.slice(0, 30).map(formatDayOffReservationLine).join('\n')
            : 'No day off reservations.';

        return new EmbedBuilder()
            .setTitle('DAY OFF Reservation List')
            .setColor('#3B82F6')
            .setDescription(`Status: ${statusName}\nCount: ${rows.length}`)
            .addFields({ name: 'List', value: `\`\`\`\n${content}\n\`\`\``, inline: false })
            .setFooter({ text: 'WAIT pending | OK approved | WORK worked | CANCEL cancelled | REJECT rejected' })
            .setTimestamp();
    }

    return {
        DAYOFF_STATUS_EMOJIS,
        DAYOFF_APPROVAL_EMOJI,
        getDayOffChannelId,
        isDayOffChannel,
        getMonthNumber,
        normalizeDayOffName,
        parseDayOffRequest,
        buildDayOffDm,
        buildDayOffRejectDm,
        hasApprovalReaction,
        parseDayOffCommandDate,
        getDayOffReservationsByStatus,
        formatDayOffReservationLine,
        buildDayOffListEmbed
    };
}

module.exports = createDayOffService;
