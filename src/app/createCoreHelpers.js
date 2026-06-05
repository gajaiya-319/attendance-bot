'use strict';

function createCoreHelpers(ctx) {
    const {
        CONFIG,
        moment,
        getOperationalShift,
        attendanceService,
        workflowApi,
        failText,
        MessageFlags,
        startupRuntime,
        botState,
        normalizeEmbedField,
        renderEmbedFieldValue,
        layoutVersion,
        instanceTag
    } = ctx;

    function cleanupOldDayOffReservations(now = moment().tz(CONFIG.TIMEZONE)) {
        const cutoff = now.clone().subtract(14, 'days');
        let changed = false;
        for (const messageId of Object.keys(botState.dayOffReservations)) {
            const reservation = botState.dayOffReservations[messageId];
            if (!reservation?.leaveDate) continue;
            if (!moment(reservation.leaveDate, 'YYYY-MM-DD').isBefore(cutoff, 'day')) continue;
            delete botState.dayOffReservations[messageId];
            changed = true;
        }
        return changed;
    }

    function printStartupBanner() {
        return startupRuntime.printStartupBanner({
            instanceTag,
            layoutVersion
        });
    }

    function safeAddFields(embed, ...fields) {
        const normalized = fields.flat().filter(Boolean).map(normalizeEmbedField);
        if (normalized.length) embed.addFields(...normalized);
        return embed;
    }

    function safeEmbedDescription(value, maxLength = 4096) {
        return renderEmbedFieldValue(value, maxLength);
    }

    function determineShift(member) {
        if (!member || !member.roles) return null;
        const now = moment().tz(CONFIG.TIMEZONE);
        const displayShift = getOperationalShift(now);
        if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && member.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) return displayShift;
        const hasD = member.roles.cache.has(CONFIG.ROLES.DAY);
        const hasN = member.roles.cache.has(CONFIG.ROLES.NIGHT);
        if (!hasD && !hasN) return null;
        if (hasD && hasN) return displayShift;
        return hasD ? 'day' : 'night';
    }

    function ensureUserData(member, shift = null) {
        return attendanceService.ensureUserData(member, shift);
    }

    function isCooldown(user) {
        const now = Date.now();
        if (now - (user.lastActionAt || 0) < 3000) return true;
        user.lastActionAt = now;
        return false;
    }

    function markMemberActivity(member, source = 'unknown', at = moment().tz(CONFIG.TIMEZONE)) {
        if (!member || member.user?.bot) return false;
        const u = ensureUserData(
            member,
            botState.attendanceData[member.id]?.shift ||
                workflowApi.getMemberShiftRole(member) ||
                determineShift(member)
        );
        if (!u) return false;
        const activityAt = moment(at).tz(CONFIG.TIMEZONE);
        const throttleSeconds = source === 'message' ? 300 : 30;
        if (u.lastActivityAt && Math.abs(activityAt.diff(moment(u.lastActivityAt).tz(CONFIG.TIMEZONE), 'seconds')) < throttleSeconds) {
            return false;
        }
        u.lastActivityAt = activityAt.toISOString();
        u.lastActivitySource = source;
        u.lastActivityDisplayName = member.displayName || member.user?.username || u.name || 'Unknown';
        return true;
    }

    function ownerOnlyReply(i) {
        return i.reply({
            content: failText('Owner only command.'),
            flags: MessageFlags.Ephemeral
        }).then(() => setTimeout(() => i.deleteReply().catch(() => {}), 3000));
    }

    function addOvertimeUser(user, type = 'AUTO', startedAt = null) {
        return attendanceService.addOvertimeUser(user, type, startedAt);
    }

    async function updateWorkingRole(member, shouldAdd) {
        if (!CONFIG.ROLES.WORKING || !member?.roles) return;
        const roleExists = member.guild?.roles?.cache?.has(CONFIG.ROLES.WORKING);
        if (!roleExists) {
            console.warn('[ROLE WARN] WORKING_ROLE_ID is not a valid role in this guild.');
            return;
        }
        const action = shouldAdd ? member.roles.add : member.roles.remove;
        await action.call(member.roles, CONFIG.ROLES.WORKING).catch(e => console.error('[ROLE UPDATE ERROR]', e));
    }

    return {
        cleanupOldDayOffReservations,
        printStartupBanner,
        safeAddFields,
        safeEmbedDescription,
        determineShift,
        ensureUserData,
        isCooldown,
        markMemberActivity,
        ownerOnlyReply,
        addOvertimeUser,
        updateWorkingRole
    };
}

module.exports = { createCoreHelpers };
