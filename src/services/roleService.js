'use strict';

function createRoleService({ CONFIG }) {
    const workerSuffixPattern = /\s*-\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?[PH]\s*(?:Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i;
    const namedWorkerSuffixPattern = /\s*-\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:Heine|Paagrio)\s*(?:Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i;

    function buildGuestNickname(displayName) {
        const base = String(displayName || 'Unknown')
            .replace(/\s+-\s+Guest$/i, '')
            .replace(workerSuffixPattern, '')
            .replace(namedWorkerSuffixPattern, '')
            .trim() || 'Unknown';
        const suffix = ' - Guest';
        return `${base.slice(0, 32 - suffix.length)}${suffix}`;
    }

    function getWorkerNicknameBase(displayName) {
        return String(displayName || 'Unknown')
            .replace(workerSuffixPattern, '')
            .replace(namedWorkerSuffixPattern, '')
            .replace(/\s+-\s+Guest$/i, '')
            .trim() || 'Unknown';
    }

    function getWorkerRoleProfileFromMember(member) {
        if (!member?.roles?.cache) return null;
        const hasHeine = member.roles.cache.has(CONFIG.ROLES.HEINE);
        const hasPaagrio = member.roles.cache.has(CONFIG.ROLES.PAAGRIO);
        const hasDay = member.roles.cache.has(CONFIG.ROLES.DAY);
        const hasNight = member.roles.cache.has(CONFIG.ROLES.NIGHT);
        if (hasHeine === hasPaagrio || hasDay === hasNight) return null;
        return {
            server: hasHeine ? 'HEINE' : 'PAAGRIO',
            shift: hasDay ? 'DAY' : 'NIGHT'
        };
    }

    function getWorkerRoleProfileFromNickname(displayName) {
        const name = String(displayName || '');
        const match = name.match(/\s-\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?([PH])\s*(Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i);
        if (!match) return null;
        return {
            server: match[1].toUpperCase() === 'H' ? 'HEINE' : 'PAAGRIO',
            shift: match[2].toUpperCase() === 'DAY' ? 'DAY' : 'NIGHT'
        };
    }

    function buildWorkerNickname(displayName, profile) {
        const base = getWorkerNicknameBase(displayName);
        const serverCode = profile.server === 'HEINE' ? 'H' : 'P';
        const shiftText = profile.shift === 'DAY' ? 'Day Time' : 'Night Time';
        const suffix = ` - ${serverCode} ${shiftText}`;
        return `${base.slice(0, 32 - suffix.length)}${suffix}`;
    }

    return {
        buildGuestNickname,
        getWorkerNicknameBase,
        getWorkerRoleProfileFromMember,
        getWorkerRoleProfileFromNickname,
        buildWorkerNickname
    };
}

module.exports = createRoleService;
