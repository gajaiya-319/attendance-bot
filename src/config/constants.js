require('dotenv').config();

const CONFIG = {
    VERSION: '2501.65-DASHBOARD-WIDE-DIVIDER',
    RELEASE_NOTE: 'Widen dashboard embed with visible divider',
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
    GRACE_PERIOD_MINS: 10,
    LIVE_OFF_DM_AFTER_MINS: 10,
    LIVE_OFF_DM_INTERVAL_MINS: 10,
    LIVE_OFF_CLOCK_OUT_MINS: 30,
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

module.exports = {
    CONFIG,
    SHIFT_SCHEDULE,
    MAINTENANCE_WINDOWS
};
