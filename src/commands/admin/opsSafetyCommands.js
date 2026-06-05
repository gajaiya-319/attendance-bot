'use strict';

const KO = {
    date: '\ub0a0\uc9dc',
    server: '\uc11c\ubc84',
    shift: '\uadfc\ubb34\uc870',
    name: '\uc774\ub984',
    status: '\uc0c1\ud0dc',
    key: '\ud0a4',
    normal: '\uc815\ucd9c',
    late: '\uc9c0\uac01',
    absent: '\uacb0\uc11d',
    earlyOut: '\uc870\ud1f4',
    overtime: '\uc5f0\uc7a5\uadfc\ubb34',
    dayOff: '\ud734\ubb34',
    noPermission: '\uad8c\ud55c\uc774 \uc5c6\uc2b5\ub2c8\ub2e4.',
    commandName: '\uc624\ub298\uae30\ub85d\uac80\uc0ac'
};

function canonicalName(value) {
    const name = String(value || '')
        .replace(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:[PH]\s*)?(?:Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i, ' ')
        .replace(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:Heine|Paagrio)\s*(?:Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i, ' ')
        .replace(/\s*[-\u2013\u2014]\s*(?:Great\s*)?(?:Manager|Trainee|Guest)(?:\s+.*)?$/i, ' ')
        .replace(/\b(?:over\s*time|overtime|ot)\b/gi, ' ')
        .replace(/ding\s*[-\u2013\u2014]\s*dong/gi, 'Ding dong')
        .replace(/\s+/g, ' ')
        .trim();
    const aliases = {
        ding: 'Ding dong',
        'ding-dong': 'Ding dong',
        'ding dong': 'Ding dong',
        shijiro: 'Shiijiro',
        lanceyy: 'Lancyy'
    };
    return aliases[name.toLowerCase()] || name || 'Unknown';
}

function getCell(row, keys, fallback = '') {
    for (const key of keys) {
        const value = row?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
    }
    return fallback;
}

function normalizeStatus(value) {
    const text = String(value || '').trim().toLowerCase();
    const map = {
        normal: KO.normal,
        on_time: KO.normal,
        ontime: KO.normal,
        clock_in: KO.normal,
        late: KO.late,
        absent: KO.absent,
        early: KO.earlyOut,
        early_out: KO.earlyOut,
        overtime: KO.overtime,
        ot: KO.overtime,
        day_off: KO.dayOff,
        off: KO.dayOff
    };
    return map[text] || String(value || '').trim();
}

function normalizeShift(value) {
    const text = String(value || '').trim().toUpperCase();
    if (text.includes('NIGHT') || text.includes('\uc57c\uac04')) return 'NIGHT';
    if (text.includes('DAY') || text.includes('\uc8fc\uac04')) return 'DAY';
    return text || '-';
}

function isPlaceholder(row) {
    const date = getCell(row, [KO.date, 'date', 'Date']);
    const status = normalizeStatus(getCell(row, ['statusNormalized', KO.status, 'status', 'Status']));
    return (!date || date === '-') && (!status || status === '-');
}

function getLogicalDate(row) {
    const key = getCell(row, [KO.key, 'key', 'Key']);
    const keyDate = key.split('|')[0];
    if (keyDate && keyDate !== '-') return keyDate;
    const rawDate = getCell(row, [KO.date, 'date', 'Date']);
    const match = rawDate.match(/\d{4}-\d{2}-\d{2}/);
    return match ? match[0] : rawDate;
}

function isAuditDate(row, today, nightDate) {
    const date = getLogicalDate(row);
    if (date === today) return true;
    const shift = normalizeShift(getCell(row, [KO.shift, 'shift', 'Shift']));
    return Boolean(nightDate && shift === 'NIGHT' && date === nightDate);
}

async function fetchRawRows(CONFIG, fetchImpl = globalThis.fetch) {
    const baseUrl = String(CONFIG.RAW_ATTENDANCE_WEBAPP_URL || '').trim();
    if (!baseUrl || typeof fetchImpl !== 'function') return [];
    const sep = baseUrl.includes('?') ? '&' : '?';
    const response = await fetchImpl(`${baseUrl}${sep}api=raw&t=${Date.now()}`);
    const text = await response.text();
    if (!response.ok) throw new Error(`Raw API ${response.status}: ${text.slice(0, 120)}`);
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
}

async function readRawRows({ CONFIG, fetchImpl, readRows }) {
    if (typeof readRows === 'function') {
        try {
            const rows = await readRows();
            if (Array.isArray(rows)) return rows;
        } catch (_) {
            // Fall back to the web app API below.
        }
    }
    return fetchRawRows(CONFIG, fetchImpl);
}

