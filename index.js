require('dotenv').config();

const fsSync = require('fs');
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
    SlashCommandBuilder,
    MessageFlags,
    PermissionFlagsBits,
    Partials
} = require('discord.js');

/**
 * [ CONFIGURATION ]
 *
 */
const CONFIG = {
    VERSION: '2500.97-COMPACT-SUMMARY-BOXES',
    RELEASE_NOTE: 'Keep dashboard summary counts on one line in narrow embeds',
    GUILD_ID: '1502598521294028830',
    LOG_CHANNEL: '1503681085618262158',
    STATUS_CHANNEL: '1503681415407992962',
    ANNOUNCE_CHANNEL: '1502609571456356545',
    DAYOFF_CHANNEL: process.env.DAYOFF_CHANNEL_ID || '1502729397336018964',
    DAYOFF_REVIEWER_ID: process.env.DAYOFF_REVIEWER_ID || '280301228716589058',
    OWNER_IDS: (process.env.OWNER_IDS || '280301228716589058').split(',').map(id => id.trim()).filter(Boolean),
    LIVE_EXCEPTION_MANAGER_ROLE_IDS: (process.env.LIVE_EXCEPTION_MANAGER_ROLE_IDS || '1502599381105246388,1502715137667235870').split(',').map(id => id.trim()).filter(Boolean),
    ANNOUNCEMENT_MANAGER_ROLE_IDS: (process.env.ANNOUNCEMENT_MANAGER_ROLE_IDS || process.env.LIVE_EXCEPTION_MANAGER_ROLE_IDS || '1502599381105246388,1502715137667235870').split(',').map(id => id.trim()).filter(Boolean),
    DAY_CHAN: '1503405274935853126',
    NIGHT_CHAN: '1503405331118821426',
    ROLES: {
        DAY: '1502714263742185492',
        NIGHT: '1502713144311677098',
        HEINE: '1503141947877888020',
        PAAGRIO: '1503142843177504959',
        WORKING: process.env.WORKING_ROLE_ID || '1505261436983574528',
        GUEST: process.env.GUEST_ROLE_ID || '1502715825767977030'
    },
    FILES: {
        DATA: './attendanceData.json',
        BACKUP: './attendanceData.json.bak',
        BACKUP_DIR: './backups',
        DAYOFF_LOG: './logs/dayoff-logs.jsonl',
        MAX_BACKUPS: 30
    },
    POINTS: { NORMAL_IN: 10, LATE: -5, EARLY_OUT: -10, OT: 15, ABSENT: -20 },
    TIMEZONE: 'Asia/Manila',
    PURGE_NORMAL: 14,
    PURGE_MANUAL_OT: 40,
    // ✨ [업데이트] 유예 기간 20분 -> 10분으로 축소
    GRACE_PERIOD_MINS: 10,
    LIVE_OFF_DM_AFTER_MINS: 10,
    LIVE_OFF_CLOCK_OUT_MINS: 10,
    CLOCK_OUT_GRACE_MINS: 5,
    AUTO_OT_AFTER_MINS: 5,
    PRE_SHIFT_LIVE_BUFFER_MINS: 10,
    FINISHED_VISIBLE_AFTER_MINS: 30,
    AUTO_TIMEOUT_RESUME_WINDOW_MINS: 60,
    GUEST_ASSIGN_AFTER_HOURS: 24,
    INACTIVE_CANDIDATE_DAYS: 3,
    NICKNAME_ROLE_SYNC: true,
    EXCEPTIONS: {
        SHARED_SEAT_USER: process.env.SHARED_SEAT_USER_ID || null
    }
};

const SHIFT_SCHEDULE = {
    day: {
        default: { start: '09:00', end: '21:00', endOffsetDays: 0 },
        Tuesday: { start: '09:00', end: '19:00', endOffsetDays: 0 }
    },
    night: {
        default: { start: '21:00', end: '09:00', endOffsetDays: 1 },
        Tuesday: { start: '19:00', end: '04:00', endOffsetDays: 1 }
    }
};

const MAINTENANCE_WINDOWS = [
    { day: 'Wednesday', start: '04:00', end: '09:00' }
];

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

let isSaving = false;
let pendingSave = false;
let renderingDashboard = false;
let pendingDashboardRender = false;
let lastSavedAt = null;
let lastBackupAt = null;
let lastMemberFetchAt = 0;
let memberFetchPromise = null;

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

function ensureUserData(member, shift = null) {
    if (!member) return null;
    const s = shift || determineShift(member);
    if (!attendanceData[member.id]) {
        attendanceData[member.id] = {
            id: member.id,
            name: member.displayName || member.user?.username || 'Unknown',
            shift: s,
            checkedIn: false,
            dayOff: false,
            attendanceStatus: 'PRE_SHIFT',
            voiceStatus: 'OFFLINE',
            attendanceStatusChangedAt: null,
            voiceStatusChangedAt: null,
            dayOffExpireAt: null,
            disconnected: false,
            disconnectedAt: null,
            isFinished: false,
            strikes: 0,
            points: 0,
            totalNormal: 0,
            totalLate: 0,
            totalAbsent: 0,
            totalEarly: 0,
            totalOT: 0,
            dcCount: 0,
            offCount: 0,
            voiceJoinedAt: null,
            liveOffStartedAt: null,
            lastLiveOnAt: null,
            lastLiveOffAt: null,
            preShiftLiveAt: null,
            pendingClockOut: null,
            attendanceEvents: [],
            lastEventKey: null,
            lastEventAt: null,
            lastPreShiftWaitLogKey: null,
            dayOffPresenceNotifiedFor: null,
            afterFinishPresenceNotifiedFor: null,
            finishedPresence: null,
            finalLeftAt: null,
            activeSessionId: null,
            sessions: [],
            pendingManualOT: false,
            manualResumeRequired: false,
            manualResumeRequiredSince: null,
            manualResumeRequiredReason: null,
            lastManualResumePromptKey: null,
            reversibleEarlyPenaltyKey: null,
            reversibleEarlyPenaltyAppliedAt: null,
            reversibleEarlyPenaltyPoints: null,
            liveOffWarnedFor: null,
            lastFinishedReturnPromptKey: null,
            lastActivityAt: null,
            lastActivitySource: null,
            lastActivityDisplayName: member.displayName || member.user?.username || 'Unknown',
            lastActionAt: 0
        };
    }
    // ✨ [업데이트] Username cannot be blank 버그 수정 (member.name 대신 member.user?.username)
    attendanceData[member.id].name = member.displayName || member.user?.username || attendanceData[member.id].name || 'Unknown';
    if (s) attendanceData[member.id].shift = s;
    attendanceData[member.id].offCount = attendanceData[member.id].offCount || 0;
    attendanceData[member.id].totalOT = attendanceData[member.id].totalOT || 0;
    attendanceData[member.id].points = attendanceData[member.id].points || 0;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'attendanceStatus')) attendanceData[member.id].attendanceStatus = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'voiceStatus')) attendanceData[member.id].voiceStatus = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'attendanceStatusChangedAt')) attendanceData[member.id].attendanceStatusChangedAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'voiceStatusChangedAt')) attendanceData[member.id].voiceStatusChangedAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'dayOffExpireAt')) attendanceData[member.id].dayOffExpireAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'liveOffStartedAt')) attendanceData[member.id].liveOffStartedAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastLiveOnAt')) attendanceData[member.id].lastLiveOnAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastLiveOffAt')) attendanceData[member.id].lastLiveOffAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'preShiftLiveAt')) attendanceData[member.id].preShiftLiveAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'pendingClockOut')) attendanceData[member.id].pendingClockOut = null;
    if (!Array.isArray(attendanceData[member.id].attendanceEvents)) attendanceData[member.id].attendanceEvents = [];
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastEventKey')) attendanceData[member.id].lastEventKey = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastEventAt')) attendanceData[member.id].lastEventAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastPreShiftWaitLogKey')) attendanceData[member.id].lastPreShiftWaitLogKey = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'dayOffPresenceNotifiedFor')) attendanceData[member.id].dayOffPresenceNotifiedFor = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'afterFinishPresenceNotifiedFor')) attendanceData[member.id].afterFinishPresenceNotifiedFor = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'finishedPresence')) attendanceData[member.id].finishedPresence = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'finalLeftAt')) attendanceData[member.id].finalLeftAt = null;
    if (!Array.isArray(attendanceData[member.id].sessions)) attendanceData[member.id].sessions = [];
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'activeSessionId')) attendanceData[member.id].activeSessionId = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'pendingManualOT')) attendanceData[member.id].pendingManualOT = false;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'manualResumeRequired')) attendanceData[member.id].manualResumeRequired = false;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'manualResumeRequiredSince')) attendanceData[member.id].manualResumeRequiredSince = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'manualResumeRequiredReason')) attendanceData[member.id].manualResumeRequiredReason = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastManualResumePromptKey')) attendanceData[member.id].lastManualResumePromptKey = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'reversibleEarlyPenaltyKey')) attendanceData[member.id].reversibleEarlyPenaltyKey = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'reversibleEarlyPenaltyAppliedAt')) attendanceData[member.id].reversibleEarlyPenaltyAppliedAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'reversibleEarlyPenaltyPoints')) attendanceData[member.id].reversibleEarlyPenaltyPoints = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastFinishedReturnPromptKey')) attendanceData[member.id].lastFinishedReturnPromptKey = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastActivityAt')) attendanceData[member.id].lastActivityAt = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastActivitySource')) attendanceData[member.id].lastActivitySource = null;
    if (!Object.prototype.hasOwnProperty.call(attendanceData[member.id], 'lastActivityDisplayName')) attendanceData[member.id].lastActivityDisplayName = attendanceData[member.id].name;
    return attendanceData[member.id];
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

function isOwnerId(id) {
    return CONFIG.OWNER_IDS.includes(String(id));
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

function ownerOnlyReply(i) {
    return i.reply({
        content: failText('Owner only command.'),
        flags: MessageFlags.Ephemeral
    }).then(() => setTimeout(() => i.deleteReply().catch(() => {}), 3000));
}

function okText(content) {
    const text = String(content || 'Completed.');
    return /^[✅❌⏳]/u.test(text) ? text : `✅ ${text}`;
}

function failText(content) {
    const text = String(content || 'Failed.');
    return /^[✅❌⏳]/u.test(text) ? text : `❌ ${text}`;
}

function pendingText(content) {
    const text = String(content || 'Processing...');
    return /^[✅❌⏳]/u.test(text) ? text : `⏳ ${text}`;
}

function commandStatusText(content) {
    const text = String(content || '');
    if (!text || /^[✅❌⏳]/u.test(text)) return text;
    const failPattern = /no perms|admin only|owner only|not found|not checked in|no role|invalid|failed|fail|cannot|could not|restore failed|backup failed|찾지 못|없습니다|권한|올바르지|실패|오류/i;
    return failPattern.test(text) ? failText(text) : okText(text);
}

function withCommandStatusPayload(payload) {
    if (typeof payload === 'string') return commandStatusText(payload);
    if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'content')) return payload;
    return {
        ...payload,
        content: commandStatusText(payload.content)
    };
}

function addOvertimeUser(user, type = 'AUTO', startedAt = null) {
    if (!user || overtimeUsers.some(o => o.id === user.id)) return false;
    const otStartedAt = startedAt
        ? moment(startedAt).tz(CONFIG.TIMEZONE)
        : moment().tz(CONFIG.TIMEZONE);
    overtimeUsers.push({
        id: user.id,
        name: user.name,
        type,
        shift: user.shift || null,
        shiftSessionKey: user.shift ? getShiftSessionKey(user.shift, moment().tz(CONFIG.TIMEZONE)) : null,
        startedAt: otStartedAt.toISOString()
    });
    const session = getOpenSession(user);
    if (session) {
        session.otType = type;
        session.otStartedAt = otStartedAt.toISOString();
    }
    return true;
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
    if (isSaving) {
        pendingSave = true;
        return;
    }
    isSaving = true;
    try {
        const payload = JSON.stringify({ attendanceData, overtimeUsers, statusMessageId, panelInfo, announceData, dayOffReservations, liveExceptions }, null, 2);
        const tmpDataPath = CONFIG.FILES.DATA + '.tmp';
        const tmpBackupPath = CONFIG.FILES.BACKUP + '.tmp';
        await fs.writeFile(tmpDataPath, payload);
        await fs.rename(tmpDataPath, CONFIG.FILES.DATA);
        await fs.writeFile(tmpBackupPath, payload);
        await fs.rename(tmpBackupPath, CONFIG.FILES.BACKUP);
        lastSavedAt = moment().tz(CONFIG.TIMEZONE).toISOString();
    } catch (e) {
        console.error('[SAVE ERROR]', e);
    } finally {
        isSaving = false;
        if (pendingSave) {
            pendingSave = false;
            saveSystemAsync();
        }
    }
}

