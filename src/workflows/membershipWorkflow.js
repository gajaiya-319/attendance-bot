'use strict';

const { getLiveExceptionsMap } = require('../utils/liveExceptionsAccess');

function createMembershipWorkflow(deps) {
    const {
        client,
        CONFIG,
        moment,
        getAttendanceData,
        getOvertimeUsers,
        setOvertimeUsers,
        saveSystemAsync,
        refreshGuildMembers,
        updateWorkingRole,
        ensureUserData,
        determineShift,
        getMemberShiftRole,
        isAssignedWorker,
        hasManagedAttendanceRole,
        roleService,
        getWorkerProfileForRawSync,
        getLiveExceptions,
        isOwnerId = () => false,
        writeDayOffLog = async () => {},
        PermissionFlagsBits,
        logger = console
    } = deps;
async function syncWorkingRoles({ dryRun = false } = {}) {
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild || !CONFIG.ROLES.WORKING) return { added: 0, removed: 0, skipped: true, notes: ['WORKING role or guild unavailable.'] };
    await refreshGuildMembers(guild);
    const notes = [];
    let added = 0;
    let removed = 0;

    for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;
        const user = getAttendanceData()[member.id];
        const shouldHave = Boolean(user?.checkedIn && !user?.dayOff && !user?.isFinished);
        const hasRole = member.roles.cache.has(CONFIG.ROLES.WORKING);

        if (shouldHave && !hasRole) {
            added++;
            notes.push(`ADD ${member.displayName}`);
            if (!dryRun) await updateWorkingRole(member, true);
        } else if (!shouldHave && hasRole) {
            removed++;
            notes.push(`REMOVE ${member.displayName}`);
            if (!dryRun) await updateWorkingRole(member, false);
        }
    }
    return { added, removed, skipped: false, notes };
}

async function reconcileAttendanceMembership(guild) {
    if (!guild) return false;
    await refreshGuildMembers(guild);
    let changed = false;

    for (const id of Object.keys(getAttendanceData())) {
        const member = guild.members.cache.get(id);
        if (member && isAssignedWorker(member)) continue;

        const u = getAttendanceData()[id];
        if (u.checkedIn || u.disconnected || u.dayOff || !u.isFinished) {
            u.checkedIn = false;
            u.dayOff = false;
            u.disconnected = false;
            u.disconnectedAt = null;
            u.isFinished = true;
            u.status = null;
            u.shift = null;
            u.voiceJoinedAt = null;
            u.liveOffStartedAt = null;
            u.lastLiveOnAt = null;
            u.lastLiveOffAt = null;
            u.pendingManualOT = false;
            u.liveOffWarnedFor = null;
            changed = true;
        }

        const beforeOt = getOvertimeUsers().length;
        setOvertimeUsers(getOvertimeUsers().filter(o => o.id !== id));
        if (getOvertimeUsers().length !== beforeOt) changed = true;

        const liveExceptions = getLiveExceptionsMap(getLiveExceptions, logger);
        if (liveExceptions[id]?.status === 'active') {
            liveExceptions[id].status = 'cancelled';
            liveExceptions[id].cancelledAt = moment().tz(CONFIG.TIMEZONE).toISOString();
            liveExceptions[id].cancelReason = member ? 'shift-role-removed' : 'member-left-guild';
            changed = true;
        }
    }

    if (changed) await saveSystemAsync();
    return changed;
}

