require('dotenv').config();

const fs = require('fs').promises;
const moment = require('moment-timezone');
const cron = require('node-cron');
const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    Events,
    REST,
    Routes,
    MessageFlags,
    PermissionFlagsBits,
    Partials
} = require('discord.js');

/**
 * [ CONFIGURATION ]
 *
 */
const {
    CONFIG,
    SHIFT_SCHEDULE,
    MAINTENANCE_WINDOWS
} = require('./src/config/constants');
const createDashboardStateUtils = require('./src/utils/dashboardState');
const dataStore = require('./src/services/dataStore');
const { createAttendanceService } = require('./src/services/attendanceService');
const createRoleService = require('./src/services/roleService');
const createDayOffService = require('./src/services/dayoffService');
const createAdminService = require('./src/services/adminService');
const { buildCommandDefinitions, hiddenCommandAliases } = require('./src/commands/definitions');
const {
    createAutoDelete,
    patchCommandReplies,
    createCommandOptionHelpers
} = require('./src/utils/interactionHelpers');
const {
    okText,
    failText,
    pendingText,
    commandStatusText,
    withCommandStatusPayload
} = require('./src/utils/commandStatus');
const createPermissionUtils = require('./src/utils/permissions');
const {
    padWidth,
    truncateWidth,
    formatDuration,
    formatExactWidth
} = require('./src/utils/textFormat');

const {
    applyClockTime,
    buildShiftBoundsForBusinessDate,
    getOperationalShift,
    isMaintenanceWindow,
    getDayOffLogicalDateForShift,
    getShiftBounds,
    getShiftSessionKey,
    getRecognizedClockInMoment,
    isWithinPreShiftWindow,
    getDashboardShift
} = require('./time-logic')({ CONFIG, SHIFT_SCHEDULE, MAINTENANCE_WINDOWS, moment });

if (!process.env.TOKEN) {
    console.error('[CONFIG ERROR] Missing TOKEN in .env');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

function isUnknownInteractionError(e) {
    return e?.code === 10062 || e?.rawError?.code === 10062;
}

function handleInteractionReplyError(e, context = 'reply') {
    if (isUnknownInteractionError(e)) {
        console.warn(`[INTERACTION WARN] Expired interaction ignored during ${context}.`);
        return null;
    }
    throw e;
}

client.on('error', e => {
    if (isUnknownInteractionError(e)) {
        console.warn('[INTERACTION WARN] Unknown interaction ignored. The command reply window already expired.');
        return;
    }
    console.error('[CLIENT ERROR]', e);
});

process.on('unhandledRejection', e => {
    if (isUnknownInteractionError(e)) {
        console.warn('[INTERACTION WARN] Unknown interaction ignored. The command reply window already expired.');
        return;
    }
    console.error('[UNHANDLED REJECTION]', e);
});

const JOKES = {
    IN: ['Clock-in has been processed. Have a great day!'],
    OUT: ['Clock-out has been processed. Thank you for your hard work!'],
    OT: ['Overtime has been processed. Don\'t push yourself too hard and keep it up!'],
    OFF: ['Day off has been processed. Rest well!']
};  

function printStartupBanner() {
    const now = moment().tz(CONFIG.TIMEZONE);
    const lines = [
        '',
        '============================================================',
        ' ATTENDANCE BOT ONLINE',
        '------------------------------------------------------------',
        ` Version : ${CONFIG.VERSION}`,
        ' Entry   : index.js',
        ` Update  : ${CONFIG.RELEASE_NOTE}`,
        ` Timezone: ${CONFIG.TIMEZONE}`,
        ` Started : ${now.format('YYYY-MM-DD HH:mm:ss')}`,
        '============================================================',
        ''
    ];
    console.log(lines.join('\n'));
}

/**
 * [ STATE & MUTEX ]
 *
 */
let attendanceData = {};
let overtimeUsers = [];
let statusMessageId = null;
let panelInfo = { day: { cId: CONFIG.DAY_CHAN, mId: null }, night: { cId: CONFIG.NIGHT_CHAN, mId: null } };
let announceData = { 1: null, 2: null, 3: null, 4: null, 5: null, 6: null };
let dayOffReservations = {};
let liveExceptions = {};

let renderingDashboard = false;
let pendingDashboardRender = false;
let lastSavedAt = null;
let lastBackupAt = null;
let lastMemberFetchAt = 0;
let memberFetchPromise = null;
const dashboardStateUtils = createDashboardStateUtils({
    CONFIG,
    moment,
    getScheduledEndMoment,
    getRecentMaintenanceEnd,
    isWithinPreShiftWindow,
    getMemberShiftRole,
    getActiveLiveException,
    getOvertimeUsers: () => overtimeUsers
});
const attendanceService = createAttendanceService({
    CONFIG,
    moment,
    getAttendanceData: () => attendanceData,
    getOvertimeUsers: () => overtimeUsers,
    determineShift,
    getShiftSessionKey,
    getShiftBounds
});
const roleService = createRoleService({ CONFIG });
const dayOffService = createDayOffService({
    CONFIG,
    moment,
    EmbedBuilder,
    padWidth,
    truncateWidth,
    getReservations: () => dayOffReservations
});
const adminService = createAdminService({
    getAnnounceData: () => announceData,
    truncateWidth
});
const {
    isOwnerId,
    hasWorkerServerRole,
    isAssignedWorker,
    hasManagedAttendanceRole,
    canManageLiveException,
    canManageAnnouncements
} = createPermissionUtils({ CONFIG, PermissionFlagsBits });

function collectSystemState() {
    return {
        attendanceData,
        overtimeUsers,
        statusMessageId,
        panelInfo,
        announceData,
        dayOffReservations,
        liveExceptions
    };
}

function applySystemState(state = dataStore.db) {
    attendanceData = state.attendanceData || {};
    overtimeUsers = state.overtimeUsers || [];
    statusMessageId = state.statusMessageId || null;
    panelInfo = state.panelInfo || panelInfo;
    announceData = state.announceData || announceData;
    dayOffReservations = state.dayOffReservations || {};
    liveExceptions = state.liveExceptions || {};
}

function syncDataStoreMeta() {
    lastSavedAt = dataStore.meta.lastSavedAt;
    lastBackupAt = dataStore.meta.lastBackupAt;
}

/**
 * [ CORE HELPERS ]
 */
async function refreshGuildMembers(guild, { force = false, minIntervalMs = 10 * 60 * 1000 } = {}) {
    if (!guild) return false;
    const now = Date.now();
    if (!force && now - lastMemberFetchAt < minIntervalMs) return true;
    if (memberFetchPromise) return memberFetchPromise;

    memberFetchPromise = guild.members.fetch()
        .then(() => {
            lastMemberFetchAt = Date.now();
            return true;
        })
        .catch(e => {
            const retry = e?.data?.retry_after ? ` Retry after ${e.data.retry_after}s.` : '';
            console.warn(`[MEMBER FETCH WARN] Guild member fetch skipped.${retry}`);
            return false;
        })
        .finally(() => {
            memberFetchPromise = null;
        });

    return memberFetchPromise;
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
    const u = ensureUserData(member, attendanceData[member.id]?.shift || getMemberShiftRole(member) || determineShift(member));
    if (!u) return false;
    const activityAt = moment(at).tz(CONFIG.TIMEZONE);
    const throttleSeconds = source === 'message' ? 300 : 30;
    if (u.lastActivityAt && Math.abs(activityAt.diff(moment(u.lastActivityAt).tz(CONFIG.TIMEZONE), 'seconds')) < throttleSeconds) return false;
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

async function saveSystemAsync() {
    await dataStore.saveSystemAsync(collectSystemState());
    syncDataStoreMeta();
}

async function createBackupSnapshot(reason = 'manual') {
    const backupPath = await dataStore.createBackupSnapshot(reason, collectSystemState());
    syncDataStoreMeta();
    return backupPath;
}

async function createScheduledBackupIfDue() {
    await dataStore.createScheduledBackupIfDue(collectSystemState());
    syncDataStoreMeta();
}

async function listBackupSnapshots() {
    return dataStore.listBackupSnapshots();
}

async function restoreBackupSnapshot(fileName = null) {
    const restored = await dataStore.restoreBackupSnapshot(fileName, collectSystemState());
    if (restored) applySystemState(dataStore.getState());
    syncDataStoreMeta();
    return restored;
}

function loadSystem() {
    dataStore.assignState(collectSystemState());
    dataStore.loadSystem();
    applySystemState(dataStore.getState());
    syncDataStoreMeta();
}

function expireDayOffSessions(now = moment().tz(CONFIG.TIMEZONE)) {
    let changed = false;
    for (const user of Object.values(attendanceData)) {
        if (!user?.dayOff || !user.dayOffExpireAt) continue;
        if (now.isBefore(moment(user.dayOffExpireAt).tz(CONFIG.TIMEZONE))) continue;
        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.isFinished = false;
        user.status = null;
        changed = true;
    }
    return changed;
}

function cleanupOldDayOffReservations(now = moment().tz(CONFIG.TIMEZONE)) {
    const cutoff = now.clone().subtract(14, 'days');
    let changed = false;
    for (const messageId of Object.keys(dayOffReservations)) {
        const reservation = dayOffReservations[messageId];
        if (!reservation?.leaveDate) continue;
        if (!moment(reservation.leaveDate, 'YYYY-MM-DD').isBefore(cutoff, 'day')) continue;
        delete dayOffReservations[messageId];
        changed = true;
    }
    return changed;
}

/**
 * [ UTILITIES ]
 */
/**
 * [ TIME LOGIC ]
 */
function getMemberShiftRole(member) {
    if (!member?.roles?.cache) return null;
    const hasD = member.roles.cache.has(CONFIG.ROLES.DAY);
    const hasN = member.roles.cache.has(CONFIG.ROLES.NIGHT);
    if (!hasD && !hasN) return null;
    if (hasD && hasN) return getOperationalShift() || getDashboardShift();
    return hasD ? 'day' : 'night';
}

function getRecentMaintenanceEnd(now = moment().tz(CONFIG.TIMEZONE), graceMins = CONFIG.FINISHED_VISIBLE_AFTER_MINS) {
    const mNow = moment(now).tz(CONFIG.TIMEZONE);
    return MAINTENANCE_WINDOWS
        .map(window => {
            if (mNow.format('dddd') !== window.day) return null;
            const endedAt = applyClockTime(mNow, window.end);
            const minsSinceEnd = mNow.diff(endedAt, 'minutes');
            return minsSinceEnd >= 0 && minsSinceEnd <= graceMins ? { ...window, endedAt, minsSinceEnd } : null;
        })
        .find(Boolean) || null;
}

function shouldShowPostMaintenanceFinished(member, user, activeShift, now = moment().tz(CONFIG.TIMEZONE)) {
    return dashboardStateUtils.shouldShowPostMaintenanceFinished(member, user, activeShift, now);
}

function getDashboardMemberRelation(member, activeShift) {
    const memberShift = getMemberShiftRole(member);
    if (!memberShift || !activeShift) return 'unknown';
    if (memberShift === activeShift) return 'current';
    return 'previous-or-other';
}

function shouldHidePreviousShiftWaiting(member, activeShift, state) {
    return getDashboardMemberRelation(member, activeShift) === 'previous-or-other' && state === 'WAITING';
}

function shouldShowAsPreShiftStandby(member, user, now) {
    return dashboardStateUtils.shouldShowAsPreShiftStandby(member, user, now);
}

function ensureSessionStore(user) {
    return attendanceService.ensureSessionStore(user);
}

function appendAttendanceEvent(user, type, at, source = 'system', meta = {}) {
    return attendanceService.appendAttendanceEvent(user, type, at, source, meta);
}

function transitionRecordedStatus(user, next = {}, now = moment().tz(CONFIG.TIMEZONE), source = 'system', reason = null) {
    return attendanceService.transitionRecordedStatus(user, next, now, source, reason);
}

function getOpenSession(user) {
    return attendanceService.getOpenSession(user);
}

function getRelevantSessionForTime(user, at) {
    return attendanceService.getRelevantSessionForTime(user, at);
}

function getScheduledEndMoment(user, fallbackAt = moment().tz(CONFIG.TIMEZONE), options = {}) {
    return attendanceService.getScheduledEndMoment(user, fallbackAt, options);
}

function normalizeOpenSessions(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.normalizeOpenSessions(user, now);
}

function startAttendanceSession(user, shift, now, source = 'unknown') {
    return attendanceService.startAttendanceSession(user, shift, now, source);
}

function finishAttendanceSession(user, outMoment, source = 'unknown', reason = null, detectedAt = null) {
    return attendanceService.finishAttendanceSession(user, outMoment, source, reason, detectedAt);
}

function startSessionPeriod(periods, startedAt, reason = null) {
    return attendanceService.startSessionPeriod(periods, startedAt, reason);
}

function closeOpenSessionPeriod(periods, endedAt) {
    return attendanceService.closeOpenSessionPeriod(periods, endedAt);
}

function sumSessionPeriods(periods, fallbackEnd) {
    return attendanceService.sumSessionPeriods(periods, fallbackEnd);
}

function calculateSessionWorkedMinutes(session, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.calculateSessionWorkedMinutes(session, now);
}

function getUserLatestSessionSummary(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.getUserLatestSessionSummary(user, now);
}

function createPendingClockOut(user, source, at, graceMins, reason = null) {
    return attendanceService.createPendingClockOut(user, source, at, graceMins, reason);
}

function recoverPendingClockOut(user, recoveredAt, reason = 'recovered') {
    return attendanceService.recoverPendingClockOut(user, recoveredAt, reason);
}

function getClockOutStatus(user, outMoment) {
    const scheduledEnd = getScheduledEndMoment(user, outMoment);
    const earlyMins = scheduledEnd
        ? scheduledEnd.diff(moment(outMoment).tz(CONFIG.TIMEZONE), 'minutes')
        : 0;
    return {
        earlyMins,
        isEarly: earlyMins > CONFIG.CLOCK_OUT_GRACE_MINS,
        isNormal: earlyMins <= CONFIG.CLOCK_OUT_GRACE_MINS
    };
}

function setFinishedPresence(user, nextPresence, now, source = 'system') {
    if (!user || !['in_voice', 'left_voice'].includes(nextPresence)) return false;
    const at = moment(now).tz(CONFIG.TIMEZONE);
    if (user.finishedPresence === nextPresence) return false;
    const previous = user.finishedPresence || null;
    user.finishedPresence = nextPresence;
    if (nextPresence === 'left_voice') {
        user.finalLeftAt = at.toISOString();
    } else {
        user.finalLeftAt = null;
    }
    appendAttendanceEvent(user, 'finished_presence_changed', at, source, {
        from: previous,
        to: nextPresence
    });
    return true;
}

function getOvertimeStartMoment(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.getOvertimeStartMoment(user, now);
}

function canStartOvertimeNow(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.canStartOvertimeNow(user, now);
}

function canStartPreShiftOvertime(user, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.canStartPreShiftOvertime(user, now);
}

async function startPreShiftOvertime(member, user, shift, now, source = 'button-or-command') {
    const result = attendanceService.applyPreShiftOvertimeCore(member, user, shift, now, source);
    if (!result.ok) return false;
    await updateWorkingRole(member, true);
    await recordLog(user, 'ot', `사전 OT 시작 (정규 출근 ${result.shiftStart.format('hh:mm A')} 전)`);
    return true;
}

function isOvertimeEntryStillValid(ot, user, member, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!ot || !user || !member) return false;
    if (user.dayOff || user.isFinished) return false;
    if (!user.checkedIn && ot.type !== 'PRE_OT') return false;
    if (ot.type === 'FORCED') return true;

    const activeException = getActiveLiveException(ot.id, now);
    const voiceState = member.guild?.voiceStates?.cache?.get(ot.id);
    const isStreaming = Boolean(member.voice?.streaming || voiceState?.streaming);
    const isConnected = Boolean(member.voice?.channelId || voiceState?.channelId);
    const isDisconnectedInGrace = Boolean(
        user.disconnected &&
        user.pendingClockOut?.source === 'voice_leave' &&
        user.pendingClockOut.expiresAt &&
        now.isBefore(moment(user.pendingClockOut.expiresAt).tz(CONFIG.TIMEZONE))
    );
    const isLiveOffInGrace = Boolean(
        user.voiceStatus === 'LIVE_OFF' &&
        user.pendingClockOut?.source === 'live_off' &&
        user.pendingClockOut.expiresAt &&
        now.isBefore(moment(user.pendingClockOut.expiresAt).tz(CONFIG.TIMEZONE))
    );

    if (ot.type === 'PRE_OT') return Boolean(isStreaming || activeException || (isConnected && isLiveOffInGrace) || isDisconnectedInGrace);
    return Boolean(isStreaming || activeException || (isConnected && isLiveOffInGrace) || isDisconnectedInGrace);
}

function isFinishedBeforeCurrentShift(user, shift, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!user?.isFinished || user.checkedIn || !shift) return false;
    const finishedAt = user.checkOutRaw || user.attendanceStatusChangedAt;
    if (!finishedAt) return false;
    const bounds = getShiftBounds(shift, now);
    return Boolean(bounds?.start && moment(finishedAt).tz(CONFIG.TIMEZONE).isBefore(bounds.start));
}

function isCurrentShiftRegularWorker(member, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!member?.roles?.cache) return false;
    const activeShift = getOperationalShift(now);
    if (!activeShift) return false;
    const roleId = activeShift === 'day' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
    if (!member.roles.cache.has(roleId)) return false;
    const bounds = getShiftBounds(activeShift, now);
    return Boolean(bounds && now.isSameOrAfter(bounds.start) && now.isBefore(bounds.end));
}

function getLatestOvertimeSession(user) {
    return attendanceService.getLatestOvertimeSession(user);
}

function getRestorableOvertimeSession(user, shift, now = moment().tz(CONFIG.TIMEZONE)) {
    return attendanceService.getRestorableOvertimeSession(user, shift, now);
}

async function restoreOvertimeAfterFinish(member, user, shift, now, source = 'voice_snapshot') {
    if (isCurrentShiftRegularWorker(member, now)) return false;
    const result = attendanceService.applyRestoreOvertimeAfterFinishCore(user, shift, now, source);
    if (!result.ok) return false;
    await updateWorkingRole(member, true);
    await recordLog(user, 'ot', 'Overtime restored after bot restart / finished state recovery');
    return true;
}

async function activatePendingManualOvertime(user, now) {
    const result = attendanceService.applyPendingManualOvertimeCore(user, now);
    if (!result.ok) return false;
    const member = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(user.id);
    if (member) await updateWorkingRole(member, true);
    await recordLog(user, 'ot', '수동 연장 근무 시작');
    return true;
}

function markLiveOffState(user, now) {
    return attendanceService.markLiveOffState(user, now);
}

function clearLiveOffState(user, now) {
    return attendanceService.clearLiveOffState(user, now);
}

async function recordLiveConfirmation(member, user, shift, now, text = '라이브 방송 확인 (출근 상태 동기화)') {
    if (!member || !user || !shift) return false;
    const key = getShiftSessionKey(shift, now);
    if (user.lastLiveLogKey === key) return false;
    user.lastLiveLogKey = key;
    await recordLog(user, 'reconnect', text);
    return true;
}

async function recordLiveRecovery(member, user, shift, now, startedAt, text) {
    if (!member || !user || !shift) return false;
    const started = startedAt ? moment(startedAt).tz(CONFIG.TIMEZONE) : moment(now).tz(CONFIG.TIMEZONE);
    const key = `${getShiftSessionKey(shift, now)}:${started.format('YYYY-MM-DD HH:mm')}`;
    if (user.lastLiveRecoveryLogKey === key) return false;
    user.lastLiveRecoveryLogKey = key;
    await recordLog(user, 'reconnect', text);
    return true;
}

async function notifyDayOffPresence(member, user, shift, now, action = 'LIVE ON') {
    if (!member || !user || !shift) return false;
    const key = `${getShiftSessionKey(shift, now)}:${action}`;
    appendAttendanceEvent(user, 'dayoff_presence_detected', now, 'voice_snapshot', {
        action,
        result: 'day_off_kept'
    });
    if (user.dayOffPresenceNotifiedFor === key) return false;
    user.dayOffPresenceNotifiedFor = key;

    const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) {
        await logChan.send([
            `\`[${now.format('MM/DD HH:mm')}]\` 🔵 **DAY OFF PRESENCE DETECTED**`,
            `👤 User: **${user.name || member.displayName || 'Unknown'}**`,
            `📌 Action: ${action}`,
            '✅ Result: Day Off kept, no clock-in processed.'
        ].join('\n')).catch(() => null);
    }

    await member.send([
        'You are currently marked as Day Off.',
        'Your presence or live stream was detected, but attendance will not be counted automatically.',
        'If you are here to work, please contact an admin for approval.'
    ].join('\n')).catch(() => null);
    return true;
}

async function notifyAfterFinishPresence(member, user, shift, now, action = 'LIVE ON after clock-out') {
    if (!member || !user || !shift) return false;
    const key = `${getShiftSessionKey(shift, now)}:${action}`;
    appendAttendanceEvent(user, 'after_finish_presence_detected', now, 'voice_snapshot', {
        action,
        result: 'finished_kept'
    });
    if (user.afterFinishPresenceNotifiedFor === key) return false;
    user.afterFinishPresenceNotifiedFor = key;

    await recordLog(user, 'reconnect', `퇴근 후 라이브 감지 (FINISHED 유지, 자동 출근 안 함)`);
    await member.send([
        'IMPORTANT: You are already clocked out.',
        '',
        'Your live stream was detected, but your attendance will NOT restart automatically.',
        '',
        'If you are starting work again, you MUST press the CLOCK IN button while your live stream is ON.',
        'If you do not press CLOCK IN, your attendance will NOT be counted.',
        '',
        'If you are working overtime, use the OVERTIME button or contact an admin.'
    ].join('\n')).catch(() => null);
    return true;
}

async function notifyFinishedReturnToVoice(member, user, shift, now, action = 'Returned to voice after clock-out') {
    if (!member || !user || !shift) return false;
    const clockOutKey = user.checkOutRaw || user.lastClockOutDetectedAt || getShiftSessionKey(shift, now);
    const key = `${clockOutKey}:${action}`;
    const bounds = getShiftBounds(shift, now);
    const isWithinShift = Boolean(bounds?.start && bounds?.end && now.isSameOrAfter(bounds.start) && now.isBefore(bounds.end));
    const wasVoiceLeaveFinish = ['dc-timeout', 'auto-out-after-shift'].includes(user.lastClockOutSource);
    appendAttendanceEvent(user, 'finished_return_to_voice_detected', now, 'voice_snapshot', {
        action,
        result: 'finished_kept',
        withinShift: isWithinShift,
        previousClockOutSource: user.lastClockOutSource || null
    });
    if (user.lastFinishedReturnPromptKey === key) return false;
    user.lastFinishedReturnPromptKey = key;

    const lines = isWithinShift && wasVoiceLeaveFinish
        ? [
            '🌿 Welcome back',
            '',
            'Your previous attendance was marked as FINISHED after you left the voice channel.',
            '',
            'It looks like you may be unable to turn your live stream ON for some reason.',
            'If that is the case, please go to the attendance channel and press the CLOCK IN button.',
            '',
            '✅ After you press CLOCK IN, your attendance can resume as a LIVE EXCEPTION.',
            '🚫 If you do not press CLOCK IN, this time will not be counted as work.',
            '',
            'Please use this only when you truly cannot turn LIVE ON. 🙏'
        ]
        : [
            '🌿 Welcome back',
            '',
            'I can see that you returned to the voice channel, but your attendance is still FINISHED.',
            '',
            'To start counting work time again:',
            '1. Turn your live stream ON.',
            '2. Press the CLOCK IN button on the attendance panel.',
            '',
            'Live stream ON by itself will not restart attendance. 🙂'
        ];

    await member.send(lines.join('\n')).catch(() => null);
    return true;
}

async function notifyStandbyClockInRequired(member, user, shift, now, action = 'Standby voice presence') {
    if (!member || !user || !shift) return false;
    const key = `${getShiftSessionKey(shift, now)}:${action}`;
    if (user.standbyClockInPromptKey === key) return false;
    user.standbyClockInPromptKey = key;
    appendAttendanceEvent(user, 'standby_clockin_required', now, 'voice_snapshot', {
        action,
        result: 'standby_kept'
    });
    await member.send([
        '🌿 Attendance reminder',
        '',
        'Your live stream is ON, but your attendance has not been counted yet.',
        'Please go to the attendance channel and press the CLOCK IN button.',
        '',
        '✅ Please make sure to press CLOCK IN so your work time is recorded.'
    ].join('\n')).catch(() => null);
    await recordLog(user, 'reconnect', '대기중 음성채널 접속 감지 - 라이브 ON 후 CLOCK IN 버튼 필요');
    return true;
}

async function normalizeCurrentShiftSession(member, user, shift, now) {
    const result = attendanceService.normalizeCurrentShiftSessionCore(member, user, shift, now);
    if (!result.changed) return false;
    if (result.action === 'working-role-off') {
        await updateWorkingRole(member, false);
        return true;
    }
    if (result.action === 'working-role-on') {
        await updateWorkingRole(member, true);
        return true;
    }
    if (result.action === 'clock-in') {
        await handleClockIn(member, user, shift, now, true);
    }
    return true;
}