function buildTodayAudit({ rows, today, nightDate = null }) {
    const profiles = new Map();
    const active = new Map();
    const rawNames = new Map();

    for (const row of rows || []) {
        const rawName = getCell(row, [KO.name, 'name', 'Name']);
        const name = canonicalName(rawName);
        const server = getCell(row, [KO.server, 'server', 'Server'], '-').toUpperCase();
        const shift = normalizeShift(getCell(row, [KO.shift, 'shift', 'Shift'], '-'));
        const key = getCell(row, [KO.key, 'key', 'Key']);
        if ((!rawName || rawName === 'Unknown') && server === '-' && shift === '-' && !key) continue;

        if (!rawNames.has(name)) rawNames.set(name, new Set());
        rawNames.get(name).add(rawName);

        const profileKey = `${server}|${shift}|${name.toLowerCase()}`;

        if (isPlaceholder(row)) {
            profiles.set(profileKey, { name, server, shift });
            continue;
        }

        if (!isAuditDate(row, today, nightDate)) continue;
        const status = normalizeStatus(getCell(row, ['statusNormalized', KO.status, 'status', 'Status']));
        if (!active.has(profileKey)) active.set(profileKey, { name, server, shift, statuses: [] });
        active.get(profileKey).statuses.push(status || '-');
    }

    const zeroRows = [...profiles.values()]
        .filter(profile => !active.has(`${profile.server}|${profile.shift}|${profile.name.toLowerCase()}`))
        .sort((a, b) => a.name.localeCompare(b.name));
    const duplicateNames = [...rawNames.entries()]
        .filter(([, variants]) => variants.size > 1)
        .map(([name, variants]) => ({ name, variants: [...variants].sort() }))
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
        today,
        nightDate,
        profiles: profiles.size,
        active: active.size,
        zeroRows,
        duplicateNames
    };
}

function renderAudit(audit) {
    const range = audit.nightDate
        ? `${audit.today} / \uc57c\uac04 ${audit.nightDate}`
        : audit.today;
    const lines = [
        `\uc624\ub298 \uae30\ub85d \uac80\uc0ac: ${range}`,
        `\ud604\uc7ac \ud504\ub85c\ud544: ${audit.profiles}\uba85`,
        `\uc624\ub298 \uae30\ub85d \uc788\uc74c: ${audit.active}\uba85`,
        `\uc624\ub298 \uae30\ub85d 0: ${audit.zeroRows.length}\uba85`
    ];

    if (audit.zeroRows.length) {
        lines.push('', '[\uc624\ub298 \uae30\ub85d 0]');
        audit.zeroRows.slice(0, 20).forEach(item => {
            lines.push(`- ${item.name} / ${item.server} / ${item.shift}`);
        });
    }

    if (audit.duplicateNames.length) {
        lines.push('', '[\uc774\ub984 \ubcc0\ud615 \uac10\uc9c0]');
        audit.duplicateNames.slice(0, 10).forEach(item => {
            lines.push(`- ${item.name}: ${item.variants.join(', ')}`);
        });
    }

    return lines.join('\n').slice(0, 1900);
}

function createOpsSafetyCommands({
    MessageFlags,
    CONFIG,
    moment,
    canRun,
    fetchImpl = globalThis.fetch,
    readRows = null
}) {
    if (!MessageFlags) throw new TypeError('MessageFlags must be provided');
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (typeof canRun !== 'function') throw new TypeError('canRun must be a function');

    async function executeTodayAudit(interaction, { autoDel = () => {} } = {}) {
        if (!canRun(interaction.member)) {
            return interaction.reply({ content: KO.noPermission, flags: MessageFlags.Ephemeral }).then(() => autoDel());
        }

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => null);
        if (!interaction.deferred && !interaction.replied) return null;

        try {
            const today = moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD');
            const nightDate = moment().tz(CONFIG.TIMEZONE).subtract(1, 'day').format('YYYY-MM-DD');
            const rows = await readRawRows({ CONFIG, fetchImpl, readRows });
            const audit = buildTodayAudit({ rows, today, nightDate });
            return interaction.editReply({ content: renderAudit(audit) }).then(() => autoDel());
        } catch (error) {
            return interaction.editReply({ content: `\uc624\ub298 \uae30\ub85d \uac80\uc0ac \uc2e4\ud328: ${error?.message || error}` }).then(() => autoDel());
        }
    }

    return {
        todayAudit: {
            aliases: [KO.commandName, 'today-audit'],
            execute: executeTodayAudit
        }
    };
}

module.exports = {
    createOpsSafetyCommands,
    canonicalName,
    buildTodayAudit,
    renderAudit,
    readRawRows
};