async function autoAssignGuestForUnassignedMembers(guild) {
    if (!guild || !CONFIG.ROLES.GUEST) return false;
    await refreshGuildMembers(guild);

    const guestRole = guild.roles.cache.get(CONFIG.ROLES.GUEST);
    if (!guestRole) {
        console.warn('[GUEST ROLE WARN] GUEST_ROLE_ID is not a valid role in this guild.');
        return false;
    }

    const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
    const now = moment().tz(CONFIG.TIMEZONE);
    let changed = false;

    for (const member of guild.members.cache.values()) {
        if (!member || member.user?.bot) continue;
        if (isOwnerId(member.id)) continue;
        if (member.permissions?.has(PermissionFlagsBits.Administrator)) continue;
        if (hasManagedAttendanceRole(member)) continue;
        if (!member.joinedTimestamp) continue;

        const joinedAt = moment(member.joinedTimestamp).tz(CONFIG.TIMEZONE);
        if (now.diff(joinedAt, 'hours', true) < CONFIG.GUEST_ASSIGN_AFTER_HOURS) continue;

        if (me && me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
            console.warn(`[GUEST AUTO WARN] Cannot manage nickname/roles for ${member.displayName}. Role hierarchy too low.`);
            continue;
        }
        if (me && me.roles.highest.comparePositionTo(guestRole) <= 0) {
            console.warn('[GUEST AUTO WARN] Cannot assign guest role. Bot role must be higher than guest role.');
            return changed;
        }

        const guestNick = roleService.buildGuestNickname(member.displayName || member.user?.username);
        let memberChanged = false;
        if (member.displayName !== guestNick) {
            await member.setNickname(guestNick, 'Unassigned for more than 24 hours').catch(e => {
                console.error('[GUEST NICK ERROR]', e);
            });
            memberChanged = true;
        }

        if (!member.roles.cache.has(CONFIG.ROLES.GUEST)) {
            await member.roles.add(CONFIG.ROLES.GUEST, 'Unassigned for more than 24 hours').catch(e => {
                console.error('[GUEST ROLE ERROR]', e);
            });
            memberChanged = true;
        }

        if (memberChanged) {
            changed = true;
            const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
            if (logChan) {
                await logChan.send([
                    `\`[${now.format('MM/DD HH:mm')}]\` 게스트 역할 자동 부여`,
                    `대상: **${member.user.tag || member.displayName}**`,
                    `ID: ${member.id}`,
                    `사유: ${CONFIG.GUEST_ASSIGN_AFTER_HOURS}시간 이상 지정된 역할 없음`,
                    `닉네임 변경: ${guestNick}`
                ].join('\n')).catch(() => null);
            }
        }
    }

    return changed;
}

async function syncManualGuestNickname(oldMember, newMember) {
    if (!CONFIG.ROLES.GUEST || !oldMember || !newMember || newMember.user?.bot) return false;
    const hadGuest = oldMember.roles?.cache?.has(CONFIG.ROLES.GUEST);
    const hasGuest = newMember.roles?.cache?.has(CONFIG.ROLES.GUEST);
    if (hadGuest || !hasGuest) return false;

    const guestNick = roleService.buildGuestNickname(newMember.displayName || newMember.user?.username);
    if (newMember.displayName === guestNick) return false;

    const me = newMember.guild?.members?.me || await newMember.guild?.members?.fetchMe().catch(() => null);
    if (me && me.roles.highest.comparePositionTo(newMember.roles.highest) <= 0) {
        console.warn(`[GUEST MANUAL WARN] Cannot update guest nickname for ${newMember.displayName}. Role hierarchy too low.`);
        return false;
    }

    await newMember.setNickname(guestNick, 'Guest role manually assigned').catch(e => {
        console.error('[GUEST MANUAL NICK ERROR]', e);
    });

    await writeDayOffLog([
        '게스트 역할 수동 부여 감지',
        `대상: ${newMember.displayName}`,
        `ID: ${newMember.id}`,
        `닉네임 변경: ${guestNick}`
    ].join('\n'));
    return true;
}
async function canManageMemberNickname(member) {
    const me = member?.guild?.members?.me || await member?.guild?.members?.fetchMe().catch(() => null);
    if (member?.guild?.ownerId === member?.id) {
        console.warn(`[NICK ROLE SYNC WARN] Cannot update nickname for ${member.displayName}. Target is the guild owner.`);
        return false;
    }
    if (me && me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        console.warn(`[NICK ROLE SYNC WARN] Cannot update nickname for ${member.displayName}. Role hierarchy too low.`);
        return false;
    }
    return true;
}