async function recordLog(user, actionType, customText = null, earlyOverrideTime = null, options = {}) {
    if (!user) return;
    const now = moment().tz(CONFIG.TIMEZONE);
    const eventTime = options.effectiveTime ? moment(options.effectiveTime).tz(CONFIG.TIMEZONE) : now;
    const shiftIcon = CONFIG.EXCEPTIONS.SHARED_SEAT_USER && user.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER
        ? '👑'
        : (user.shift === 'day' ? '☀️' : '🌙');
    let aIcon = '🔵';
    let defaultText = '업무 기록';

    if (actionType === 'in') {
        if (user.status === 'absent') {
            aIcon = '⚠️';
            defaultText = '초과 시간 지각 (출근)';
        } else if (user.status === 'late') {
            aIcon = '🟠';
            defaultText = '지각 출근';
        } else {
            aIcon = '🟢';
            defaultText = '정상 출근';
        }
    } else if (actionType === 'out') {
        aIcon = '🔴';
        defaultText = '퇴근';
    } else if (actionType === 'ot') {
        aIcon = '🔥';
        defaultText = '연장 시작';
    } else if (actionType === 'disconnect') {
        aIcon = '⚡';
        defaultText = `DC (${CONFIG.GRACE_PERIOD_MINS}분 접속 유예 시작)`;
    } else if (actionType === 'reconnect') {
        aIcon = '🔗';
        defaultText = 'DC 복구';
    }

    if (options.forceIcon) aIcon = options.forceIcon;

    let baseTxt = customText || defaultText;

    if (actionType === 'out' && !user.dayOff && !options.skipEarlyPenalty) {
        const clockStatus = getClockOutStatus(user, earlyOverrideTime || now);
        const earlyMins = clockStatus.earlyMins;
        if (clockStatus.isEarly) {
            if (baseTxt.includes('조기 퇴근') || baseTxt.includes('조기퇴근')) {
                baseTxt = baseTxt + ' (' + formatDuration(earlyMins) + ' 남음)';
            } else {
                baseTxt = baseTxt + ' (⚠️ 조기퇴근 ' + formatDuration(earlyMins) + ' 전)';
            }
            user.totalEarly = (user.totalEarly || 0) + 1;
            user.points = (user.points || 0) + CONFIG.POINTS.EARLY_OUT;
            if (options.reversibleEarlyPenaltyKey) {
                user.reversibleEarlyPenaltyKey = options.reversibleEarlyPenaltyKey;
                user.reversibleEarlyPenaltyAppliedAt = eventTime.toISOString();
                user.reversibleEarlyPenaltyPoints = Math.abs(CONFIG.POINTS.EARLY_OUT);
            }
        }
    }

    if (actionType === 'out' && user.checkInRaw && !baseTxt.includes('[근무:')) {
        const workedMins = Math.max(0, eventTime.diff(moment(user.checkInRaw).tz(CONFIG.TIMEZONE), 'minutes'));
        baseTxt = baseTxt + ' [근무: ' + formatDuration(workedMins) + ']';
    }

    // 라이브 및 방송 관련 자동 감지하여 카메라 아이콘 🎥 조합 추가
    const isLiveAction = options.isLive || (baseTxt && (
        baseTxt.includes('라이브') || 
        baseTxt.includes('방송') || 
        baseTxt.includes('자동 출근') || 
        baseTxt.includes('자동 퇴근')
    ));

    if (isLiveAction) {
        aIcon += '🎥';
    }

    const logChan = client.channels.cache.get(CONFIG.LOG_CHANNEL) ||
        await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) {
        const timestamp = eventTime.format('MM/DD HH:mm');
        await logChan.send(`\`[${timestamp}]\` ${shiftIcon} 👤 **${user.name}** → ${aIcon} ${baseTxt}`)
            .catch(e => console.error('[LOG SEND ERROR]', e));
    }
}

async function handleClockIn(member, user, shift, now, isAuto = false) {
    const u = ensureUserData(member, shift) || user;
    const clockInRule = getRecognizedClockInMoment(shift, now);
    const result = attendanceService.applyClockInCore(u, member, shift, now, clockInRule, isAuto);
    if (!result.ok) {
        if (result.shouldLogPreShiftWait) {
            await recordLog(u, 'reconnect', `사전 대기 감지 (${result.preShiftStart.format('HH:mm')} 출근 시작 전)`);
        }
        return false;
    }

    await updateWorkingRole(member, true);
    if (isAuto) {
        u.lastLiveLogKey = getShiftSessionKey(shift, result.recognizedAt);
        const statusText = u.status === 'late' ? '지각' : (u.status === 'absent' ? '초과 시간 지각' : '정상');
        const preText = result.preShift ? `사전 라이브 대기 ${now.format('HH:mm')} / 인정 출근 ${result.recognizedAt.format('HH:mm')}` : `디스코드 자동 출근 (${statusText})`;
        await recordLog(u, 'in', preText, null, { effectiveTime: result.recognizedAt });
    } else {
        await recordLog(u, 'in', result.preShift ? `사전 출근 대기 / 인정 출근 ${result.recognizedAt.format('HH:mm')}` : null, null, { effectiveTime: result.recognizedAt });
    }
    return true;
}

async function handleClockOut(member, user, now, customLogText = null, earlyOverrideTime = null, options = {}) {
    const result = attendanceService.applyClockOutCore(member, user, now, customLogText, earlyOverrideTime, options);
    if (!result.ok) return;
    await updateWorkingRole(member, false);
    await recordLog(user, 'out', customLogText, result.recordLogTime, result.recordLogOptions);
}

/**
 * [ DASHBOARD RENDERER ]
 */
async function findExistingStatusMessage(channel) {
    try {
        const msgs = await channel.messages.fetch({ limit: 20 });
        return msgs.find(m => m.author.id === client.user.id && m.embeds?.[0]?.title?.includes('INTEGRATED OPS'));
    } catch (e) {
        console.error('[MSG FIND ERROR]', e);
        return null;
    }
}

function getDashboardName(user) {
    return (user.dashboardName || user.name || 'Unknown').split('-')[0].trim() || 'Unknown';
}

function renderCleanGrid(arr, icon) {
    if (!arr || arr.length === 0) return 'NONE';
    const sorted = [...arr].sort((a, b) => getDashboardName(a).localeCompare(getDashboardName(b)));
    const fixN = (u) => padWidth(truncateWidth(getDashboardName(u), 10), 11);
    const fixT = (t) => padWidth(String(t || '00:00').replace(/\s?[AP]M$/i, '').trim(), 5);
    const formatCell = (u) => `${icon} ${fixT(u.checkInTime)} ${fixN(u)}`;
    let lines = "```\n";
    for (let i = 0; i < sorted.length; i += 2) {
        const left = sorted[i];
        const right = sorted[i + 1];
        lines += formatCell(left) + (right ? `  ${formatCell(right)}` : '') + "\n";
    }
    return lines + "```";
}

