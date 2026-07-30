'use strict';

function createRoleService({ CONFIG }) {
    const workerSuffixPattern = /\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?[PVH]\s*(?:Day|Night)\s*Time.*$/i;
    const namedWorkerSuffixPattern = /\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:Valacas|Heine|Paagrio)\s*(?:Day|Night)\s*Time.*$/i;
    const workerNameAliases = {
        'deia#1024': 'Deia',
        'deia#7347': 'Deia',
        shijiro: 'Shiijiro'
    };

    function buildGuestNickname(displayName) {
        const base = String(displayName || 'Unknown')
            .replace(/\s+-\s+Guest$/i, '')
            .replace(workerSuffixPattern, '')
            .replace(namedWorkerSuffixPattern, '')
            .replace(/\s*[-\u2013\u2014]\s*(?:Great\s*)?(?:Manager|Trainee|Traine|Guest)(?:\s+.*)?$/i, ' ')
            .trim() || 'Unknown';
        const suffix = ' - Guest';
        return `${base.slice(0, 32 - suffix.length)}${suffix}`;
    }

    function getWorkerNicknameBase(displayName) {
        const base = String(displayName || 'Unknown')
            .replace(workerSuffixPattern, '')
            .replace(namedWorkerSuffixPattern, '')
            .replace(/\s+-\s+Guest$/i, '')
            .replace(/\s*[-\u2013\u2014]\s*(?:Great\s*)?(?:Manager|Trainee|Traine|Guest)(?:\s+.*)?$/i, ' ')
            .trim() || 'Unknown';
        return workerNameAliases[base.toLowerCase()] || base;
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
        const match = name.match(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?([PVH])\s*(Day|Night)\s*Time.*$/i);
        if (!match) return null;
        return {
            server: ['V', 'H'].includes(match[1].toUpperCase()) ? 'HEINE' : 'PAAGRIO',
            shift: match[2].toUpperCase() === 'DAY' ? 'DAY' : 'NIGHT'
        };
    }

    function buildWorkerNickname(displayName, profile) {
        const base = getWorkerNicknameBase(displayName);
        const serverCode = profile.server === 'HEINE' ? 'V' : 'P';
        const serverEmoji = profile.server === 'HEINE' ? '\u{1F432}' : '\u{1F525}';
        const shiftText = profile.shift === 'DAY' ? 'Day Time' : 'Night Time';
        const suffix = ` - ${serverCode} ${shiftText}${serverEmoji}`;
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
