'use strict';

function createPermissionUtils({ CONFIG, PermissionFlagsBits }) {
    function isOwnerId(id) {
        return CONFIG.OWNER_IDS.includes(String(id));
    }

    function hasWorkerServerRole(member) {
        if (!member?.roles?.cache) return false;
        return member.roles.cache.has(CONFIG.ROLES.HEINE) || member.roles.cache.has(CONFIG.ROLES.PAAGRIO);
    }

    function isAssignedWorker(member) {
        if (!member || member.user?.bot) return false;
        if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && member.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) return true;
        const hasShiftRole = member.roles.cache.has(CONFIG.ROLES.DAY) || member.roles.cache.has(CONFIG.ROLES.NIGHT);
        if (isOwnerId(member.id)) return hasShiftRole;
        return hasShiftRole && hasWorkerServerRole(member);
    }

    function hasManagedAttendanceRole(member) {
        if (!member?.roles?.cache) return false;
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
        if (!member) return false;
        if (isOwnerId(member.id)) return true;
        if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
        if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
        return CONFIG.LIVE_EXCEPTION_MANAGER_ROLE_IDS.some(roleId => member.roles?.cache?.has(roleId));
    }

    function canManageAnnouncements(member) {
        if (!member) return false;
        if (isOwnerId(member.id)) return true;
        if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
        if (member.permissions?.has(PermissionFlagsBits.ManageMessages)) return true;
        return CONFIG.ANNOUNCEMENT_MANAGER_ROLE_IDS.some(roleId => member.roles?.cache?.has(roleId));
    }

    return {
        isOwnerId,
        hasWorkerServerRole,
        isAssignedWorker,
        hasManagedAttendanceRole,
        canManageLiveException,
        canManageAnnouncements
    };
}

module.exports = createPermissionUtils;