function renderStatusList(arr, icon, now, mode = 'time') {
    if (!arr || arr.length === 0) return 'NONE';
    const lines = arr
        .sort((a, b) => {
            if (mode !== 'standby') return getDashboardName(a).localeCompare(getDashboardName(b));
            const rank = (u) => {
                const liveRank = u.preShiftLiveAt ? 0 : 1;
                const firstAt = u.preShiftLiveAt || u.voiceJoinedAt || u.lastLiveOnAt || u.checkInRaw || now.toISOString();
                return `${liveRank}:${moment(firstAt).valueOf()}:${getDashboardName(u)}`;
            };
            return rank(a).localeCompare(rank(b));
        })
        .map(u => {
            const name = padWidth(truncateWidth(getDashboardName(u), 16), 17);
            let meta = u.checkInTime || '00:00';
            if (mode === 'dc' && u.disconnectedAt) meta = `DC ${formatDuration(now.diff(moment(u.disconnectedAt), 'minutes'))}`;
            if (mode === 'absent') meta = `+${formatDuration(now.diff(getShiftBounds(u.shift, now).start, 'minutes'))}`;
            if (mode === 'standby') {
                const firstAt = u.preShiftLiveAt || u.voiceJoinedAt || u.lastLiveOnAt || u.checkInRaw;
                const status = u.preShiftLiveAt ? 'LIVE' : 'OFF ';
                meta = firstAt ? `${status} ${moment(firstAt).tz(CONFIG.TIMEZONE).format('hh:mm A')}` : status;
            }
            if (mode === 'finished') meta = u.checkOutTime ? `OUT ${u.checkOutTime}` : '퇴근 완료';
            if (mode === 'liveoff') {
                const liveOffAt = u.liveOffStartedAt || u.voiceJoinedAt;
                meta = liveOffAt ? `OFF ${formatDuration(now.diff(moment(liveOffAt), 'minutes'))}` : 'LIVE OFF';
            }
            if (mode === 'exception') {
                const ex = liveExceptions[u.id];
                const minsLeft = ex?.expiresAt ? Math.max(0, moment(ex.expiresAt).diff(now, 'minutes')) : 0;
                meta = `${formatDuration(minsLeft)} 남음`;
            }
            return `${icon} ${name} ${meta}`;
        });
    return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

function renderShiftSummary(label, groups) {
    return `${label} | ABSENT ${groups.absent.length} | DC ${groups.disconnected.length} | WAITING ${groups.standby.length} | ACTIVE ${groups.active.length} | OFF ${groups.leave.length}`;
}

const DASHBOARD_WIDTH_FOOTER = '\u2800'.repeat(96);

function renderSummaryBox(rows) {
    const labelWidth = 10;
    const valueWidth = 3;
    const height = 4;
    const width = labelWidth + valueWidth;
    const lines = rows.map(([label, value]) => `${padWidth(label, labelWidth)}${String(value).padStart(valueWidth)}`);
    while (lines.length < height) lines.push(' '.repeat(width));
    return `\`\`\`text\n${lines.slice(0, height).join('\n')}\n\`\`\``;
}

function renderDashboardHeader(now, maintenance = false) {
    const dateStr = now.format('ddd, MMM DD, YYYY').toUpperCase();
    const status = maintenance ? '[ MAINTENANCE - WORK CLOSED ]' : `[ ${dateStr} ]`;
    return `> # ⏱️ PH TIME: **${now.format('hh:mm:ss A')}**\n>  ㅤ ㅤ     **[${status}](https://-)**`;
}

function renderOvertimeList(now, source = overtimeUsers) {
    if (!source.length) return 'NONE';
    const lines = source
        .map(ot => {
            const u = attendanceData[ot.id] || ot;
            const name = padWidth(truncateWidth(getDashboardName(u), 16), 17);
            const otStartedAt = ot.startedAt || u.otStartedAt || u.checkInRaw;
            const mins = otStartedAt ? now.diff(moment(otStartedAt).tz(CONFIG.TIMEZONE), 'minutes') : 0;
            const typeLabel = ot.type === 'PRE_OT' ? 'P-OT' : ot.type === 'FORCED' ? 'F-OT' : ot.type === 'MANUAL' ? 'M-OT' : ot.type === 'AUTO' ? 'A-OT' : 'OT';
            return `${padWidth(typeLabel, 5)} ${name} ${mins > 0 ? formatDuration(mins) : ''}`;
        })
        .sort();
    return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

function getLegacyDashboardState(user, context) {
    return dashboardStateUtils.getLegacyDashboardState(user, context);
}

function buildExclusiveDashboardGroups(visibleUsers, dashboardOvertimeUsers) {
    const byId = new Map(visibleUsers.map(user => [user.id, user]));
    const used = new Set();
    const takeUsers = (predicate) => visibleUsers.filter(user => {
        if (!user?.id || used.has(user.id)) return false;
        if (!predicate(user)) return false;
        used.add(user.id);
        return true;
    });

    const leave = takeUsers(user => user.fState === 'LEAVE' || user.dayOff);
    const overtime = dashboardOvertimeUsers.filter(ot => {
        const user = byId.get(ot.id);
        if (!user || used.has(ot.id) || user.dayOff) return false;
        used.add(ot.id);
        return true;
    });

    return {
        leave,
        overtime,
        liveExceptionUsers: takeUsers(user => user.fState === 'LIVE_EXCEPTION'),
        disconnected: takeUsers(user => user.fState === 'DISCONNECTED'),
        liveOff: takeUsers(user => user.fState === 'LIVE_OFF'),
        absent: takeUsers(user => user.fState === 'ABSENT'),
        active: takeUsers(user => ['ACTIVE', 'LATE'].includes(user.fState)),
        finished: takeUsers(user => user.fState === 'FINISHED'),
        standby: takeUsers(user => user.fState === 'WAITING')
    };
}

// ✨ [업데이트] 정규 퇴근 시간이 지났고 연장 근무(OT)가 아니면 FINISHED 처리
function getHybridDashboardState(user, context) {
    return dashboardStateUtils.getHybridDashboardState(user, context);
}

function getActiveLiveException(userId, now = moment().tz(CONFIG.TIMEZONE)) {
    const exception = liveExceptions[userId];
    if (!exception || exception.status !== 'active') return null;
    if (!exception.expiresAt || now.isSameOrAfter(moment(exception.expiresAt))) return null;
    return exception;
}

function safeNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
}

function getReportName(user, width = 14) {
    return formatExactWidth((user.name || 'Unknown').split('-')[0].trim() || 'Unknown', width);
}

function formatKoreanDateTime(value) {
    return moment(value).tz(CONFIG.TIMEZONE).format('YYYY년 MM월 DD일 HH:mm');
}

function getReportStatsColumns(user) {
    return [
        safeNumber(user.totalNormal),
        safeNumber(user.totalAbsent),
        safeNumber(user.totalLate),
        safeNumber(user.totalEarly),
        safeNumber(user.totalOT),
        safeNumber(user.offCount)
    ].map(v => String(v).padStart(3)).join(' ');
}

function getCompactReportStatsColumns(user) {
    return [
        safeNumber(user.totalNormal),
        safeNumber(user.totalAbsent),
        safeNumber(user.totalLate),
        safeNumber(user.totalEarly),
        safeNumber(user.totalOT),
        safeNumber(user.offCount)
    ].map(v => String(v).padStart(2)).join(' ');
}

function renderReportMetricRow(user) {
    const points = String(safeNumber(user.points)).padStart(4);
    const name = getReportName(user, 11);
    const stats = getCompactReportStatsColumns(user);
    const dc = String(safeNumber(user.dcCount)).padStart(2);
    return `${points}|${name}|${stats}|${dc}`;
}

function renderReportMetricHeader() {
    return '점수|이름       |정 결 지 조 연 휴|DC';
}

function renderReportTopRow(user, index) {
    const rank = String(index + 1).padStart(2, '0');
    const name = getReportName(user, 10);
    const points = String(safeNumber(user.points)).padStart(3);
    return `${rank}|${name}|${points}|${getCompactReportStatsColumns(user)}`;
}

function renderReportStatsLegend() {
    return '순위|이름      |점수|정 결 지 조 연 휴';
}

function formatDurationClock(minutes) {
    const safeMinutes = Math.max(0, Number(minutes) || 0);
    const hours = Math.floor(safeMinutes / 60);
    const mins = safeMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function renderSessionMetricRow(user, now = moment().tz(CONFIG.TIMEZONE)) {
    const summary = getUserLatestSessionSummary(user, now);
    const name = getReportName(user, 12);
    if (!summary) return `${name}|세션없음|00:00|00:00|00:00|00:00`;
    const session = summary.session;
    const state = session.clockOutAt ? '퇴근' : '근무';
    return [
        name,
        state,
        formatDurationClock(summary.creditedMinutes),
        formatDurationClock(summary.grossMinutes),
        formatDurationClock(summary.liveOffMinutes),
        formatDurationClock(summary.dcMinutes)
    ].join('|');
}

function renderPercentBar(percent, size = 10) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const filled = Math.round((safePercent / 100) * size);
    return `[${'#'.repeat(filled)}${'.'.repeat(size - filled)}] ${String(safePercent).padStart(3)}%`;
}

function renderEmbedCodeBlock(text, maxLength = 1010) {
    const body = truncateWidth(String(text || 'NONE'), maxLength);
    return `\`\`\`\n${body}\n\`\`\``;
}

function getDayNightWorkerStats(guild, shift = 'all') {
    const scope = ['all', 'day', 'night'].includes(shift) ? shift : 'all';
    return Object.values(attendanceData).filter(user => {
        const workerShift = getRankingWorkerShift(user, guild);
        if (!workerShift) return false;
        return scope === 'all' || workerShift === scope;
    });
}

function getDayNightWorkerOvertimeUsers(guild, shift = 'all') {
    const scope = ['all', 'day', 'night'].includes(shift) ? shift : 'all';
    return overtimeUsers.filter(ot => {
        const user = attendanceData[ot.id] || ot;
        const workerShift = getRankingWorkerShift(user, guild);
        if (!workerShift) return false;
        return scope === 'all' || workerShift === scope;
    });
}

async function renderDashboardCore({ forceMemberRefresh = false } = {}) {
    if (renderingDashboard) {
        pendingDashboardRender = true;
        return;
    }
    renderingDashboard = true;
    try {
        const ch = client.channels.cache.get(CONFIG.STATUS_CHANNEL) ||
            await client.channels.fetch(CONFIG.STATUS_CHANNEL).catch(() => null);
        if (!ch) return;
        const guild = ch.guild;
        await refreshGuildMembers(guild, { force: forceMemberRefresh });

        const now = moment().tz(CONFIG.TIMEZONE);
        const expiredDayOff = expireDayOffSessions(now);
        const dashboardMaintenance = isMaintenanceWindow(now) && !isWithinPreShiftWindow('day', now);
        const activeDisplayShift = getDashboardShift(now);
        const roleId = activeDisplayShift === 'day' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
        const shiftNameText = dashboardMaintenance
            ? '🛠️ MAINTENANCE WINDOW'
            : activeDisplayShift === 'day'
                ? '☀️ 주간 DAY SHIFT'
                : '🌙 야간 NIGHT SHIFT';
        const embedColor = dashboardMaintenance
            ? '#95A5A6'
            : activeDisplayShift === 'day'
                ? '#F1C40F'
                : '#3498DB';
        const liveOffVoiceIds = new Set(
            guild.voiceStates.cache
                .filter(v => v.channelId && !v.streaming)
                .map(v => v.id)
        );

        const currentShiftMembers = guild.members.cache
            .filter(m => {
                if (!isAssignedWorker(m)) return false;
                if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && m.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) return true;
                const user = attendanceData[m.id];
                const voiceState = guild.voiceStates.cache.get(m.id);
                const isVoiceConnected = Boolean(m.voice?.channelId || voiceState?.channelId);
                const roleMatchesCurrentShift = !dashboardMaintenance && m.roles.cache.has(roleId);
                const postMaintenanceFinished = !dashboardMaintenance && shouldShowPostMaintenanceFinished(m, user, activeDisplayShift, now);
                const finishedAt = user?.checkOutRaw || user?.attendanceStatusChangedAt;
                const finishedTooLong = Boolean(
                    user?.isFinished &&
                    !user?.checkedIn &&
                    !user?.disconnected &&
                    finishedAt &&
                    now.diff(moment(finishedAt).tz(CONFIG.TIMEZONE), 'minutes') > CONFIG.FINISHED_VISIBLE_AFTER_MINS
                );
                if (finishedTooLong && !roleMatchesCurrentShift && !postMaintenanceFinished && !user?.dayOff && !overtimeUsers.some(ot => ot.id === m.id)) return false;
                const recentManualAction = Boolean(
                    user?.manualPanelTouchedAt &&
                    now.diff(moment(user.manualPanelTouchedAt).tz(CONFIG.TIMEZONE), 'minutes') <= 10 &&
                    user?.shift === activeDisplayShift
                );
                const preShiftStandby = shouldShowAsPreShiftStandby(m, user, now);
                
                // ✨ [업데이트] 불필요한 voiceJoinedAt 등 제거 및 피니시 후 채널 잔류자 유지
                const hasTrackedState = Boolean(
                    user &&
                    !user.dayOff &&
                    (
                        user.checkedIn ||
                        user.disconnected ||
                        user.pendingManualOT ||
                        overtimeUsers.some(ot => ot.id === m.id) ||
                        (user.isFinished && isVoiceConnected && !finishedTooLong) ||
                        postMaintenanceFinished
                    )
                );
                return roleMatchesCurrentShift || recentManualAction || preShiftStandby || postMaintenanceFinished || hasTrackedState;
            });
        const currentRoleMemberIds = new Set(
            currentShiftMembers
                .filter(m => !dashboardMaintenance && (m.roles.cache.has(roleId) || (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && m.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER)))
                .map(m => m.id)
        );
        let sessionChanged = false;
        for (const member of currentShiftMembers.values()) {
            const shouldNormalizeCurrentShift = currentRoleMemberIds.has(member.id);
            const user = ensureUserData(member, shouldNormalizeCurrentShift ? activeDisplayShift : (attendanceData[member.id]?.shift || determineShift(member)));
            if (shouldNormalizeCurrentShift && await normalizeCurrentShiftSession(member, user, activeDisplayShift, now)) {
                sessionChanged = true;
            }
            const memberShift = getMemberShiftRole(member);
            const isPreviousShiftMember = memberShift && memberShift !== activeDisplayShift && !overtimeUsers.some(ot => ot.id === member.id);
            const activeLiveException = getActiveLiveException(member.id, now);
            if (isPreviousShiftMember && !activeLiveException && user && (user.checkedIn || user.disconnected)) {
                const previousBounds = getShiftBounds(memberShift, now);
                if (previousBounds?.end && now.isSameOrAfter(previousBounds.end)) {
                    await handleClockOut(member, user, previousBounds.end, '이전 근무조 예정 종료 시간 도달 - 교대 자동 퇴근', previousBounds.end, {
                        skipEarlyPenalty: true,
                        clockOutSource: 'shift-handoff-auto-finish',
                        detectedAt: now
                    });
                    sessionChanged = true;
                }
            }
        }
        const dashboardNameCounts = new Map();
        for (const member of currentShiftMembers.values()) {
            const baseName = (member.displayName || member.user?.username || 'Unknown').split('-')[0].trim() || 'Unknown';
            const key = baseName.toLowerCase();
            dashboardNameCounts.set(key, (dashboardNameCounts.get(key) || 0) + 1);
        }
        const overtimeBeforeCleanup = overtimeUsers.length;
        overtimeUsers = overtimeUsers.filter(ot => {
            const user = attendanceData[ot.id];
            const member = guild.members.cache.get(ot.id);
            if (!user || !member || user.dayOff) return false;
            if (!isOvertimeEntryStillValid(ot, user, member, now)) {
                if (user.attendanceStatus === 'OVERTIME') {
                    transitionRecordedStatus(user, {
                        attendanceStatus: user.checkedIn ? 'WORKING' : 'FINISHED',
                        voiceStatus: user.disconnected ? 'DISCONNECTED' : (member.voice?.channelId ? (member.voice?.streaming ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE')
                    }, now, 'dashboard-overtime-cleanup', 'invalid-overtime-entry-removed');
                }
                return false;
            }
            if (!currentRoleMemberIds.has(ot.id)) return true;
            const bounds = getShiftBounds(activeDisplayShift, now);
            const isMainShiftTime = now.isBetween(bounds.start, bounds.end, null, '[]');
            if (ot.type === 'PRE_OT' && isMainShiftTime) {
                user.pendingManualOT = false;
                transitionRecordedStatus(user, {
                    attendanceStatus: 'WORKING',
                    voiceStatus: member.voice?.streaming ? 'LIVE_ON' : (member.voice?.channelId ? 'LIVE_OFF' : 'OFFLINE')
                }, now, 'dashboard-overtime-cleanup', 'pre-shift-ot-ended-regular-shift-started');
                return false;
            }
            if (ot.type === 'MANUAL' && isMainShiftTime) {
                user.pendingManualOT = true;
                return false;
            }
            if (['MANUAL', 'PRE_OT'].includes(ot.type)) return true;
            if (!isMainShiftTime) return true;
            user.shift = activeDisplayShift;
            user.isFinished = false;
            if (member.voice?.streaming) {
                user.checkedIn = true;
                user.disconnected = false;
                user.disconnectedAt = null;
                user.voiceJoinedAt = null;
                user.liveOffStartedAt = null;
                user.liveOffWarnedFor = null;
                user.shiftSessionKey = getShiftSessionKey(activeDisplayShift, now);
                user.lastLiveLogKey = getShiftSessionKey(activeDisplayShift, now);
            }
            return false;
        });
        if (overtimeUsers.length !== overtimeBeforeCleanup) sessionChanged = true;
        const dashboardOvertimeUsers = overtimeUsers.filter(ot => {
            const user = attendanceData[ot.id];
            const member = guild.members.cache.get(ot.id);
            const voiceState = guild.voiceStates.cache.get(ot.id);
            const isCurrentShiftMember = currentRoleMemberIds.has(ot.id);
            const isStreamingNow = Boolean(member?.voice?.streaming || voiceState?.streaming);
            const hasLiveException = Boolean(getActiveLiveException(ot.id, now));
            return Boolean(
                member &&
                user?.checkedIn &&
                !user?.dayOff &&
                (!isCurrentShiftMember || ['MANUAL', 'FORCED', 'PRE_OT'].includes(ot.type)) &&
                (isStreamingNow || hasLiveException || ot.type === 'FORCED')
            );
        });
        const dashboardOvertimeIds = new Set(dashboardOvertimeUsers.map(ot => ot.id));
        const users = currentShiftMembers
            .map(m => {
                const userShift = currentRoleMemberIds.has(m.id)
                    ? activeDisplayShift
                    : (attendanceData[m.id]?.shift || determineShift(m) || activeDisplayShift);
                const u = ensureUserData(m, userShift);
                const voiceState = guild.voiceStates.cache.get(m.id);
                const isVoiceConnected = Boolean(m.voice?.channelId || voiceState?.channelId);
                const isStreaming = Boolean(voiceState?.streaming);
                const baseName = (m.displayName || m.user?.username || 'Unknown').split('-')[0].trim() || 'Unknown';
                u.dashboardName = dashboardNameCounts.get(baseName.toLowerCase()) > 1
                    ? `${baseName}#${m.id.slice(-4)}`
                    : baseName;
                const bounds = getShiftBounds(u.shift, now);
                const isPreShift = now.isBefore(bounds.start);
                const liveException = getActiveLiveException(m.id, now);
                const isVoiceLiveOff = isVoiceConnected && !isStreaming;
                if (u.checkedIn && !u.isFinished && u.disconnected && isVoiceLiveOff && !isPreShift) {
                    u.disconnected = false;
                    u.disconnectedAt = null;
                    { const session = getOpenSession(u); if (session) closeOpenSessionPeriod(session.dcPeriods, now); }
                    markLiveOffState(u, now);
                    sessionChanged = true;
                }
                const postMaintenanceFinished = shouldShowPostMaintenanceFinished(m, u, activeDisplayShift, now);
                const isDashboardOvertime = dashboardOvertimeIds.has(m.id);
                u.fState = postMaintenanceFinished ? 'FINISHED' : getHybridDashboardState(u, {
                    isVoiceLiveOff,
                    isPreShift,
                    isStreaming,
                    isVoiceConnected,
                    hasLiveOffVoice: liveOffVoiceIds.has(m.id),
                    liveException,
                    bounds,
                    now
                });
                if (isDashboardOvertime) {
                    u.fState = 'OVERTIME';
                } else if (shouldHidePreviousShiftWaiting(m, activeDisplayShift, u.fState)) {
                    u.fState = 'OUT_OF_SCOPE';
                }
                u.isOT = isDashboardOvertime;
                return u;
            });

        const visibleUsers = users.filter(u => u.fState !== 'OUT_OF_SCOPE');
        const groups = buildExclusiveDashboardGroups(visibleUsers, dashboardOvertimeUsers);
        const {
            active,
            liveExceptionUsers,
            disconnected,
            finished,
            liveOff,
            standby,
            absent,
            leave,
            overtime: exclusiveOvertimeUsers
        } = groups;

        const totalUsers = visibleUsers.length;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle('🖥️ INTEGRATED OPS CONTROL CENTER')
            .setDescription(renderDashboardHeader(now, dashboardMaintenance))
            .setFooter({ text: DASHBOARD_WIDTH_FOOTER });

        embed.addFields(
    {
        name: '📊 OVERVIEW',
        value: renderSummaryBox([
            ['TOTAL', totalUsers],
            ['ACTIVE', active.length],
            ['FINISHED', finished.length]
        ]),
        inline: true
    },
    {
        name: '⚠️ ATTENTION',
        value: renderSummaryBox([
            ['LIVE OFF', liveOff.length],
            ['DC', disconnected.length],
            ['ABSENT', absent.length],
            ['WAITING', standby.length]
        ]),
        inline: true
    },
    {
        name: '📌 ETC',
        value: renderSummaryBox([
            ['OFF', leave.length],
            ['OT', exclusiveOvertimeUsers.length],
            ['EXCEPTION', liveExceptionUsers.length]
        ]),
        inline: true
    }
);

        embed.addFields({ name: '\u200B', value: '\u200B', inline: false });
        embed.addFields({ name: `${shiftNameText} [CURRENT]`, value: '\u200B', inline: false });
        embed.addFields(
            { name: `✅ ACTIVE & LIVE ON (${active.length}명)`, value: renderCleanGrid(active, '✅'), inline: false },
            { name: `📴 LIVE OFF (${liveOff.length}명)`, value: renderStatusList(liveOff, '📴', now, 'liveoff'), inline: false },
            { name: `⚡ DISCONNECTED (${disconnected.length}명)`, value: renderStatusList(disconnected, '⚡', now, 'dc'), inline: false },
            { name: `🟣 LIVE EXCEPTION (${liveExceptionUsers.length}명)`, value: renderStatusList(liveExceptionUsers, '🟣', now, 'exception'), inline: false },
            { name: `❌ ABSENT (${absent.length}명)`, value: renderStatusList(absent, '❌', now, 'absent'), inline: false },
            { name: `⏳ STANDBY (${standby.length}명)`, value: renderStatusList(standby, '⏳', now, 'standby'), inline: false },
            { name: `⏹️ FINISHED (${finished.length}명)`, value: renderStatusList(finished, '⏹️', now, 'finished'), inline: false },
            { name: `🔵 DAY OFF (${leave.length}명)`, value: renderStatusList(leave, '🔵', now), inline: false }
        );

        embed.addFields({
            name: `🔥 OVERTIME (${exclusiveOvertimeUsers.length}명)`,
            value: renderOvertimeList(now, exclusiveOvertimeUsers),
            inline: false
        });

        let msg = statusMessageId ? await ch.messages.fetch(statusMessageId).catch(() => null) : null;
        if (!msg) msg = await findExistingStatusMessage(ch);

        if (!msg) {
            const n = await ch.send({ embeds: [embed] });
            statusMessageId = n.id;
            await saveSystemAsync();
        } else {
            statusMessageId = msg.id;
            await msg.edit({ embeds: [embed] }).catch(() => {
                statusMessageId = null;
            });
        }
        if (sessionChanged || expiredDayOff) await saveSystemAsync();
    } catch (e) {
        console.error('[DASH CORE ERROR]', e);
    } finally {
        renderingDashboard = false;
        if (pendingDashboardRender) {
            pendingDashboardRender = false;
            setTimeout(() => renderDashboardCore().catch(() => null), 1000);
        }
    }
}

/**
 * [ VOICE SYNC ENGINE ]
 */
async function applyVoiceSnapshot(member, user, shift, snapshot, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!member || !user || !shift) return false;
    let changed = false;
    const source = snapshot.source || 'voice_snapshot';
    const wasConnected = Boolean(snapshot.wasConnected);
    const isConnected = Boolean(snapshot.isConnected);
    const wasStreaming = Boolean(snapshot.wasStreaming);
    const isStreaming = Boolean(snapshot.isStreaming);
    const joinedVoice = !wasConnected && isConnected;
    const leftVoice = wasConnected && !isConnected;
    const becameLive = !wasStreaming && isStreaming;
    const stoppedStreaming = wasStreaming && !isStreaming;
    const maintenance = isMaintenanceWindow(now);

    if (maintenance && !isWithinPreShiftWindow(shift, now)) {
        if (joinedVoice) appendAttendanceEvent(user, 'voice_join_maintenance', now, source, { live: isStreaming });
        if (becameLive) appendAttendanceEvent(user, 'live_on_maintenance', now, source);
        return false;
    }

    const bounds = getShiftBounds(shift, now);
    
    // ✨ [핵심 수정] 출근한 사람(checkedIn)이거나 이미 퇴근 대기 중인 사람(isFinished)은 
    // 근무 시간이 지나도 채널 상태 감지를 무시하지 않도록 강제 예외 처리합니다.
    if (!user.checkedIn && !user.isFinished && !user.pendingManualOT && !now.isBetween(bounds.start, bounds.end, null, '[]') && !isWithinPreShiftWindow(shift, now)) {
        return false;
    }

    if (user.isFinished && !user.checkedIn) {
        if (!isConnected) {
            return setFinishedPresence(user, 'left_voice', now, source);
        }
        if (setFinishedPresence(user, 'in_voice', now, source)) changed = true;
    }

    const activeLiveException = getActiveLiveException(member.id, now);

    if (!isConnected) {
        if (user.voiceJoinedAt || user.liveOffStartedAt || user.liveOffWarnedFor) {
            user.voiceJoinedAt = null;
            user.liveOffStartedAt = null;
            user.liveOffWarnedFor = null;
            changed = true;
        }
        if (transitionRecordedStatus(user, {
            voiceStatus: user.checkedIn ? 'DISCONNECTED' : 'OFFLINE'
        }, now, source, user.checkedIn ? 'voice-disconnected' : 'voice-offline')) changed = true;
        
        if (user.checkedIn && !user.disconnected) {
            // ✨ 정규 퇴근 시간 이후에 채널을 나가면 즉시 퇴근 처리 (유예 없음)
            const shiftEnd = getScheduledEndMoment(user, now); 
            if (shiftEnd && now.isSameOrAfter(shiftEnd)) {
                await handleClockOut(member, user, now, '정규 퇴근 시간 이후 채널 이탈 (즉시 자동 퇴근)', now, { clockOutSource: 'auto-out-after-shift' });
                changed = true;
                return true;
            }

            user.disconnected = true;
            user.disconnectedAt = now.toISOString();
            { const session = getOpenSession(user); if (session) startSessionPeriod(session.dcPeriods, now, source === 'heartbeat' ? 'voice-left-heartbeat' : 'voice-left'); }
            createPendingClockOut(user, 'voice_leave', now, CONFIG.GRACE_PERIOD_MINS, '음성채널 이탈 유예 시작');
            user.dcCount = (user.dcCount || 0) + 1;
            await recordLog(user, 'disconnect', source === 'heartbeat' ? 'DC (음성채널 이탈 감지)' : null);
            changed = true;
        }
        return changed;
    }

    if (user.dayOff) {
        const activeDayOffReservation = getActiveApprovedDayOffReservation(member.id, shift, now);
        if (isStreaming && isCurrentShiftRegularWorker(member, now) && !activeDayOffReservation) {
            const previousExpireAt = user.dayOffExpireAt || null;
            user.dayOff = false;
            user.dayOffExpireAt = null;
            if ((user.offCount || 0) > 0) user.offCount -= 1;
            appendAttendanceEvent(user, 'stale_dayoff_cleared_for_current_worker', now, source, {
                shift,
                previousExpireAt,
                reason: 'current-regular-live-on-without-approved-reservation'
            });
            await recordLog(user, 'reconnect', '현재 근무자 LIVE ON 감지 - 예약 없는 DAY OFF 상태 자동 해제');
            changed = true;
        } else {
        if (transitionRecordedStatus(user, {
            attendanceStatus: 'DAY_OFF',
            voiceStatus: isStreaming ? 'LIVE_ON' : 'LIVE_OFF'
        }, now, source, 'day-off-presence')) changed = true;
        if (isConnected) {
            const action = isStreaming ? 'LIVE ON while Day Off' : 'Voice channel presence while Day Off';
            return await notifyDayOffPresence(member, user, shift, now, action);
        }
        return false;
        }
    }

    if (activeLiveException) {
        const wasCheckedIn = Boolean(user.checkedIn);
        user.checkedIn = true;
        user.dayOff = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.isFinished = false;
        user.shift = shift;
        user.status = 'exception';
        user.checkInTime = user.checkInTime || now.format('hh:mm A');
        user.checkInRaw = user.checkInRaw || now.toISOString();
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingClockOut = null;
        user.finishedLiveOffReminderMarks = [];
        user.lastLiveOnAt = now.toISOString();
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus: 'EXCEPTION'
        }, now, source, 'live-exception-voice-connected');
        await updateWorkingRole(member, true);
        if (!wasCheckedIn || joinedVoice) {
            await recordLog(user, 'reconnect', '라이브 예외 근무 인정 - 음성채널 접속 확인');
        }
        return true;
    }

    if (isStreaming && isFinishedBeforeCurrentShift(user, shift, now)) {
        user.isFinished = false;
        user.finishedPresence = null;
        user.finalLeftAt = null;
        if (await handleClockIn(member, user, shift, now, true)) changed = true;
        if (await activatePendingManualOvertime(user, now)) changed = true;
        return true;
    }

    const canResumeAsApprovedOt = Boolean(
        user.pendingManualOT &&
        canStartOvertimeNow(user, now)
    );
    const lastClockOutEvent = Array.isArray(user.attendanceEvents)
        ? user.attendanceEvents.slice().reverse().find(event => event?.type === 'clock_out_confirmed')
        : null;
    const lastClockOutSource = user.lastClockOutSource || lastClockOutEvent?.source || null;
    const lastClockOutAt = user.checkOutRaw || lastClockOutEvent?.at || null;
    const lastAutoTimeoutClockOutAt = lastClockOutAt ? moment(lastClockOutAt).tz(CONFIG.TIMEZONE) : null;
    const autoTimeoutResumeMins = lastAutoTimeoutClockOutAt
        ? now.diff(lastAutoTimeoutClockOutAt, 'minutes')
        : null;
    const isAutoTimeoutClockOut = ['dc-timeout', 'live-off-timeout'].includes(lastClockOutSource);
    const scheduledEnd = getScheduledEndMoment(user, now);
    const isBeforeScheduledEnd = Boolean(scheduledEnd && now.isBefore(scheduledEnd));
    const canAutoResumeCurrentRegularWorker = isCurrentShiftRegularWorker(member, now);
    const canResumeFromAutoTimeout = Boolean(
        isStreaming &&
        user.isFinished &&
        !user.checkedIn &&
        isAutoTimeoutClockOut &&
        isBeforeScheduledEnd &&
        autoTimeoutResumeMins !== null &&
        (canAutoResumeCurrentRegularWorker || autoTimeoutResumeMins <= CONFIG.AUTO_TIMEOUT_RESUME_WINDOW_MINS) &&
        (!user.manualResumeRequired || canAutoResumeCurrentRegularWorker) &&
        !overtimeUsers.some(ot => ot.id === member.id)
    );
    if (canResumeFromAutoTimeout) {
        const resumePenaltyKey = `${lastClockOutSource}:${lastAutoTimeoutClockOutAt.toISOString()}`;
        if (user.reversibleEarlyPenaltyKey === resumePenaltyKey) {
            user.totalEarly = Math.max(0, (user.totalEarly || 0) - 1);
            user.points = (user.points || 0) + (user.reversibleEarlyPenaltyPoints || Math.abs(CONFIG.POINTS.EARLY_OUT));
            user.reversibleEarlyPenaltyKey = null;
            user.reversibleEarlyPenaltyAppliedAt = null;
            user.reversibleEarlyPenaltyPoints = null;
            appendAttendanceEvent(user, 'early_penalty_reversed', now, source, {
                reason: 'auto-timeout-resumed-live-on',
                currentRegularWorker: canAutoResumeCurrentRegularWorker,
                clockOutSource: lastClockOutSource,
                clockOutAt: lastClockOutAt
            });
        }
        user.checkedIn = true;
        user.isFinished = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingClockOut = null;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.lastManualResumePromptKey = null;
        user.manualResumePromptMarks = [];
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.lastLiveOnAt = now.toISOString();
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus: 'LIVE_ON'
        }, now, source, canAutoResumeCurrentRegularWorker ? 'current-regular-resumed-live-on' : 'auto-timeout-resumed-live-on');
        startAttendanceSession(user, shift, now, canAutoResumeCurrentRegularWorker ? 'current-regular-resume' : 'auto-timeout-resume');
        await updateWorkingRole(member, true);
        await recordLog(user, 'reconnect', canAutoResumeCurrentRegularWorker
            ? '현재 근무자 DC/LIVE OFF 종료 후 라이브 복구 (근무 재개)'
            : '자동 조기퇴근 후 라이브 복구 (근무 재개)');
        return true;
    }
    const shouldPromptManualResume = Boolean(
        isStreaming &&
        user.isFinished &&
        !user.checkedIn &&
        isAutoTimeoutClockOut &&
        isBeforeScheduledEnd &&
        autoTimeoutResumeMins !== null &&
        autoTimeoutResumeMins > CONFIG.AUTO_TIMEOUT_RESUME_WINDOW_MINS &&
        !canAutoResumeCurrentRegularWorker &&
        !overtimeUsers.some(ot => ot.id === member.id)
    );
    if (shouldPromptManualResume) {
        const promptKey = `${lastClockOutSource}:${lastClockOutAt}:manual-resume-required`;
        user.manualResumeRequired = true;
        user.manualResumeRequiredReason = lastClockOutSource;
        if (user.lastManualResumePromptKey !== promptKey) {
            user.lastManualResumePromptKey = promptKey;
            user.manualResumeRequiredSince = now.toISOString();
            user.manualResumePromptMarks = [];
        }
        const promptStartedAt = user.manualResumeRequiredSince
            ? moment(user.manualResumeRequiredSince).tz(CONFIG.TIMEZONE)
            : now.clone();
        const promptElapsedMins = Math.max(0, now.diff(promptStartedAt, 'minutes'));
        const reminderMark = Math.floor(promptElapsedMins / 10) * 10;
        const allowedReminderMarks = [0, 10, 20];
        if (allowedReminderMarks.includes(reminderMark) && !user.manualResumePromptMarks.includes(reminderMark)) {
            user.manualResumePromptMarks.push(reminderMark);
            const reminderNumber = allowedReminderMarks.indexOf(reminderMark) + 1;
            appendAttendanceEvent(user, 'manual_resume_required', now, source, {
                clockOutSource: lastClockOutSource,
                clockOutAt: lastClockOutAt,
                minutesSinceClockOut: autoTimeoutResumeMins,
                reminderNumber,
                reminderMark
            });
            await member.send([
                '🌿 Attendance reminder',
                `Reminder ${reminderNumber}/3`,
                '',
                'Your live stream is ON, but your attendance is NOT active right now.',
                'Your previous attendance was already closed because the DC/LIVE OFF grace period was exceeded.',
                '',
                'Since more than 60 minutes have passed, the bot will not resume your shift automatically.',
                '',
                '✅ Please press the CLOCK IN button on the attendance panel while your live stream is ON.',
                '⚠️ If you do not press CLOCK IN, your work time will NOT be counted.',
                '',
                'If this was a mistake, please contact an admin. 🙂'
            ].join('\n')).catch(() => null);
            await recordLog(user, 'reconnect', `자동 조기퇴근 후 60분 초과 복귀 감지 (CLOCK IN 버튼 필요, 안내 ${reminderNumber}/3)`);
        }
        return true;
    }
    if (isStreaming && user.isFinished && !user.checkedIn && await restoreOvertimeAfterFinish(member, user, shift, now, source)) {
        return true;
    }
    if (user.isFinished && !user.checkedIn) {
        if (!isConnected) {
            if (setFinishedPresence(user, 'left_voice', now, source)) changed = true;
            if (transitionRecordedStatus(user, {
                attendanceStatus: 'FINISHED',
                voiceStatus: 'OFFLINE'
            }, now, source, 'finished-presence-offline')) changed = true;
            return changed;
        }

        if (setFinishedPresence(user, 'in_voice', now, source)) changed = true;
        if (transitionRecordedStatus(user, {
            attendanceStatus: 'FINISHED',
            voiceStatus: isStreaming ? 'LIVE_ON' : 'LIVE_OFF'
        }, now, source, 'finished-presence-kept')) changed = true;
        if (joinedVoice) {
            const notified = await notifyFinishedReturnToVoice(member, user, shift, now, 'Returned to voice after clock-out');
            if (notified) changed = true;
        }
        if (!isStreaming && isConnected) {
            const notified = await notifyStandbyClockInRequired(member, user, shift, now, 'Finished user in voice without live');
            if (notified) changed = true;
            const finishedReminderSent = await sendFinishedLiveOffReminder(member, user, now, source);
            if (finishedReminderSent) changed = true;
        }
        if (isStreaming) {
            const notified = await notifyAfterFinishPresence(member, user, shift, now, 'LIVE ON after clock-out');
            return changed || notified;
        }
        appendAttendanceEvent(user, joinedVoice ? 'voice_join_after_finish' : 'voice_live_off_after_finish', now, source, {
            result: 'finished_kept'
        });
        return true;
    }
    if (isStreaming && user.isFinished && !user.checkedIn && !canResumeAsApprovedOt && !overtimeUsers.some(ot => ot.id === member.id)) {
        return await notifyAfterFinishPresence(member, user, shift, now, 'LIVE ON after clock-out');
    }

    if (!isStreaming) {
        appendAttendanceEvent(user, joinedVoice ? 'voice_join' : 'voice_live_off_snapshot', now, source, { live: false });
        if (user.disconnected) {
            user.disconnected = false;
            { const session = getOpenSession(user); if (session) closeOpenSessionPeriod(session.dcPeriods, now); }
            user.disconnectedAt = null;
            recoverPendingClockOut(user, now, `${source}_voice_rejoined_live_off`);
            markLiveOffState(user, now);
            await recordLog(user, 'reconnect', 'DC 복구 - 음성채널 재접속, 라이브 OFF 상태');
            await recordLog(user, 'disconnect', '라이브 OFF 시작 - 음성채널 접속 상태');
            return true;
        }
        if (
            user.checkedIn &&
            !user.isFinished &&
            !getActiveLiveException(member.id, now) &&
            user.status !== 'exception' &&
            user.voiceStatus !== 'EXCEPTION'
        ) {
            // ✨ 정규 퇴근 시간 이후에 방송을 끄면 즉시 퇴근 처리 (유예 없음)
            const shiftEnd = getScheduledEndMoment(user, now); 
            if (shiftEnd && now.isSameOrAfter(shiftEnd)) {
                await handleClockOut(member, user, now, '정규 퇴근 시간 이후 방송 종료 - 자동 퇴근', now, { clockOutSource: 'auto-out-after-shift-live-off' });
                changed = true;
                return true;
            }

            const started = markLiveOffState(user, now);
            const liveOffAt = user.liveOffStartedAt || user.voiceJoinedAt;
            const liveOffMins = liveOffAt ? now.diff(moment(liveOffAt).tz(CONFIG.TIMEZONE), 'minutes') : 0;
            const pendingLiveOffClockOutAt = user.pendingClockOut?.source === 'live_off' && user.pendingClockOut.expiresAt
                ? moment(user.pendingClockOut.expiresAt).tz(CONFIG.TIMEZONE)
                : (liveOffAt ? moment(liveOffAt).tz(CONFIG.TIMEZONE).add(CONFIG.LIVE_OFF_CLOCK_OUT_MINS, 'minutes') : null);
            const isLiveOffClockOutDue = Boolean(pendingLiveOffClockOutAt && now.isSameOrAfter(pendingLiveOffClockOutAt));
            if (started) {
                await recordLog(user, 'disconnect', stoppedStreaming ? '라이브 OFF 시작 - 방송 종료' : '라이브 OFF 시작 - 음성채널 접속 상태');
                changed = true;
            }
            const warningMark = Math.floor(liveOffMins / CONFIG.LIVE_OFF_DM_INTERVAL_MINS) * CONFIG.LIVE_OFF_DM_INTERVAL_MINS;
            const liveOffReminderMarks = [10, 20];
            if (
                !isLiveOffClockOutDue &&
                liveOffReminderMarks.includes(warningMark) &&
                !user.liveOffWarningMarks.includes(warningMark)
            ) {
                const reminderNumber = liveOffReminderMarks.indexOf(warningMark) + 1;
                await member.send([
                    '🌿 Gentle reminder',
                    `Reminder ${reminderNumber}/3`,
                    '',
                    'You are in the voice channel, but your live stream appears to be OFF.',
                    'When you are ready, please turn your live stream back on so your work time can keep counting.',
                    '',
                    `Live OFF time: about ${warningMark} minutes.`,
                    `If it stays off for ${CONFIG.LIVE_OFF_CLOCK_OUT_MINS} minutes, the bot may clock you out automatically.`,
                    'Thank you. 🙂'
                ].join('\n')).catch(() => null);
                user.liveOffWarningMarks.push(warningMark);
                user.liveOffWarnedFor = `${shift}:${liveOffAt ? moment(liveOffAt).format('YYYY-MM-DD HH:mm') : now.format('YYYY-MM-DD HH:mm')}:${warningMark}`;
                changed = true;
            }
        } else if (!user.checkedIn && isWithinPreShiftWindow(shift, now)) {
            if (!user.voiceJoinedAt) {
                user.voiceJoinedAt = now.toISOString();
                changed = true;
            }
        } else if (!user.checkedIn && !user.isFinished && isConnected && now.isSameOrAfter(bounds.start)) {
            const notified = await notifyStandbyClockInRequired(member, user, shift, now, 'Standby voice without live');
            if (notified) changed = true;
        }
        return changed;
    }

    user.isFinished = false;
    const liveOffStartedAt = (user.liveOffStartedAt || user.voiceJoinedAt)
        ? moment(user.liveOffStartedAt || user.voiceJoinedAt).tz(CONFIG.TIMEZONE)
        : null;
    const liveOffDurationText = liveOffStartedAt
        ? ` [라이브 OFF 지속: ${formatDuration(Math.max(0, now.diff(liveOffStartedAt, 'minutes')))}]`
        : '';

    if (clearLiveOffState(user, now)) changed = true;
    user.lastLiveOnAt = now.toISOString();

    if (user.disconnected) {
        user.disconnected = false;
        { const session = getOpenSession(user); if (session) closeOpenSessionPeriod(session.dcPeriods, now); }
        user.disconnectedAt = null;
        recoverPendingClockOut(user, now, `${source}_live_recovered_from_dc`);
        if (!user.checkedIn) await handleClockIn(member, user, shift, now, true);
        transitionRecordedStatus(user, {
            voiceStatus: 'LIVE_ON'
        }, now, source, 'dc-recovered-live-on');
        await recordLog(user, 'reconnect', 'DC 복구 - 라이브 ON 상태로 복귀');
        await recordLog(user, 'reconnect', '라이브 ON 복구 - DC 이후 방송 재개' + liveOffDurationText);
        if (await activatePendingManualOvertime(user, now)) changed = true;
        return true;
    }

    if (!user.checkedIn) {
        if (user.isFinished) {
            return changed; 
        }

        if (await handleClockIn(member, user, shift, now, true)) changed = true;
        if (await activatePendingManualOvertime(user, now)) changed = true;
        return true;
    }

    if (transitionRecordedStatus(user, {
        voiceStatus: 'LIVE_ON'
    }, now, source, 'live-on-confirmed')) changed = true;

    if (becameLive || liveOffStartedAt) {
        const text = liveOffStartedAt
            ? '라이브 ON 복구 - 방송 재개' + liveOffDurationText
            : '라이브 ON 확인 - 출근 상태 유지';
        if (liveOffStartedAt) {
            if (await recordLiveRecovery(member, user, shift, now, liveOffStartedAt, text)) changed = true;
        } else if (await recordLiveConfirmation(member, user, shift, now, text)) {
            changed = true;
        }
    } else if (source === 'heartbeat' && await recordLiveConfirmation(member, user, shift, now)) {
        changed = true;
    }

    if (await activatePendingManualOvertime(user, now)) changed = true;
    return changed;
}