async function createBackupSnapshot(reason = 'manual') {
    try {
        await fs.mkdir(CONFIG.FILES.BACKUP_DIR, { recursive: true });
        const stamp = moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD-HH-mm-ss');
        const fileName = `attendanceData-${stamp}-${reason}.json`;
        const backupPath = `${CONFIG.FILES.BACKUP_DIR}/${fileName}`;
        const payload = JSON.stringify({
            attendanceData,
            overtimeUsers,
            statusMessageId,
            panelInfo,
            announceData,
            dayOffReservations,
            liveExceptions,
            backupReason: reason,
            createdAt: moment().tz(CONFIG.TIMEZONE).toISOString()
        }, null, 2);

        await fs.writeFile(backupPath, payload);
        lastBackupAt = moment().tz(CONFIG.TIMEZONE).toISOString();

        const files = (await fs.readdir(CONFIG.FILES.BACKUP_DIR))
            .filter(name => name.startsWith('attendanceData-') && name.endsWith('.json'))
            .sort();
        const overflow = files.length - CONFIG.FILES.MAX_BACKUPS;
        if (overflow > 0) {
            for (const oldFile of files.slice(0, overflow)) {
                await fs.unlink(`${CONFIG.FILES.BACKUP_DIR}/${oldFile}`).catch(() => {});
            }
        }
        return backupPath;
    } catch (e) {
        console.error('[BACKUP ERROR]', e);
        return null;
    }
}

async function createScheduledBackupIfDue() {
    const now = moment().tz(CONFIG.TIMEZONE);
    if (lastBackupAt && now.diff(moment(lastBackupAt), 'hours') < 6) return;
    await createBackupSnapshot('auto');
}

async function listBackupSnapshots() {
    try {
        await fs.mkdir(CONFIG.FILES.BACKUP_DIR, { recursive: true });
        return (await fs.readdir(CONFIG.FILES.BACKUP_DIR))
            .filter(name => name.startsWith('attendanceData-') && name.endsWith('.json'))
            .sort()
            .reverse();
    } catch (e) {
        console.error('[BACKUP LIST ERROR]', e);
        return [];
    }
}

async function restoreBackupSnapshot(fileName = null) {
    try {
        const backups = await listBackupSnapshots();
        const targetName = fileName || backups[0];
        if (!targetName || !backups.includes(targetName)) return false;

        await createBackupSnapshot('pre-restore');
        const raw = await fs.readFile(`${CONFIG.FILES.BACKUP_DIR}/${targetName}`, 'utf8');
        const restored = JSON.parse(raw);
        attendanceData = restored.attendanceData || {};
        overtimeUsers = restored.overtimeUsers || [];
        statusMessageId = restored.statusMessageId || null;
        panelInfo = restored.panelInfo || panelInfo;
        announceData = restored.announceData || announceData;
        dayOffReservations = restored.dayOffReservations || {};
        liveExceptions = restored.liveExceptions || {};
        await saveSystemAsync();
        return targetName;
    } catch (e) {
        console.error('[BACKUP RESTORE ERROR]', e);
        return false;
    }
}

function loadSystem() {
    try {
        if (fsSync.existsSync(CONFIG.FILES.DATA)) {
            const d = JSON.parse(fsSync.readFileSync(CONFIG.FILES.DATA, 'utf8'));
            attendanceData = d.attendanceData || {};
            overtimeUsers = d.overtimeUsers || [];
            statusMessageId = d.statusMessageId || null;
            panelInfo = d.panelInfo || panelInfo;
            announceData = d.announceData || announceData;
            dayOffReservations = d.dayOffReservations || {};
            liveExceptions = d.liveExceptions || {};
        }
    } catch (e) {
        console.error('[LOAD ERROR]', e);
    }
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
const getStrWidth = (str) => {
    if (!str) return 0;
    let width = 0;
    for (const char of str) width += char.codePointAt(0) > 255 ? 2 : 1;
    return width;
};
const padWidth = (str, len) => str + ' '.repeat(Math.max(0, len - getStrWidth(str)));
const truncateWidth = (str, maxW) => {
    let w = 0;
    let res = '';
    for (const char of str) {
        const charW = char.codePointAt(0) > 255 ? 2 : 1;
        if (w + charW > maxW - 2) return res + '..';
        res += char;
        w += charW;
    }
    return res;
};
const formatDuration = (mins) => `${Math.floor(mins / 60)}시간 ${mins % 60}분`;
const formatExactWidth = (str, width) => padWidth(truncateWidth(str, width), width);

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
    if (!member?.roles?.cache || !user || !activeShift) return false;
    if (user.dayOff || user.checkedIn || user.disconnected || overtimeUsers.some(ot => ot.id === member.id)) return false;
    if (!getRecentMaintenanceEnd(now)) return false;
    const previousShift = activeShift === 'day' ? 'night' : 'day';
    const previousRoleId = previousShift === 'day' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
    const activeRoleId = activeShift === 'day' ? CONFIG.ROLES.DAY : CONFIG.ROLES.NIGHT;
    if (!member.roles.cache.has(previousRoleId) || member.roles.cache.has(activeRoleId)) return false;
    const voiceState = member.guild?.voiceStates?.cache?.get(member.id);
    return Boolean(member.voice?.channelId || voiceState?.channelId);
}

function shouldShowAsPreShiftStandby(member, user, now) {
    const shift = user?.shift || getMemberShiftRole(member);
    if (!shift || user?.dayOff || user?.isFinished) return false;
    const voiceState = member.guild?.voiceStates?.cache?.get(member.id);
    const isVoiceConnected = Boolean(member.voice?.channelId || voiceState?.channelId);
    const hasPreShiftLive = Boolean(user?.preShiftLiveAt);
    return isWithinPreShiftWindow(shift, now) && (isVoiceConnected || hasPreShiftLive);
}

function ensureSessionStore(user) {
    if (!Array.isArray(user.sessions)) user.sessions = [];
    if (!Object.prototype.hasOwnProperty.call(user, 'activeSessionId')) user.activeSessionId = null;
}

function appendAttendanceEvent(user, type, at, source = 'system', meta = {}) {
    if (!user) return false;
    if (!Array.isArray(user.attendanceEvents)) user.attendanceEvents = [];
    const eventAt = moment(at).tz(CONFIG.TIMEZONE);
    const key = `${type}:${source}`;
    if (
        user.lastEventKey === key &&
        user.lastEventAt &&
        Math.abs(eventAt.diff(moment(user.lastEventAt).tz(CONFIG.TIMEZONE), 'seconds')) < 30
    ) {
        return false;
    }
    user.lastEventKey = key;
    user.lastEventAt = eventAt.toISOString();
    user.attendanceEvents.push({
        at: eventAt.toISOString(),
        type,
        source,
        meta
    });
    if (user.attendanceEvents.length > 100) {
        user.attendanceEvents = user.attendanceEvents.slice(-100);
    }
    return true;
}

function transitionRecordedStatus(user, next = {}, now = moment().tz(CONFIG.TIMEZONE), source = 'system', reason = null) {
    if (!user) return false;
    const at = moment(now).tz(CONFIG.TIMEZONE);
    let changed = false;
    const meta = { reason };

    if (next.attendanceStatus && user.attendanceStatus !== next.attendanceStatus) {
        meta.attendanceStatus = {
            from: user.attendanceStatus || null,
            to: next.attendanceStatus
        };
        user.attendanceStatus = next.attendanceStatus;
        user.attendanceStatusChangedAt = at.toISOString();
        changed = true;
    }

    if (next.voiceStatus && user.voiceStatus !== next.voiceStatus) {
        meta.voiceStatus = {
            from: user.voiceStatus || null,
            to: next.voiceStatus
        };
        user.voiceStatus = next.voiceStatus;
        user.voiceStatusChangedAt = at.toISOString();
        changed = true;
    }

    if (changed) {
        appendAttendanceEvent(user, 'recorded_status_changed', at, source, meta);
    }
    return changed;
}

function getOpenSession(user) {
    ensureSessionStore(user);
    return user.sessions.find(s => s.id === user.activeSessionId && !s.clockOutAt) ||
        user.sessions.slice().reverse().find(s => !s.clockOutAt) ||
        null;
}

function getRelevantSessionForTime(user, at) {
    if (!user || !Array.isArray(user.sessions)) return null;
    const ref = moment(at).tz(CONFIG.TIMEZONE);
    return user.sessions
        .filter(s => s?.scheduledEndAt && s.clockInAt && moment(s.clockInAt).tz(CONFIG.TIMEZONE).isSameOrBefore(ref))
        .sort((a, b) => moment(b.clockInAt).valueOf() - moment(a.clockInAt).valueOf())[0] || null;
}

function getScheduledEndMoment(user, fallbackAt = moment().tz(CONFIG.TIMEZONE)) {
    const openSession = getOpenSession(user);
    const relevantSession = openSession || getRelevantSessionForTime(user, fallbackAt);
    if (relevantSession?.scheduledEndAt) {
        return moment(relevantSession.scheduledEndAt).tz(CONFIG.TIMEZONE);
    }
    if (!user || !['day', 'night'].includes(user.shift)) return null;
    const reference = user.checkInRaw
        ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE)
        : moment(fallbackAt).tz(CONFIG.TIMEZONE);
    return getShiftBounds(user.shift, reference).end;
}

function normalizeOpenSessions(user, now = moment().tz(CONFIG.TIMEZONE)) {
    ensureSessionStore(user);
    const openSessions = user.sessions.filter(s => !s.clockOutAt);
    if (openSessions.length <= 1) return;
    const keep = openSessions.slice().sort((a, b) => moment(a.clockInAt).valueOf() - moment(b.clockInAt).valueOf()).pop();
    for (const session of openSessions) {
        if (session.id === keep.id) continue;
        const closeAt = moment.min(moment(now).tz(CONFIG.TIMEZONE), moment(keep.clockInAt).tz(CONFIG.TIMEZONE));
        session.clockOutAt = closeAt.toISOString();
        session.clockOutDetectedAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
        session.clockOutSource = 'session-repair';
        session.clockOutReason = '중복 열린 세션 자동 정리';
        session.workedMinutes = Math.max(0, closeAt.diff(moment(session.clockInAt).tz(CONFIG.TIMEZONE), 'minutes'));
    }
    user.activeSessionId = keep.id;
}

function startAttendanceSession(user, shift, now, source = 'unknown') {
    ensureSessionStore(user);
    normalizeOpenSessions(user, now);
    const open = getOpenSession(user);
    if (open) {
        user.activeSessionId = open.id;
        return open;
    }

    const bounds = getShiftBounds(shift, now);
    const session = {
        id: `${shift}:${bounds.start.format('YYYY-MM-DD-HH-mm')}:${now.valueOf()}`,
        shift,
        sessionKey: getShiftSessionKey(shift, now),
        scheduledStartAt: bounds.start.toISOString(),
        scheduledEndAt: bounds.end.toISOString(),
        clockInAt: now.toISOString(),
        clockInDetectedAt: now.toISOString(),
        clockInSource: source,
        clockOutAt: null,
        clockOutDetectedAt: null,
        clockOutSource: null,
        clockOutReason: null,
        workedMinutes: 0,
        liveOffPeriods: [],
        dcPeriods: [],
        otType: null
    };
    user.sessions.push(session);
    user.activeSessionId = session.id;
    return session;
}

function finishAttendanceSession(user, outMoment, source = 'unknown', reason = null, detectedAt = null) {
    const session = getOpenSession(user);
    if (!session) return null;
    const outAt = moment(outMoment).tz(CONFIG.TIMEZONE);
    const confirmedAt = detectedAt ? moment(detectedAt).tz(CONFIG.TIMEZONE) : moment().tz(CONFIG.TIMEZONE);
    const inAt = moment(session.clockInAt).tz(CONFIG.TIMEZONE);
    closeOpenSessionPeriod(session.liveOffPeriods, outAt);
    closeOpenSessionPeriod(session.dcPeriods, outAt);
    session.clockOutAt = outAt.toISOString();
    session.clockOutDetectedAt = confirmedAt.toISOString();
    session.clockOutSource = source;
    session.clockOutReason = reason;
    session.workedMinutes = Math.max(0, outAt.diff(inAt, 'minutes'));
    const workedSummary = calculateSessionWorkedMinutes(session, outAt);
    session.grossMinutes = workedSummary.grossMinutes;
    session.liveOffMinutes = workedSummary.liveOffMinutes;
    session.dcMinutes = workedSummary.dcMinutes;
    session.creditedMinutes = workedSummary.creditedMinutes;
    user.activeSessionId = null;
    return session;
}

