require('dotenv').config();

const CONFIG = {
    VERSION: '2501.97-DAYOFF-LIVE-CLOCKIN',
    RELEASE_NOTE: 'Allow day-off live users to clock in',
    GUILD_ID: '1502598521294028830',
    LOG_CHANNEL: '1503681085618262158',
    STATUS_CHANNEL: '1503681415407992962',
    ANNOUNCE_CHANNEL: '1502609571456356545',
    DAYOFF_CHANNEL: process.env.DAYOFF_CHANNEL_ID || '1502729397336018964',
    DAYOFF_REVIEWER_ID: process.env.DAYOFF_REVIEWER_ID || '280301228716589058',
    PURCHASE_CHANNEL_ID: process.env.PURCHASE_CHANNEL_ID || '1505382831772270743',
    PURCHASE_CHANNEL_NAME: process.env.PURCHASE_CHANNEL_NAME || 'red-potion-buy',
    PURCHASE_APPROVAL_EMOJI: process.env.PURCHASE_APPROVAL_EMOJI || '\u2705',
    PURCHASE_CANCEL_EMOJI: process.env.PURCHASE_CANCEL_EMOJI || '\u274C',
    PURCHASE_PROCESSING_EMOJI: process.env.PURCHASE_PROCESSING_EMOJI || '\u23F3',
    PURCHASE_SUCCESS_EMOJI: process.env.PURCHASE_SUCCESS_EMOJI || '\uD83D\uDCCA',
    PURCHASE_FAILURE_EMOJI: process.env.PURCHASE_FAILURE_EMOJI || '\u26A0\uFE0F',
    PURCHASE_UNIT_PRICE: Number(process.env.PURCHASE_UNIT_PRICE || 3000),
    PURCHASE_OWNER_DM_IDS: (process.env.PURCHASE_OWNER_DM_IDS || process.env.OWNER_IDS || '280301228716589058').split(',').map(id => id.trim()).filter(Boolean),
    PURCHASE_GOOGLE_KEY_FILE: process.env.PURCHASE_GOOGLE_KEY_FILE || './sheet-bot-key.json',
    /** Work list: Paagrio Great / Valakas Great (live 3-day source). */
    PURCHASE_SPREADSHEET_ID: process.env.PURCHASE_SPREADSHEET_ID
        || process.env.SPREADSHEET_ID
        || '1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk',
    /** Payroll summary workbook: recent 3-day summary and monthly summary pages. */
    PAYROLL_SUMMARY_SPREADSHEET_ID: process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || '1IFZ-oBqatX0cEN7k7JiUr_UkqyAoXPi2LgmEifNG0eY',
    /** Payroll archive workbook: Raw_Data and attendance dashboard data. */
    PAYROLL_ARCHIVE_SPREADSHEET_ID: process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || '1IFZ-oBqatX0cEN7k7JiUr_UkqyAoXPi2LgmEifNG0eY',
    RAW_ATTENDANCE_SPREADSHEET_ID: process.env.RAW_ATTENDANCE_SPREADSHEET_ID
        || process.env.PAYROLL_ARCHIVE_SPREADSHEET_ID
        || process.env.PAYROLL_SUMMARY_SPREADSHEET_ID
        || '1IFZ-oBqatX0cEN7k7JiUr_UkqyAoXPi2LgmEifNG0eY',
    RAW_ATTENDANCE_WEBAPP_URL: process.env.RAW_ATTENDANCE_WEBAPP_URL || 'https://script.google.com/macros/s/AKfycbx3a9-T71S_zfRwf-hCCwmLfzJR2mW3E3FTNXHWNaa1s-p5gdJqmCd3L6W9IoVNvBGj/exec',
    PURCHASE_SERVER_TABS: {
        VALAKAS: process.env.PURCHASE_VALACAS_TAB_NAME || process.env.PURCHASE_HEINE_TAB_NAME || 'Valakas Great',
        HEINE: process.env.PURCHASE_VALACAS_TAB_NAME || process.env.PURCHASE_HEINE_TAB_NAME || 'Valakas Great',
        PAAGRIO: process.env.PURCHASE_PAAGRIO_TAB_NAME || 'Paagrio Great'
    },
    PURCHASE_SERVER_SHEET_IDS: {
        VALAKAS: Number(process.env.PURCHASE_VALACAS_SHEET_ID || process.env.PURCHASE_HEINE_SHEET_ID || 140599828),
        HEINE: Number(process.env.PURCHASE_VALACAS_SHEET_ID || process.env.PURCHASE_HEINE_SHEET_ID || 140599828),
        PAAGRIO: Number(process.env.PURCHASE_PAAGRIO_SHEET_ID || 354531306)
    },
    PURCHASE_SECTION_LABELS: {
        DAY: process.env.PURCHASE_DAY_SECTION_LABEL || 'Day',
        NIGHT: process.env.PURCHASE_NIGHT_SECTION_LABEL || 'Night'
    },
    SHEET_NAME_ALIASES: {
        kramthespark: 'kram',
        shijiro: 'shiijiro',
        lanceyy: 'lancyy',
        ...Object.fromEntries(
            (process.env.SHEET_NAME_ALIASES || '')
                .split(',')
                .map(pair => pair.split('=').map(part => part.trim()))
                .filter(([from, to]) => from && to)
        )
    },
    DEATH_PENALTY_AMOUNT: Number(process.env.DEATH_PENALTY_AMOUNT || 1000),
    DEATH_PENALTY_CHANNEL_IDS: {
        PAAGRIO: process.env.DEATH_PENALTY_PAAGRIO_CHANNEL_ID || '1502693924026847232',
        VALAKAS: process.env.DEATH_PENALTY_VALACAS_CHANNEL_ID || process.env.DEATH_PENALTY_HEINE_CHANNEL_ID || '1502725853329752245',
        HEINE: process.env.DEATH_PENALTY_VALACAS_CHANNEL_ID || process.env.DEATH_PENALTY_HEINE_CHANNEL_ID || '1502725853329752245'
    },
    DEATH_PENALTY_REVIEWER_ROLE_IDS: (process.env.DEATH_PENALTY_REVIEWER_ROLE_IDS || '1502599381105246388,1502715137667235870').split(',').map(id => id.trim()).filter(Boolean),
    END_ADENA_CHANNEL_IDS: {
        PAAGRIO: process.env.END_ADENA_PAAGRIO_CHANNEL_ID || '1502689374331080724',
        VALAKAS: process.env.END_ADENA_VALACAS_CHANNEL_ID || process.env.END_ADENA_HEINE_CHANNEL_ID || '1502725827094118400',
        HEINE: process.env.END_ADENA_VALACAS_CHANNEL_ID || process.env.END_ADENA_HEINE_CHANNEL_ID || '1502725827094118400'
    },
    END_ADENA_REVIEWER_ROLE_IDS: (process.env.END_ADENA_REVIEWER_ROLE_IDS || process.env.DEATH_PENALTY_REVIEWER_ROLE_IDS || '1502599381105246388,1502715137667235870').split(',').map(id => id.trim()).filter(Boolean),
    END_ADENA_SUMMARY_OWNER_ROLE_IDS: (process.env.END_ADENA_SUMMARY_OWNER_ROLE_IDS || process.env.SERVER_OWNER_ROLE_IDS || '1502712503421894757').split(',').map(id => id.trim()).filter(Boolean),
    END_ADENA_SUMMARY_USER_IDS: (process.env.END_ADENA_SUMMARY_USER_IDS || '727085698401697843').split(',').map(id => id.trim()).filter(Boolean),
    END_ADENA_OVERTIME_THRESHOLD_MINS: Number(process.env.END_ADENA_OVERTIME_THRESHOLD_MINS || 5),
    END_ADENA_APPROVAL_WINDOW_MINS: Number(process.env.END_ADENA_APPROVAL_WINDOW_MINS || 60),
    END_ADENA_MAX_OVERTIME_MINS: Number(process.env.END_ADENA_MAX_OVERTIME_MINS || 360),
    OWNER_IDS: (process.env.OWNER_IDS || '280301228716589058').split(',').map(id => id.trim()).filter(Boolean),
    LIVE_EXCEPTION_MANAGER_ROLE_IDS: (process.env.LIVE_EXCEPTION_MANAGER_ROLE_IDS || '1502599381105246388,1502715137667235870').split(',').map(id => id.trim()).filter(Boolean),
    ANNOUNCEMENT_MANAGER_ROLE_IDS: (process.env.ANNOUNCEMENT_MANAGER_ROLE_IDS || process.env.LIVE_EXCEPTION_MANAGER_ROLE_IDS || '1502599381105246388,1502715137667235870').split(',').map(id => id.trim()).filter(Boolean),
    OPS_MANAGER_ROLE_IDS: (process.env.OPS_MANAGER_ROLE_IDS || process.env.LIVE_EXCEPTION_MANAGER_ROLE_IDS || '1502599381105246388,1502715137667235870').split(',').map(id => id.trim()).filter(Boolean),
    DAYOFF_MANAGER_ROLE_IDS: (process.env.DAYOFF_MANAGER_ROLE_IDS || process.env.LIVE_EXCEPTION_MANAGER_ROLE_IDS || '1502599381105246388,1502715137667235870').split(',').map(id => id.trim()).filter(Boolean),
    ALLOW_DISCORD_ADMIN_COMMANDS: /^(1|true|yes)$/i.test(process.env.ALLOW_DISCORD_ADMIN_COMMANDS || ''),
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
        OPS_PENDING: './logs/ops-pending.json',
        MAINTENANCE_OVERRIDES: './logs/maintenance-overrides.json',
        MAX_BACKUPS: 30
    },
    POINTS: { NORMAL_IN: 10, LATE: -5, EXCESSIVE_LATE: -10, EARLY_OUT: -10, OT: 5, ABSENT: -25 },
    TIMEZONE: 'Asia/Manila',
    PURGE_NORMAL: 14,
    PURGE_MANUAL_OT: 40,
    GRACE_PERIOD_MINS: 10,
    LIVE_OFF_IGNORE_MINS: Number(process.env.LIVE_OFF_IGNORE_MINS || 2),
    LIVE_OFF_DM_AFTER_MINS: 10,
    LIVE_OFF_DM_INTERVAL_MINS: 10,
    LIVE_OFF_CLOCK_OUT_MINS: 30,
    CLOCK_IN_GRACE_MINS: Number(process.env.CLOCK_IN_GRACE_MINS || 0),
    CLOCK_OUT_GRACE_MINS: 5,
    AUTO_OT_AFTER_MINS: 5,
    POST_SHIFT_CONTINUOUS_OT_WINDOW_MINS: Number(process.env.POST_SHIFT_CONTINUOUS_OT_WINDOW_MINS || 30),
    PRE_SHIFT_LIVE_BUFFER_MINS: 10,
    PRE_SHIFT_LIVE_MEMORY_MINS: Number(process.env.PRE_SHIFT_LIVE_MEMORY_MINS || 30),
    PRE_SHIFT_RECONNECT_GRACE_MINS: Number(process.env.PRE_SHIFT_RECONNECT_GRACE_MINS || 10),
    PRE_SHIFT_VOICE_MEMORY_MINS: Number(process.env.PRE_SHIFT_VOICE_MEMORY_MINS || 7 * 60),
    PRE_SHIFT_VOICE_LIVE_GRACE_MINS: Number(process.env.PRE_SHIFT_VOICE_LIVE_GRACE_MINS || 10),
    MAX_AUTO_OT_MINS: Number(process.env.MAX_AUTO_OT_MINS || 14 * 60),
    AUTO_OT_CONFIRM_EXPIRE_MINS: Number(process.env.AUTO_OT_CONFIRM_EXPIRE_MINS || 0),
    AUTO_OT_CONFIRM_REMINDER_MINS: Number(process.env.AUTO_OT_CONFIRM_REMINDER_MINS || 5),
    ENABLE_PRESENCE_INTENT: String(process.env.ENABLE_PRESENCE_INTENT || 'false').toLowerCase() === 'true',
    OT_ACTIVITY_DENYLIST: String(process.env.OT_ACTIVITY_DENYLIST || [
        'Dota',
        'Dota 2',
        'League',
        'League of Legends',
        'Valorant',
        'Steam',
        'Counter-Strike',
        'CS2',
        'PUBG',
        'Fortnite',
        'Apex Legends',
        'Overwatch',
        'Minecraft',
        'Roblox',
        'Genshin',
        'Diablo',
        'Lost Ark',
        'Call of Duty',
        'Warzone',
        'Grand Theft Auto',
        'GTA',
        'Mobile Legends',
        'Hearthstone',
        'World of Warcraft',
        'Riot Client',
        'Battle.net',
        'Epic Games'
    ].join(',')).split(',').map(item => item.trim()).filter(Boolean),
    OT_ACTIVITY_ALLOWLIST: String(process.env.OT_ACTIVITY_ALLOWLIST || [
        'Lineage Classic',
        'LineageClassic',
        'Lineage',
        '리니지 클래식',
        '리니지클래식'
    ].join(','))
        .split(',')
        .map(item => item.trim())
        .filter(Boolean),
    AUTO_OT_UNKNOWN_ACTIVITY_POLICY: String(process.env.AUTO_OT_UNKNOWN_ACTIVITY_POLICY || 'allow').toLowerCase(),
    AUTO_OT_UNKNOWN_ACTIVITY_CONTINUOUS_LIVE_FALLBACK: String(process.env.AUTO_OT_UNKNOWN_ACTIVITY_CONTINUOUS_LIVE_FALLBACK || 'true').toLowerCase() !== 'false',
    FINISHED_VISIBLE_AFTER_MINS: 30,
    AUTO_TIMEOUT_RESUME_WINDOW_MINS: 60,
    GUEST_ASSIGN_AFTER_HOURS: 24,
    INACTIVE_CANDIDATE_DAYS: 3,
    NICKNAME_ROLE_SYNC: true,
    EXCEPTIONS: {
        SHARED_SEAT_USER: process.env.SHARED_SEAT_USER_ID || null,
        EXCLUDED_USER_IDS: (process.env.EXCLUDED_USER_IDS || '1239447405749993533')
            .split(',')
            .map(id => id.trim())
            .filter(Boolean)
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

module.exports = {
    CONFIG,
    SHIFT_SCHEDULE,
    MAINTENANCE_WINDOWS
};