async function syncVoiceStates() {
    try {
        const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
        if (!guild) return;
        await refreshGuildMembers(guild);
        const now = moment().tz(CONFIG.TIMEZONE);
        let changed = false;
        const activeVoiceIds = new Set(guild.voiceStates.cache.map(voiceState => voiceState.id));

        for (const voiceState of guild.voiceStates.cache.values()) {
            const member = voiceState.member || guild.members.cache.get(voiceState.id);
            if (!member || member.user?.bot) continue;
            const shift = determineShift(member);
            if (!shift) continue;
            const u = ensureUserData(member, shift);
            if (!u) continue;
            if (await applyVoiceSnapshot(member, u, shift, {
                source: 'heartbeat',
                wasConnected: true,
                isConnected: Boolean(voiceState.channelId),
                wasStreaming: Boolean(voiceState.streaming),
                isStreaming: Boolean(voiceState.streaming)
            }, now)) changed = true;
        }

        for (const member of guild.members.cache.values()) {
            if (member.user.bot) continue;
            const u = attendanceData[member.id];
            if (!u) continue;
            if (getActiveLiveException(member.id, now) && activeVoiceIds.has(member.id)) continue;
            if (!activeVoiceIds.has(member.id)) {
                const shift = u.shift || getMemberShiftRole(member);
                if (!shift) continue;
                if (await applyVoiceSnapshot(member, u, shift, {
                    source: 'heartbeat',
                    wasConnected: Boolean(member.voice?.channelId || u.checkedIn || u.disconnected || u.voiceJoinedAt || u.liveOffStartedAt),
                    isConnected: false,
                    wasStreaming: Boolean(member.voice?.streaming),
                    isStreaming: false
                }, now)) changed = true;
            }
        }
        if (changed) await saveSystemAsync();
    } catch (e) {
        console.error('[VOICE SYNC ERROR]', e);
    }
}

/**
 * [ NOTICE PANEL ]
 */
const getNoticeEmbed = (type) => {
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
    const P = '\u001b[1;35m';  // 분홍 (시간 숫자)
    const G = '\u001b[1;32m';  // 초록 (분/AM/PM 등 나머지)
    const W = '\u001b[1;37m';  // 흰색 (레이블, 괄호 등)
    const R = '\u001b[0m';     // 리셋
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
};

async function syncAutoPanels() {
    try {
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
                panelInfo[key].mId = n.id;
                await saveSystemAsync();
            } else {
                await pMsg.edit({ embeds: [getNoticeEmbed(key)], components: [row] }).catch(e => {
                    console.error('[PANEL EDIT ERROR]', e);
                    panelInfo[key].mId = null;
                });
            }
        }
    } catch (e) {
        console.error('[PANEL SYNC ERROR]', e);
    }
}

/**
 * [ REPORTING ]
 */