async function syncNicknameFromAssignedRoles(oldMember, newMember) {
    const oldProfile = roleService.getWorkerRoleProfileFromMember(oldMember);
    const newProfile = roleService.getWorkerRoleProfileFromMember(newMember);
    if (!newProfile) return false;
    const roleProfileChanged = !oldProfile ||
        oldProfile.server !== newProfile.server ||
        oldProfile.shift !== newProfile.shift;
    if (!roleProfileChanged) return false;

    const targetNick = roleService.buildWorkerNickname(newMember.displayName || newMember.user?.username, newProfile);
    if (newMember.displayName === targetNick) return false;
    if (!await canManageMemberNickname(newMember)) return false;

    const nicknameUpdated = await newMember.setNickname(targetNick, 'Worker roles manually assigned')
        .then(() => true)
        .catch(e => {
            if (e?.code === 50013) {
                console.warn(`[WORKER ROLE NICK WARN] Missing permission to rename ${newMember.displayName}. Move the bot role above this member's highest role, or rename manually.`);
            } else {
                console.error('[WORKER ROLE NICK ERROR]', e);
            }
            return false;
        });
    if (!nicknameUpdated) return false;
    if (CONFIG.ROLES.GUEST && newMember.roles.cache.has(CONFIG.ROLES.GUEST)) {
        await newMember.roles.remove(CONFIG.ROLES.GUEST, 'Worker role assigned; remove guest role').catch(e => {
            console.error('[WORKER GUEST ROLE REMOVE ERROR]', e);
        });
    }
    await writeDayOffLog([
        '역할 수동 부여에 따른 닉네임 자동 변경',
        `대상: ${newMember.displayName}`,
        `ID: ${newMember.id}`,
        `서버: ${newProfile.server}`,
        `근무조: ${newProfile.shift}`,
        `닉네임 변경: ${targetNick}`
    ].join('\n'));
    return true;
}

async function syncRolesFromStructuredNickname(newMember) {
    const profile = roleService.getWorkerRoleProfileFromNickname(newMember.displayName);
    if (!profile) return false;

    const serverRole = profile.server === 'HEINE' ? CONFIG.ROLES.HEINE : CONFIG.ROLES.PAAGRIO;
    const otherServerRole = profile.server === 'HEINE' ? CONFIG.ROLES.PAAGRIO : CONFIG.ROLES.HEINE;
    const shiftRole = profile.shift === 'DAY' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
    const otherShiftRole = profile.shift === 'DAY' ? CONFIG.ROLES.NIGHT : CONFIG.ROLES.DAY;

    let changed = false;
    if (!newMember.roles.cache.has(serverRole)) {
        await newMember.roles.add(serverRole, 'Nickname worker profile sync').catch(e => console.error('[NICK ROLE ADD ERROR]', e));
        changed = true;
    }
    if (newMember.roles.cache.has(otherServerRole)) {
        await newMember.roles.remove(otherServerRole, 'Nickname worker profile sync').catch(e => console.error('[NICK ROLE REMOVE ERROR]', e));
        changed = true;
    }
    if (!newMember.roles.cache.has(shiftRole)) {
        await newMember.roles.add(shiftRole, 'Nickname worker profile sync').catch(e => console.error('[NICK SHIFT ADD ERROR]', e));
        changed = true;
    }
    if (newMember.roles.cache.has(otherShiftRole)) {
        await newMember.roles.remove(otherShiftRole, 'Nickname worker profile sync').catch(e => console.error('[NICK SHIFT REMOVE ERROR]', e));
        changed = true;
    }
    if (CONFIG.ROLES.GUEST && newMember.roles.cache.has(CONFIG.ROLES.GUEST)) {
        await newMember.roles.remove(CONFIG.ROLES.GUEST, 'Nickname worker profile sync; remove guest role').catch(e => console.error('[NICK GUEST REMOVE ERROR]', e));
        changed = true;
    }

    if (changed) {
        const u = ensureUserData(newMember, profile.shift === 'DAY' ? 'day' : 'night');
        if (u) u.shift = profile.shift === 'DAY' ? 'day' : 'night';
        await writeDayOffLog([
            '닉네임 형식 감지에 따른 역할 자동 동기화',
            `대상: ${newMember.displayName}`,
            `ID: ${newMember.id}`,
            `서버: ${profile.server}`,
            `근무조: ${profile.shift}`
        ].join('\n'));
    }
    return changed;
}
    return {
        syncWorkingRoles,
        reconcileAttendanceMembership,
        autoAssignGuestForUnassignedMembers,
        syncManualGuestNickname,
        syncNicknameFromAssignedRoles,
        syncRolesFromStructuredNickname
    };
}

module.exports = { createMembershipWorkflow };