function startSessionPeriod(periods, startedAt, reason = null) {
    if (!Array.isArray(periods)) return;
    if (periods.some(p => !p.endedAt)) return;
    periods.push({
        startedAt: moment(startedAt).tz(CONFIG.TIMEZONE).toISOString(),
        endedAt: null,
        minutes: 0,
        reason
    });
}

function closeOpenSessionPeriod(periods, endedAt) {
    if (!Array.isArray(periods)) return;
    const open = periods.slice().reverse().find(p => !p.endedAt);
    if (!open) return;
    const end = moment(endedAt).tz(CONFIG.TIMEZONE);
    open.endedAt = end.toISOString();
    open.minutes = Math.max(0, end.diff(moment(open.startedAt).tz(CONFIG.TIMEZONE), 'minutes'));
}

function sumSessionPeriods(periods, fallbackEnd) {
    if (!Array.isArray(periods)) return 0;
    const end = moment(fallbackEnd).tz(CONFIG.TIMEZONE);
    return periods.reduce((total, period) => {
        if (!period?.startedAt) return total;
        const started = moment(period.startedAt).tz(CONFIG.TIMEZONE);
        const ended = period.endedAt ? moment(period.endedAt).tz(CONFIG.TIMEZONE) : end;
        const minutes = Math.max(0, ended.diff(started, 'minutes'));
        return total + minutes;
    }, 0);
}

function calculateSessionWorkedMinutes(session, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!session?.clockInAt) {
        return {
            grossMinutes: 0,
            liveOffMinutes: 0,
            dcMinutes: 0,
            creditedMinutes: 0
        };
    }
    const end = session.clockOutAt
        ? moment(session.clockOutAt).tz(CONFIG.TIMEZONE)
        : moment(now).tz(CONFIG.TIMEZONE);
    const start = moment(session.clockInAt).tz(CONFIG.TIMEZONE);
    const grossMinutes = Math.max(0, end.diff(start, 'minutes'));
    const liveOffMinutes = Math.min(grossMinutes, sumSessionPeriods(session.liveOffPeriods, end));
    const dcMinutes = Math.min(grossMinutes, sumSessionPeriods(session.dcPeriods, end));
    const creditedMinutes = Math.max(0, grossMinutes - liveOffMinutes - dcMinutes);
    return {
        grossMinutes,
        liveOffMinutes,
        dcMinutes,
        creditedMinutes
    };
}

function getUserLatestSessionSummary(user, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!user || !Array.isArray(user.sessions) || user.sessions.length === 0) return null;
    const session = getOpenSession(user) ||
        user.sessions.slice().sort((a, b) => {
            const aAt = moment(a.clockInAt || a.scheduledStartAt || 0).valueOf();
            const bAt = moment(b.clockInAt || b.scheduledStartAt || 0).valueOf();
            return bAt - aAt;
        })[0];
    if (!session) return null;
    return {
        session,
        ...calculateSessionWorkedMinutes(session, now)
    };
}

function createPendingClockOut(user, source, at, graceMins, reason = null) {
    if (!user) return false;
    const start = moment(at).tz(CONFIG.TIMEZONE);
    const existing = user.pendingClockOut;
    if (existing && !existing.recoveredAt && existing.source === source) return false;
    user.pendingClockOut = {
        source,
        at: start.toISOString(),
        expiresAt: start.clone().add(graceMins, 'minutes').toISOString(),
        detectedAt: null,
        recoveredAt: null,
        reason
    };
    appendAttendanceEvent(user, 'clockout_candidate', start, source, {
        expiresAt: user.pendingClockOut.expiresAt,
        reason
    });
    return true;
}

function recoverPendingClockOut(user, recoveredAt, reason = 'recovered') {
    if (!user?.pendingClockOut || user.pendingClockOut.recoveredAt) return false;
    const recovered = moment(recoveredAt).tz(CONFIG.TIMEZONE);
    user.pendingClockOut.recoveredAt = recovered.toISOString();
    appendAttendanceEvent(user, 'clockout_candidate_recovered', recovered, user.pendingClockOut.source, { reason });
    user.pendingClockOut = null;
    return true;
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
    return getScheduledEndMoment(user, now);
}

function canStartOvertimeNow(user, now = moment().tz(CONFIG.TIMEZONE)) {
    const overtimeStart = getOvertimeStartMoment(user, now);
    return Boolean(overtimeStart && moment(now).tz(CONFIG.TIMEZONE).isSameOrAfter(overtimeStart));
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
    if (!user || !Array.isArray(user.sessions)) return null;
    return user.sessions
        .filter(session => session?.otStartedAt || session?.otType)
        .sort((a, b) => moment(b.clockInAt || b.otStartedAt || b.scheduledEndAt || 0).valueOf() -
            moment(a.clockInAt || a.otStartedAt || a.scheduledEndAt || 0).valueOf())[0] || null;
}

function getRestorableOvertimeSession(user, shift, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!user?.isFinished || user.checkedIn || user.dayOff || overtimeUsers.some(ot => ot.id === user.id)) return null;
    const session = getLatestOvertimeSession(user);
    if (!session) return null;

    const otStartedAt = moment(session.otStartedAt || session.scheduledEndAt || session.clockOutAt).tz(CONFIG.TIMEZONE);
    if (!otStartedAt.isValid() || now.isBefore(otStartedAt)) return null;
    if (now.diff(otStartedAt, 'hours', true) > CONFIG.PURGE_MANUAL_OT) return null;

    const currentBounds = getShiftBounds(shift || user.shift, now);
    const previousEnd = session.scheduledEndAt ? moment(session.scheduledEndAt).tz(CONFIG.TIMEZONE) : null;
    if (
        currentBounds?.start &&
        previousEnd &&
        currentBounds.start.isAfter(previousEnd) &&
        now.isSameOrAfter(currentBounds.start)
    ) {
        return null;
    }

    return { session, otStartedAt };
}

async function restoreOvertimeAfterFinish(member, user, shift, now, source = 'voice_snapshot') {
    if (isCurrentShiftRegularWorker(member, now)) return false;
    const restorable = getRestorableOvertimeSession(user, shift, now);
    if (!restorable) return false;

    const otType = restorable.session.otType || 'AUTO';
    const otStartedAt = restorable.otStartedAt;
    user.checkedIn = true;
    user.dayOff = false;
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
    user.finishedPresence = null;
    user.finalLeftAt = null;
    user.lastLiveOnAt = now.toISOString();
    user.shift = shift || user.shift;

    const session = startAttendanceSession(user, user.shift, now, 'overtime-restore');
    if (session) {
        session.scheduledStartAt = now.toISOString();
        session.scheduledEndAt = now.toISOString();
        session.otType = otType;
        session.otStartedAt = otStartedAt.toISOString();
        session.restoredFromSessionId = restorable.session.id || null;
    }

    addOvertimeUser(user, otType, otStartedAt);
    transitionRecordedStatus(user, {
        attendanceStatus: 'OVERTIME',
        voiceStatus: 'LIVE_ON'
    }, now, source, 'overtime-restored-after-finish');
    appendAttendanceEvent(user, 'overtime_restored_after_finish', now, source, {
        restoredFromSessionId: restorable.session.id || null,
        otStartedAt: otStartedAt.toISOString(),
        otType
    });
    await updateWorkingRole(member, true);
    await recordLog(user, 'ot', 'Overtime restored after bot restart / finished state recovery');
    return true;
}

async function activatePendingManualOvertime(user, now) {
    if (!user?.pendingManualOT) return false;
    if (!canStartOvertimeNow(user, now)) return false;
    const overtimeStart = getOvertimeStartMoment(user, now);
    const otStart = overtimeStart || moment(now).tz(CONFIG.TIMEZONE);
    const added = addOvertimeUser(user, 'MANUAL', overtimeStart || now);
    user.pendingManualOT = false;
    if (added) {
        user.checkedIn = true;
        user.dayOff = false;
        user.isFinished = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.liveOffStartedAt = null;
        user.pendingClockOut = null;
        user.checkInTime = user.checkInTime || otStart.format('hh:mm A');
        user.checkInRaw = user.checkInRaw || otStart.toISOString();
        const session = startAttendanceSession(user, user.shift, otStart, 'manual-ot');
        if (session) {
            session.scheduledStartAt = otStart.toISOString();
            session.scheduledEndAt = otStart.toISOString();
            session.otType = 'MANUAL';
            session.otStartedAt = otStart.toISOString();
        }
        transitionRecordedStatus(user, {
            attendanceStatus: 'OVERTIME',
            voiceStatus: 'LIVE_ON'
        }, otStart, 'manual-ot', 'pending-manual-ot-activated');
        user.totalOT = (user.totalOT || 0) + 1;
        user.points = (user.points || 0) + CONFIG.POINTS.OT;
        const member = client.guilds.cache.get(CONFIG.GUILD_ID)?.members.cache.get(user.id);
        if (member) await updateWorkingRole(member, true);
        await recordLog(user, 'ot', '수동 연장 근무 시작');
        return true;
    }
    return false;
}

function markLiveOffState(user, now) {
    if (!user) return false;
    let changed = false;
    const wasLiveOff = Boolean(user.liveOffStartedAt);
    if (transitionRecordedStatus(user, {
        voiceStatus: 'LIVE_OFF'
    }, now, 'voice-state', 'live-off')) changed = true;
    const session = getOpenSession(user);
    if (session) startSessionPeriod(session.liveOffPeriods, now, 'live-off');
    if (user.checkedIn) {
        if (createPendingClockOut(user, 'live_off', now, CONFIG.LIVE_OFF_CLOCK_OUT_MINS, '라이브 OFF 유예 시작')) changed = true;
    }
    if (!user.liveOffStartedAt) {
        user.liveOffStartedAt = now.toISOString();
        changed = true;
    }
    user.lastLiveOffAt = now.toISOString();
    if (!user.voiceJoinedAt) {
        user.voiceJoinedAt = now.toISOString();
        changed = true;
    }
    if (!wasLiveOff) user.liveOffWarnedFor = null;
    return changed;
}

function clearLiveOffState(user, now) {
    if (!user) return false;
    const session = getOpenSession(user);
    if (session) closeOpenSessionPeriod(session.liveOffPeriods, now);
    recoverPendingClockOut(user, now, 'live_on_recovered');
    const changed = Boolean(user.voiceJoinedAt || user.liveOffStartedAt || user.liveOffWarnedFor);
    transitionRecordedStatus(user, {
        voiceStatus: 'LIVE_ON'
    }, now, 'voice-state', 'live-on-recovered');
    user.voiceJoinedAt = null;
    user.liveOffStartedAt = null;
    user.liveOffWarnedFor = null;
    return changed;
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
    appendAttendanceEvent(user, 'finished_return_to_voice_detected', now, 'voice_snapshot', {
        action,
        result: 'finished_kept'
    });
    if (user.lastFinishedReturnPromptKey === key) return false;
    user.lastFinishedReturnPromptKey = key;

    await member.send([
        '🌿 Welcome back',
        '',
        'I can see that you returned to the voice channel, but your attendance is still FINISHED.',
        '',
        'To start counting work time again:',
        '1. Turn your live stream ON.',
        '2. Press the CLOCK IN button on the attendance panel.',
        '',
        'Live stream ON by itself will not restart attendance. 🙂'
    ].join('\n')).catch(() => null);
    return true;
}