async function sendDeepReport(type = 'Regular') {
    try {
        const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL);
        const embed = new EmbedBuilder()
            .setTitle(`[${type.toUpperCase()}] 운영 보고서`)
            .setColor(type === 'Analysis' ? '#3498DB' : '#2ECC71')
            .setTimestamp();
        const guild = logChan.guild;
        await refreshGuildMembers(guild);
        const allStats = getDayNightWorkerStats(guild);

        if (type === 'Analysis') {
            let content = '```\n[PTS] [Normal/Late/Absent/Early/OT/Off] [DC] | Name\n';
            const sorted = allStats.sort((a, b) => (b.points || 0) - (a.points || 0));
            sorted.forEach(u => {
                const stats = `${u.totalNormal || 0}/${u.totalLate || 0}/${u.totalAbsent || 0}/${u.totalEarly || 0}/${u.totalOT || 0}/${u.offCount || 0}`;
                content += `${padWidth((u.points || 0).toString(), 5)} ${padWidth(stats, 18)} ${padWidth((u.dcCount || 0).toString(), 4)} | ${u.name?.split('-')[0] || 'Unknown'}\n`;
            });
            embed.addFields({ name: '전체 인원 지표', value: renderEmbedCodeBlock(content.replace(/^```\n/, ''), 1000) });
        } else {
            const act = allStats.filter(u => u.checkedIn).length;
            const off = allStats.filter(u => u.dayOff).length;
            const denominator = Math.max(allStats.length - off, 1);
            const rate = Math.round((act / denominator) * 100) || 0;
            embed.addFields({ name: '출석 요약', value: `출석률: ${rate}%\n출근: ${act}명 | 휴무: ${off}명` });
        }
        return logChan.send({ embeds: [embed] });
    } catch (e) {
        console.error('[REPORT ERROR]', e);
    }
}

async function sendOpsReport(type = 'Regular') {
    try {
        const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL);
        const now = moment().tz(CONFIG.TIMEZONE);
        const currentShift = getDashboardShift(now);
        const shiftNameText = currentShift === 'day' ? 'DAY SHIFT' : 'NIGHT SHIFT';
        const embedColor = currentShift === 'day' ? '#F1C40F' : '#3498DB';
        const embed = new EmbedBuilder()
            .setTitle(type === 'Analysis' ? `PRECISION REPORT - ${shiftNameText}` : `SUMMARY REPORT - ${shiftNameText}`)
            .setColor(embedColor)
            .setDescription(`PH TIME: ${now.format('hh:mm A')}`)
            .setFooter({ text: `Integrated Ops Control Center | ${CONFIG.VERSION}` })
            .setTimestamp();

        const guild = logChan.guild;
        await refreshGuildMembers(guild);
        const allStats = getDayNightWorkerStats(guild, currentShift);
        const reportOvertimeUsers = getDayNightWorkerOvertimeUsers(guild, currentShift);

        if (type !== 'Analysis') {
            const activeUsers = allStats.filter(u => u.checkedIn && !u.disconnected && !u.dayOff);
            const finishedUsers = allStats.filter(u => u.isFinished && !u.checkedIn && !u.dayOff);
            const offUsers = allStats.filter(u => u.dayOff);
            const disconnectedUsers = allStats.filter(u => u.disconnected);
            const absentUsers = allStats.filter(u => {
                if (u.checkedIn || u.dayOff || !u.shift) return false;
                return now.diff(getShiftBounds(u.shift, now).start, 'minutes') > 120;
            });
            const standbyUsers = allStats.filter(u => {
                if (u.checkedIn || u.dayOff || !u.shift || u.isFinished) return false;
                const diff = now.diff(getShiftBounds(u.shift, now).start, 'minutes');
                return diff >= 0 && diff <= 120;
            });
            const workBase = Math.max(allStats.length - offUsers.length, 1);
            const attendanceRate = Math.round(((activeUsers.length + finishedUsers.length) / workBase) * 100) || 0;
            const absenceRate = Math.round((absentUsers.length / workBase) * 100) || 0;
            const activeRate = Math.round((activeUsers.length / workBase) * 100) || 0;
            const finishedRate = Math.round((finishedUsers.length / workBase) * 100) || 0;
            const standbyRate = Math.round((standbyUsers.length / workBase) * 100) || 0;
            const offRate = Math.round((offUsers.length / Math.max(allStats.length, 1)) * 100) || 0;
            const dcRate = Math.round((disconnectedUsers.length / workBase) * 100) || 0;
            const otRate = Math.round((reportOvertimeUsers.length / workBase) * 100) || 0;
            const lateUsers = allStats.filter(u => u.status === 'late');
            const lateRate = Math.round((lateUsers.length / workBase) * 100) || 0;

            const listNames = (arr, empty = 'NONE') => {
                if (!arr.length) return empty;
                return arr
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .slice(0, 20)
                    .map(u => `${padWidth(truncateWidth(u.name?.split('-')[0] || 'Unknown', 16), 17)} ${u.checkInTime || ''}`)
                    .join('\n');
            };

            const makeRateRow = (label, rate, val, base) => {
                const paddedLabel = formatExactWidth(label, 8);
                return `${paddedLabel} |   ${String(rate).padStart(3)}%  ${renderPercentBar(rate)}  |  ${String(val).padStart(2)} / ${String(base).padStart(2)}`;
            };

            const rateBlock = [
                makeRateRow('Attend', attendanceRate, activeUsers.length + finishedUsers.length, workBase),
                makeRateRow('Active', activeRate, activeUsers.length, workBase),
                makeRateRow('Finished', finishedRate, finishedUsers.length, workBase),
                makeRateRow('Standby', standbyRate, standbyUsers.length, workBase),
                makeRateRow('Absent', absenceRate, absentUsers.length, workBase),
                makeRateRow('Late', lateRate, lateUsers.length, workBase),
                makeRateRow('Off', offRate, offUsers.length, Math.max(allStats.length, 1)),
                makeRateRow('DC', dcRate, disconnectedUsers.length, workBase),
                makeRateRow('OT 비율', otRate, reportOvertimeUsers.length, workBase)
            ].join('\n\n');

            embed.addFields(
                { name: `📊 ${shiftNameText} Summary Snapshot`, value: `TOTAL ${allStats.length} | WORK BASE ${workBase} | ACTIVE ${activeUsers.length} | FINISHED ${finishedUsers.length} | ABSENT ${absentUsers.length} | STANDBY ${standbyUsers.length} | OFF ${offUsers.length} | OT ${reportOvertimeUsers.length} | DC ${disconnectedUsers.length}`, inline: false },
                { name: `📈 Daily Rates`, value: renderEmbedCodeBlock(rateBlock), inline: false },
                { name: `🟢 Active (${activeUsers.length})`, value: renderEmbedCodeBlock(listNames(activeUsers)), inline: false },
                { name: `⚪ Finished (${finishedUsers.length})`, value: renderEmbedCodeBlock(listNames(finishedUsers)), inline: false },
                { name: `❌ Absent (${absentUsers.length})`, value: renderEmbedCodeBlock(listNames(absentUsers)), inline: false },
                { name: `🟡 Standby (${standbyUsers.length})`, value: renderEmbedCodeBlock(listNames(standbyUsers)), inline: false },
                { name: `🔵 Day Off (${offUsers.length})`, value: renderEmbedCodeBlock(listNames(offUsers)), inline: false },
                { name: `⚡ Disconnected (${disconnectedUsers.length})`, value: renderEmbedCodeBlock(listNames(disconnectedUsers)), inline: false },
                { name: `🔥 Overtime (${reportOvertimeUsers.length})`, value: renderEmbedCodeBlock(reportOvertimeUsers.map(ot => attendanceData[ot.id] || ot).map(u => formatExactWidth(u.name || 'Unknown', 16)).join('\n') || 'NONE'), inline: false }
            );
            return logChan.send({ embeds: [embed] });
        }

        const sorted = allStats.sort((a, b) => (b.points || 0) - (a.points || 0));
        const active = allStats.filter(u => u.checkedIn && !u.disconnected && !u.dayOff);
        const disconnected = allStats.filter(u => u.disconnected);
        const off = allStats.filter(u => u.dayOff);
        const absent = allStats.filter(u => {
            if (u.checkedIn || u.dayOff || !u.shift) return false;
            return now.diff(getShiftBounds(u.shift, now).start, 'minutes') > 120;
        });
        const standby = allStats.filter(u => {
            if (u.checkedIn || u.dayOff || !u.shift) return false;
            const diff = now.diff(getShiftBounds(u.shift, now).start, 'minutes');
            return diff >= 0 && diff <= 120;
        });

        const attention = [
            ...disconnected.slice(0, 5).map(u => `DC     ${padWidth(truncateWidth(u.name || 'Unknown', 16), 17)} ${u.disconnectedAt ? formatDuration(now.diff(moment(u.disconnectedAt), 'minutes')) : ''}`),
            ...absent.slice(0, 5).map(u => `ABSENT ${padWidth(truncateWidth(u.name || 'Unknown', 16), 17)} +${formatDuration(now.diff(getShiftBounds(u.shift, now).start, 'minutes'))}`)
        ].join('\n') || 'No urgent issues.';
        const topRows = sorted.slice(0, 5).map((u, idx) => renderReportTopRow(u, idx)).join('\n') || 'No data.';
        const top = `${renderReportStatsLegend()}\n${topRows}`;
        const metrics = sorted.slice(0, 20).map(renderReportMetricRow).join('\n') || 'No data.';
        const sessionMetrics = sorted
            .filter(u => Array.isArray(u.sessions) && u.sessions.length > 0)
            .slice(0, 15)
            .map(u => renderSessionMetricRow(u, now))
            .join('\n') || 'No session data.';
        const sessionMetricsTable = `이름        |상태|인정 |총시간|OFF  |DC\n${sessionMetrics}`;

        embed.addFields(
            { name: `${shiftNameText} Precision Snapshot`, value: `TOTAL ${allStats.length} | ACTIVE ${active.length} | STANDBY ${standby.length} | ABSENT ${absent.length} | OFF ${off.length} | OT ${reportOvertimeUsers.length} | DC ${disconnected.length}`, inline: false },
            { name: 'Attention', value: renderEmbedCodeBlock(attention), inline: false },
            { name: '상위 5명', value: renderEmbedCodeBlock(top), inline: false },
            { name: '세션 인정 시간', value: renderEmbedCodeBlock(sessionMetricsTable), inline: false },
            { name: '전체 지표', value: renderEmbedCodeBlock(`${renderReportMetricHeader()}\n${metrics}`), inline: false }
        );
        return logChan.send({ embeds: [embed] });
    } catch (e) {
        console.error('[OPS REPORT ERROR]', e);
    }
}

function buildDiagnosticsEmbed(guild) {
    const users = Object.values(attendanceData);
    const checkedIn = users.filter(u => u.checkedIn).length;
    const disconnected = users.filter(u => u.disconnected).length;
    const dayOff = users.filter(u => u.dayOff).length;
    const scheduled = Object.values(announceData).filter(Boolean).filter(d => d.active).length;

    return new EmbedBuilder()
        .setTitle('System Diagnostics')
        .setColor('#5865F2')
        .addFields(
            { name: 'Version', value: CONFIG.VERSION, inline: true },
            { name: 'Guild Cache', value: `${guild?.memberCount || guild?.members?.cache?.size || 0}`, inline: true },
            { name: 'Saved Users', value: `${users.length}`, inline: true },
            { name: 'Checked In', value: `${checkedIn}`, inline: true },
            { name: 'Disconnected', value: `${disconnected}`, inline: true },
            { name: 'Day Off', value: `${dayOff}`, inline: true },
            { name: 'Overtime', value: `${overtimeUsers.length}`, inline: true },
            { name: 'Active Announcements', value: `${scheduled}`, inline: true },
            { name: 'Last Save', value: lastSavedAt || 'Not saved in this session', inline: false },
            { name: 'Last Backup', value: lastBackupAt || 'No rotated backup in this session', inline: false },
            { name: 'Status Message', value: statusMessageId || 'Not linked', inline: false }
        )
        .setTimestamp();
}

function getRankingWorkerShift(user, guild = null) {
    if (!user?.id) return null;
    const member = guild?.members?.cache?.get(user.id);
    if (member?.user?.bot) return null;

    const hasDayRole = Boolean(member?.roles?.cache?.has(CONFIG.ROLES.DAY));
    const hasNightRole = Boolean(member?.roles?.cache?.has(CONFIG.ROLES.NIGHT));
    if (hasDayRole || hasNightRole) {
        if (hasDayRole && hasNightRole) return user.shift === 'night' ? 'night' : 'day';
        return hasDayRole ? 'day' : 'night';
    }

    if (!guild && ['day', 'night'].includes(user.shift)) return user.shift;
    return null;
}

function buildRankingEmbed({ guild = null, shift = 'all' } = {}) {
    const scope = ['all', 'day', 'night'].includes(shift) ? shift : 'all';
    const sorted = Object.values(attendanceData)
        .filter(user => {
            const workerShift = getRankingWorkerShift(user, guild);
            if (!workerShift) return false;
            return scope === 'all' || workerShift === scope;
        })
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, 20);
    const lines = sorted.length
        ? sorted.map((u, idx) => {
            const name = truncateWidth((u.name || 'Unknown').split('-')[0].trim(), 18);
            const stats = `${u.totalNormal || 0}/${u.totalLate || 0}/${u.totalAbsent || 0}/${u.totalEarly || 0}/${u.totalOT || 0}/${u.offCount || 0}`;
            return `${String(idx + 1).padStart(2, '0')}. ${padWidth(name, 20)} ${String(u.points || 0).padStart(5)} pts  [${stats}]`;
        }).join('\n')
        : 'No day/night worker attendance data.';

    const titleByScope = {
        all: 'Combined Day/Night Worker Ranking',
        day: 'Day Shift Worker Ranking',
        night: 'Night Shift Worker Ranking'
    };

    return new EmbedBuilder()
        .setTitle(titleByScope[scope])
        .setDescription(`\`\`\`\n${lines}\n\`\`\``)
        .setColor('#F1C40F')
        .setFooter({ text: 'Only members with DAY or NIGHT shift roles are included.' })
        .setTimestamp();
}

async function buildInactiveCandidatesEmbed(guild, days = CONFIG.INACTIVE_CANDIDATE_DAYS) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const thresholdDays = Math.max(1, Math.min(30, Number(days) || CONFIG.INACTIVE_CANDIDATE_DAYS));
    const cutoff = now.clone().subtract(thresholdDays, 'days');
    await refreshGuildMembers(guild, { force: false, minIntervalMs: 5 * 60 * 1000 });

    const candidates = guild.members.cache
        .filter(member => {
            if (!member || member.user?.bot) return false;
            if (isOwnerId(member.id)) return false;
            if (member.permissions?.has(PermissionFlagsBits.Administrator)) return false;
            const u = attendanceData[member.id];
            if (u?.checkedIn || u?.disconnected || u?.dayOff || overtimeUsers.some(ot => ot.id === member.id)) return false;
            const lastAt = u?.lastActivityAt || (member.joinedTimestamp ? moment(member.joinedTimestamp).tz(CONFIG.TIMEZONE).toISOString() : null);
            return Boolean(lastAt && moment(lastAt).tz(CONFIG.TIMEZONE).isBefore(cutoff));
        })
        .map(member => {
            const u = attendanceData[member.id] || {};
            const lastAt = u.lastActivityAt || moment(member.joinedTimestamp).tz(CONFIG.TIMEZONE).toISOString();
            const source = u.lastActivitySource || 'joined';
            return {
                id: member.id,
                name: member.displayName || member.user?.username || 'Unknown',
                source,
                lastAt: moment(lastAt).tz(CONFIG.TIMEZONE),
                days: now.diff(moment(lastAt).tz(CONFIG.TIMEZONE), 'days')
            };
        })
        .sort((a, b) => a.lastAt.valueOf() - b.lastAt.valueOf());

    const rows = candidates.length
        ? candidates.slice(0, 30).map(c => {
            const name = padWidth(truncateWidth(c.name, 18), 19);
            return `${name} | ${String(c.days).padStart(2)}d | ${c.lastAt.format('MM/DD HH:mm')} | ${c.source}`;
        })
        : ['No inactive kick candidates.'];

    const embed = new EmbedBuilder()
        .setTitle('Inactive Kick Candidate Report')
        .setColor(candidates.length ? '#E67E22' : '#2ECC71')
        .setDescription(`기준: 마지막 관찰 활동 ${thresholdDays}일 이상 없음\n주의: 아직 자동 추방하지 않고 후보만 표시합니다.`)
        .setFooter({ text: 'Activity sources: message | voice_state | command | button | joined' })
        .setTimestamp();

    let chunk = [];
    let chunkLength = 8;
    let page = 1;
    for (const row of rows) {
        const nextLength = chunkLength + row.length + 1;
        if (chunk.length && nextLength > 950) {
            embed.addFields({ name: `Candidates (${candidates.length}) #${page}`, value: `\`\`\`\n${chunk.join('\n')}\n\`\`\``, inline: false });
            chunk = [];
            chunkLength = 8;
            page++;
        }
        chunk.push(row);
        chunkLength += row.length + 1;
    }
    if (chunk.length) {
        embed.addFields({ name: `Candidates (${candidates.length}) #${page}`, value: `\`\`\`\n${chunk.join('\n')}\n\`\`\``, inline: false });
    }
    return embed;
}

async function syncWorkingRoles({ dryRun = false } = {}) {
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild || !CONFIG.ROLES.WORKING) return { added: 0, removed: 0, skipped: true, notes: ['WORKING role or guild unavailable.'] };
    await refreshGuildMembers(guild);
    const notes = [];
    let added = 0;
    let removed = 0;

    for (const member of guild.members.cache.values()) {
        if (member.user.bot) continue;
        const user = attendanceData[member.id];
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

    for (const id of Object.keys(attendanceData)) {
        const member = guild.members.cache.get(id);
        if (member && isAssignedWorker(member)) continue;

        const u = attendanceData[id];
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

        const beforeOt = overtimeUsers.length;
        overtimeUsers = overtimeUsers.filter(o => o.id !== id);
        if (overtimeUsers.length !== beforeOt) changed = true;

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

function buildDataAuditEmbed() {
    const issues = [];
    for (const user of Object.values(attendanceData)) {
        if (user.checkedIn && user.dayOff) issues.push(`${user.name}: checkedIn=true + dayOff=true`);
        if (user.checkedIn && user.isFinished) issues.push(`${user.name}: checkedIn=true + isFinished=true`);
        if (user.disconnected && !user.checkedIn) issues.push(`${user.name}: disconnected=true but checkedIn=false`);
        if (!user.shift && (user.checkedIn || user.dayOff || user.disconnected)) issues.push(`${user.name}: active state without shift`);
        if ((user.offCount || 0) < 0) issues.push(`${user.name}: offCount is negative`);
        if ((user.points || 0) !== Number(user.points || 0)) issues.push(`${user.name}: points is invalid`);
    }

    const duplicateDayOffs = new Map();
    for (const r of Object.values(dayOffReservations)) {
        if (!r || !['pending', 'approved'].includes(r.status)) continue;
        const key = `${r.userId}:${r.leaveDate}:${r.shift}`;
        duplicateDayOffs.set(key, (duplicateDayOffs.get(key) || 0) + 1);
    }
    for (const [key, count] of duplicateDayOffs.entries()) {
        if (count > 1) issues.push(`duplicate day off reservation: ${key} (${count})`);
    }

    const text = issues.length ? issues.slice(0, 30).join('\n') : 'No data issues found.';
    return new EmbedBuilder()
        .setTitle('Data Audit')
        .setColor(issues.length ? '#E67E22' : '#2ECC71')
        .setDescription(`Issues: ${issues.length}`)
        .addFields({ name: 'Details', value: `\`\`\`\n${text}\n\`\`\``, inline: false })
        .setTimestamp();
}

function deriveAttendanceStatusForAudit(user) {
    return dashboardStateUtils.deriveAttendanceStatusForAudit(user);
}

function deriveVoiceStatusForAudit(member, user, now = moment().tz(CONFIG.TIMEZONE)) {
    return dashboardStateUtils.deriveVoiceStatusForAudit(member, user, now);
}

async function buildStatusAuditEmbed(guild) {
    await refreshGuildMembers(guild);
    const now = moment().tz(CONFIG.TIMEZONE);
    const rows = [];
    let checked = 0;

    for (const user of Object.values(attendanceData)) {
        const member = guild?.members?.cache?.get(user.id);
        if (!member || member.user?.bot) continue;
        if (!isAssignedWorker(member) && !hasManagedAttendanceRole(member)) continue;
        checked++;

        const expectedAttendance = deriveAttendanceStatusForAudit(user);
        const expectedVoice = deriveVoiceStatusForAudit(member, user, now);
        const recordedAttendance = user.attendanceStatus || 'MISSING';
        const recordedVoice = user.voiceStatus || 'MISSING';
        if (expectedAttendance === recordedAttendance && expectedVoice === recordedVoice) continue;

        rows.push([
            truncateWidth(getDashboardName(user), 14).padEnd(14),
            `A ${recordedAttendance}->${expectedAttendance}`,
            `V ${recordedVoice}->${expectedVoice}`
        ].join(' | '));
    }

    const text = rows.length ? rows.slice(0, 30).join('\n') : 'No status mismatches found.';
    return new EmbedBuilder()
        .setTitle('Recorded Status Audit')
        .setColor(rows.length ? '#E67E22' : '#2ECC71')
        .setDescription(`Checked: ${checked}\nMismatches: ${rows.length}`)
        .addFields({
            name: 'Details',
            value: `\`\`\`\n${text}\n\`\`\``,
            inline: false
        })
        .setFooter({ text: 'Recorded -> Expected. This command does not change data.' })
        .setTimestamp();
}

function buildTimeAuditEmbed() {
    const cases = [
        { label: 'Tue Day', shift: 'day', at: '2026-05-19 12:00', start: '2026-05-19 09:00', end: '2026-05-19 19:00' },
        { label: 'Tue Night', shift: 'night', at: '2026-05-19 20:00', start: '2026-05-19 19:00', end: '2026-05-20 04:00' },
        { label: 'Wed Night Carry', shift: 'night', at: '2026-05-20 03:30', start: '2026-05-19 19:00', end: '2026-05-20 04:00' },
        { label: 'Wed Day', shift: 'day', at: '2026-05-20 09:00', start: '2026-05-20 09:00', end: '2026-05-20 21:00' },
        { label: 'Normal Night', shift: 'night', at: '2026-05-21 22:00', start: '2026-05-21 21:00', end: '2026-05-22 09:00' }
    ];

    const rows = cases.map(testCase => {
        const at = moment.tz(testCase.at, 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
        const bounds = getShiftBounds(testCase.shift, at);
        const startOk = bounds.start.format('YYYY-MM-DD HH:mm') === testCase.start;
        const endOk = bounds.end.format('YYYY-MM-DD HH:mm') === testCase.end;
        const status = startOk && endOk ? 'OK' : 'FAIL';
        return `${padWidth(testCase.label, 15)} ${status} | ${bounds.start.format('ddd HH:mm')} -> ${bounds.end.format('ddd HH:mm')}`;
    });

    const maintenanceAt = moment.tz('2026-05-20 06:00', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
    rows.push(`${padWidth('Wed Maint', 15)} ${isMaintenanceWindow(maintenanceAt) ? 'OK' : 'FAIL'} | 04:00 -> 09:00 closed`);

    const preShiftAt = moment.tz('2026-05-20 08:50', 'YYYY-MM-DD HH:mm', CONFIG.TIMEZONE);
    rows.push(`${padWidth('Day PreShift', 15)} ${isWithinPreShiftWindow('day', preShiftAt) ? 'OK' : 'FAIL'} | 08:50 accepted buffer`);

    return new EmbedBuilder()
        .setTitle('Time Logic Audit')
        .setColor(rows.some(row => row.includes('FAIL')) ? '#E67E22' : '#2ECC71')
        .setDescription(`Timezone: ${CONFIG.TIMEZONE}`)
        .addFields({
            name: 'Cases',
            value: `\`\`\`\n${rows.join('\n')}\n\`\`\``,
            inline: false
        })
        .setFooter({ text: 'This command only checks schedule calculations.' })
        .setTimestamp();
}

async function buildPermissionCheckEmbed(guild) {
    const me = guild?.members?.me || (guild ? await guild.members.fetchMe().catch(() => null) : null);
    if (guild) await refreshGuildMembers(guild, { force: false, minIntervalMs: 5 * 60 * 1000 });
    const statusChannel = await client.channels.fetch(CONFIG.STATUS_CHANNEL).catch(() => null);
    const logChannel = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    const dayOffChannel = await client.channels.fetch(CONFIG.DAYOFF_CHANNEL).catch(() => null);
    const workingRole = guild?.roles?.cache?.get(CONFIG.ROLES.WORKING);
    const botHighest = me?.roles?.highest;
    const canManageWorking = Boolean(workingRole && botHighest && botHighest.comparePositionTo(workingRole) > 0);
    const dayOffPerms = dayOffChannel && me ? dayOffChannel.permissionsFor(me) : null;
    const guildManageRoles = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageRoles));
    const guildManageNicknames = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageNicknames));
    const guildManageMessages = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageMessages));
    const guildAddReactions = Boolean(me?.permissions?.has(PermissionFlagsBits.AddReactions));
    const dayOffManageMessages = Boolean(dayOffPerms?.has(PermissionFlagsBits.ManageMessages));
    const dayOffAddReactions = Boolean(dayOffPerms?.has(PermissionFlagsBits.AddReactions));
    const managedRoleIds = [
        CONFIG.ROLES.DAY,
        CONFIG.ROLES.NIGHT,
        CONFIG.ROLES.HEINE,
        CONFIG.ROLES.PAAGRIO,
        CONFIG.ROLES.WORKING,
        CONFIG.ROLES.GUEST
    ].filter(Boolean);
    const roleRows = managedRoleIds.map(roleId => {
        const role = guild?.roles?.cache?.get(roleId);
        const manageable = Boolean(role && botHighest && botHighest.comparePositionTo(role) > 0);
        return `${padWidth(truncateWidth(role?.name || roleId, 18), 19)} ${manageable ? 'OK' : 'NO'}`;
    });
    const nicknameRiskMembers = guild?.members?.cache
        ?.filter(member => {
            if (!member || member.user?.bot) return false;
            if (member.id === me?.id) return false;
            if (member.id === guild.ownerId) return true;
            return Boolean(botHighest && member.roles?.highest && botHighest.comparePositionTo(member.roles.highest) <= 0);
        })
        .map(member => {
            const reason = member.id === guild.ownerId ? 'owner' : 'role';
            return `${padWidth(truncateWidth(member.displayName || member.user?.username || member.id, 18), 19)} ${reason}`;
        })
        .slice(0, 15) || [];
    const healthy = guildManageRoles && guildManageNicknames && canManageWorking && dayOffManageMessages && dayOffAddReactions && nicknameRiskMembers.length === 0;
    const rows = [
        `Bot member: ${me ? 'OK' : 'MISSING'}`,
        `Status channel: ${statusChannel ? 'OK' : 'MISSING'}`,
        `Log channel: ${logChannel ? 'OK' : 'MISSING'}`,
        `Day Off channel: ${dayOffChannel ? 'OK' : 'MISSING'}`,
        `WORKING role: ${workingRole ? 'OK' : 'MISSING'}`,
        `Guild Manage Roles: ${guildManageRoles ? 'OK' : 'NO'}`,
        `Guild Manage Nicknames: ${guildManageNicknames ? 'OK' : 'NO'}`,
        `Can manage WORKING: ${canManageWorking ? 'OK' : 'NO'}`,
        `Guild Manage Messages: ${guildManageMessages ? 'OK' : 'NO'}`,
        `Guild Add Reactions: ${guildAddReactions ? 'OK' : 'NO'}`,
        `Day Off Manage Messages: ${dayOffManageMessages ? 'OK' : 'NO'}`,
        `Day Off Add Reactions: ${dayOffAddReactions ? 'OK' : 'NO'}`
    ];
    const notes = [
        '닉네임 변경은 서버장 또는 봇보다 높은 역할 대상에게는 불가능합니다.',
        '해결: Discord 역할 설정에서 봇 역할을 관리 대상 역할보다 위로 올려주세요.'
    ];
    const embed = new EmbedBuilder()
        .setTitle('Permission Check')
        .setColor(healthy ? '#2ECC71' : '#E67E22')
        .setDescription(`\`\`\`\n${rows.join('\n')}\n\`\`\``)
        .setTimestamp();
    embed.addFields(
        { name: 'Managed Role Hierarchy', value: `\`\`\`\n${roleRows.join('\n') || 'No managed roles configured.'}\n\`\`\``, inline: false },
        { name: `Nickname Update Risks (${nicknameRiskMembers.length})`, value: `\`\`\`\n${nicknameRiskMembers.join('\n') || 'NONE'}\n\`\`\``, inline: false },
        { name: 'Notes', value: notes.join('\n'), inline: false }
    );
    return embed;
}

async function buildDayOffLogEmbed(limit = 10) {
    const rows = await readDayOffLog(limit);
    const text = rows.length ? rows.join('\n') : 'No day off audit log found.';
    return new EmbedBuilder()
        .setTitle('Day Off Audit Log')
        .setColor('#3B82F6')
        .setDescription(`\`\`\`json\n${truncateWidth(text, 3800)}\n\`\`\``)
        .setTimestamp();
}

async function performSmartReset(targetShift) {
    const now = moment().tz(CONFIG.TIMEZONE);
    for (const id in attendanceData) {
        const u = attendanceData[id];
        if (u.shift === targetShift) {
            u.strikeReceivedThisShift = false;
            u.isFinished = false;
            if (u.checkedIn && u.checkInRaw) {
                const hrs = now.diff(moment(u.checkInRaw), 'hours');
                const limit = overtimeUsers.some(ot => ot.id === id) ? CONFIG.PURGE_MANUAL_OT : CONFIG.PURGE_NORMAL;
                if (hrs >= limit) {
                    u.checkedIn = false;
                    overtimeUsers = overtimeUsers.filter(ot => ot.id !== id);
                    await recordLog(u, 'out', '자동 퇴근');
                } else {
                    continue;
                }
            }
            u.dayOff = false;
            u.dayOffExpireAt = null;
            u.status = null;
            transitionRecordedStatus(u, {
                attendanceStatus: 'PRE_SHIFT',
                voiceStatus: 'OFFLINE'
            }, now, 'smart-reset', `reset-${targetShift}`);
        }
    }
    await saveSystemAsync();
    await renderDashboardCore();
}

async function checkGracePeriods() {
    const now = moment().tz(CONFIG.TIMEZONE);
    let changed = false;
    for (const id in attendanceData) {
        const u = attendanceData[id];
        if (!u.checkedIn && u.preShiftLiveAt && u.shift) {
            const member = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(id);
            if (member?.voice?.streaming) {
                if (await handleClockIn(member, u, u.shift, now, true)) changed = true;
            }
        }
        if (
            u.checkedIn &&
            !u.disconnected &&
            !u.dayOff &&
            (u.pendingClockOut?.source === 'live_off' || u.liveOffStartedAt) &&
            now.isSameOrAfter(moment(u.pendingClockOut?.expiresAt || moment(u.liveOffStartedAt).tz(CONFIG.TIMEZONE).add(CONFIG.LIVE_OFF_CLOCK_OUT_MINS, 'minutes'))) &&
            !getActiveLiveException(id, now)
        ) {
            const m = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(id);
            const effectiveOut = moment(u.pendingClockOut?.at || u.liveOffStartedAt).tz(CONFIG.TIMEZONE);
            const liveOffTimeoutText = `라이브 OFF 유예 초과 자동 퇴근 (인정 퇴근 ${effectiveOut.format('hh:mm A')} / 처리 ${now.format('hh:mm A')})`;
            if (m) {
                await handleClockOut(m, u, now, liveOffTimeoutText, effectiveOut,
                    { effectiveTime: effectiveOut, detectedAt: now, forceIcon: '🔴', clockOutSource: 'live-off-timeout' }
                );
            } else {
                console.warn(`[GRACE WARN] live-off timeout: member ${id} not in cache, applying state only.`);
                u.checkedIn = false;
                u.disconnected = false;
                u.pendingClockOut = null;
                u.liveOffStartedAt = null;
                u.isFinished = true;
                await recordLog(u, 'out', liveOffTimeoutText, effectiveOut, { effectiveTime: effectiveOut, forceIcon: '🔴' });
            }
            if (m?.send) {
                if (!Array.isArray(u.liveOffWarningMarks)) u.liveOffWarningMarks = [];
                if (!u.liveOffWarningMarks.includes(CONFIG.LIVE_OFF_CLOCK_OUT_MINS)) {
                    u.liveOffWarningMarks.push(CONFIG.LIVE_OFF_CLOCK_OUT_MINS);
                }
                await m.send([
                    '🌿 Quick update',
                    'Reminder 3/3',
                    '',
                    `Your live stream has been OFF for about ${CONFIG.LIVE_OFF_CLOCK_OUT_MINS} minutes.`,
                    'The bot has clocked you out automatically because your work time could not be verified.',
                    '',
                    'To start working again, please turn your live stream ON and press the CLOCK IN button.'
                ].join('\n')).catch(() => null);
            }
            changed = true;
            continue;
        }
        if (
            u.disconnected &&
            (u.pendingClockOut?.source === 'voice_leave' || u.disconnectedAt) &&
            now.isSameOrAfter(moment(u.pendingClockOut?.expiresAt || moment(u.disconnectedAt).tz(CONFIG.TIMEZONE).add(CONFIG.GRACE_PERIOD_MINS, 'minutes')))
        ) {
            const m = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(id);
            const effectiveDcOut = moment(u.pendingClockOut?.at || u.disconnectedAt).tz(CONFIG.TIMEZONE);
            const scheduledEnd = getScheduledEndMoment(u, effectiveDcOut);
            const earlyMins = scheduledEnd ? scheduledEnd.diff(effectiveDcOut, 'minutes') : 0;
            const customMsg = earlyMins > CONFIG.CLOCK_OUT_GRACE_MINS ? 'DC 유예 시간 초과 (조기 퇴근)' : 'DC 유예 시간 초과 (정상 퇴근)';
            if (m) {
                await handleClockOut(m, u, now, customMsg, effectiveDcOut, {
                    effectiveTime: effectiveDcOut,
                    detectedAt: now,
                    forceIcon: '🔴',
                    clockOutSource: 'dc-timeout'
                });
            } else {
                console.warn(`[GRACE WARN] dc-timeout: member ${id} not in cache, applying state only.`);
                u.checkedIn = false;
                u.disconnected = false;
                u.pendingClockOut = null;
                u.disconnectedAt = null;
                u.isFinished = true;
                await recordLog(u, 'out', customMsg, effectiveDcOut, { effectiveTime: effectiveDcOut, forceIcon: '🔴' });
            }
            if (m?.send) {
                await m.send([
                    '🌿 Quick update',
                    '',
                    `You were disconnected for about ${CONFIG.GRACE_PERIOD_MINS} minutes, so the bot has clocked you out automatically.`,
                    '',
                    'If you are still in your current scheduled shift, please follow these steps:',
                    '1. Join the voice channel again.',
                    '2. Turn your live stream ON.',
                    '3. The bot can resume your shift automatically.',
                    '',
                    `Outside the current shift, automatic resume is limited to ${CONFIG.AUTO_TIMEOUT_RESUME_WINDOW_MINS} minutes; after that, you must press CLOCK IN again.`,
                    'No extra DC reminders will be sent for this clock-out. 🙂'
                ].join('\n')).catch(() => null);
            }
            changed = true;
        }
    }
    if (changed) {
        await saveSystemAsync();
        await renderDashboardCore({ forceMemberRefresh: true });
    }
}

async function autoOvertimeCheck() {
    const now = moment().tz(CONFIG.TIMEZONE);
    if (isMaintenanceWindow(now)) return;
    let changed = false;
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);

    const preOtBefore = overtimeUsers.length;
    const preOtToRemove = [];
    for (const ot of overtimeUsers) {
        if (ot.type !== 'PRE_OT') continue;
        const u = attendanceData[ot.id];
        const member = guild?.members.cache.get(ot.id);
        if (!u || !member || u.dayOff || u.isFinished) {
            preOtToRemove.push(ot.id);
            continue;
        }
        const bounds = getShiftBounds(u.shift, now);
        if (!bounds?.start || now.isBefore(bounds.start)) continue;

        transitionRecordedStatus(u, {
            attendanceStatus: 'WORKING',
            voiceStatus: member.voice?.streaming || guild?.voiceStates.cache.get(ot.id)?.streaming
                ? 'LIVE_ON'
                : (member.voice?.channelId || guild?.voiceStates.cache.get(ot.id)?.channelId ? 'LIVE_OFF' : 'OFFLINE')
        }, bounds.start, 'auto-overtime-check', 'pre-shift-ot-ended-regular-shift-started');
        u.pendingManualOT = false;
        u.isFinished = false;
        u.checkedIn = true;
        await recordLog(u, 'in', '정시 근무 시작 (사전 OT 종료)', null, { effectiveTime: bounds.start });
        preOtToRemove.push(ot.id);
        changed = true;
    }
    if (preOtToRemove.length > 0) {
        overtimeUsers = overtimeUsers.filter(ot => !preOtToRemove.includes(ot.id));
    }
    if (overtimeUsers.length !== preOtBefore) changed = true;

    for (const id in attendanceData) {
        if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) continue;
        const u = attendanceData[id];
        if ((!u.checkedIn && !u.pendingManualOT) || u.dayOff || overtimeUsers.some(ot => ot.id === id)) continue;
        if (!['day', 'night'].includes(u.shift)) continue;

        const member = guild?.members.cache.get(id);
        if (isCurrentShiftRegularWorker(member, now)) {
            if (u.checkedIn && u.attendanceStatus === 'OVERTIME') {
                transitionRecordedStatus(u, {
                    attendanceStatus: 'WORKING',
                    voiceStatus: member?.voice?.streaming || guild?.voiceStates.cache.get(id)?.streaming ? 'LIVE_ON' : (member?.voice?.channelId || guild?.voiceStates.cache.get(id)?.channelId ? 'LIVE_OFF' : 'OFFLINE')
                }, now, 'auto-overtime-check', 'current-shift-regular-worker');
                changed = true;
            }
            continue;
        }

        const targetEnd = getOvertimeStartMoment(u, now);
        if (!targetEnd) continue;

        if (u.pendingManualOT && now.isSameOrAfter(targetEnd)) {
            const voiceState = guild?.voiceStates.cache.get(id);
            const isStreamingNow = Boolean(member?.voice?.streaming || voiceState?.streaming);
            if (isStreamingNow && addOvertimeUser(u, 'MANUAL', targetEnd)) {
                transitionRecordedStatus(u, {
                    attendanceStatus: 'OVERTIME',
                    voiceStatus: 'LIVE_ON'
                }, targetEnd, 'auto-overtime-check', 'reserved-manual-ot-started');
                u.pendingManualOT = false;
                u.totalOT = (u.totalOT || 0) + 1;
                u.points = (u.points || 0) + CONFIG.POINTS.OT;
                await recordLog(u, 'ot', '예약된 수동 연장 근무 시작');
                changed = true;
            }
            continue;
        }

        if (now.isSameOrAfter(targetEnd.clone().add(CONFIG.AUTO_OT_AFTER_MINS, 'minutes'))) {
            const voiceState = guild?.voiceStates.cache.get(id);
            const isStreamingNow = Boolean(member?.voice?.streaming || voiceState?.streaming);
            const hasLiveException = Boolean(getActiveLiveException(id, now));
            if ((isStreamingNow || hasLiveException) && addOvertimeUser(u, 'AUTO', targetEnd)) {
                transitionRecordedStatus(u, {
                    attendanceStatus: 'OVERTIME',
                    voiceStatus: isStreamingNow ? 'LIVE_ON' : 'EXCEPTION'
                }, targetEnd, 'auto-overtime-check', 'auto-ot-started');
                u.totalOT = (u.totalOT || 0) + 1;
                u.points = (u.points || 0) + CONFIG.POINTS.OT;
                await recordLog(u, 'ot', `자동 OT 감지 (정시 이후 ${formatDuration(now.diff(targetEnd, 'minutes'))} 라이브 유지)`);
                changed = true;
            }
        }
    }
    if (changed) {
        await saveSystemAsync();
        await renderDashboardCore({ forceMemberRefresh: true });
    }
}

async function grantLiveException(targetMember, hours = null, reason, approverMember) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const shift = determineShift(targetMember);
    if (!shift) return { ok: false, message: '대상에게 DAY/NIGHT 역할이 없습니다.' };

    const u = ensureUserData(targetMember, shift);
    if (!u) return { ok: false, message: '대상 데이터를 생성할 수 없습니다.' };

    const shouldStartNewSession = Boolean(u.isFinished || !u.checkedIn || !getOpenSession(u));
    const shiftEnd = getShiftBounds(shift, now).end;
    const expiresAt = hours ? now.clone().add(hours, 'hours') : shiftEnd.clone();
    if (!expiresAt || expiresAt.isSameOrBefore(now)) {
        return { ok: false, message: '현재 근무 종료 시간을 계산할 수 없습니다. 시간을 직접 입력해주세요.' };
    }
    const approvedMinutes = Math.max(1, expiresAt.diff(now, 'minutes'));
    liveExceptions[targetMember.id] = {
        userId: targetMember.id,
        name: targetMember.displayName,
        shift,
        hours: hours || null,
        approvedMinutes,
        mode: hours ? 'manual-hours' : 'shift-end',
        reason,
        approvedBy: approverMember.id,
        approvedByName: approverMember.displayName || approverMember.user?.username || 'Unknown',
        approvedAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        status: 'active'
    };

    overtimeUsers = overtimeUsers.filter(o => o.id !== targetMember.id);
    u.checkedIn = true;
    u.dayOff = false;
    u.disconnected = false;
    u.disconnectedAt = null;
    u.isFinished = false;
    u.shift = shift;
    u.status = 'exception';
    transitionRecordedStatus(u, {
        attendanceStatus: 'WORKING',
        voiceStatus: 'EXCEPTION'
    }, now, 'live-exception-command', 'admin-approved-live-exception');
    if (shouldStartNewSession) {
        u.checkInTime = now.format('hh:mm A');
        u.checkInRaw = now.toISOString();
        u.checkOutTime = null;
        u.checkOutRaw = null;
        u.lastClockOutSource = null;
        u.finishedPresence = null;
        u.finalLeftAt = null;
        u.finishedLiveOffReminderMarks = [];
        startAttendanceSession(u, shift, now, 'live-exception-command');
    } else {
        u.checkInTime = u.checkInTime || now.format('hh:mm A');
        u.checkInRaw = u.checkInRaw || now.toISOString();
    }
    u.voiceJoinedAt = null;
    u.liveOffStartedAt = null;
    u.lastLiveOnAt = now.toISOString();
    u.liveOffWarnedFor = null;
    await updateWorkingRole(targetMember, true);
    await saveSystemAsync();

    const logText = [
        `\`[${now.format('MM/DD HH:mm')}]\` 👑 관리자 라이브 예외 승인`,
        `👥 대상: **${targetMember.displayName}**`,
        `⏰ 인정 범위: ${hours ? `${hours}시간` : '현재 근무 종료 시간까지'}`,
        `⏳ 만료 시간: ${formatKoreanDateTime(expiresAt)}`,
        `📝 사유: ${reason}`,
        `👑 승인자: ${liveExceptions[targetMember.id].approvedByName}`
    ].join('\n');
    const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) await logChan.send(logText).catch(() => null);

    return { ok: true, expiresAt };
}

