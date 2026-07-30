'use strict';

const { isExcludedUserId } = require('./excludedUsers');

function createPermissionUtils({ CONFIG, PermissionFlagsBits }) {
    function isOwnerId(id) {
        return !isExcludedUserId(CONFIG, id) && CONFIG.OWNER_IDS.includes(String(id));
    }

    function memberId(member, fallbackId = null) {
        return String(member?.id || member?.user?.id || fallbackId || '');
    }

    function hasAnyRole(member, roleIds = []) {
        if (!member?.roles?.cache) return false;
        return roleIds.filter(Boolean).some(roleId => member.roles.cache.has(String(roleId)));
    }

    function hasAllowedDiscordAdmin(member) {
        return CONFIG.ALLOW_DISCORD_ADMIN_COMMANDS === true &&
            Boolean(member?.permissions?.has(PermissionFlagsBits.Administrator));
    }

    function canUseExplicitPolicy(member, roleIds = [], fallbackId = null) {
        const id = memberId(member, fallbackId);
        if (isExcludedUserId(CONFIG, id)) return false;
        return Boolean(id && (
            isOwnerId(id) ||
            hasAnyRole(member, roleIds) ||
            hasAllowedDiscordAdmin(member)
        ));
    }

    function hasWorkerServerRole(member) {
        if (!member?.roles?.cache || isExcludedUserId(CONFIG, member)) return false;
        return member.roles.cache.has(CONFIG.ROLES.HEINE) || member.roles.cache.has(CONFIG.ROLES.PAAGRIO);
    }

    function isAssignedWorker(member) {
        if (!member || member.user?.bot || isExcludedUserId(CONFIG, member)) return false;
        if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && member.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) return true;
        const hasShiftRole = member.roles.cache.has(CONFIG.ROLES.DAY) || member.roles.cache.has(CONFIG.ROLES.NIGHT);
        if (isOwnerId(member.id)) return hasShiftRole;
        return hasShiftRole && hasWorkerServerRole(member);
    }

    function hasManagedAttendanceRole(member) {
        if (!member?.roles?.cache || isExcludedUserId(CONFIG, member)) return false;
        return [
            CONFIG.ROLES.DAY,
            CONFIG.ROLES.NIGHT,
            CONFIG.ROLES.HEINE,
            CONFIG.ROLES.PAAGRIO,
            CONFIG.ROLES.WORKING,
            CONFIG.ROLES.GUEST
        ].filter(Boolean).some(roleId => member.roles.cache.has(roleId));
    }

    function canManageLiveException(member) {
        return canUseExplicitPolicy(member, CONFIG.LIVE_EXCEPTION_MANAGER_ROLE_IDS);
    }

    function canManageAnnouncements(member) {
        return canUseExplicitPolicy(member, CONFIG.ANNOUNCEMENT_MANAGER_ROLE_IDS);
    }

    function canRunOperationalCommand(member) {
        return canUseExplicitPolicy(member, CONFIG.OPS_MANAGER_ROLE_IDS);
    }

    function canManageDayOff(member, fallbackId = null) {
        const id = memberId(member, fallbackId);
        if (isExcludedUserId(CONFIG, id)) return false;
        if (id && String(CONFIG.DAYOFF_REVIEWER_ID || '') === id) return true;
        return canUseExplicitPolicy(member, CONFIG.DAYOFF_MANAGER_ROLE_IDS, fallbackId);
    }

    function canReviewEndAdena(member, fallbackId = null) {
        const id = memberId(member, fallbackId);
        if (!id || isExcludedUserId(CONFIG, id)) return false;
        return canUseExplicitPolicy(member, [
            ...(CONFIG.END_ADENA_REVIEWER_ROLE_IDS || []),
            ...(CONFIG.END_ADENA_SUMMARY_OWNER_ROLE_IDS || [])
        ], fallbackId);
    }

    return {
        isOwnerId,
        hasWorkerServerRole,
        isAssignedWorker,
        hasManagedAttendanceRole,
        canManageLiveException,
        canManageAnnouncements,
        canRunOperationalCommand,
        canManageDayOff,
        canReviewEndAdena
    };
}

module.exports = createPermissionUtils;
