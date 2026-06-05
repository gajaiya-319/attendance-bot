'use strict';

const { getLiveExceptionsMap } = require('../utils/liveExceptionsAccess');

function createGuildMemberEventHandlers({
    CONFIG,
    getAttendanceData,
    getLiveExceptions,
    removeOvertimeUser,
    syncManualGuestNickname,
    syncNicknameFromAssignedRoles,
    syncRolesFromStructuredNickname,
    ensureUserData,
    applyFinishedState,
    clearMemberState,
    getNow,
    writeDayOffLog,
    saveSystem,
    syncCurrentWorkerProfile = async () => {},
    renderDashboard,
    logger = console
}) {
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (typeof getAttendanceData !== 'function') throw new TypeError('getAttendanceData must be a function');
    if (typeof getLiveExceptions !== 'function') throw new TypeError('getLiveExceptions must be a function');
    if (typeof removeOvertimeUser !== 'function') throw new TypeError('removeOvertimeUser must be a function');
    if (typeof syncManualGuestNickname !== 'function') throw new TypeError('syncManualGuestNickname must be a function');
    if (typeof syncNicknameFromAssignedRoles !== 'function') throw new TypeError('syncNicknameFromAssignedRoles must be a function');
    if (typeof syncRolesFromStructuredNickname !== 'function') throw new TypeError('syncRolesFromStructuredNickname must be a function');
    if (typeof ensureUserData !== 'function') throw new TypeError('ensureUserData must be a function');
    if (typeof applyFinishedState !== 'function') throw new TypeError('applyFinishedState must be a function');
    if (typeof clearMemberState !== 'function') throw new TypeError('clearMemberState must be a function');
    if (typeof getNow !== 'function') throw new TypeError('getNow must be a function');
    if (typeof writeDayOffLog !== 'function') throw new TypeError('writeDayOffLog must be a function');
    if (typeof saveSystem !== 'function') throw new TypeError('saveSystem must be a function');
    if (typeof syncCurrentWorkerProfile !== 'function') throw new TypeError('syncCurrentWorkerProfile must be a function');
    if (typeof renderDashboard !== 'function') throw new TypeError('renderDashboard must be a function');

    const roleSyncHoldLogAtByKey = new Map();
    const ROLE_SYNC_HOLD_LOG_COOLDOWN_MS = 60 * 60 * 1000;

    function getNowMs() {
        const now = getNow();
        if (typeof now?.valueOf === 'function') return Number(now.valueOf());
        return Date.now();
    }

    async function writeRoleSyncHoldLog(member, reasonCode, reasonText) {
        const key = `${member.id}:${reasonCode}`;
        const nowMs = getNowMs();
        const lastAt = roleSyncHoldLogAtByKey.get(key) || 0;
        if (nowMs - lastAt < ROLE_SYNC_HOLD_LOG_COOLDOWN_MS) return false;
        roleSyncHoldLogAtByKey.set(key, nowMs);
        await writeDayOffLog(`🟡 역할 자동 동기화 보류\n👥 대상: ${member.displayName}\n📝 사유: ${reasonText}`);
        return true;
    }

    function hasRelevantRoleChange(oldMember, newMember) {
        const roleIds = [
            CONFIG.ROLES?.HEINE,
            CONFIG.ROLES?.PAAGRIO,
            CONFIG.ROLES?.DAY,
            CONFIG.ROLES?.NIGHT,
            CONFIG.ROLES?.WORKING,
            CONFIG.ROLES?.GUEST
        ].filter(Boolean);

        return roleIds.some(roleId => (
            Boolean(oldMember?.roles?.cache?.has?.(roleId)) !==
            Boolean(newMember?.roles?.cache?.has?.(roleId))
        ));
    }

    async function handleGuildMemberUpdate(oldMember, newMember) {
        try {
            if (!CONFIG.NICKNAME_ROLE_SYNC) return;
            if (!newMember || newMember.user?.bot) return;
            if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && newMember.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) return;
            const relevantRoleChanged = hasRelevantRoleChange(oldMember, newMember);
            let dashboardRefreshed = false;
            let profileSynced = false;
            async function syncProfileForRoleChange() {
                if (!relevantRoleChanged || profileSynced) return;
                profileSynced = true;
                await syncCurrentWorkerProfile(newMember).catch(error => {
                    logger.error?.('[CURRENT WORKER PROFILE SYNC ERROR]', error);
                });
            }
            async function refreshDashboardForRoleChange() {
                if (!relevantRoleChanged || dashboardRefreshed) return;
                await syncProfileForRoleChange();
                dashboardRefreshed = true;
                await renderDashboard({ forceMemberRefresh: true });
            }

            if (await syncManualGuestNickname(oldMember, newMember)) {
                await refreshDashboardForRoleChange();
                return;
            }

            const existing = getAttendanceData()[newMember.id];
            if (existing?.checkedIn || existing?.disconnected || existing?.dayOff) {
                await writeRoleSyncHoldLog(
                    newMember,
                    'active-state',
                    '근무/휴무/DC 상태 중에는 역할을 자동으로 변경하지 않습니다.'
                );
                await refreshDashboardForRoleChange();
                return;
            }

            if (await syncNicknameFromAssignedRoles(oldMember, newMember)) {
                await refreshDashboardForRoleChange();
                return;
            }
            if (oldMember.displayName === newMember.displayName) {
                await refreshDashboardForRoleChange();
                return;
            }

            const hasBothShiftRoles = newMember.roles.cache.has(CONFIG.ROLES.DAY) && newMember.roles.cache.has(CONFIG.ROLES.NIGHT);
            if (hasBothShiftRoles && !CONFIG.EXCEPTIONS.SHARED_SEAT_USER) {
                await writeRoleSyncHoldLog(
                    newMember,
                    'both-shift-roles',
                    'DAY/NIGHT 역할을 모두 가진 공유 근무 가능 인원입니다. 자동으로 변경하지 않습니다.'
                );
                await refreshDashboardForRoleChange();
                return;
            }

            if (await syncRolesFromStructuredNickname(newMember)) {
                await saveSystem();
                await refreshDashboardForRoleChange();
                if (!dashboardRefreshed) renderDashboard();
                return;
            }

            const newName = newMember.displayName.toLowerCase();
            const hasServerKeyword = /heine|paagrio/.test(newName);
            const hasShiftKeyword = /\bday\b|day\s*time|\bnight\b|night\s*time/.test(newName);
            if (!hasServerKeyword && !hasShiftKeyword) {
                await refreshDashboardForRoleChange();
                return;
            }

            let changed = false;
            let targetServerRole = null;
            let otherServerRole = null;
            if (newName.includes('heine')) {
                targetServerRole = CONFIG.ROLES.HEINE;
                otherServerRole = CONFIG.ROLES.PAAGRIO;
            } else if (newName.includes('paagrio')) {
                targetServerRole = CONFIG.ROLES.PAAGRIO;
                otherServerRole = CONFIG.ROLES.HEINE;
            }

            if (targetServerRole && !newMember.roles.cache.has(targetServerRole)) {
                await newMember.roles.add(targetServerRole).catch(() => null);
                if (otherServerRole) await newMember.roles.remove(otherServerRole).catch(() => null);
                changed = true;
            }

            let targetShiftRole = null;
            let otherShiftRole = null;
            let shiftStr = null;
            if (/\bday\b|day\s*time/.test(newName)) {
                targetShiftRole = CONFIG.ROLES.DAY;
                otherShiftRole = CONFIG.ROLES.NIGHT;
                shiftStr = 'day';
            } else if (/\bnight\b|night\s*time/.test(newName)) {
                targetShiftRole = CONFIG.ROLES.NIGHT;
                otherShiftRole = CONFIG.ROLES.DAY;
                shiftStr = 'night';
            }

            if (targetShiftRole && !newMember.roles.cache.has(targetShiftRole)) {
                await newMember.roles.add(targetShiftRole).catch(() => null);
                if (otherShiftRole) await newMember.roles.remove(otherShiftRole).catch(() => null);
                const user = ensureUserData(newMember, shiftStr);
                if (user) user.shift = shiftStr;
                changed = true;
            }

            if (changed) {
                await saveSystem();
                await writeDayOffLog(`✅ 역할 자동 동기화 완료\n👥 대상: ${newMember.displayName}`);
                await refreshDashboardForRoleChange();
                if (!dashboardRefreshed) renderDashboard();
            }
        } catch (error) {
            logger.error?.('[NICKNAME ROLE SYNC ERROR]', error);
        }
    }

    async function handleGuildMemberRemove(member) {
        try {
            if (!member || member.user?.bot) return;
            const user = getAttendanceData()[member.id];
            const now = getNow();
            if (user) {
                applyFinishedState(user, now, 'member-remove', 'member-left-guild');
                user.shift = null;
                user.liveOffWarnedFor = null;
            }
            removeOvertimeUser(member.id);
            const liveExceptions = getLiveExceptionsMap(getLiveExceptions, logger);
            if (liveExceptions[member.id]?.status === 'active') {
                liveExceptions[member.id].status = 'cancelled';
                liveExceptions[member.id].cancelledAt = now.toISOString();
                liveExceptions[member.id].cancelReason = 'member-left-guild';
            }
            clearMemberState(member.id);
            await saveSystem();
            renderDashboard({ forceMemberRefresh: true });
        } catch (error) {
            logger.error?.('[MEMBER REMOVE ERROR]', error);
        }
    }

    return {
        update: handleGuildMemberUpdate,
        remove: handleGuildMemberRemove
    };
}

module.exports = {
    createGuildMemberEventHandlers
};