async function checkLiveExceptions() {
    const now = moment().tz(CONFIG.TIMEZONE);
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    let changed = false;

    for (const [userId, exception] of Object.entries(liveExceptions)) {
        if (!exception || exception.status !== 'active') continue;

        const member = guild?.members.cache.get(userId) || null;
        const u = attendanceData[userId];
        const exceptionExpiresAt = moment(exception.expiresAt).tz(CONFIG.TIMEZONE);
        const approvedAt = exception.approvedAt ? moment(exception.approvedAt).tz(CONFIG.TIMEZONE) : null;
        const rawScheduledEnd = u
            ? (getScheduledEndMoment(u, now) || (exception.shift ? getShiftBounds(exception.shift, now).end : null))
            : (exception.shift ? getShiftBounds(exception.shift, now).end : null);
        const fallbackShiftEnd = exception.shift ? getShiftBounds(exception.shift, now).end : null;
        const scheduledEnd = rawScheduledEnd && approvedAt && rawScheduledEnd.isSameOrBefore(approvedAt)
            ? fallbackShiftEnd
            : rawScheduledEnd;
        const effectiveEnd = scheduledEnd && scheduledEnd.isBefore(exceptionExpiresAt)
            ? scheduledEnd
            : exceptionExpiresAt;
        if (now.isBefore(effectiveEnd)) continue;

        exception.status = 'expired';
        exception.expiredAt = now.toISOString();
        exception.expireReason = scheduledEnd && scheduledEnd.isSameOrBefore(exceptionExpiresAt) && now.isSameOrAfter(scheduledEnd)
            ? 'scheduled-shift-end'
            : 'exception-time-ended';

        if (u?.status === 'exception') {
            if (member && (u.checkedIn || u.disconnected)) {
                const outText = exception.expireReason === 'scheduled-shift-end'
                    ? '예정 퇴근 시간 도달 - 라이브 예외 자동 퇴근'
                    : '라이브 예외 시간 만료 - 자동 퇴근';
                await handleClockOut(member, u, now, outText, now, {
                    skipEarlyPenalty: true,
                    clockOutSource: 'live-exception-expired'
                });
            } else {
                u.checkedIn = false;
                u.disconnected = false;
                u.disconnectedAt = null;
                u.isFinished = true;
                u.status = null;
                u.checkOutTime = now.format('hh:mm A');
                u.checkOutRaw = now.toISOString();
                transitionRecordedStatus(u, {
                    attendanceStatus: 'FINISHED',
                    voiceStatus: 'OFFLINE'
                }, now, 'live-exception-expired', 'live-exception-expired-auto-finish');
                if (member) await updateWorkingRole(member, false);
            }
        }

        const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
        if (logChan) {
            await logChan.send([
                `\`[${now.format('MM/DD HH:mm')}]\` ⏰ 라이브 예외 만료`,
                `👥 대상: **${exception.name || userId}**`,
                `⏳ 처리 기준: ${exception.expireReason === 'scheduled-shift-end' ? '예정 퇴근 시간' : '예외 만료 시간'}`,
                `⏰ 예정 퇴근: ${scheduledEnd ? formatKoreanDateTime(scheduledEnd) : '계산 불가'}`,
                `⏳ 예외 만료: ${formatKoreanDateTime(exception.expiresAt)}`,
                '라이브 방송이 없으면 이제 출근 인정되지 않습니다.'
            ].join('\n')).catch(() => null);
        }
        changed = true;
    }

    if (changed) {
        await saveSystemAsync();
        await renderDashboardCore({ forceMemberRefresh: true });
    }
}

async function checkScheduledAnnouncements() {
    try {
        const now = moment().tz(CONFIG.TIMEZONE);
        const currentTime = now.format('HH:mm');
        const today = now.format('YYYY-MM-DD');
        for (let i = 1; i <= 6; i++) {
            const d = announceData[i];
            if (d && d.active && d.time === currentTime && d.lastSentDate !== today) {
                const chan = await client.channels.fetch(CONFIG.ANNOUNCE_CHANNEL).catch(() => null);
                if (chan) {
                    const embed = new EmbedBuilder()
                        .setTitle(`📢 SYSTEM BROADCAST [Slot ${i}]`)
                        .setDescription(d.content)
                        .setColor('#5865F2')
                        .setTimestamp();
                    const roleIds = Array.isArray(d.roleIds)
                        ? d.roleIds.filter(Boolean)
                        : (d.roleId ? [d.roleId] : []);
                    const mentionText = roleIds.length
                        ? roleIds.map(roleId => `<@&${roleId}>`).join(' ')
                        : '@everyone';
                    await chan.send({ content: mentionText, embeds: [embed] })
                        .catch(e => console.error('[ANNOUNCE SEND ERROR]', e));
                    d.lastSentDate = today;
                    await saveSystemAsync();
                }
            }
        }
    } catch (e) {
        console.error('[ANNOUNCE ERROR]', e);
    }
}

/**
 * [ DAY OFF WATCHER ]
 */
const DAYOFF_STATUS_EMOJIS = ['❌', '✅', '⏳', '🔁'];
const DAYOFF_APPROVAL_EMOJI = '✅';
const dayOffReactionCleanupLocks = new Set();

async function sendTemporaryDayOffReply(message, content) {
    const reply = await message.reply({ content, allowedMentions: { users: [message.author.id], roles: [], repliedUser: true } })
        .catch(e => {
            console.error('[DAYOFF REPLY ERROR]', e);
            return null;
        });
    if (reply) setTimeout(() => reply.delete().catch(() => {}), 5000);
}

async function setDayOffStatusEmoji(message, emoji) {
    await message.fetch().catch(() => null);
    dayOffReactionCleanupLocks.add(message.id);
    for (const statusEmoji of dayOffService.DAYOFF_STATUS_EMOJIS) {
        const reaction = message.reactions.cache.find(r => r.emoji.name === statusEmoji);
        if (reaction) {
            await reaction.remove().catch(async () => {
                await reaction.users.remove(client.user.id).catch(() => {});
            });
        }
    }
    if (emoji) await message.react(emoji).catch(e => console.error('[DAYOFF REACT ERROR]', e));
    setTimeout(() => dayOffReactionCleanupLocks.delete(message.id), 5000);
}

async function writeDayOffLog(text) {
    const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) await logChan.send(text).catch(e => console.error('[DAYOFF LOG ERROR]', e));
}

async function writeAdminActionLog(action, actorMember, targetMember = null, details = []) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const actorName = actorMember?.displayName || actorMember?.user?.username || actorMember?.id || 'Unknown';
    const targetName = targetMember?.displayName || targetMember?.user?.username || targetMember?.id || 'N/A';
    const lines = [
        `\`[${now.format('MM/DD HH:mm')}]\` 🛡️ ADMIN ACTION: **${action}**`,
        `👑 Actor: **${actorName}** (${actorMember?.id || 'unknown'})`,
        `👤 Target: **${targetName}**${targetMember?.id ? ` (${targetMember.id})` : ''}`,
        ...details.filter(Boolean).map(line => `📌 ${line}`)
    ];
    await writeDayOffLog(lines.join('\n'));
}

async function appendDayOffAudit(event, payload = {}) {
    try {
        await fs.mkdir('./logs', { recursive: true });
        const record = {
            time: moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
            event,
            ...payload
        };
        await fs.appendFile(CONFIG.FILES.DAYOFF_LOG, `${JSON.stringify(record)}\n`);
    } catch (e) {
        console.error('[DAYOFF AUDIT LOG ERROR]', e);
    }
}

async function readDayOffLog(limit = 10) {
    try {
        const raw = await fs.readFile(CONFIG.FILES.DAYOFF_LOG, 'utf8');
        return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit);
    } catch {
        return [];
    }
}

async function notifyDayOffReviewer(reservation) {
    const notifyKey = `${reservation.messageId}:${reservation.leaveDate}:${reservation.shift}:pending`;
    if (reservation.reviewerNotifyKey === notifyKey) return 'already-sent';

    const leaveText = moment.tz(reservation.leaveDate, 'YYYY-MM-DD', CONFIG.TIMEZONE).format('YYYY-MM-DD');
    const text = [
        '📋 휴무 신청 검토 필요',
        `이름: ${reservation.name}`,
        reservation.nameMismatch ? `작성 이름: ${reservation.submittedName}` : null,
        reservation.nameMismatch ? '⚠️ 작성 이름과 Discord 닉네임이 다릅니다. 공식 대상은 Discord 작성자 기준으로 처리됩니다.' : null,
        `근무조: ${reservation.shiftLabel}`,
        `휴무일: ${leaveText}`,
        '',
        `${reservation.name} 님이 ${leaveText} 자로 휴무를 신청했습니다.`,
        '승인하려면 이모지 반응을 남겨주세요.'
    ].filter(line => line !== null).join('\n');

    let dmStatus = '리뷰어 미설정';
    if (CONFIG.DAYOFF_REVIEWER_ID) {
        const reviewer = await client.users.fetch(CONFIG.DAYOFF_REVIEWER_ID).catch(() => null);
        if (reviewer) {
            await reviewer.send(text).then(() => {
                dmStatus = '발송 완료';
            }).catch(e => {
                console.error('[DAYOFF REVIEWER DM ERROR]', e);
                dmStatus = '발송 실패';
            });
        } else {
            dmStatus = '유저 찾을 수 없음';
        }
    }

    reservation.reviewerNotifyKey = notifyKey;
    reservation.reviewerNotifiedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    reservation.reviewerDmStatus = dmStatus;
    dayOffReservations[reservation.messageId] = reservation;
    await saveSystemAsync();
    await writeDayOffLog(`${text}\nDM 상태: ${dmStatus}`);
    await appendDayOffAudit('REQUESTED', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        reviewerId: CONFIG.DAYOFF_REVIEWER_ID,
        reviewerDmStatus: dmStatus
    });
    return dmStatus;
}

async function saveDayOffReservation(message, parsed, status, approver = null) {
    const previous = dayOffReservations[message.id] || {};
    const reservation = {
        ...previous,
        id: message.id,
        messageId: message.id,
        channelId: message.channelId,
        userId: message.author.id,
        name: parsed.displayName,
        submittedName: parsed.submittedName || null,
        nameMismatch: Boolean(parsed.nameMismatch),
        shift: parsed.shift,
        shiftLabel: parsed.shiftLabel,
        leaveDate: parsed.leaveDate,
        status,
        approvedBy: approver?.id || previous.approvedBy || null,
        approvedByName: approver?.displayName || approver?.user?.username || previous.approvedByName || null,
        updatedAt: moment().tz(CONFIG.TIMEZONE).toISOString()
    };
    dayOffReservations[message.id] = reservation;
    await saveSystemAsync();
    return reservation;
}

async function processDayOffMessage(message, { silent = false } = {}) {
    if (!dayOffService.isDayOffChannel(message) || message.author?.bot) return;
    const parsed = dayOffService.parseDayOffRequest(message);

    if (!parsed.ok) {
        delete dayOffReservations[message.id];
        await setDayOffStatusEmoji(message, parsed.emoji);
        await saveSystemAsync();

        // ✨ [업데이트] 이름 누락 경고 
        if (parsed.code === 'missing-name') {
            if (!silent) await sendTemporaryDayOffReply(message, `${message.author} Username cannot be blank. Please explicitly provide your name in the request format.`);
            await writeDayOffLog(`❌ 휴무 신청 실패\n👥 대상: ${parsed.displayName}\n📝 사유: 이름이 공란입니다.`);
            await appendDayOffAudit('FAILED', {
                messageId: message.id,
                userId: message.author.id,
                name: parsed.displayName,
                reason: 'missing-name'
            });
        } else if (parsed.code === 'invalid-month') {
            if (!silent) await sendTemporaryDayOffReply(message, `${message.author} The month name is invalid. Please check the English spelling. Example: May, Dec`);
            await writeDayOffLog(`❌ 휴무 신청 실패\n👥 이름: ${parsed.displayName}\n📝 사유: 월 이름이 올바르지 않습니다.\n⏰ 처리 시간: ${moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm')}`);
            await appendDayOffAudit('FAILED', {
                messageId: message.id,
                userId: message.author.id,
                name: parsed.displayName,
                reason: 'invalid-month'
            });
        } else {
            if (!silent) await sendTemporaryDayOffReply(message, `${message.author} I could not find a valid leave date. Please use this format exactly: Leave date: May 21`);
            await writeDayOffLog(`❌ 휴무 신청 실패\n👥 이름: ${parsed.displayName}\n📝 사유: 휴무 날짜 또는 근무 구분을 찾지 못했습니다.\n⏰ 처리 시간: ${moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm')}`);
            await appendDayOffAudit('FAILED', {
                messageId: message.id,
                userId: message.author.id,
                name: parsed.displayName,
                reason: parsed.code
            });
        }
        return;
    }

    const existingReservation = dayOffReservations[message.id];
    if (existingReservation?.status === 'approved' && dayOffService.hasApprovalReaction(message)) {
        await approveDayOffMessage(message, null, parsed, silent);
        return;
    }

    const reservation = await saveDayOffReservation(message, parsed, 'pending');
    await setDayOffStatusEmoji(message, '⏳');
    if (!silent) {
        const nameNotice = parsed.nameMismatch
            ? `\nNote: The name in your form (${parsed.submittedName}) is different from your Discord name. Your request will be processed under your Discord name: ${parsed.displayName}.`
            : '';
        await sendTemporaryDayOffReply(message, `${message.author} Your day-off request has been received and is waiting for manager approval.\nShift: ${parsed.shiftLabel}\nLeave Date: ${parsed.leaveDate}${nameNotice}`);
        await notifyDayOffReviewer(reservation);
    }
}

async function approveDayOffMessage(message, approverMember = null, parsed = null, silent = false) {
    if (!dayOffService.isDayOffChannel(message) || message.author?.bot) return;
    const freshParsed = parsed || dayOffService.parseDayOffRequest(message);
    if (!freshParsed.ok) {
        await processDayOffMessage(message, { silent });
        return;
    }

    const duplicate = Object.values(dayOffReservations).find(r =>
        r &&
        r.messageId !== message.id &&
        ['pending', 'approved'].includes(r.status) &&
        r.userId === message.author.id &&
        r.leaveDate === freshParsed.leaveDate &&
        r.shift === freshParsed.shift
    );
    if (duplicate) {
        await setDayOffStatusEmoji(message, '❌');
        if (!silent) {
            await sendTemporaryDayOffReply(message, `${message.author} A day-off request already exists for ${freshParsed.leaveDate}.`);
        }
        await writeDayOffLog(`❌ 휴무 신청 중복 차단\n👥 이름: ${freshParsed.displayName}\n⏰ 근무: ${freshParsed.shiftLabel}\n📅 휴무일: ${freshParsed.leaveDate}\n📝 사유: 같은 날짜와 근무조의 휴무 예약이 이미 존재합니다.`);
        await appendDayOffAudit('DUPLICATE_BLOCKED', {
            messageId: message.id,
            duplicateMessageId: duplicate.messageId,
            userId: message.author.id,
            name: freshParsed.displayName,
            shift: freshParsed.shiftLabel,
            leaveDate: freshParsed.leaveDate
        });
        return;
    }

    const reservation = await saveDayOffReservation(message, freshParsed, 'approved', approverMember);
    const dmKey = `${reservation.leaveDate}:${reservation.shift}:${reservation.userId}`;
    let dmStatus = 'DM 발송 완료';
    if (reservation.lastDmKey !== dmKey) {
        await message.author.send(dayOffService.buildDayOffDm(reservation)).catch(e => {
            console.error('[DAYOFF DM ERROR]', e);
            dmStatus = 'DM 발송 실패';
        });
        reservation.lastDmKey = dmKey;
        reservation.dmSentAt = moment().tz(CONFIG.TIMEZONE).toISOString();
        await saveSystemAsync();
    } else {
        dmStatus = 'DM 중복 발송 생략';
    }

    await setDayOffStatusEmoji(message, '✅');
    if (!silent) {
        await sendTemporaryDayOffReply(message, `${message.author} Your day off has been approved.\nShift: ${reservation.shiftLabel}\nLeave Date: ${reservation.leaveDate}`);
    }
    await writeDayOffLog(`✅ 휴무 승인 완료\n이름: ${reservation.name}\n근무조: ${reservation.shiftLabel}\n휴무일: ${reservation.leaveDate}\n승인자: ${reservation.approvedByName || '시스템'}\nDM 상태: ${dmStatus}`);
    await appendDayOffAudit('APPROVED', {
        messageId: message.id,
        userId: message.author.id,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        approvedBy: reservation.approvedBy || CONFIG.DAYOFF_REVIEWER_ID,
        approvedByName: reservation.approvedByName || null,
        dmStatus
    });
}

async function cancelDayOffApproval(message, cancelledBy = null) {
    if (!dayOffService.isDayOffChannel(message) || message.author?.bot) return;
    const reservation = dayOffReservations[message.id];
    if (!reservation || reservation.status !== 'approved') {
        await processDayOffMessage(message, { silent: true });
        return;
    }

    reservation.status = 'pending';
    reservation.cancelledBy = cancelledBy?.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.cancelledByName = cancelledBy?.displayName || cancelledBy?.user?.username || null;
    reservation.cancelledAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    delete reservation.appliedDate;
    delete reservation.appliedAt;
    dayOffReservations[message.id] = reservation;

    await saveSystemAsync();
    await setDayOffStatusEmoji(message, '⏳');
    await writeDayOffLog(`❌ 휴무 승인 취소\n이름: ${reservation.name}\n근무조: ${reservation.shiftLabel}\n휴무일: ${reservation.leaveDate}\n취소자: ${reservation.cancelledByName || reservation.cancelledBy || '알 수 없음'}`);
    await appendDayOffAudit('CANCELLED', {
        messageId: message.id,
        userId: message.author.id,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        cancelledBy: reservation.cancelledBy,
        cancelledByName: reservation.cancelledByName
    });
}

async function markWorkedOnDayOff(member, user, shift, now) {
    if (user) user.dayOffExpireAt = null;
    const today = now.format('YYYY-MM-DD');
    const reservation = Object.values(dayOffReservations).find(r =>
        r &&
        r.status === 'approved' &&
        r.userId === member.id &&
        r.leaveDate === today &&
        r.shift === shift
    );
    if (!reservation) return null;

    reservation.status = 'worked';
    reservation.workedAt = now.toISOString();
    reservation.workedBy = member.id;
    reservation.workedByName = member.displayName;
    if (reservation.appliedDate === today && (user.offCount || 0) > 0) {
        user.offCount -= 1;
    }
    delete reservation.appliedDate;
    delete reservation.appliedAt;

    await writeDayOffLog(`🔄 휴무 당일 근무 전환\n👥 대상: ${reservation.name}\n⏰ 근무: ${reservation.shiftLabel}\n📅 기존 휴무일: ${reservation.leaveDate}\n📝 사유: 휴무일 본인 CLOCK IN 버튼 출근\n\n${reservation.name} 님이 승인된 휴무일에 출근하여 근무 상태로 전환되었습니다.`);
    await appendDayOffAudit('WORKED_ON_DAYOFF', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        reason: 'clock-in-or-live-on'
    });
    return reservation;
}

function getActiveApprovedDayOffReservation(memberId, shift, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!memberId || !shift) return null;
    const logicalDate = getDayOffLogicalDateForShift(shift, now);
    return Object.values(dayOffReservations).find(r =>
        r &&
        r.status === 'approved' &&
        r.userId === memberId &&
        r.shift === shift &&
        r.leaveDate === logicalDate
    ) || null;
}

function buildLiveOffGuidanceDm({ final = false, minutes = null } = {}) {
    const lines = [
        final ? '⚠️ Your attendance has been closed because LIVE stayed OFF.' : '📹 Please turn your live stream ON.',
        '',
        '❓ Are you unable to turn on your live stream right now?',
        'If you cannot turn on LIVE due to internet or PC problems, stay in the voice channel and press CLOCK IN to restart as a LIVE EXCEPTION.',
        '✅ Your work will only be counted after you do this.',
        '',
        '🙏 Please use this only when you truly cannot turn LIVE ON.',
        '🚫 If you do not press CLOCK IN, your attendance will not be counted.'
    ];
    if (minutes !== null) {
        lines.splice(1, 0, `⏱️ LIVE OFF duration: about ${minutes} minutes.`);
    }
    return lines.join('\n');
}

async function sendFinishedLiveOffReminder(member, user, now, source = 'voice_snapshot') {
    if (!member || !user?.isFinished || user.checkedIn) return false;
    const finishedAt = user.checkOutRaw || user.attendanceStatusChangedAt || null;
    if (!finishedAt) return false;
    if (!Array.isArray(user.finishedLiveOffReminderMarks)) user.finishedLiveOffReminderMarks = [];

    const elapsedMins = Math.max(0, now.diff(moment(finishedAt).tz(CONFIG.TIMEZONE), 'minutes'));
    const reminderMarks = [15, 30, 45, 60];
    const reminderMark = Math.floor(elapsedMins / 15) * 15;
    if (!reminderMarks.includes(reminderMark)) return false;
    if (user.finishedLiveOffReminderMarks.includes(reminderMark)) return false;

    user.finishedLiveOffReminderMarks.push(reminderMark);
    appendAttendanceEvent(user, 'finished_live_off_dm_sent', now, source, {
        minutesSinceFinished: elapsedMins,
        reminderMark
    });
    await member.send([
        '🌿 LIVE OFF after FINISHED',
        `Reminder ${reminderMarks.indexOf(reminderMark) + 1}/${reminderMarks.length}`,
        '',
        buildLiveOffGuidanceDm({ final: true, minutes: reminderMark })
    ].join('\n')).catch(() => null);
    return true;
}

async function cancelDayOffReservationByCommand(member, leaveDate, cancelledBy) {
    const reservation = Object.values(dayOffReservations).find(r =>
        r &&
        ['pending', 'approved'].includes(r.status) &&
        r.userId === member.id &&
        r.leaveDate === leaveDate
    );
    if (!reservation) return null;

    reservation.status = 'cancelled';
    reservation.cancelledBy = cancelledBy.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.cancelledByName = cancelledBy.displayName || cancelledBy.user?.username || null;
    reservation.cancelledAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    delete reservation.appliedDate;
    delete reservation.appliedAt;
    dayOffReservations[reservation.messageId] = reservation;

    const u = attendanceData[member.id];
    if (u?.dayOff && leaveDate === moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD')) {
        u.dayOff = false;
        if ((u.offCount || 0) > 0) u.offCount -= 1;
    }

    await saveSystemAsync();
    await writeDayOffLog(`❌ 휴무 예약 취소\n👥 대상: ${reservation.name}\n⏰ 근무: ${reservation.shiftLabel}\n📅 휴무일: ${reservation.leaveDate}\n👑 취소자: ${reservation.cancelledByName || reservation.cancelledBy || '정보 없음'}\n\n${reservation.name} 님의 휴무가 취소되었습니다.`);
    await appendDayOffAudit('CANCELLED', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        cancelledBy: reservation.cancelledBy,
        cancelledByName: reservation.cancelledByName,
        reason: 'slash-command'
    });
    return reservation;
}

async function cancelOnlyDayOffReservationByCommand(member, cancelledBy) {
    const candidates = Object.values(dayOffReservations)
        .filter(r =>
            r &&
            ['pending', 'approved'].includes(r.status) &&
            r.userId === member.id
        )
        .sort((a, b) => `${a.leaveDate}${a.messageId}`.localeCompare(`${b.leaveDate}${b.messageId}`));

    if (candidates.length !== 1) {
        return {
            error: candidates.length === 0 ? 'not-found' : 'ambiguous',
            count: candidates.length,
            candidates
        };
    }

    const reservation = candidates[0];
    const cancelled = await cancelDayOffReservationByCommand(member, reservation.leaveDate, cancelledBy);
    return cancelled || { error: 'not-found', count: 0, candidates: [] };
}

async function rejectDayOffReservationByCommand(member, leaveDate, rejectedBy, reason = 'Rejected by Graet') {
    const reservation = Object.values(dayOffReservations).find(r =>
        r &&
        ['pending', 'approved'].includes(r.status) &&
        r.userId === member.id &&
        r.leaveDate === leaveDate
    );
    if (!reservation) return null;

    reservation.status = 'rejected';
    reservation.rejectedBy = rejectedBy.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.rejectedByName = rejectedBy.displayName || rejectedBy.user?.username || null;
    reservation.rejectedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    reservation.rejectReason = (reason || 'Rejected by Graet').trim() || 'Rejected by Graet';
    delete reservation.appliedDate;
    delete reservation.appliedAt;
    dayOffReservations[reservation.messageId] = reservation;

    const u = attendanceData[member.id];
    if (u?.dayOff && leaveDate === moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD')) {
        u.dayOff = false;
        u.dayOffExpireAt = null;
        if ((u.offCount || 0) > 0) u.offCount -= 1;
    }

    const channel = await client.channels.fetch(reservation.channelId).catch(() => null);
    const message = channel ? await channel.messages.fetch(reservation.messageId).catch(() => null) : null;
    if (message) await setDayOffStatusEmoji(message, '❌');

    await member.send(dayOffService.buildDayOffRejectDm(reservation)).catch(e => {
        console.error('[DAYOFF REJECT DM ERROR]', e);
    });

    await saveSystemAsync();
    await writeDayOffLog(`❌ 휴무 신청 반려\n👥 대상: ${reservation.name}\n⏰ 근무: ${reservation.shiftLabel}\n📅 휴무일: ${reservation.leaveDate}\n👑 반려자: ${reservation.rejectedByName || reservation.rejectedBy || '정보 없음'}\n📝 사유: ${reservation.rejectReason}`);
    await appendDayOffAudit('REJECTED', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        submittedName: reservation.submittedName || null,
        nameMismatch: Boolean(reservation.nameMismatch),
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        rejectedBy: reservation.rejectedBy,
        rejectedByName: reservation.rejectedByName,
        reason: reservation.rejectReason
    });
    return reservation;
}