async function normalizeCurrentShiftSession(member, user, shift, now) {
    if (!member || !user || !shift) return false;
    const sessionKey = getShiftSessionKey(shift, now);
    if (user.shiftSessionKey === sessionKey) return false;

    const previousShift = user.shift || null;
    const shiftChanged = Boolean(previousShift && previousShift !== shift);
    user.shiftSessionKey = sessionKey;
    user.shift = shift;
    user.status = null;
    user.strikeReceivedThisShift = false;
    user.disconnected = false;
    user.disconnectedAt = null;
    user.voiceJoinedAt = null;
    user.liveOffStartedAt = null;
    user.liveOffWarnedFor = null;
    user.lastLiveLogKey = null;
    overtimeUsers = overtimeUsers.filter(ot => ot.id !== member.id);
    const bounds = getShiftBounds(shift, now);
    const alreadyCheckedThisSession = Boolean(
        user.checkedIn &&
        user.checkInRaw &&
        moment(user.checkInRaw).tz(CONFIG.TIMEZONE).isSameOrAfter(bounds.start)
    );
    const alreadyFinishedThisSession = Boolean(
        user.isFinished &&
        !shiftChanged &&
        user.checkOutRaw &&
        moment(user.checkOutRaw).tz(CONFIG.TIMEZONE).isSameOrAfter(bounds.start)
    );
    const finishedBeforeCurrentSession = Boolean(
        user.isFinished &&
        user.checkOutRaw &&
        moment(user.checkOutRaw).tz(CONFIG.TIMEZONE).isBefore(bounds.start)
    );

    if (alreadyFinishedThisSession) {
        user.checkedIn = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        await updateWorkingRole(member, false);
        return true;
    }
    user.isFinished = false;
    if (finishedBeforeCurrentSession || user.attendanceStatus === 'FINISHED') {
        transitionRecordedStatus(user, {
            attendanceStatus: 'PRE_SHIFT',
            voiceStatus: member.voice?.channelId ? (member.voice?.streaming ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE'
        }, now, 'shift-normalize', 'previous-finished-reset-for-new-shift');
        user.finishedPresence = null;
        user.finalLeftAt = null;
    }

    if (user.dayOff) {
        user.checkedIn = false;
        await updateWorkingRole(member, false);
        return true;
    }

    if (member.voice?.streaming) {
        if (alreadyCheckedThisSession) {
            user.checkedIn = true;
            user.isFinished = false;
            user.lastLiveLogKey = getShiftSessionKey(shift, now);
            await updateWorkingRole(member, true);
        } else {
            await handleClockIn(member, user, shift, now, true);
        }
    } else {
        if (alreadyCheckedThisSession) {
            user.checkedIn = true;
            user.isFinished = false;
            if (member.voice?.channelId && !user.voiceJoinedAt) {
                user.voiceJoinedAt = now.toISOString();
            }
            await updateWorkingRole(member, true);
        } else {
            user.checkedIn = false;
            await updateWorkingRole(member, false);
        }
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
        logChan.send(`\`[${timestamp}]\` ${shiftIcon} 👤 **${user.name}** → ${aIcon} ${baseTxt}`)
            .catch(e => console.error('[LOG SEND ERROR]', e));
    }
}

async function handleClockIn(member, user, shift, now, isAuto = false) {
    const u = ensureUserData(member, shift) || user;
    const clockInRule = getRecognizedClockInMoment(shift, now);
    appendAttendanceEvent(u, 'clock_in_attempt', now, isAuto ? 'live_on' : 'button_or_command', { shift });
    if (!clockInRule.ok) {
        u.shift = shift;
        u.preShiftLiveAt = now.toISOString();
        u.isFinished = false;
        u.dayOff = false;
        u.disconnected = false;
        u.disconnectedAt = null;
        const waitLogKey = `${shift}:${clockInRule.bounds.start.format('YYYY-MM-DD HH:mm')}:too-early`;
        if (u.lastPreShiftWaitLogKey !== waitLogKey) {
            u.lastPreShiftWaitLogKey = waitLogKey;
            await recordLog(u, 'reconnect', `사전 대기 감지 (${clockInRule.bounds.start.format('HH:mm')} 출근 시작 전)`);
        }
        return false;
    }
    const recognizedAt = clockInRule.recognizedAt;
    overtimeUsers = overtimeUsers.filter(o => o.id !== member.id);
    u.checkedIn = true;
    u.dayOff = false;
    u.dayOffExpireAt = null;
    u.isFinished = false;
    transitionRecordedStatus(u, {
        attendanceStatus: 'WORKING',
        voiceStatus: 'LIVE_ON'
    }, recognizedAt, isAuto ? 'live-on' : 'button-or-command', clockInRule.preShift ? 'pre-shift-clock-in' : 'clock-in');
    u.finishedPresence = null;
    u.finalLeftAt = null;
    u.earlyOut = false;
    u.disconnected = false;
    u.disconnectedAt = null;
    u.liveOffStartedAt = null;
    u.pendingClockOut = null;
    u.manualResumeRequired = false;
    u.manualResumeRequiredSince = null;
    u.manualResumeRequiredReason = null;
    u.preShiftLiveAt = clockInRule.preShift ? now.toISOString() : null;
    u.lastPreShiftWaitLogKey = null;
    u.lastLiveOnAt = now.toISOString();
    u.shift = shift;
    u.checkInTime = recognizedAt.format('hh:mm A');
    u.checkInRaw = recognizedAt.toISOString();
    const session = startAttendanceSession(u, shift, recognizedAt, clockInRule.preShift ? 'pre-shift-live' : (isAuto ? 'live-on' : 'button-or-command'));
    if (session) {
        session.clockInDetectedAt = now.toISOString();
        if (clockInRule.preShift) session.firstLiveOnAt = now.toISOString();
    }
    appendAttendanceEvent(u, 'clock_in_confirmed', recognizedAt, isAuto ? 'live_on' : 'button_or_command', {
        detectedAt: now.toISOString(),
        preShift: clockInRule.preShift
    });

    if (shift) {
        const diffMins = recognizedAt.diff(getShiftBounds(shift, recognizedAt).start, 'minutes');
        if (diffMins > 120) {
            u.status = 'absent';
            if (!u.strikeReceivedThisShift) {
                u.strikes = (u.strikes || 0) + 1;
                u.points = (u.points || 0) + CONFIG.POINTS.ABSENT;
                u.totalAbsent = (u.totalAbsent || 0) + 1;
                u.strikeReceivedThisShift = true;
            }
        } else if (diffMins > 5) {
            u.status = 'late';
            if (!u.strikeReceivedThisShift) {
                u.strikes = (u.strikes || 0) + 1;
                u.points = (u.points || 0) + CONFIG.POINTS.LATE;
                u.totalLate = (u.totalLate || 0) + 1;
                u.strikeReceivedThisShift = true;
            }
        } else {
            u.status = 'ontime';
            u.points = (u.points || 0) + CONFIG.POINTS.NORMAL_IN;
            u.totalNormal = (u.totalNormal || 0) + 1;
        }
    }

    await updateWorkingRole(member, true);
    if (isAuto) {
        u.lastLiveLogKey = getShiftSessionKey(shift, recognizedAt);
        const statusText = u.status === 'late' ? '지각' : (u.status === 'absent' ? '초과 시간 지각' : '정상');
        const preText = clockInRule.preShift ? `사전 라이브 대기 ${now.format('HH:mm')} / 인정 출근 ${recognizedAt.format('HH:mm')}` : `디스코드 자동 출근 (${statusText})`;
        await recordLog(u, 'in', preText, null, { effectiveTime: recognizedAt });
    } else {
        await recordLog(u, 'in', clockInRule.preShift ? `사전 출근 대기 / 인정 출근 ${recognizedAt.format('HH:mm')}` : null, null, { effectiveTime: recognizedAt });
    }
    return true;
}

async function handleClockOut(member, user, now, customLogText = null, earlyOverrideTime = null, options = {}) {
    const memberId = member?.id || member;
    if (!user) return;
    if (!user.checkedIn && !user.disconnected) return;
    const outMoment = options.effectiveTime ? moment(options.effectiveTime).tz(CONFIG.TIMEZONE) : now;
    const detectedAt = options.detectedAt ? moment(options.detectedAt).tz(CONFIG.TIMEZONE) : now;

    user.checkedIn = false;
    user.isFinished = true;
    transitionRecordedStatus(user, {
        attendanceStatus: 'FINISHED',
        voiceStatus: member?.voice?.channelId ? (member.voice?.streaming ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE'
    }, outMoment, options.clockOutSource || 'clock-out', customLogText || 'clock-out');
    user.disconnected = false;
    user.disconnectedAt = null;
    user.voiceJoinedAt = null;
    user.liveOffStartedAt = null;
    user.liveOffWarnedFor = null;
    user.pendingClockOut = null;
    user.checkOutTime = outMoment.format('hh:mm A');
    user.checkOutRaw = outMoment.toISOString();
    user.lastClockOutSource = options.clockOutSource || 'clock-out';
    user.lastClockOutReason = customLogText || null;
    user.lastClockOutDetectedAt = detectedAt.toISOString();
    const reversibleEarlyPenaltyKey = ['dc-timeout', 'live-off-timeout'].includes(options.clockOutSource)
        ? `${options.clockOutSource}:${outMoment.toISOString()}`
        : null;
    setFinishedPresence(user, member?.voice?.channelId ? 'in_voice' : 'left_voice', outMoment, options.clockOutSource || 'clock-out');
    finishAttendanceSession(user, outMoment, options.clockOutSource || 'clock-out', customLogText, detectedAt);
    appendAttendanceEvent(user, 'clock_out_confirmed', outMoment, options.clockOutSource || 'clock-out', {
        detectedAt: detectedAt.toISOString(),
        reason: customLogText || null
    });
    overtimeUsers = overtimeUsers.filter(o => o.id !== memberId);
    await updateWorkingRole(member, false);
    await recordLog(user, 'out', customLogText, earlyOverrideTime || outMoment, { ...options, reversibleEarlyPenaltyKey, effectiveTime: outMoment });
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
    const fixN = (u) => padWidth(truncateWidth(getDashboardName(u), 16), 17);
    const fixT = (t) => padWidth(String(t || '00:00').replace(/\s?[AP]M$/i, '').trim(), 6);
    let lines = "```\n";
    for (const user of sorted) {
        lines += `${icon} ${fixT(user.checkInTime)} ${fixN(user)}\n`;
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

function renderSummaryBox(rows) {
    return `\`\`\`text\n${rows.map(([label, value]) => `${label} ${value}`).join('\n')}\n\`\`\``;
}

function renderOvertimeList(now, source = overtimeUsers) {
    if (!source.length) return 'NONE';
    const lines = source
        .map(ot => {
            const u = attendanceData[ot.id] || ot;
            const name = padWidth(truncateWidth(getDashboardName(u), 16), 17);
            const otStartedAt = ot.startedAt || u.otStartedAt || u.checkInRaw;
            const mins = otStartedAt ? now.diff(moment(otStartedAt).tz(CONFIG.TIMEZONE), 'minutes') : 0;
            const typeLabel = ot.type === 'MANUAL' ? 'M-OT' : ot.type === 'AUTO' ? 'A-OT' : 'OT';
            return `${padWidth(typeLabel, 5)} ${name} ${mins > 0 ? formatDuration(mins) : ''}`;
        })
        .sort();
    return `\`\`\`\n${lines.join('\n')}\n\`\`\``;
}

function getLegacyDashboardState(user, context) {
    const {
        isVoiceLiveOff,
        isPreShift,
        isStreaming,
        isVoiceConnected,
        hasLiveOffVoice,
        liveException,
        bounds,
        now
    } = context;

    if (user.dayOff) return 'LEAVE';
    if (user.isFinished) return 'FINISHED';
    if (isVoiceLiveOff && !isPreShift && user.checkedIn) return 'LIVE_OFF';
    if (user.disconnected) return 'DISCONNECTED';
    if (liveException) return 'LIVE_EXCEPTION';
    if (user.checkedIn && !isStreaming) return 'LIVE_OFF';
    if ((hasLiveOffVoice || (isVoiceConnected && !isStreaming)) && user.checkedIn) return isPreShift ? 'WAITING' : 'LIVE_OFF';
    if (user.checkedIn) return user.status === 'late' ? 'LATE' : 'ACTIVE';
    return now.isAfter(bounds.start) && now.diff(bounds.start, 'minutes') > 120 ? 'ABSENT' : 'WAITING';
}

// ✨ [업데이트] 정규 퇴근 시간이 지났고 연장 근무(OT)가 아니면 FINISHED 처리
function getHybridDashboardState(user, context) {
    const legacy = getLegacyDashboardState(user, context);
    const attendanceStatus = user.attendanceStatus || null;
    const voiceStatus = user.voiceStatus || null;
    const { now, bounds } = context;

    // ✨ [핵심 수정] 봇의 현재 시간이 아닌, '유저의 실제 출근 시간'을 기준으로 퇴근 시점을 정확히 계산합니다.
    const shiftEnd = getScheduledEndMoment(user, now);
    const isShiftEnded = shiftEnd && now.isSameOrAfter(shiftEnd);
    const isWithinCurrentShiftBounds = Boolean(
        bounds?.start &&
        bounds?.end &&
        now.isSameOrAfter(bounds.start) &&
        now.isBefore(bounds.end)
    );
    const isOT = overtimeUsers.some(ot => ot.id === user.id);
    const finishedAt = user.checkOutRaw || user.attendanceStatusChangedAt || null;
    const finishedVisibleExpired = Boolean(
        user.isFinished &&
        finishedAt &&
        now.diff(moment(finishedAt).tz(CONFIG.TIMEZONE), 'minutes') > CONFIG.FINISHED_VISIBLE_AFTER_MINS
    );

    if (!attendanceStatus && !voiceStatus) return legacy;
    if (user.dayOff || attendanceStatus === 'DAY_OFF') return 'LEAVE';
    if (finishedVisibleExpired && isWithinCurrentShiftBounds && !user.checkedIn && !isOT) return 'WAITING';
    if (attendanceStatus === 'FINISHED' || user.isFinished) return 'FINISHED';

    if (isShiftEnded && !isWithinCurrentShiftBounds && !isOT && user.checkedIn) {
        return 'FINISHED';
    }

    if (voiceStatus === 'EXCEPTION' || context.liveException) return 'LIVE_EXCEPTION';
    if (voiceStatus === 'DISCONNECTED' || user.disconnected) return 'DISCONNECTED';

    if (attendanceStatus === 'OVERTIME' || attendanceStatus === 'WORKING') {
        if (voiceStatus === 'LIVE_OFF') return 'LIVE_OFF';
        if (voiceStatus === 'LIVE_ON') return user.status === 'late' ? 'LATE' : 'ACTIVE';
        if (voiceStatus === 'OFFLINE') return user.checkedIn ? legacy : 'WAITING';
    }

    if (attendanceStatus === 'PRE_SHIFT') return 'WAITING';
    return legacy;
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

function renderReportMetricRow(user) {
    const points = String(safeNumber(user.points)).padStart(4);
    const name = getReportName(user, 14);
    const stats = getReportStatsColumns(user);
    const dc = String(safeNumber(user.dcCount)).padStart(2);
    return `${points} | ${name} | ${stats} | ${dc}`;
}

function renderReportTopRow(user, index) {
    const rank = String(index + 1).padStart(2, '0');
    const name = getReportName(user, 14);
    const points = String(safeNumber(user.points)).padStart(4);
    return `${rank} ${name} ${points} pts | ${getReportStatsColumns(user)}`;
}

function renderSessionMetricRow(user, now = moment().tz(CONFIG.TIMEZONE)) {
    const summary = getUserLatestSessionSummary(user, now);
    const name = getReportName(user, 14);
    if (!summary) return `${name} | no session data`;
    const session = summary.session;
    const state = session.clockOutAt ? 'CLOSED' : 'OPEN  ';
    return [
        name,
        state,
        `credit ${formatDuration(summary.creditedMinutes)}`,
        `gross ${formatDuration(summary.grossMinutes)}`,
        `off ${formatDuration(summary.liveOffMinutes)}`,
        `dc ${formatDuration(summary.dcMinutes)}`
    ].join(' | ');
}

function renderPercentBar(percent, size = 10) {
    const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
    const filled = Math.round((safePercent / 100) * size);
    return `[${'#'.repeat(filled)}${'.'.repeat(size - filled)}] ${String(safePercent).padStart(3)}%`;
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
        }
        const dashboardNameCounts = new Map();
        for (const member of currentShiftMembers.values()) {
            const baseName = (member.displayName || member.user?.username || 'Unknown').split('-')[0].trim() || 'Unknown';
            const key = baseName.toLowerCase();
            dashboardNameCounts.set(key, (dashboardNameCounts.get(key) || 0) + 1);
        }
        const overtimeBeforeCleanup = overtimeUsers.length;
        overtimeUsers = overtimeUsers.filter(ot => {
            if (!currentRoleMemberIds.has(ot.id)) return true;
            const user = attendanceData[ot.id];
            const member = guild.members.cache.get(ot.id);
            if (!user || !member || user.dayOff) return false;
            const bounds = getShiftBounds(activeDisplayShift, now);
            const isMainShiftTime = now.isBetween(bounds.start, bounds.end, null, '[]');
            if (ot.type === 'MANUAL' && isMainShiftTime) {
                user.pendingManualOT = true;
                return false;
            }
            if (ot.type === 'MANUAL') return true;
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
                (!isCurrentShiftMember || ot.type === 'MANUAL') &&
                (isStreamingNow || hasLiveException)
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
                u.isOT = dashboardOvertimeIds.has(m.id);
                return u;
            });

        const active = users.filter(u => ['ACTIVE', 'LATE'].includes(u.fState) && !u.isOT);
        const liveExceptionUsers = users.filter(u => u.fState === 'LIVE_EXCEPTION' && !u.isOT);
        const disconnected = users.filter(u => u.fState === 'DISCONNECTED');
        const finished = users.filter(u => u.fState === 'FINISHED' && !u.isOT);
        const liveOff = users.filter(u => u.fState === 'LIVE_OFF');
        const standby = users.filter(u => u.fState === 'WAITING' && !u.isOT);
        const absent = users.filter(u => u.fState === 'ABSENT' && !u.isOT);
        const leave = users.filter(u => u.fState === 'LEAVE');

        const totalUsers = users.length;

        const embed = new EmbedBuilder()
            .setColor(embedColor)
            .setTitle('🖥️ INTEGRATED OPS CONTROL CENTER')
            .setDescription(dashboardMaintenance
                ? `> # ⏱️ PH TIME: **${now.format('hh:mm:ss A')}**\n> ## [ MAINTENANCE - WORK CLOSED ]`
                : `> # ⏱️ PH TIME: **${now.format('hh:mm:ss A')}**\n> ## [ LIVE MONITORING ]`);

     
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
            ['OT', dashboardOvertimeUsers.length],
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
            { name: `⚪ FINISHED (${finished.length}명)`, value: renderStatusList(finished, '⚪', now, 'finished'), inline: false },
            { name: `🔵 DAY OFF (${leave.length}명)`, value: renderStatusList(leave, '🔵', now), inline: false }
        );

        embed.addFields({
            name: `🔥 OVERTIME (${dashboardOvertimeUsers.length}명)`,
            value: renderOvertimeList(now, dashboardOvertimeUsers),
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
    const canResumeFromAutoTimeout = Boolean(
        isStreaming &&
        user.isFinished &&
        !user.checkedIn &&
        isAutoTimeoutClockOut &&
        isBeforeScheduledEnd &&
        autoTimeoutResumeMins !== null &&
        autoTimeoutResumeMins <= CONFIG.AUTO_TIMEOUT_RESUME_WINDOW_MINS &&
        !user.manualResumeRequired &&
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
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.lastLiveOnAt = now.toISOString();
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus: 'LIVE_ON'
        }, now, source, 'auto-timeout-resumed-live-on');
        startAttendanceSession(user, shift, now, 'auto-timeout-resume');
        await updateWorkingRole(member, true);
        await recordLog(user, 'reconnect', '자동 조기퇴근 후 라이브 복구 (근무 재개)');
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
        !overtimeUsers.some(ot => ot.id === member.id)
    );
    if (shouldPromptManualResume) {
        const promptKey = `${lastClockOutSource}:${lastClockOutAt}:manual-resume-required`;
        user.manualResumeRequired = true;
        user.manualResumeRequiredSince = now.toISOString();
        user.manualResumeRequiredReason = lastClockOutSource;
        if (user.lastManualResumePromptKey !== promptKey) {
            user.lastManualResumePromptKey = promptKey;
            appendAttendanceEvent(user, 'manual_resume_required', now, source, {
                clockOutSource: lastClockOutSource,
                clockOutAt: lastClockOutAt,
                minutesSinceClockOut: autoTimeoutResumeMins
            });
            await member.send([
                'IMPORTANT: Your attendance is NOT active right now.',
                '',
                'Your previous attendance was already closed because the DC/LIVE OFF grace period was exceeded.',
                '',
                'Since more than 60 minutes have passed, the bot will not resume your shift automatically.',
                '',
                'You MUST press the CLOCK IN button on the attendance panel while your live stream is ON.',
                'If you do not press CLOCK IN, your attendance will NOT be counted.',
                '',
                'If this was a mistake, please contact an admin.'
            ].join('\n')).catch(() => null);
            await recordLog(user, 'reconnect', '자동 조기퇴근 후 60분 초과 복귀 감지 (CLOCK IN 버튼 필요)');
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
        if (user.checkedIn && !user.isFinished && !getActiveLiveException(member.id, now)) {
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
            const warnKey = `${shift}:${liveOffAt ? moment(liveOffAt).format('YYYY-MM-DD HH:mm') : now.format('YYYY-MM-DD HH:mm')}`;
            const pendingLiveOffClockOutAt = user.pendingClockOut?.source === 'live_off' && user.pendingClockOut.expiresAt
                ? moment(user.pendingClockOut.expiresAt).tz(CONFIG.TIMEZONE)
                : (liveOffAt ? moment(liveOffAt).tz(CONFIG.TIMEZONE).add(CONFIG.LIVE_OFF_CLOCK_OUT_MINS, 'minutes') : null);
            const isLiveOffClockOutDue = Boolean(pendingLiveOffClockOutAt && now.isSameOrAfter(pendingLiveOffClockOutAt));
            if (started) {
                await recordLog(user, 'disconnect', stoppedStreaming ? '라이브 OFF 시작 - 방송 종료' : '라이브 OFF 시작 - 음성채널 접속 상태');
                changed = true;
            }
            if (!isLiveOffClockOutDue && liveOffMins >= CONFIG.LIVE_OFF_DM_AFTER_MINS && user.liveOffWarnedFor !== warnKey) {
                await member.send([
                    '🌿 Gentle reminder',
                    '',
                    'You are in the voice channel, but your live stream appears to be OFF.',
                    'When you are ready, please turn your live stream back on so your work time can keep counting.',
                    '',
                    `If it stays off for about ${CONFIG.LIVE_OFF_CLOCK_OUT_MINS} minutes, the bot may clock you out automatically.`,
                    'Thank you. 🙂'
                ].join('\n')).catch(() => null);
                user.liveOffWarnedFor = warnKey;
                changed = true;
            }
        } else if (!user.checkedIn && isWithinPreShiftWindow(shift, now)) {
            if (!user.voiceJoinedAt) {
                user.voiceJoinedAt = now.toISOString();
                changed = true;
            }
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
    const clockLine = [
        '```ansi',
        `\u001b[1;37m⏱️ PH TIME: ${now.format('hh:mm:ss A')}\u001b[0m   \u001b[1;36m[ LIVE MONITORING ]\u001b[0m`,
        '```'
    ].join('\n');
    const regularDays = padWidth('MON / WED - SUN', 15);
    const tueUpdate = padWidth('TUE (UPDATE)', 15);
    const workingHours = isDay
        ? `📅 ${regularDays}: 09:00 AM - 09:00 PM (12h)\n🚨 ${tueUpdate}: 09:00 AM - 07:00 PM (10h)`
        : `📅 ${regularDays}: 09:00 PM - 09:00 AM (12h)\n🚨 ${tueUpdate}: 07:00 PM - 04:00 AM (9h)`;
    const tueNote = isDay ? 'Early Out.' : 'Early Start & Out.';
    const rules = '> ⛔ **NO-SHOW** : **IMMEDIATE FIRE**\n> ❌ **ABSENCE** : **TERMINATED IMMEDIATELY**\n> ⏳ **LATE 2H** : **TREATED AS NO-SHOW**\n\n⚠️ **2 WARNINGS** = **INSTANT KICK**\n🛑 **Absence/Tardiness 2 times** = **DISMISSAL**';
    const buttonGuide = [
        '🟢 **IN**: Start shift',
        '🔴 **OUT**: End shift',
        '🔵 **OFF**: Approved leave',
        '🔥 **OT**: Extra hours'
    ].join('\n');

    return new EmbedBuilder()
        .setTitle(isDay ? '☀️ ELITE DAY SHIFT PROTOCOL' : '🌙 ELITE NIGHT SHIFT PROTOCOL')
        .setDescription(`${clockLine}\n\n--------------------------------\n### ⏰ WORKING HOURS\n\`\`\`yaml\n${workingHours}\n\`\`\`\n> ⚠️ **TUE Note**: ${tueNote}\n--------------------------------\n### 🚨 OPERATIONAL RULES\n${rules}\n\n⏳ **STRICT PUNCTUALITY**\n📢 Be ready **BEFORE** the shift starts.\n--------------------------------\n### 💡 BUTTON INSTRUCTIONS\n${buttonGuide}`)
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
        const allStats = Object.values(attendanceData).filter(u => guild.members.cache.has(u.id));

        if (type === 'Analysis') {
            let content = '```\n[PTS] [Normal/Late/Absent/Early/OT/Off] [DC] | Name\n';
            const sorted = allStats.sort((a, b) => (b.points || 0) - (a.points || 0));
            sorted.forEach(u => {
                const stats = `${u.totalNormal || 0}/${u.totalLate || 0}/${u.totalAbsent || 0}/${u.totalEarly || 0}/${u.totalOT || 0}/${u.offCount || 0}`;
                content += `${padWidth((u.points || 0).toString(), 5)} ${padWidth(stats, 18)} ${padWidth((u.dcCount || 0).toString(), 4)} | ${u.name?.split('-')[0] || 'Unknown'}\n`;
            });
            embed.addFields({ name: '전체 인원 지표', value: content + '```' });
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
        const allStats = Object.values(attendanceData).filter(u => guild.members.cache.has(u.id));

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
            const otRate = Math.round((overtimeUsers.length / workBase) * 100) || 0;
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
                makeRateRow('OT 비율', otRate, overtimeUsers.length, workBase)
            ].join('\n\n');

            embed.addFields(
                { name: `📊 ${shiftNameText} Snapshot`, value: `TOTAL ${allStats.length} | WORK BASE ${workBase} | ACTIVE ${activeUsers.length} | FINISHED ${finishedUsers.length} | ABSENT ${absentUsers.length} | STANDBY ${standbyUsers.length} | OFF ${offUsers.length} | OT ${overtimeUsers.length} | DC ${disconnectedUsers.length}`, inline: false },
                { name: `📈 Daily Rates`, value: `\`\`\`\n${rateBlock}\n\`\`\``, inline: false },
                { name: `🟢 Active (${activeUsers.length})`, value: `\`\`\`\n${listNames(activeUsers)}\n\`\`\``, inline: false },
                { name: `⚪ Finished (${finishedUsers.length})`, value: `\`\`\`\n${listNames(finishedUsers)}\n\`\`\``, inline: false },
                { name: `❌ Absent (${absentUsers.length})`, value: `\`\`\`\n${listNames(absentUsers)}\n\`\`\``, inline: false },
                { name: `🟡 Standby (${standbyUsers.length})`, value: `\`\`\`\n${listNames(standbyUsers)}\n\`\`\``, inline: false },
                { name: `🔵 Day Off (${offUsers.length})`, value: `\`\`\`\n${listNames(offUsers)}\n\`\`\``, inline: false },
                { name: `⚡ Disconnected (${disconnectedUsers.length})`, value: `\`\`\`\n${listNames(disconnectedUsers)}\n\`\`\``, inline: false },
                { name: `🔥 Overtime (${overtimeUsers.length})`, value: `\`\`\`\n${overtimeUsers.map(ot => attendanceData[ot.id] || ot).map(u => formatExactWidth(u.name || 'Unknown', 16)).join('\n') || 'NONE'}\n\`\`\``, inline: false }
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
        const top = sorted.slice(0, 5).map((u, idx) => renderReportTopRow(u, idx)).join('\n') || 'No data.';
        const metrics = sorted.slice(0, 20).map(renderReportMetricRow).join('\n') || 'No data.';
        const sessionMetrics = sorted
            .filter(u => Array.isArray(u.sessions) && u.sessions.length > 0)
            .slice(0, 15)
            .map(u => renderSessionMetricRow(u, now))
            .join('\n') || 'No session data.';

        embed.addFields(
            { name: `${shiftNameText} Snapshot`, value: `TOTAL ${allStats.length} | ACTIVE ${active.length} | STANDBY ${standby.length} | ABSENT ${absent.length} | OFF ${off.length} | OT ${overtimeUsers.length} | DC ${disconnected.length}`, inline: false },
            { name: 'Attention', value: `\`\`\`\n${attention}\n\`\`\``, inline: false },
            { name: 'Target Top 5', value: `\`\`\`\n${top}\n\`\`\``, inline: false },
            { name: 'Session Credited Time', value: `\`\`\`\n${sessionMetrics}\n\`\`\``, inline: false },
            { name: 'Full Metrics', value: `\`\`\`\n PTS | Name              |  정  지  결  조  연  휴 | DC\n${metrics}\n\`\`\``, inline: false }
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

function buildRankingEmbed() {
    const sorted = Object.values(attendanceData)
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, 20);
    const lines = sorted.length
        ? sorted.map((u, idx) => {
            const name = truncateWidth((u.name || 'Unknown').split('-')[0].trim(), 18);
            const stats = `${u.totalNormal || 0}/${u.totalLate || 0}/${u.totalAbsent || 0}/${u.totalEarly || 0}/${u.totalOT || 0}/${u.offCount || 0}`;
            return `${String(idx + 1).padStart(2, '0')}. ${padWidth(name, 20)} ${String(u.points || 0).padStart(5)} pts  [${stats}]`;
        }).join('\n')
        : 'No attendance data.';

    return new EmbedBuilder()
        .setTitle('Live Attendance Ranking')
        .setDescription(`\`\`\`\n${lines}\n\`\`\``)
        .setColor('#F1C40F')
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
        }).join('\n')
        : 'No inactive kick candidates.';

    return new EmbedBuilder()
        .setTitle('Inactive Kick Candidate Report')
        .setColor(candidates.length ? '#E67E22' : '#2ECC71')
        .setDescription(`기준: 마지막 관찰 활동 ${thresholdDays}일 이상 없음\n주의: 아직 자동 추방하지 않고 후보만 표시합니다.`)
        .addFields({ name: `Candidates (${candidates.length})`, value: `\`\`\`\n${rows}\n\`\`\``, inline: false })
        .setFooter({ text: 'Activity sources: message | voice_state | command | button | joined' })
        .setTimestamp();
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

        const guestNick = `${member.id} - Guest`.slice(0, 32);
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

function buildGuestNickname(displayName) {
    const suffix = ' - Guest';
    const base = String(displayName || 'Guest')
        .replace(/\s+-\s+Guest$/i, '')
        .trim() || 'Guest';
    return `${base.slice(0, 32 - suffix.length)}${suffix}`;
}

async function syncManualGuestNickname(oldMember, newMember) {
    if (!CONFIG.ROLES.GUEST || !oldMember || !newMember || newMember.user?.bot) return false;
    const hadGuest = oldMember.roles?.cache?.has(CONFIG.ROLES.GUEST);
    const hasGuest = newMember.roles?.cache?.has(CONFIG.ROLES.GUEST);
    if (hadGuest || !hasGuest) return false;

    const guestNick = buildGuestNickname(newMember.displayName || newMember.user?.username);
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

function getWorkerNicknameBase(displayName) {
    return String(displayName || 'Unknown')
        .replace(/\s*-\s*[PH]\s*(?:Day|Night)\s*Time\s*$/i, '')
        .replace(/\s*-\s*(?:Heine|Paagrio)\s*(?:Day|Night)\s*Time\s*$/i, '')
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
    const match = name.match(/\s-\s*([PH])\s*(Day|Night)\s*Time\s*$/i);
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

async function canManageMemberNickname(member) {
    const me = member?.guild?.members?.me || await member?.guild?.members?.fetchMe().catch(() => null);
    if (me && me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
        console.warn(`[NICK ROLE SYNC WARN] Cannot update nickname for ${member.displayName}. Role hierarchy too low.`);
        return false;
    }
    return true;
}

async function syncNicknameFromAssignedRoles(oldMember, newMember) {
    const oldProfile = getWorkerRoleProfileFromMember(oldMember);
    const newProfile = getWorkerRoleProfileFromMember(newMember);
    if (!newProfile) return false;
    const roleProfileChanged = !oldProfile ||
        oldProfile.server !== newProfile.server ||
        oldProfile.shift !== newProfile.shift;
    if (!roleProfileChanged) return false;

    const targetNick = buildWorkerNickname(newMember.displayName || newMember.user?.username, newProfile);
    if (newMember.displayName === targetNick) return false;
    if (!await canManageMemberNickname(newMember)) return false;

    await newMember.setNickname(targetNick, 'Worker roles manually assigned').catch(e => {
        console.error('[WORKER ROLE NICK ERROR]', e);
    });
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
    const profile = getWorkerRoleProfileFromNickname(newMember.displayName);
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
    if (!user) return 'UNKNOWN';
    if (user.dayOff) return 'DAY_OFF';
    if (overtimeUsers.some(ot => ot.id === user.id)) return 'OVERTIME';
    if (user.checkedIn || user.disconnected) return 'WORKING';
    if (user.isFinished) return 'FINISHED';
    if (user.shift) return 'PRE_SHIFT';
    return 'UNKNOWN';
}

function deriveVoiceStatusForAudit(member, user, now = moment().tz(CONFIG.TIMEZONE)) {
    if (!user) return 'UNKNOWN';
    if (getActiveLiveException(user.id, now)) return 'EXCEPTION';
    if (user.disconnected) return 'DISCONNECTED';
    const voiceState = member?.guild?.voiceStates?.cache?.get(user.id);
    const isConnected = Boolean(member?.voice?.channelId || voiceState?.channelId);
    const isStreaming = Boolean(member?.voice?.streaming || voiceState?.streaming);
    if (isStreaming) return 'LIVE_ON';
    if (isConnected) return 'LIVE_OFF';
    return 'OFFLINE';
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
    const statusChannel = await client.channels.fetch(CONFIG.STATUS_CHANNEL).catch(() => null);
    const logChannel = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    const dayOffChannel = await client.channels.fetch(CONFIG.DAYOFF_CHANNEL).catch(() => null);
    const workingRole = guild?.roles?.cache?.get(CONFIG.ROLES.WORKING);
    const botHighest = me?.roles?.highest;
    const canManageWorking = Boolean(workingRole && botHighest && botHighest.comparePositionTo(workingRole) > 0);
    const dayOffPerms = dayOffChannel && me ? dayOffChannel.permissionsFor(me) : null;
    const guildManageMessages = Boolean(me?.permissions?.has(PermissionFlagsBits.ManageMessages));
    const guildAddReactions = Boolean(me?.permissions?.has(PermissionFlagsBits.AddReactions));
    const dayOffManageMessages = Boolean(dayOffPerms?.has(PermissionFlagsBits.ManageMessages));
    const dayOffAddReactions = Boolean(dayOffPerms?.has(PermissionFlagsBits.AddReactions));
    const healthy = canManageWorking && dayOffManageMessages && dayOffAddReactions;
    const rows = [
        `Bot member: ${me ? 'OK' : 'MISSING'}`,
        `Status channel: ${statusChannel ? 'OK' : 'MISSING'}`,
        `Log channel: ${logChannel ? 'OK' : 'MISSING'}`,
        `Day Off channel: ${dayOffChannel ? 'OK' : 'MISSING'}`,
        `WORKING role: ${workingRole ? 'OK' : 'MISSING'}`,
        `Can manage WORKING: ${canManageWorking ? 'OK' : 'NO'}`,
        `Guild Manage Messages: ${guildManageMessages ? 'OK' : 'NO'}`,
        `Guild Add Reactions: ${guildAddReactions ? 'OK' : 'NO'}`,
        `Day Off Manage Messages: ${dayOffManageMessages ? 'OK' : 'NO'}`,
        `Day Off Add Reactions: ${dayOffAddReactions ? 'OK' : 'NO'}`
    ];
    return new EmbedBuilder()
        .setTitle('Permission Check')
        .setColor(healthy ? '#2ECC71' : '#E67E22')
        .setDescription(`\`\`\`\n${rows.join('\n')}\n\`\`\``)
        .setTimestamp();
}

async function buildDayOffLogEmbed(limit = 10) {
    let rows = [];
    try {
        const raw = await fs.readFile(CONFIG.FILES.DAYOFF_LOG, 'utf8');
        rows = raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit);
    } catch {
        rows = [];
    }
    const text = rows.length ? rows.join('\n') : 'No day off audit log found.';
    return new EmbedBuilder()
        .setTitle('Day Off Audit Log')
        .setColor('#3B82F6')
        .setDescription(`\`\`\`json\n${truncateWidth(text, 3800)}\n\`\`\``)
        .setTimestamp();
}

function formatAnnouncementList() {
    return Object.entries(announceData)
        .map(([slot, d]) => {
            if (!d) return `Slot ${slot}: empty`;
            const state = d.active ? 'ON' : 'OFF';
            const role = d.roleId ? ` role=<@&${d.roleId}>` : '';
            const content = truncateWidth(d.content || '', 55);
            return `Slot ${slot}: ${state} ${d.time || '--:--'}${role} - ${content}`;
        })
        .join('\n');
}

function applyManualAdjustment(user, field, value) {
    const numericFields = {
        points: 'points',
        normal: 'totalNormal',
        late: 'totalLate',
        absent: 'totalAbsent',
        early: 'totalEarly',
        ot: 'totalOT',
        off: 'offCount',
        dc: 'dcCount',
        strikes: 'strikes'
    };
    const booleanFields = {
        'checked-in': 'checkedIn',
        'day-off': 'dayOff',
        disconnected: 'disconnected',
        finished: 'isFinished'
    };

    if (numericFields[field]) {
        const amount = Number(value);
        if (!Number.isFinite(amount)) return false;
        user[numericFields[field]] = amount;
        return true;
    }
    if (booleanFields[field]) {
        if (!['true', 'false'].includes(String(value).toLowerCase())) return false;
        user[booleanFields[field]] = String(value).toLowerCase() === 'true';
        return true;
    }
    if (field === 'status') {
        if (!['ontime', 'late', 'absent', 'none'].includes(value)) return false;
        user.status = value === 'none' ? null : value;
        return true;
    }
    if (field === 'shift') {
        if (!['day', 'night'].includes(value)) return false;
        user.shift = value;
        return true;
    }
    return false;
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
    renderDashboardCore();
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
            await handleClockOut(
                m || { id },
                u,
                now,
                liveOffTimeoutText,
                effectiveOut,
                { effectiveTime: effectiveOut, detectedAt: now, forceIcon: '🔴', clockOutSource: 'live-off-timeout' }
            );
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
            await handleClockOut(m || { id }, u, now, customMsg, effectiveDcOut, {
                effectiveTime: effectiveDcOut,
                detectedAt: now,
                forceIcon: '🔴',
                clockOutSource: 'dc-timeout'
            });
            if (m?.send) {
                await m.send([
                    '🌿 Quick update',
                    '',
                    `You were disconnected for about ${CONFIG.GRACE_PERIOD_MINS} minutes, so the bot has clocked you out automatically.`,
                    '',
                    'If you come back after this, please follow these steps:',
                    '1. Join the voice channel again.',
                    '2. Turn your live stream ON.',
                    '3. Press the CLOCK IN button on the attendance panel.',
                    '',
                    'Important: live stream ON by itself will NOT restart attendance. You must press CLOCK IN again.',
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

async function grantLiveException(targetMember, hours, reason, approverMember) {
    const now = moment().tz(CONFIG.TIMEZONE);
    const shift = determineShift(targetMember);
    if (!shift) return { ok: false, message: '대상에게 DAY/NIGHT 역할이 없습니다.' };

    const u = ensureUserData(targetMember, shift);
    if (!u) return { ok: false, message: '대상 데이터를 생성할 수 없습니다.' };

    const expiresAt = now.clone().add(hours, 'hours');
    liveExceptions[targetMember.id] = {
        userId: targetMember.id,
        name: targetMember.displayName,
        shift,
        hours,
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
    u.checkInTime = u.checkInTime || now.format('hh:mm A');
    u.checkInRaw = u.checkInRaw || now.toISOString();
    u.voiceJoinedAt = null;
    u.liveOffStartedAt = null;
    u.lastLiveOnAt = now.toISOString();
    u.liveOffWarnedFor = null;
    await updateWorkingRole(targetMember, true);
    await saveSystemAsync();

    const logText = [
        `\`[${now.format('MM/DD HH:mm')}]\` 👑 관리자 라이브 예외 승인`,
        `👥 대상: **${targetMember.displayName}**`,
        `⏰ 인정 시간: ${hours}시간`,
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
        if (now.isBefore(moment(exception.expiresAt))) continue;

        exception.status = 'expired';
        exception.expiredAt = now.toISOString();

        const member = guild?.members.cache.get(userId) || null;
        const u = attendanceData[userId];
        if (u?.status === 'exception') {
            u.checkedIn = false;
            u.isFinished = false;
            u.status = null;
            u.checkOutTime = now.format('hh:mm A');
            u.checkOutRaw = now.toISOString();
            if (member) await updateWorkingRole(member, false);
        }

        const logChan = await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
        if (logChan) {
            await logChan.send([
                `\`[${now.format('MM/DD HH:mm')}]\` ⏰ 라이브 예외 만료`,
                `👥 대상: **${exception.name || userId}**`,
                `⏳ 만료 시간: ${formatKoreanDateTime(exception.expiresAt)}`,
                '라이브 방송이 없으면 이제 출근 인정되지 않습니다.'
            ].join('\n')).catch(() => null);
        }
        changed = true;
    }

    if (changed) {
        await saveSystemAsync();
        renderDashboardCore();
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
                    await chan.send({ content: d.roleId ? `<@&${d.roleId}>` : '@everyone', embeds: [embed] })
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
        .replace(/[^a-z0-9가-힣]/g, '');
}

function parseDayOffRequest(message) {
    const content = message.content || '';
    const contentText = content.toLowerCase();
    const dayPattern = /\bday\s*time\b|\bday\b|낮|주간/;
    const nightPattern = /\bnight\s*time\b|\bnight\b|밤|야간/;
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

    // ✨ [업데이트] 빈 이름 제출 차단 
    if (!submittedName) {
        return { 
            ok: false, 
            code: 'missing-name', 
            emoji: '❌', 
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
            emoji: hasLeaveDate ? '❓' : '❌',
            displayName,
            submittedName,
            nameMismatch,
            shift,
            shiftLabel
        };
    }

    const month = getMonthNumber(leaveLine[1]);
    if (month === null) {
        return { ok: false, code: 'invalid-month', emoji: '❓', displayName, submittedName, nameMismatch, shift, shiftLabel };
    }

    const now = moment().tz(CONFIG.TIMEZONE);
    const year = leaveLine[3] ? Number(leaveLine[3]) : now.year();
    const date = moment.tz({ year, month, day: Number(leaveLine[2]), hour: 0, minute: 0 }, CONFIG.TIMEZONE);
    if (!date.isValid() || date.month() !== month) {
        return { ok: false, code: 'invalid-date', emoji: '❌', displayName, submittedName, nameMismatch, shift, shiftLabel };
    }

    if (!shift) {
        return { ok: false, code: 'missing-shift', emoji: '❌', displayName, submittedName, nameMismatch, shift, shiftLabel };
    }

    return {
        ok: true,
        code: 'valid',
        emoji: '⏳',
        displayName,
        submittedName,
        nameMismatch,
        shift,
        shiftLabel,
        leaveDate: date.format('YYYY-MM-DD')
    };
}

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
    for (const statusEmoji of DAYOFF_STATUS_EMOJIS) {
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
    if (!isDayOffChannel(message) || message.author?.bot) return;
    const parsed = parseDayOffRequest(message);

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
    if (existingReservation?.status === 'approved' && hasApprovalReaction(message)) {
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
    if (!isDayOffChannel(message) || message.author?.bot) return;
    const freshParsed = parsed || parseDayOffRequest(message);
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
        await message.author.send(buildDayOffDm(reservation)).catch(e => {
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
    if (!isDayOffChannel(message) || message.author?.bot) return;
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
    return Object.values(dayOffReservations)
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

    await member.send(buildDayOffRejectDm(reservation)).catch(e => {
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
            await targetUser.send(buildDayOffDm(reservation)).catch(e => {
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
        if (!isDayOffChannel(message)) return;
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
        if (!isDayOffChannel(message)) return;

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
    const autoDel = (ms = 3000) => setTimeout(() => i.deleteReply().catch(() => {}), ms);
    try {
        if (i.isChatInputCommand()) {
            const rawReply = i.reply.bind(i);
            const rawEditReply = i.editReply.bind(i);
            const rawDeferReply = i.deferReply.bind(i);
            i.reply = (payload) => rawReply(withCommandStatusPayload(payload)).catch(e => handleInteractionReplyError(e, 'reply'));
            i.editReply = (payload) => rawEditReply(withCommandStatusPayload(payload)).catch(e => handleInteractionReplyError(e, 'editReply'));
            i.deferReply = (payload) => rawDeferReply(payload).catch(e => handleInteractionReplyError(e, 'deferReply'));
            if (i.member && markMemberActivity(i.member, 'command')) await saveSystemAsync();
            const isAdmin = i.member.permissions.has(PermissionFlagsBits.Administrator);
            const isDayOffManager = isAdmin || i.user.id === CONFIG.DAYOFF_REVIEWER_ID || isOwnerId(i.user.id);
            const now = moment().tz(CONFIG.TIMEZONE);
            const n = (cmd) => i.commandName === cmd;
            const getTargetMember = () => i.options.getMember('target') || i.options.getMember('대상');
            const getSlot = () => i.options.getInteger('slot') || i.options.getInteger('번호');
            const getAnnounceTime = () => i.options.getString('time') || i.options.getString('시간');
            const getAnnounceContent = () => i.options.getString('content') || i.options.getString('내용');
            const getAnnounceRole = () => i.options.getRole('target') || i.options.getRole('대상') || i.options.getRole('role') || i.options.getRole('역할');
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
                if (!hours || hours < 1 || hours > 12) {
                    return i.editReply({ content: '시간은 1~12시간 사이로 입력해주세요.' }).then(() => autoDel());
                }
                const result = await grantLiveException(t, hours, reason, i.member);
                if (!result.ok) return i.editReply({ content: result.message }).then(() => autoDel());
                await renderDashboardCore();
                return i.editReply({ content: `라이브 예외가 승인되었습니다. 대상: ${t.displayName}, 시간: ${hours}시간` }).then(() => autoDel());
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
            if (n('ranking') || n('랭킹')) {
                return i.reply({ embeds: [buildRankingEmbed()] });
            }
            if (n('refresh') || n('현황판갱신')) {
                await i.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
                if (!i.deferred && !i.replied) return;
                await refreshGuildMembers(i.guild, { force: true });
                await reconcileAttendanceMembership(i.guild);
                await syncVoiceStates();
                await checkDayOffReservations();
                await autoOvertimeCheck();
                await syncAutoPanels();
                await renderDashboardCore({ forceMemberRefresh: true });
                return i.editReply({ content: 'UI Refreshed.' }).then(() => autoDel());
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
                return i.reply({ embeds: [buildDayOffListEmbed(status)], flags: MessageFlags.Ephemeral });
            }
            if (n('dayoff-approve') || n('휴무승인')) {
                if (!isDayOffManager) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const dateInput = i.options.getString('date') || i.options.getString('날짜');
                const leaveDate = parseDayOffCommandDate(dateInput);
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
                const leaveDate = parseDayOffCommandDate(dateInput);
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
                const leaveDate = parseDayOffCommandDate(dateInput);
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
                renderDashboardCore();
                return i.reply({ content: 'Forced In.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
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
                renderDashboardCore();
                return i.reply({ content: 'Forced Out.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
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
                renderDashboardCore();
                return i.reply({ content: 'Forced Early Out.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
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
                renderDashboardCore();
                return i.reply({ content: 'Forced Off.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
            }
            if (n('force-ot') || n('강제연장')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const s = determineShift(t);
                if (!s) return i.reply({ content: 'No role.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                const u = ensureUserData(t, s);
                if (!u.checkedIn) await handleClockIn(t, u, s, now);
                if (addOvertimeUser(u, 'MANUAL')) {
                    u.totalOT = (u.totalOT || 0) + 1;
                    u.points = (u.points || 0) + CONFIG.POINTS.OT;
                    await recordLog(u, 'ot', '관리자 강제 연장');
                }
                await writeAdminActionLog('FORCE_OT', i.member, t, [`shift=${s}`, `checkedIn=${Boolean(u.checkedIn)}`]);
                await saveSystemAsync();
                renderDashboardCore();
                return i.reply({ content: 'Forced OT.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
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
                const role = getAnnounceRole();
                if (slot < 1 || slot > 6 || !/^\d{2}:\d{2}$/.test(time)) {
                    return i.reply({ content: 'Invalid slot or time. Use slot 1-6 and HH:mm.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                }
                announceData[slot] = {
                    active: true,
                    time,
                    content,
                    roleId: role?.id || null,
                    lastSentDate: null
                };
                await saveSystemAsync();
                return i.reply({ content: `Announcement slot ${slot} saved for ${time}.`, flags: MessageFlags.Ephemeral }).then(() => autoDel());
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
                return i.reply({ content: `\`\`\`\n${formatAnnouncementList()}\n\`\`\``, flags: MessageFlags.Ephemeral });
            }
            if (n('manual-adjust') || n('수동수정')) {
                if (!isAdmin) return i.reply({ content: 'No perms.', flags: MessageFlags.Ephemeral }).then(() => autoDel());
                if (!isOwnerId(i.user.id)) return ownerOnlyReply(i);
                const t = getTargetMember();
                if (!t) return replyMemberNotFound();
                const field = i.options.getString('field') || i.options.getString('항목');
                const value = i.options.getString('value') || i.options.getString('값');
                const u = ensureUserData(t, determineShift(t));
                if (!applyManualAdjustment(u, field, value)) {
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
                const isVoiceConnected = Boolean(voiceState?.channelId);
                const isStreamingNow = Boolean(voiceState?.channelId && voiceState?.streaming);
                if (!isStreamingNow) {
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
                            ? 'LIVE OFF detected. Please turn on your live stream so your clock-in can be counted.'
                            : 'Please join a voice channel and turn on your live stream so your clock-in can be counted.',
                        flags: MessageFlags.Ephemeral
                    }).then(() => autoDel(3000));
                }
                u.isFinished = false;
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
                const isVoiceConnected = Boolean(voiceState?.channelId);
                const isStreamingNow = Boolean(voiceState?.channelId && voiceState?.streaming);
                const overtimeStart = getOvertimeStartMoment(u, now);
                const isOvertimeWindow = canStartOvertimeNow(u, now);
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
    const cmdList = [
        new SlashCommandBuilder().setName('라이브예외').setDescription('Approve live exception').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addIntegerOption(o=>o.setName('시간').setRequired(true).setDescription('Hours').setMinValue(1).setMaxValue(12)).addStringOption(o=>o.setName('사유').setRequired(true).setDescription('Reason')),
        new SlashCommandBuilder().setName('live-exception').setDescription('Approve live exception').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addIntegerOption(o=>o.setName('hours').setRequired(true).setDescription('Approved hours').setMinValue(1).setMaxValue(12)).addStringOption(o=>o.setName('reason').setRequired(true).setDescription('Reason')),
        new SlashCommandBuilder().setName('역할').setDescription('Assign roles').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('서버').setRequired(true).setDescription('Server').addChoices({name:'Heine',value:'HEINE'},{name:'Paagrio',value:'PAAGRIO'})).addStringOption(o=>o.setName('시프트').setRequired(true).setDescription('Shift').addChoices({name:'Day',value:'DAY'},{name:'Night',value:'NIGHT'})),
        new SlashCommandBuilder().setName('assign-roles').setDescription('Assign roles').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('server').setRequired(true).setDescription('Server').addChoices({name:'Heine',value:'HEINE'},{name:'Paagrio',value:'PAAGRIO'})).addStringOption(o=>o.setName('shift').setRequired(true).setDescription('Shift').addChoices({name:'Day',value:'DAY'},{name:'Night',value:'NIGHT'})),
        new SlashCommandBuilder().setName('일반보고').setDescription('Summary report'), new SlashCommandBuilder().setName('report-regular').setDescription('Summary report'),
        new SlashCommandBuilder().setName('정밀보고').setDescription('Deep report'), new SlashCommandBuilder().setName('report-analysis').setDescription('Deep report'),
        new SlashCommandBuilder().setName('랭킹').setDescription('Ranking'), new SlashCommandBuilder().setName('ranking').setDescription('Ranking'),
        new SlashCommandBuilder().setName('현황판갱신').setDescription('Refresh'), new SlashCommandBuilder().setName('refresh').setDescription('Refresh'),
        new SlashCommandBuilder().setName('워킹동기화').setDescription('Sync WORKING roles'), new SlashCommandBuilder().setName('sync-working').setDescription('Sync WORKING roles'),
        new SlashCommandBuilder().setName('권한진단').setDescription('Permission check'), new SlashCommandBuilder().setName('permission-check').setDescription('Permission check'),
        new SlashCommandBuilder().setName('데이터검사').setDescription('Data audit'), new SlashCommandBuilder().setName('data-audit').setDescription('Data audit'),
        new SlashCommandBuilder().setName('비활동검사').setDescription('Inactive kick candidate report').addIntegerOption(o=>o.setName('일수').setDescription('Inactive days').setMinValue(1).setMaxValue(30)),
        new SlashCommandBuilder().setName('inactive-candidates').setDescription('Inactive kick candidate report').addIntegerOption(o=>o.setName('days').setDescription('Inactive days').setMinValue(1).setMaxValue(30)),
        new SlashCommandBuilder().setName('상태검사').setDescription('Recorded status audit'), new SlashCommandBuilder().setName('status-audit').setDescription('Recorded status audit'),
        new SlashCommandBuilder().setName('시간검사').setDescription('Time logic audit'), new SlashCommandBuilder().setName('time-audit').setDescription('Time logic audit'),
        new SlashCommandBuilder().setName('휴무로그').setDescription('Day off audit log').addIntegerOption(o=>o.setName('갯수').setDescription('Limit').setMinValue(1).setMaxValue(30)),
        new SlashCommandBuilder().setName('dayoff-log').setDescription('Day off audit log').addIntegerOption(o=>o.setName('limit').setDescription('Limit').setMinValue(1).setMaxValue(30)),
        new SlashCommandBuilder().setName('휴무목록').setDescription('Day off list').addStringOption(o=>o.setName('상태').setDescription('Status').addChoices({name:'All',value:'all'},{name:'Pending',value:'pending'},{name:'Approved',value:'approved'},{name:'Today',value:'today'},{name:'Worked',value:'worked'},{name:'Cancelled',value:'cancelled'},{name:'Rejected',value:'rejected'})),
        new SlashCommandBuilder().setName('dayoff-list').setDescription('Day off list').addStringOption(o=>o.setName('status').setDescription('Status').addChoices({name:'All',value:'all'},{name:'Pending',value:'pending'},{name:'Approved',value:'approved'},{name:'Today',value:'today'},{name:'Worked',value:'worked'},{name:'Cancelled',value:'cancelled'},{name:'Rejected',value:'rejected'})),
        new SlashCommandBuilder().setName('휴무승인').setDescription('Approve day off').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('날짜').setRequired(true).setDescription('Date')),
        new SlashCommandBuilder().setName('dayoff-approve').setDescription('Approve day off').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('date').setRequired(true).setDescription('Date')),
        new SlashCommandBuilder().setName('휴무취소').setDescription('Cancel day off').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('날짜').setRequired(true).setDescription('Date')),
        new SlashCommandBuilder().setName('dayoff-cancel').setDescription('Cancel day off').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('date').setRequired(true).setDescription('Date')),
        new SlashCommandBuilder().setName('강제휴무취소').setDescription('Cancel exactly one day off without date').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('dayoff-cancel-force').setDescription('Cancel exactly one day off without date').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('휴무반려').setDescription('Reject day off').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('날짜').setRequired(true).setDescription('Date')).addStringOption(o=>o.setName('사유').setDescription('Reason')),
        new SlashCommandBuilder().setName('dayoff-reject').setDescription('Reject day off').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('date').setRequired(true).setDescription('Date')).addStringOption(o=>o.setName('reason').setDescription('Reason')),
        new SlashCommandBuilder().setName('강제출근').setDescription('Force in').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('force-in').setDescription('Force in').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('강제퇴근').setDescription('Force out').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('force-out').setDescription('Force out').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('강제조기퇴근').setDescription('Force early out').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('force-early-out').setDescription('Force early out').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('강제휴무').setDescription('Force off').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('force-off').setDescription('Force off').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('강제연장').setDescription('Force OT').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('force-ot').setDescription('Force OT').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('개인리셋').setDescription('Reset one user').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('reset-user').setDescription('Reset one user').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('리셋').setDescription('Reset one user').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('전체리셋').setDescription('Reset all attendance data'), new SlashCommandBuilder().setName('reset-all').setDescription('Reset all attendance data'),
        new SlashCommandBuilder().setName('내정보').setDescription('My info'), new SlashCommandBuilder().setName('my-info').setDescription('My info'),
        new SlashCommandBuilder().setName('진단').setDescription('Diagnostics'), new SlashCommandBuilder().setName('diagnostics').setDescription('Diagnostics'),
        new SlashCommandBuilder().setName('백업생성').setDescription('Backup create'), new SlashCommandBuilder().setName('backup-create').setDescription('Backup create'),
        new SlashCommandBuilder().setName('백업목록').setDescription('Backup list'), new SlashCommandBuilder().setName('backup-list').setDescription('Backup list'),
        new SlashCommandBuilder().setName('백업복구').setDescription('Backup restore').addStringOption(o=>o.setName('파일').setDescription('File')), new SlashCommandBuilder().setName('backup-restore').setDescription('Backup restore').addStringOption(o=>o.setName('file').setDescription('File')),
        new SlashCommandBuilder().setName('공지설정').setDescription('Set announce').addIntegerOption(o=>o.setName('번호').setRequired(true).setMinValue(1).setMaxValue(6).setDescription('Slot')).addRoleOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('시간').setRequired(true).setDescription('HH:mm')).addStringOption(o=>o.setName('내용').setRequired(true).setDescription('Content')),
        new SlashCommandBuilder().setName('set-announce').setDescription('Set announce').addIntegerOption(o=>o.setName('slot').setRequired(true).setMinValue(1).setMaxValue(6).setDescription('Slot')).addRoleOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('time').setRequired(true).setDescription('HH:mm')).addStringOption(o=>o.setName('content').setRequired(true).setDescription('Content')),
        new SlashCommandBuilder().setName('공지취소').setDescription('Cancel announce').addIntegerOption(o=>o.setName('번호').setRequired(true).setMinValue(1).setMaxValue(6).setDescription('Slot')), new SlashCommandBuilder().setName('cancel-announce').setDescription('Cancel announce').addIntegerOption(o=>o.setName('slot').setRequired(true).setMinValue(1).setMaxValue(6).setDescription('Slot')),
        new SlashCommandBuilder().setName('공지목록').setDescription('List announce'), new SlashCommandBuilder().setName('list-announce').setDescription('List announce'),
        new SlashCommandBuilder().setName('해고').setDescription('Kick').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('fire').setDescription('Kick').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('역할삭제').setDescription('Clear roles').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('clear-roles').setDescription('Clear roles').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('수동수정').setDescription('Manual adjust').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('항목').setRequired(true).setDescription('Field').addChoices({name:'points',value:'points'},{name:'status',value:'status'},{name:'shift',value:'shift'},{name:'checked-in',value:'checked-in'},{name:'day-off',value:'day-off'},{name:'disconnected',value:'disconnected'},{name:'finished',value:'finished'},{name:'normal',value:'normal'},{name:'late',value:'late'},{name:'absent',value:'absent'},{name:'early',value:'early'},{name:'ot',value:'ot'},{name:'off',value:'off'},{name:'dc',value:'dc'},{name:'strikes',value:'strikes'})).addStringOption(o=>o.setName('값').setRequired(true).setDescription('Value')),
        new SlashCommandBuilder().setName('manual-adjust').setDescription('Manual adjust').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('field').setRequired(true).setDescription('Field').addChoices({name:'points',value:'points'},{name:'status',value:'status'},{name:'shift',value:'shift'},{name:'checked-in',value:'checked-in'},{name:'day-off',value:'day-off'},{name:'disconnected',value:'disconnected'},{name:'finished',value:'finished'},{name:'normal',value:'normal'},{name:'late',value:'late'},{name:'absent',value:'absent'},{name:'early',value:'early'},{name:'ot',value:'ot'},{name:'off',value:'off'},{name:'dc',value:'dc'},{name:'strikes',value:'strikes'})).addStringOption(o=>o.setName('value').setRequired(true).setDescription('Value'))
    ];

    try {
        await rest.put(Routes.applicationGuildCommands(client.user.id, CONFIG.GUILD_ID), { body: cmdList });
    } catch (e) {
        console.error('[REST ERROR]', e);
    }

    const g = await client.guilds.fetch(CONFIG.GUILD_ID);
    await refreshGuildMembers(g, { force: true });

    setInterval(async () => {
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
        }
    }, 60000);

    cron.schedule('30 21 * * 0,1,3,4,5,6', () => performSmartReset('day'), { timezone: CONFIG.TIMEZONE });
    cron.schedule('30 19 * * 2', () => performSmartReset('day'), { timezone: CONFIG.TIMEZONE });
    cron.schedule('30 9 * * 0,1,2,4,5,6', () => performSmartReset('night'), { timezone: CONFIG.TIMEZONE });
    cron.schedule('30 4 * * 3', () => performSmartReset('night'), { timezone: CONFIG.TIMEZONE });
    printStartupBanner();
});

client.login(process.env.TOKEN);