async function approveDayOffReservationByCommand(member, leaveDate, approvedBy) {
    const reservation = Object.values(dayOffReservations).find(r =>
        r &&
        r.status === 'pending' &&
        r.userId === member.id &&
        r.leaveDate === leaveDate
    );
    if (!reservation) return null;

    const duplicate = Object.values(dayOffReservations).find(r =>
        r &&
        r.messageId !== reservation.messageId &&
        r.status === 'approved' &&
        r.userId === reservation.userId &&
        r.leaveDate === leaveDate &&
        r.shift === reservation.shift
    );
    if (duplicate) return { error: 'duplicate' };

    reservation.status = 'approved';
    reservation.approvedBy = approvedBy.id || CONFIG.DAYOFF_REVIEWER_ID;
    reservation.approvedByName = approvedBy.displayName || approvedBy.user?.username || null;
    reservation.updatedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    dayOffReservations[reservation.messageId] = reservation;

    const channel = await client.channels.fetch(reservation.channelId).catch(() => null);
    const message = channel ? await channel.messages.fetch(reservation.messageId).catch(() => null) : null;
    if (message) await setDayOffStatusEmoji(message, '✅');

    const dmKey = `${reservation.leaveDate}:${reservation.shift}:${reservation.userId}`;
    let dmStatus = 'DM 발송 완료';
    if (reservation.lastDmKey !== dmKey) {
        const targetUser = await client.users.fetch(reservation.userId).catch(() => null);
        if (targetUser) {
            await targetUser.send(dayOffService.buildDayOffDm(reservation)).catch(e => {
                console.error('[DAYOFF DM ERROR]', e);
                dmStatus = 'DM 발송 실패';
            });
        } else {
            dmStatus = '대상 유저 찾을 수 없음';
        }
        reservation.lastDmKey = dmKey;
        reservation.dmSentAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    } else {
        dmStatus = 'DM 중복 발송 생략';
    }

    await saveSystemAsync();
    await writeDayOffLog(`✅ 휴무 승인 완료 (명령어)\n이름: ${reservation.name}\n근무조: ${reservation.shiftLabel}\n휴무일: ${reservation.leaveDate}\n승인자: ${reservation.approvedByName || reservation.approvedBy || '시스템'}\nDM 상태: ${dmStatus}`);
    await appendDayOffAudit('APPROVED', {
        messageId: reservation.messageId,
        userId: reservation.userId,
        name: reservation.name,
        submittedName: reservation.submittedName || null,
        nameMismatch: Boolean(reservation.nameMismatch),
        shift: reservation.shiftLabel,
        leaveDate: reservation.leaveDate,
        approvedBy: reservation.approvedBy,
        approvedByName: reservation.approvedByName,
        dmStatus,
        reason: 'slash-command'
    });
    return reservation;
}

async function checkDayOffReservations() {
    const now = moment().tz(CONFIG.TIMEZONE);
    const guild = client.guilds.cache.get(CONFIG.GUILD_ID);
    if (!guild) return;
    let changed = false;

    for (const reservation of Object.values(dayOffReservations)) {
        if (!reservation || reservation.status !== 'approved') continue;
        const logicalDate = getDayOffLogicalDateForShift(reservation.shift, now);
        if (reservation.leaveDate !== logicalDate) continue;
        const reservationBounds = buildShiftBoundsForBusinessDate(
            reservation.shift,
            moment.tz(reservation.leaveDate, 'YYYY-MM-DD', CONFIG.TIMEZONE)
        );
        if (reservationBounds?.end && now.isSameOrAfter(reservationBounds.end)) continue;

        const member = await guild.members.fetch(reservation.userId).catch(() => null);
        const u = ensureUserData(member || { id: reservation.userId, displayName: reservation.name }, reservation.shift);
        if (!u) continue;
        if (reservation.appliedDate === logicalDate && u.dayOff) continue;
        const alreadyCounted = reservation.appliedDate === logicalDate;

        u.shift = reservation.shift;
        u.dayOff = true;
        transitionRecordedStatus(u, {
            attendanceStatus: 'DAY_OFF',
            voiceStatus: 'OFFLINE'
        }, now, 'dayoff-auto-apply', 'approved-day-off-applied');
        u.dayOffExpireAt = (reservationBounds || getShiftBounds(reservation.shift, now)).end.toISOString();
        u.checkedIn = false;
        u.disconnected = false;
        u.isFinished = true;
        if (!alreadyCounted) u.offCount = (u.offCount || 0) + 1;
        overtimeUsers = overtimeUsers.filter(o => o.id !== reservation.userId);
        if (member) await updateWorkingRole(member, false);

        reservation.appliedDate = logicalDate;
        reservation.appliedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
        changed = true;
        await writeDayOffLog(`📅 휴무 자동 반영\n👥 이름: ${reservation.name}\n⏰ 근무: ${reservation.shiftLabel}\n📅 휴무일: ${reservation.leaveDate}\n📝 사유: 근무조별 논리 날짜(${logicalDate}) 기준으로 근무 현황에 DAY OFF를 반영했습니다.`);
        await appendDayOffAudit('APPLIED', {
            messageId: reservation.messageId,
            userId: reservation.userId,
            name: reservation.name,
            shift: reservation.shiftLabel,
            leaveDate: reservation.leaveDate,
            logicalDate
        });
    }

    if (changed) {
        await saveSystemAsync();
        renderDashboardCore();
    }
}

/**
 * [ INTERACTION HANDLER ]
 */
client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
    try {
        const m = newState.member || oldState.member;
        if (!m || m.user?.bot) return;
        const activityChanged = markMemberActivity(m, 'voice_state');
        const s = determineShift(m);
        if (!s) {
            if (activityChanged) await saveSystemAsync();
            return;
        }
        const u = ensureUserData(m, s);
        if (!u) return;
        const now = moment().tz(CONFIG.TIMEZONE);
        const changed = await applyVoiceSnapshot(m, u, s, {
            source: 'voice_state',
            wasConnected: Boolean(oldState.channelId),
            isConnected: Boolean(newState.channelId),
            wasStreaming: Boolean(oldState.streaming),
            isStreaming: Boolean(newState.streaming)
        }, now);
        if (changed) {
            await saveSystemAsync();
            renderDashboardCore();
        } else if (activityChanged) {
            await saveSystemAsync();
        }
    } catch (e) {
        console.error('[VOICE AUTOMATION ERROR]', e);
    }
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    try {
        if (!CONFIG.NICKNAME_ROLE_SYNC) return;
        if (!newMember || newMember.user?.bot) return;
        if (CONFIG.EXCEPTIONS.SHARED_SEAT_USER && newMember.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER) return;
        if (await syncManualGuestNickname(oldMember, newMember)) return;

        const existing = attendanceData[newMember.id];
        if (existing?.checkedIn || existing?.disconnected || existing?.dayOff) {
            await writeDayOffLog(`닉네임/역할 자동동기화 보류\n대상: ${newMember.displayName}\n사유: 근무/휴무/DC 상태 중에는 역할을 자동 변경하지 않습니다.`);
            return;
        }

        if (await syncNicknameFromAssignedRoles(oldMember, newMember)) return;
        if (oldMember.displayName === newMember.displayName) return;

        const hasBothShiftRoles = newMember.roles.cache.has(CONFIG.ROLES.DAY) && newMember.roles.cache.has(CONFIG.ROLES.NIGHT);
        if (hasBothShiftRoles && !CONFIG.EXCEPTIONS.SHARED_SEAT_USER) {
            await writeDayOffLog(`닉네임/역할 자동동기화 보류\n대상: ${newMember.displayName}\n사유: DAY/NIGHT 역할을 모두 가지고 있는 공유 근무 가능 인원입니다. 자동 변경하지 않습니다.`);
            return;
        }

        if (await syncRolesFromStructuredNickname(newMember)) {
            await saveSystemAsync();
            renderDashboardCore();
            return;
        }

        const newName = newMember.displayName.toLowerCase();
        const hasServerKeyword = /heine|paagrio|하이네|파그리오|파아그리오|파아/.test(newName);
        const hasShiftKeyword = /\bday\b|day\s*time|주간|낮|\bnight\b|night\s*time|야간|밤/.test(newName);
        if (!hasServerKeyword && !hasShiftKeyword) return;

        let changed = false;
        let targetServerRole = null;
        let otherServerRole = null;
        if (newName.includes('heine') || newName.includes('하이네')) {
            targetServerRole = CONFIG.ROLES.HEINE;
            otherServerRole = CONFIG.ROLES.PAAGRIO;
        } else if (newName.includes('paagrio') || newName.includes('파그리오') || newName.includes('파아그리오') || newName.includes('파아')) {
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
        if (/\bday\b|day\s*time|주간|낮/.test(newName)) {
            targetShiftRole = CONFIG.ROLES.DAY;
            otherShiftRole = CONFIG.ROLES.NIGHT;
            shiftStr = 'day';
        } else if (/\bnight\b|night\s*time|야간|밤/.test(newName)) {
            targetShiftRole = CONFIG.ROLES.NIGHT;
            otherShiftRole = CONFIG.ROLES.DAY;
            shiftStr = 'night';
        }

        if (targetShiftRole && !newMember.roles.cache.has(targetShiftRole)) {
            await newMember.roles.add(targetShiftRole).catch(() => null);
            if (otherShiftRole) await newMember.roles.remove(otherShiftRole).catch(() => null);
            const u = ensureUserData(newMember, shiftStr);
            if (u) u.shift = shiftStr;
            changed = true;
        }

        if (changed) {
            await saveSystemAsync();
            await writeDayOffLog(`닉네임/역할 자동동기화 완료\n대상: ${newMember.displayName}`);
            renderDashboardCore();
        }
    } catch (e) {
        console.error('[NICKNAME ROLE SYNC ERROR]', e);
    }
});

client.on(Events.GuildMemberRemove, async member => {
    try {
        if (!member || member.user?.bot) return;
        const u = attendanceData[member.id];
        if (u) {
            u.checkedIn = false;
            u.dayOff = false;
            u.disconnected = false;
            u.disconnectedAt = null;
            u.isFinished = true;
            u.status = null;
            u.shift = null;
            u.voiceJoinedAt = null;
            u.liveOffWarnedFor = null;
        }
        overtimeUsers = overtimeUsers.filter(o => o.id !== member.id);
        if (liveExceptions[member.id]?.status === 'active') {
            liveExceptions[member.id].status = 'cancelled';
            liveExceptions[member.id].cancelledAt = moment().tz(CONFIG.TIMEZONE).toISOString();
            liveExceptions[member.id].cancelReason = 'member-left-guild';
        }
        await saveSystemAsync();
        renderDashboardCore({ forceMemberRefresh: true });
    } catch (e) {
        console.error('[MEMBER REMOVE ERROR]', e);
    }
});

client.on(Events.MessageCreate, async message => {
    try {
        if (message.member && !message.author?.bot && markMemberActivity(message.member, 'message')) {
            await saveSystemAsync();
        }
        await processDayOffMessage(message);
    } catch (e) {
        console.error('[DAYOFF MESSAGE ERROR]', e);
    }
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    try {
        const message = newMessage.partial ? await newMessage.fetch().catch(() => null) : newMessage;
        if (message) await processDayOffMessage(message);
    } catch (e) {
        console.error('[DAYOFF UPDATE ERROR]', e);
    }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
    try {
        if (user.bot) return;
        if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
        if (!reaction || reaction.emoji.name !== DAYOFF_APPROVAL_EMOJI) return;
        const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
        if (!dayOffService.isDayOffChannel(message)) return;
        if (dayOffReactionCleanupLocks.has(message.id)) return;

        const member = await message.guild.members.fetch(user.id).catch(() => null);
        const canApprove = member?.permissions?.has(PermissionFlagsBits.Administrator) ||
            member?.permissions?.has(PermissionFlagsBits.ManageMessages) ||
            user.id === CONFIG.DAYOFF_REVIEWER_ID;
        if (!canApprove) return;

        await approveDayOffMessage(message, member);
    } catch (e) {
        console.error('[DAYOFF REACTION ADD ERROR]', e);
    }
});

client.on(Events.MessageReactionRemove, async (reaction, user) => {
    try {
        if (user.bot) return;
        if (reaction.partial) reaction = await reaction.fetch().catch(() => null);
        if (!reaction || reaction.emoji.name !== DAYOFF_APPROVAL_EMOJI) return;
        const message = reaction.message.partial ? await reaction.message.fetch().catch(() => null) : reaction.message;
        if (!dayOffService.isDayOffChannel(message)) return;

        const member = await message.guild.members.fetch(user.id).catch(() => null);
        const canCancel = member?.permissions?.has(PermissionFlagsBits.Administrator) ||
            member?.permissions?.has(PermissionFlagsBits.ManageMessages) ||
            user.id === CONFIG.DAYOFF_REVIEWER_ID;
        if (!canCancel) return;

        await cancelDayOffApproval(message, member);
    } catch (e) {
        console.error('[DAYOFF REACTION REMOVE ERROR]', e);
    }
});

client.on(Events.InteractionCreate, async i => {
    const autoDel = createAutoDelete(i);
    try {
        if (i.isChatInputCommand()) {
            patchCommandReplies(i, { withCommandStatusPayload, handleInteractionReplyError });
            if (i.member && markMemberActivity(i.member, 'command')) await saveSystemAsync();
            const isAdmin = i.member.permissions.has(PermissionFlagsBits.Administrator);
            const isDayOffManager = isAdmin || i.user.id === CONFIG.DAYOFF_REVIEWER_ID || isOwnerId(i.user.id);
            const now = moment().tz(CONFIG.TIMEZONE);
            const {
                n,
                getTargetMember,
                getSlot,
                getAnnounceTime,
                getAnnounceContent,
                getAnnounceRole,
                getAnnounceRoles
            } = createCommandOptionHelpers(i);
            const replyMemberNotFound = () => i.reply({ content: '대상을 찾을 수 없습니다.', flags: MessageFlags.Ephemeral }).then(() => autoDel());

            if (n('live-exception') || n('라이브예외')) {
                if (!canManageLiveException(i.member)) {
                    return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                const t = getTargetMember();
                const hours = i.options.getInteger('hours') || i.options.getInteger('시간');
                const reason = i.options.getString('reason') || i.options.getString('사유');
                if (!t) return i.editReply({ content: 'Member not found.' }).then(() => autoDel());
                if (hours && (hours < 1 || hours > 12)) {
                    return i.editReply({ content: '시간은 1~12시간 사이로 입력해주세요.' }).then(() => autoDel());
                }
                const result = await grantLiveException(t, hours, reason, i.member);
                if (!result.ok) return i.editReply({ content: result.message }).then(() => autoDel());
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.editReply({ content: `✅ 라이브 예외가 승인되었습니다. 대상: ${t.displayName}, 만료: ${formatKoreanDateTime(result.expiresAt)}` }).then(() => autoDel());
            }

            if (n('assign-roles') || n('역할')) {
                if (!isAdmin) return i.reply({ content: 'Admin only.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const server = i.options.getString('server') || i.options.getString('서버');
                const shift = i.options.getString('shift') || i.options.getString('시프트');
                const serverRole = server === 'HEINE' ? CONFIG.ROLES.HEINE : CONFIG.ROLES.PAAGRIO;
                const otherServerRole = server === 'HEINE' ? CONFIG.ROLES.PAAGRIO : CONFIG.ROLES.HEINE;
                const shiftRole = shift === 'DAY' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
                const otherShiftRole = shift === 'DAY' ? CONFIG.ROLES.NIGHT : CONFIG.ROLES.DAY;

                await t.roles.add(serverRole).catch(e => console.error('[ROLE ASSIGN ERROR]', e));
                await t.roles.remove(otherServerRole).catch(() => null);
                await t.roles.add(shiftRole).catch(e => console.error('[SHIFT ASSIGN ERROR]', e));
                await t.roles.remove(otherShiftRole).catch(() => null);

                const u = ensureUserData(t, shift === 'DAY' ? 'day' : 'night');
                u.dayOff = false;
                await saveSystemAsync();
                renderDashboardCore();
                return i.reply({ content: `Assigned ${server} / ${shift} to ${t.displayName}.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('report-regular') || n('일반보고')) {
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                await sendOpsReport('Regular');
                return i.editReply({ content: 'Sent.' }).then(() => autoDel());
            }
            if (n('report-analysis') || n('정밀보고')) {
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                await sendOpsReport('Analysis');
                return i.editReply({ content: 'Sent.' }).then(() => autoDel());
            }
            if (n('combined-ranking') || n('통합랭킹')) {
                const shift = i.options.getString('구분') || i.options.getString('shift') || 'all';
                await refreshGuildMembers(i.guild, { force: false });
                return i.reply({ embeds: [buildRankingEmbed({ guild: i.guild, shift })] });
            }
            if (n('refresh') || n('현황판갱신')) {
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                await i.editReply({ content: '✅ Refresh started. Updating attendance panels and dashboard...' }).catch(() => null);
                await refreshGuildMembers(i.guild, { force: true });
                await reconcileAttendanceMembership(i.guild);
                await syncVoiceStates();
                await checkDayOffReservations();
                await autoOvertimeCheck();
                await syncAutoPanels();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.editReply({ content: '✅ UI Refreshed.' }).then(() => autoDel());
            }
            if (n('sync-working') || n('워킹동기화')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                const result = await syncWorkingRoles();
                return i.editReply({ content: `WORKING sync complete. added=${result.added}, removed=${result.removed}` }).then(() => autoDel());
            }
            if (n('permission-check') || n('권한진단')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                return i.editReply({ embeds: [await buildPermissionCheckEmbed(i.guild)] });
            }
            if (n('data-audit') || n('데이터검사')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                return i.reply({ embeds: [buildDataAuditEmbed()], flags: MessageFlags.Ephemeral });
            }
            if (n('inactive-candidates') || n('비활동검사')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const days = i.options.getInteger('days') || i.options.getInteger('일수') || CONFIG.INACTIVE_CANDIDATE_DAYS;
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                return i.editReply({ embeds: [await buildInactiveCandidatesEmbed(i.guild, days)] });
            }
            if (n('status-audit') || n('상태검사')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                return i.reply({ embeds: [await buildStatusAuditEmbed(i.guild)], flags: MessageFlags.Ephemeral });
            }
            if (n('time-audit') || n('시간검사')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                return i.reply({ embeds: [buildTimeAuditEmbed()], flags: MessageFlags.Ephemeral });
            }
            if (n('dayoff-log') || n('휴무로그')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const limit = i.options.getInteger('limit') || i.options.getInteger('갯수') || 10;
                return i.reply({ embeds: [await buildDayOffLogEmbed(Math.max(1, Math.min(30, limit)))], flags: MessageFlags.Ephemeral });
            }
            if (n('dayoff-list') || n('휴무목록')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const status = i.options.getString('status') || i.options.getString('상태') || 'all';
                return i.reply({ embeds: [dayOffService.buildDayOffListEmbed(status)], flags: MessageFlags.Ephemeral });
            }
            if (n('dayoff-approve') || n('휴무승인')) {
                if (!isDayOffManager) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const dateInput = i.options.getString('date') || i.options.getString('날짜');
                const leaveDate = dayOffService.parseDayOffCommandDate(dateInput);
                if (!leaveDate) {
                    return i.reply({ content: '날짜 형식이 올바르지 않습니다. 예: 2026-05-21 또는 May 21', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                const approved = await approveDayOffReservationByCommand(t, leaveDate, i.member);
                if (!approved) {
                    return i.reply({ content: `${t.displayName} / ${leaveDate} 대기 중인 휴무 신청을 찾지 못했습니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                if (approved.error === 'duplicate') {
                    return i.reply({ content: `이미 동일한 날짜(${leaveDate})에 승인된 휴무가 존재합니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                renderDashboardCore();
                return i.reply({ content: `${approved.name} 님의 ${leaveDate} 휴무를 승인했습니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('dayoff-cancel') || n('휴무취소')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const dateInput = i.options.getString('date') || i.options.getString('날짜');
                const leaveDate = dayOffService.parseDayOffCommandDate(dateInput);
                if (!leaveDate) {
                    return i.reply({ content: '날짜 형식이 올바르지 않습니다. 예: 2026-05-21 또는 May 21', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                const cancelled = await cancelDayOffReservationByCommand(t, leaveDate, i.member);
                if (!cancelled) {
                    return i.reply({ content: `${t.displayName} / ${leaveDate} 휴무 예약을 찾지 못했습니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                renderDashboardCore();
                return i.reply({ content: `${cancelled.name} 님의 ${leaveDate} 휴무를 취소했습니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('dayoff-cancel-force') || n('강제휴무취소')) {
                if (!isDayOffManager) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const cancelled = await cancelOnlyDayOffReservationByCommand(t, i.member);
                if (cancelled?.error === 'ambiguous') {
                    const candidates = cancelled.candidates
                        .slice(0, 5)
                        .map(r => `${r.leaveDate} / ${r.shiftLabel || '-'}`)
                        .join(', ');
                    return i.reply({ content: `휴무 신청이 ${cancelled.count}개입니다. 날짜가 있는 /휴무취소를 사용해주세요. 후보: ${candidates}`, flags: MessageFlags.Ephemeral }).then(() => autoDel(7000));
                }
                if (!cancelled || cancelled.error === 'not-found') {
                    return i.reply({ content: `${t.displayName} 님의 취소 가능한 휴무 신청을 찾지 못했습니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                renderDashboardCore();
                return i.reply({ content: `${cancelled.name} 님의 ${cancelled.leaveDate} 휴무를 강제 취소했습니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('dayoff-reject') || n('휴무반려')) {
                if (!isDayOffManager) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const dateInput = i.options.getString('date') || i.options.getString('날짜');
                const leaveDate = dayOffService.parseDayOffCommandDate(dateInput);
                const reason = i.options.getString('reason') || i.options.getString('사유') || 'Rejected by Graet';
                if (!leaveDate) {
                    return i.reply({ content: '날짜 형식이 올바르지 않습니다. 예: 2026-05-21 또는 May 21', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                const rejected = await rejectDayOffReservationByCommand(t, leaveDate, i.member, reason);
                if (!rejected) {
                    return i.reply({ content: `${t.displayName} / ${leaveDate} 휴무 신청을 찾지 못했습니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                renderDashboardCore();
                return i.reply({ content: `${rejected.name} 님의 ${leaveDate} 휴무 신청을 반려했습니다.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('force-in') || n('강제출근')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const s = determineShift(t);
                if (!s) return i.reply({ content: 'No role.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const u = ensureUserData(t, s);
                await handleClockIn(t, u, s, now);
                await writeAdminActionLog('FORCE_IN', i.member, t, [`shift=${s}`]);
                await saveSystemAsync();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.reply({ content: '✅ Forced In.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('force-out') || n('강제퇴근')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const u = ensureUserData(t, determineShift(t));
                if (!u.checkedIn && !u.disconnected) {
                    return i.reply({ content: 'Target is not checked in.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                await handleClockOut(t, u, now, '관리자 강제 퇴근', null, { skipEarlyPenalty: true });
                await writeAdminActionLog('FORCE_OUT', i.member, t, ['skipEarlyPenalty=true']);
                await saveSystemAsync();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.reply({ content: '✅ Forced Out.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('force-early-out') || n('강제조기퇴근')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const u = ensureUserData(t, determineShift(t));
                if (!u.checkedIn && !u.disconnected) {
                    return i.reply({ content: 'Target is not checked in.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                await handleClockOut(t, u, now, '관리자 조기퇴근 처리');
                await writeAdminActionLog('FORCE_EARLY_OUT', i.member, t);
                await saveSystemAsync();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.reply({ content: '✅ Forced Early Out.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('force-off') || n('강제휴무')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const s = determineShift(t);
                const u = ensureUserData(t, s);
                if (s) u.dayOffExpireAt = getShiftBounds(s, now).end.toISOString();
                u.dayOff = true;
                u.checkedIn = false;
                u.disconnected = false;
                u.isFinished = true;
                u.offCount = (u.offCount || 0) + 1;
                overtimeUsers = overtimeUsers.filter(o => o.id !== t.id);
                await updateWorkingRole(t, false);
                await recordLog(u, 'off', '관리자 강제 휴무');
                await writeAdminActionLog('FORCE_OFF', i.member, t, [s ? `shift=${s}` : 'shift=unknown']);
                await saveSystemAsync();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.reply({ content: '✅ Forced Off.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('force-ot') || n('강제연장')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const s = determineShift(t);
                if (!s) return i.reply({ content: 'No role.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const u = ensureUserData(t, s);
                if (!u.checkedIn) await handleClockIn(t, u, s, now);
                u.checkedIn = true;
                u.isFinished = false;
                u.dayOff = false;
                u.disconnected = false;
                u.disconnectedAt = null;
                u.pendingManualOT = false;
                transitionRecordedStatus(u, {
                    attendanceStatus: 'OVERTIME',
                    voiceStatus: t.voice?.streaming ? 'LIVE_ON' : (t.voice?.channelId ? 'LIVE_OFF' : 'OFFLINE')
                }, now, 'force-ot-command', 'admin-forced-overtime');
                await updateWorkingRole(t, true);
                if (addOvertimeUser(u, 'FORCED')) {
                    u.totalOT = (u.totalOT || 0) + 1;
                    u.points = (u.points || 0) + CONFIG.POINTS.OT;
                    await recordLog(u, 'ot', '관리자 강제 연장');
                } else {
                    await recordLog(u, 'ot', '관리자 강제 연장 상태 재확인');
                }
                await writeAdminActionLog('FORCE_OT', i.member, t, [`shift=${s}`, `checkedIn=${Boolean(u.checkedIn)}`]);
                await saveSystemAsync();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.reply({ content: '✅ Forced OT.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('diagnostics') || n('진단')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                return i.reply({ embeds: [buildDiagnosticsEmbed(i.guild)], flags: MessageFlags.Ephemeral });
            }
            if (n('backup-create') || n('백업생성')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                await saveSystemAsync();
                const backupPath = await createBackupSnapshot('manual');
                return i.reply({
                    content: backupPath ? `Backup created: ${backupPath}` : 'Backup failed. Check console logs.',
                    flags: MessageFlags.Ephemeral
                });
            }
            if (n('backup-list') || n('백업목록')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const backups = await listBackupSnapshots();
                const content = backups.length ? backups.slice(0, 10).join('\n') : 'No backups found.';
                return i.reply({ content: `\`\`\`\n${content}\n\`\`\``, flags: MessageFlags.Ephemeral });
            }
            if (n('backup-restore') || n('백업복구')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                if (!isOwnerId(i.user.id)) return ownerOnlyReply(i);
                const fileName = i.options.getString('file') || i.options.getString('파일');
                const restored = await restoreBackupSnapshot(fileName);
                if (!restored) return i.reply({ content: 'Restore failed. Use /backup-list first.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                renderDashboardCore();
                return i.reply({ content: `Restored backup: ${restored}`, flags: MessageFlags.Ephemeral });
            }
            if (n('set-announce') || n('공지설정')) {
                if (!canManageAnnouncements(i.member)) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const slot = getSlot();
                const time = getAnnounceTime();
                const content = getAnnounceContent();
                const roles = typeof getAnnounceRoles === 'function'
                    ? getAnnounceRoles()
                    : [getAnnounceRole()].filter(Boolean);
                const roleIds = [...new Set(roles.map(role => role?.id).filter(Boolean))].slice(0, 2);
                if (slot < 1 || slot > 6 || !/^\d{2}:\d{2}$/.test(time)) {
                    return i.reply({ content: 'Invalid slot or time. Use slot 1-6 and HH:mm.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                announceData[slot] = {
                    active: true,
                    time,
                    content,
                    roleId: roleIds[0] || null,
                    roleIds,
                    lastSentDate: null
                };
                await saveSystemAsync();
                const targetText = roleIds.length
                    ? roleIds.map(roleId => `<@&${roleId}>`).join(' ')
                    : '@everyone';
                return i.reply({ content: `Announcement slot ${slot} saved for ${time}. Targets: ${targetText}`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('cancel-announce') || n('공지취소')) {
                if (!canManageAnnouncements(i.member)) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const slot = getSlot();
                if (slot < 1 || slot > 6) return i.reply({ content: 'Invalid slot. Use 1-6.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                if (announceData[slot]) announceData[slot].active = false;
                await saveSystemAsync();
                return i.reply({ content: `Announcement slot ${slot} disabled.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('list-announce') || n('공지목록')) {
                if (!canManageAnnouncements(i.member)) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                return i.reply({ content: `\`\`\`\n${adminService.formatAnnouncementList()}\n\`\`\``, flags: MessageFlags.Ephemeral });
            }
            if (n('manual-adjust') || n('수동수정')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                if (!isOwnerId(i.user.id)) return ownerOnlyReply(i);
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const field = i.options.getString('field') || i.options.getString('항목');
                const value = i.options.getString('value') || i.options.getString('값');
                const u = ensureUserData(t, determineShift(t));
                if (!adminService.applyManualAdjustment(u, field, value)) {
                    return i.reply({ content: 'Invalid field/value.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                await writeAdminActionLog('MANUAL_ADJUST', i.member, t, [`field=${field}`, `value=${value}`]);
                await saveSystemAsync();
                renderDashboardCore();
                return i.reply({ content: `Updated ${u.name}: ${field} = ${value}`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('fire') || n('해고')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                if (!isOwnerId(i.user.id)) return ownerOnlyReply(i);
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                await createBackupSnapshot('before-fire');
                delete attendanceData[t.id];
                overtimeUsers = overtimeUsers.filter(o => o.id !== t.id);
                await updateWorkingRole(t, false);
                await t.kick('Attendance bot fire command').catch(e => console.error('[KICK ERROR]', e));
                await writeAdminActionLog('FIRE_KICK', i.member, t, ['backup=before-fire']);
                await saveSystemAsync();
                renderDashboardCore();
                return i.reply({ content: 'Fired/Kicked.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('clear-roles') || n('역할삭제')) {
                if (!canManageAnnouncements(i.member)) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const roleIds = [CONFIG.ROLES.DAY, CONFIG.ROLES.NIGHT, CONFIG.ROLES.HEINE, CONFIG.ROLES.PAAGRIO, CONFIG.ROLES.WORKING].filter(Boolean);
                for (const roleId of roleIds) {
                    if (t.roles.cache.has(roleId)) await t.roles.remove(roleId).catch(e => console.error('[ROLE CLEAR ERROR]', e));
                }
                const u = ensureUserData(t);
                u.shift = null;
                u.checkedIn = false;
                u.dayOff = false;
                u.disconnected = false;
                u.isFinished = true;
                overtimeUsers = overtimeUsers.filter(o => o.id !== t.id);
                await writeAdminActionLog('CLEAR_ROLES', i.member, t, [`roles=${roleIds.join(',')}`]);
                await saveSystemAsync();
                renderDashboardCore();
                return i.reply({ content: 'Roles cleared.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('reset-user') || n('리셋') || n('개인리셋')) {
                if (!isAdmin) return i.reply({ content: failText('No perms.'), flags: MessageFlags.Ephemeral }).then(() => autoDel());
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                await i.editReply({ content: pendingText('개인 리셋 처리 중입니다. 백업을 만들고 데이터를 정리하고 있습니다.') }).catch(() => null);
                const t = getTargetMember();
                if (!t) return i.editReply({ content: failText('Member not found.') }).then(() => autoDel());
                await createBackupSnapshot('before-user-reset');
                delete attendanceData[t.id];
                overtimeUsers = overtimeUsers.filter(o => o.id !== t.id);
                ensureUserData(t);
                await updateWorkingRole(t, false);
                await writeAdminActionLog('RESET_USER', i.member, t, ['backup=before-user-reset']);
                await saveSystemAsync();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.editReply({ content: okText(`개인 리셋 완료: ${t.displayName}`) }).then(() => autoDel());
            }
            if (n('reset-all') || n('전체리셋')) {
                if (!isAdmin) return i.reply({ content: failText('No perms.'), flags: MessageFlags.Ephemeral }).then(() => autoDel());
                if (!isOwnerId(i.user.id)) return ownerOnlyReply(i);
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                await i.editReply({ content: pendingText('전체 리셋 처리 중입니다. 백업을 만들고 전체 출석 데이터를 정리하고 있습니다.') }).catch(() => null);
                await createBackupSnapshot('before-full-reset');
                attendanceData = {};
                overtimeUsers = [];
                liveExceptions = {};
                await syncWorkingRoles();
                await writeAdminActionLog('RESET_ALL', i.member, null, ['backup=before-full-reset']);
                await saveSystemAsync();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.editReply({ content: okText('전체 리셋 완료. 출석 데이터와 OT 상태를 초기화했습니다.') }).then(() => autoDel());
            }
            if (n('my-info') || n('내정보')) {
                const u = attendanceData[i.user.id];
                if (!u) return i.reply({ content: 'No data.', flags: MessageFlags.Ephemeral });
                const embed = new EmbedBuilder()
                    .setTitle(`📊 ${u.name} STATUS`)
                    .setColor('#2ECC71')
                    .addFields(
                        { name: '🏆 현재 누적 점수', value: `${u.points || 0} Pts`, inline: true },
                        { name: '📊 [정상/지각/결석/조퇴/연장/휴무]', value: `\`${u.totalNormal || 0}/${u.totalLate || 0}/${u.totalAbsent || 0}/${u.totalEarly || 0}/${u.totalOT || 0}/${u.offCount || 0}\``, inline: false }
                    );
                return i.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
            }
        }

        if (i.isButton()) {
            await refreshGuildMembers(i.guild, { force: true, minIntervalMs: 0 });
            const m = await i.guild.members.fetch({ user: i.user.id, force: true }).catch(() => i.member);
            if (markMemberActivity(m, 'button')) await saveSystemAsync();
            const s = determineShift(m);
            if (!s) return i.reply({ content: 'No role.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            const u = ensureUserData(m, s);
            if (isCooldown(u)) return i.reply({ content: 'Cooldown (3s).', flags: MessageFlags.Ephemeral }).then(() => autoDel(2000));
            const now = moment().tz(CONFIG.TIMEZONE);
            const type = i.customId;
            u.manualPanelTouchedAt = now.toISOString();
            u.shift = s;
            console.log('[BUTTON ACTION]', type, m.id, m.displayName);

            if (type === 'in' && u.checkedIn && !u.dayOff && !u.disconnected) {
                await saveSystemAsync();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.reply({ content: 'Already in.', flags: MessageFlags.Ephemeral }).then(() => autoDel(2000));
            }
            if (type === 'out' && !u.checkedIn && !u.disconnected) {
                return i.reply({ content: 'You are not checked in.', flags: MessageFlags.Ephemeral }).then(() => autoDel(2000));
            }

            if (type === 'in') {
                const wasDayOff = Boolean(u.dayOff);
                if (wasDayOff) {
                    await notifyDayOffPresence(m, u, s, now, 'CLOCK IN attempted while Day Off');
                    await saveSystemAsync();
                    await renderDashboardCore({ forceMemberRefresh: true });
                    return i.reply({
                        content: 'You are currently marked as Day Off. Attendance will not be counted automatically. If you are here to work, please contact an admin for approval.',
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(5000));
                }
                const voiceState = i.guild.voiceStates.cache.get(m.id);
                const isVoiceConnected = Boolean(m.voice?.channelId || voiceState?.channelId);
                const isStreamingNow = Boolean(isVoiceConnected && (m.voice?.streaming || voiceState?.streaming));
                const activeLiveException = getActiveLiveException(m.id, now);
                const canClockInByLiveException = Boolean(isVoiceConnected && activeLiveException);
                const canSelfResumeLiveException = Boolean(
                    isVoiceConnected &&
                    !isStreamingNow &&
                    !activeLiveException &&
                    u.isFinished &&
                    ['live-off-timeout', 'live-exception-expired'].includes(u.lastClockOutSource)
                );
                if (canSelfResumeLiveException) {
                    const exceptionExpiresAt = getShiftBounds(s, now).end;
                    liveExceptions[m.id] = {
                        userId: m.id,
                        name: m.displayName,
                        shift: s,
                        hours: null,
                        approvedMinutes: Math.max(1, exceptionExpiresAt.diff(now, 'minutes')),
                        mode: 'self-clock-in',
                        reason: 'Unable to turn on LIVE; resumed from FINISHED by CLOCK IN',
                        approvedBy: m.id,
                        approvedByName: m.displayName || m.user?.username || 'Unknown',
                        approvedAt: now.toISOString(),
                        expiresAt: exceptionExpiresAt.toISOString(),
                        status: 'active'
                    };
                    u.checkedIn = true;
                    u.dayOff = false;
                    u.isFinished = false;
                    u.disconnected = false;
                    u.disconnectedAt = null;
                    u.voiceJoinedAt = null;
                    u.liveOffStartedAt = null;
                    u.liveOffWarnedFor = null;
                    u.pendingClockOut = null;
                    u.manualResumeRequired = false;
                    u.manualResumeRequiredSince = null;
                    u.manualResumeRequiredReason = null;
                    u.lastManualResumePromptKey = null;
                    u.manualResumePromptMarks = [];
                    u.finishedLiveOffReminderMarks = [];
                    u.finishedPresence = null;
                    u.finalLeftAt = null;
                    u.status = 'exception';
                    u.shift = s;
                    u.checkInTime = now.format('hh:mm A');
                    u.checkInRaw = now.toISOString();
                    u.finishedLiveOffReminderMarks = [];
                    u.lastLiveOnAt = now.toISOString();
                    transitionRecordedStatus(u, {
                        attendanceStatus: 'WORKING',
                        voiceStatus: 'EXCEPTION'
                    }, now, 'button-or-command', 'self-live-exception-clock-in');
                    startAttendanceSession(u, s, now, 'self-live-exception-clock-in');
                    appendAttendanceEvent(u, 'self_live_exception_clock_in', now, 'button-or-command', {
                        previousClockOutSource: u.lastClockOutSource || null,
                        previousClockOutAt: u.checkOutRaw || null,
                        exceptionExpiresAt: exceptionExpiresAt.toISOString()
                    });
                    await updateWorkingRole(m, true);
                    await recordLog(u, 'reconnect', '라이브 불가 예외 CLOCK IN - 근무 인정');
                    await saveSystemAsync();
                    await renderDashboardCore({ forceMemberRefresh: true });
                    return i.reply({
                        content: 'Attendance resumed as LIVE EXCEPTION. You will be shown as LIVE EXCEPTION on the dashboard.',
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(7000));
                }
                if (!isStreamingNow && !canClockInByLiveException) {
                    if (u.manualResumeRequired) {
                        u.checkedIn = false;
                        u.isFinished = true;
                        u.disconnected = false;
                        u.disconnectedAt = null;
                        u.voiceJoinedAt = null;
                        u.liveOffStartedAt = null;
                        u.liveOffWarnedFor = null;
                        u.pendingClockOut = null;
                        transitionRecordedStatus(u, {
                            attendanceStatus: 'FINISHED',
                            voiceStatus: isVoiceConnected ? 'LIVE_OFF' : 'OFFLINE'
                        }, now, 'button-or-command', 'manual-resume-live-required');
                        await saveSystemAsync();
                        await renderDashboardCore({ forceMemberRefresh: true });
                        return i.reply({
                            content: isVoiceConnected
                                ? 'Your attendance is still FINISHED. Turn on your live stream first, then press CLOCK IN again. Attendance will not be counted until you press CLOCK IN while LIVE ON.'
                                : 'Your attendance is still FINISHED. Join a voice channel, turn on your live stream, then press CLOCK IN again. Attendance will not be counted until then.',
                            flags: MessageFlags.Ephemeral
                        }).then(() => autoDel(7000));
                    }
                    u.isFinished = false;
                    if (isVoiceConnected) markLiveOffState(u, now);
                    await saveSystemAsync();
                    await renderDashboardCore({ forceMemberRefresh: true });
                    return i.reply({
                        content: isVoiceConnected
                            ? [
                                'Please turn your live stream ON.',
                                '',
                                'Are you unable to turn your live stream on right now?',
                                'Stay in the voice channel and press CLOCK IN to resume as a LIVE EXCEPTION.',
                                'Your work will only be counted after that.',
                                '',
                                'Only use this if you truly cannot turn LIVE ON.',
                                'If you do not press CLOCK IN, your attendance will not be counted.'
                            ].join('\n')
                            : 'Please join a voice channel and turn on your live stream so your clock-in can be counted.',
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(isVoiceConnected ? 10000 : 3000));
                }
                u.isFinished = false;
                if (canStartPreShiftOvertime(u, now)) {
                    await startPreShiftOvertime(m, u, s, now, 'button-or-command');
                    await saveSystemAsync();
                    await renderDashboardCore({ forceMemberRefresh: true });
                    return i.reply({
                        content: [
                            '✅ Pre-shift OT has started.',
                            '',
                            `Your regular ${s.toUpperCase()} shift starts at ${getShiftBounds(s, now).start.format('hh:mm A')}.`,
                            'Until then, you will be shown as overtime.'
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(7000));
                }
                if (u.disconnected) {
                    u.disconnected = false;
                    u.disconnectedAt = null;
                    await recordLog(u, 'reconnect', 'DC 복구');
                } else {
                    const clockedIn = await handleClockIn(m, u, s, now, false);
                    if (!clockedIn) {
                        const bounds = getShiftBounds(s, now);
                        await saveSystemAsync();
                        await renderDashboardCore({ forceMemberRefresh: true });
                        return i.reply({
                            content: `Clock-in was not counted. Detected shift: ${s.toUpperCase()}. Your shift starts at ${bounds.start.format('hh:mm A')}. Please check your DAY/NIGHT role, then press CLOCK IN again while LIVE ON.`,
                            flags: MessageFlags.Ephemeral
                        }).then(() => autoDel(7000));
                    }
                }
                if (canClockInByLiveException) {
                    u.checkedIn = true;
                    u.dayOff = false;
                    u.isFinished = false;
                    u.disconnected = false;
                    u.disconnectedAt = null;
                    u.status = 'exception';
                    u.shift = s;
                    u.checkInTime = u.checkInTime || now.format('hh:mm A');
                    u.checkInRaw = u.checkInRaw || now.toISOString();
                    u.liveOffStartedAt = null;
                    u.liveOffWarnedFor = null;
                    u.pendingClockOut = null;
                    transitionRecordedStatus(u, {
                        attendanceStatus: 'WORKING',
                        voiceStatus: 'EXCEPTION'
                    }, now, 'button-or-command', 'clock-in-with-live-exception');
                    appendAttendanceEvent(u, 'clock_in_with_live_exception', now, 'button-or-command', {
                        exceptionApprovedAt: activeLiveException.approvedAt || null,
                        exceptionExpiresAt: activeLiveException.expiresAt || null
                    });
                    await recordLog(u, 'reconnect', '라이브 예외 대상 CLOCK IN - 근무 인정');
                }
            } else if (type === 'out') {
                await handleClockOut(m, u, now);
            } else if (type === 'ot') {
                if (u.dayOff) {
                    await notifyDayOffPresence(m, u, s, now, 'OVERTIME attempted while Day Off');
                    await saveSystemAsync();
                    await renderDashboardCore({ forceMemberRefresh: true });
                    return i.reply({
                        content: 'You are currently marked as Day Off. OT will not be counted automatically. Please contact an admin for approval.',
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(5000));
                }
                const voiceState = i.guild.voiceStates.cache.get(m.id);
                const isVoiceConnected = Boolean(m.voice?.channelId || voiceState?.channelId);
                const isStreamingNow = Boolean(isVoiceConnected && (m.voice?.streaming || voiceState?.streaming));
                const overtimeStart = getOvertimeStartMoment(u, now);
                const isOvertimeWindow = canStartOvertimeNow(u, now);
                const isPreShiftOvertimeWindow = canStartPreShiftOvertime(u, now);
                if (!u.checkedIn && !isOvertimeWindow) {
                    if (isPreShiftOvertimeWindow && isStreamingNow) {
                        await startPreShiftOvertime(m, u, s, now, 'button-or-command');
                        await saveSystemAsync();
                        await renderDashboardCore({ forceMemberRefresh: true });
                        return i.reply({
                            content: [
                                '✅ Pre-shift OT has started.',
                                '',
                                `Your regular ${s.toUpperCase()} shift starts at ${getShiftBounds(s, now).start.format('hh:mm A')}.`,
                                'Until then, you will be shown as overtime.'
                            ].join('\n'),
                            flags: MessageFlags.Ephemeral
                        }).then(() => autoDel(7000));
                    }
                    await saveSystemAsync();
                    await renderDashboardCore({ forceMemberRefresh: true });
                    return i.reply({
                        content: [
                            '⚠️ OT was not reserved.',
                            '',
                            isPreShiftOvertimeWindow
                                ? 'You are before your regular shift, but your live stream is not ON.'
                                : 'You are not clocked in yet.',
                            isPreShiftOvertimeWindow
                                ? 'Please join a voice channel, turn LIVE ON, then press OVERTIME again.'
                                : 'Please turn LIVE ON and press the CLOCK IN button first.',
                            '',
                            `OT can start after ${overtimeStart ? overtimeStart.format('hh:mm A') : 'your shift end'}.`
                        ].join('\n'),
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(7000));
                }
                if (!isStreamingNow) {
                    u.pendingManualOT = true;
                    u.isFinished = false;
                    if (isVoiceConnected) markLiveOffState(u, now);
                    await recordLog(u, 'ot', 'OT 예약 대기 (라이브 ON 후 정시 이후 인정)');
                    await saveSystemAsync();
                    await renderDashboardCore({ forceMemberRefresh: true });
                    return i.reply({
                        content: isVoiceConnected
                            ? 'OT standby is active. Turn on your live stream to confirm manual OT.'
                            : 'Please join a voice channel and turn on your live stream so OT can be counted.',
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(3000));
                }
                if (!isOvertimeWindow) {
                    u.pendingManualOT = true;
                    u.isFinished = false;
                    await recordLog(u, 'ot', `OT 예약 등록 (정시 이후 ${overtimeStart ? overtimeStart.format('hh:mm A') : 'shift end'}부터 인정)`);
                    await saveSystemAsync();
                    await renderDashboardCore({ forceMemberRefresh: true });
                    return i.reply({
                        content: `OT reservation saved. If you keep your live stream on after ${overtimeStart ? overtimeStart.format('hh:mm A') : 'shift end'}, it will switch to manual OT.`,
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(5000));
                }
                if (!u.checkedIn) await handleClockIn(m, u, s, now, false);
                if (addOvertimeUser(u, 'MANUAL')) {
                    transitionRecordedStatus(u, {
                        attendanceStatus: 'OVERTIME',
                        voiceStatus: 'LIVE_ON'
                    }, now, 'button-or-command', 'manual-ot-button-started');
                    u.totalOT = (u.totalOT || 0) + 1;
                    u.points = (u.points || 0) + CONFIG.POINTS.OT;
                    await recordLog(u, 'ot', '수동 연장 근무 시작');
                }
            } else if (type === 'off') {
                if (u.checkedIn || u.disconnected || overtimeUsers.some(o => o.id === m.id)) {
                    await handleClockOut(m, u, now, '휴무 버튼 전환 전 퇴근 처리');
                }
                u.dayOffExpireAt = getShiftBounds(s, now).end.toISOString();
                u.dayOff = true;
                transitionRecordedStatus(u, {
                    attendanceStatus: 'DAY_OFF',
                    voiceStatus: m.voice?.channelId ? (m.voice?.streaming ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE'
                }, now, 'button-or-command', 'day-off-button');
                u.checkedIn = false;
                u.disconnected = false;
                u.isFinished = true;
                u.offCount = (u.offCount || 0) + 1;
                overtimeUsers = overtimeUsers.filter(o => o.id !== m.id);
                await updateWorkingRole(m, false);
                await recordLog(u, 'off');
            }

            const jokeList = JOKES[type?.toUpperCase()] || ['Completed.'];
            await i.reply({ content: jokeList[0], flags: MessageFlags.Ephemeral }).then(() => autoDel(2000));
            await saveSystemAsync();
            await renderDashboardCore({ forceMemberRefresh: true });
        }
    } catch (error) {
        console.error('[INTERACTION ERROR]', error);
        const content = failText('명령어를 처리하는 중 오류가 발생했습니다. 콘솔 로그를 확인해주세요.');
        if (i.deferred || i.replied) {
            await i.editReply({ content, embeds: [], components: [] }).catch(() => null);
        } else {
            await i.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
        }
    }
});

/**
 * [ START ENGINE ]
 */
client.once(Events.ClientReady, async () => {
    loadSystem();
    const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);
    const cmdList = buildCommandDefinitions();
    const visibleCmdList = cmdList.filter(command => !hiddenCommandAliases.has(command.name));

    try {
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: visibleCmdList });
    } catch (e) {
        console.error('[REST ERROR]', e);
    }

    const g = await client.guilds.fetch(CONFIG.GUILD_ID);
    await refreshGuildMembers(g, { force: true });

    let heartbeatRunning = false;
    setInterval(async () => {
        if (heartbeatRunning) {
            console.warn('[HEARTBEAT WARN] Previous tick still running, skipping.');
            return;
        }
        heartbeatRunning = true;
        try {
            await syncVoiceStates();
            await reconcileAttendanceMembership(client.guilds.cache.get(CONFIG.GUILD_ID));
            await checkGracePeriods();
            await autoOvertimeCheck();
            await checkLiveExceptions();
            await checkScheduledAnnouncements();
            await checkDayOffReservations();
            await autoAssignGuestForUnassignedMembers(client.guilds.cache.get(CONFIG.GUILD_ID));
            await syncWorkingRoles();
            await createScheduledBackupIfDue();
            await syncAutoPanels();
            const housekeepingChanged = expireDayOffSessions() || cleanupOldDayOffReservations();
            if (housekeepingChanged) await saveSystemAsync();
            await renderDashboardCore();
        } catch (e) {
            console.error('[HEARTBEAT ERROR]', e);
        } finally {
            heartbeatRunning = false;
        }
    }, 60000);

    cron.schedule('30 21 * * 0,1,3,4,5,6', () => performSmartReset('day'), { timezone: CONFIG.TIMEZONE });
    cron.schedule('30 19 * * 2', () => performSmartReset('day'), { timezone: CONFIG.TIMEZONE });
    cron.schedule('30 9 * * 0,1,2,4,5,6', () => performSmartReset('night'), { timezone: CONFIG.TIMEZONE });
    cron.schedule('30 4 * * 3', () => performSmartReset('night'), { timezone: CONFIG.TIMEZONE });
    printStartupBanner();
});

client.login(process.env.TOKEN);
