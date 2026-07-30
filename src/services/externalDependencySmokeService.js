'use strict';

function unique(values = []) {
    return [...new Set(values.filter(Boolean).map(String))];
}

function criticalDiscordChannelIds(CONFIG = {}) {
    return unique([
        CONFIG.LOG_CHANNEL,
        CONFIG.STATUS_CHANNEL,
        CONFIG.ANNOUNCE_CHANNEL,
        CONFIG.DAYOFF_CHANNEL,
        CONFIG.DAY_CHAN,
        CONFIG.NIGHT_CHAN,
        CONFIG.PURCHASE_CHANNEL_ID,
        ...Object.values(CONFIG.DEATH_PENALTY_CHANNEL_IDS || {}),
        ...Object.values(CONFIG.END_ADENA_CHANNEL_IDS || {})
    ]);
}

async function fetchJson(fetchFn, url, options = {}) {
    const requestOptions = {
        ...options,
        signal: options.signal || globalThis.AbortSignal?.timeout?.(15000)
    };
    const response = await fetchFn(url, requestOptions);
    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    if (!response.ok) {
        const message = body?.message || `HTTP ${response.status}`;
        throw Object.assign(new Error(message), { status: response.status });
    }
    return body;
}

async function createDefaultSheetsClient(CONFIG) {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    return google.sheets({ version: 'v4', auth });
}

async function runExternalDependencySmoke({
    CONFIG,
    token,
    fetchFn = globalThis.fetch,
    createSheetsClient = createDefaultSheetsClient,
    now = new Date()
} = {}) {
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (!token) throw new Error('Discord bot token is missing');
    if (typeof fetchFn !== 'function') throw new TypeError('fetchFn must be a function');

    const checks = [];
    async function check(name, operation) {
        const startedAt = Date.now();
        try {
            const detail = await operation();
            checks.push({ name, ok: true, durationMs: Date.now() - startedAt, detail });
        } catch (error) {
            checks.push({
                name,
                ok: false,
                durationMs: Date.now() - startedAt,
                error: error?.message || String(error),
                status: error?.status || error?.code || null
            });
        }
    }

    const discordHeaders = { Authorization: `Bot ${token}` };
    await check('discord-bot-auth', async () => {
        const user = await fetchJson(fetchFn, 'https://discord.com/api/v10/users/@me', { headers: discordHeaders });
        if (!user?.id) throw new Error('Discord bot identity is missing');
        return { botId: user.id, username: user.username || null };
    });
    await check('discord-guild-access', async () => {
        const guild = await fetchJson(fetchFn, `https://discord.com/api/v10/guilds/${CONFIG.GUILD_ID}`, { headers: discordHeaders });
        if (String(guild?.id || '') !== String(CONFIG.GUILD_ID)) throw new Error('Configured guild was not returned');
        return { guildId: guild.id, name: guild.name || null };
    });

    const channelIds = criticalDiscordChannelIds(CONFIG);
    for (const channelId of channelIds) {
        await check(`discord-channel:${channelId}`, async () => {
            const channel = await fetchJson(fetchFn, `https://discord.com/api/v10/channels/${channelId}`, { headers: discordHeaders });
            if (String(channel?.id || '') !== channelId) throw new Error('Configured channel was not returned');
            return { channelId, name: channel.name || null, type: channel.type ?? null };
        });
    }

    let sheets = null;
    try {
        sheets = await createSheetsClient(CONFIG);
    } catch (error) {
        checks.push({ name: 'google-sheets-client', ok: false, durationMs: 0, error: error?.message || String(error) });
    }
    if (sheets) {
        const workbookIds = unique([
            CONFIG.PURCHASE_SPREADSHEET_ID,
            CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID,
            CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID,
            CONFIG.RAW_ATTENDANCE_SPREADSHEET_ID
        ]);
        for (const spreadsheetId of workbookIds) {
            await check(`google-sheet:${spreadsheetId}`, async () => {
                const response = await sheets.spreadsheets.get({
                    spreadsheetId,
                    fields: 'spreadsheetId,properties.title,sheets.properties(sheetId,title)'
                });
                const titles = (response.data.sheets || []).map(sheet => sheet.properties?.title).filter(Boolean);
                if (spreadsheetId === CONFIG.PURCHASE_SPREADSHEET_ID) {
                    const requiredTabs = unique(Object.values(CONFIG.PURCHASE_SERVER_TABS || {}));
                    const missingTabs = requiredTabs.filter(title => !titles.includes(title));
                    if (missingTabs.length) throw new Error(`Missing purchase tab(s): ${missingTabs.join(', ')}`);
                }
                return {
                    spreadsheetId,
                    title: response.data.properties?.title || null,
                    sheetCount: titles.length
                };
            });
        }
    }

    if (CONFIG.RAW_ATTENDANCE_WEBAPP_URL) {
        await check('raw-attendance-webapp', async () => {
            const separator = CONFIG.RAW_ATTENDANCE_WEBAPP_URL.includes('?') ? '&' : '?';
            const url = `${CONFIG.RAW_ATTENDANCE_WEBAPP_URL}${separator}api=raw&t=${new Date(now).getTime()}`;
            const body = await fetchJson(fetchFn, url, { headers: { Accept: 'application/json' } });
            if (!Array.isArray(body)) throw new Error('Raw attendance API did not return an array');
            return { rowCount: body.length };
        });
    }

    const failures = checks.filter(item => !item.ok);
    return {
        ok: failures.length === 0,
        checkedAt: new Date(now).toISOString(),
        checkCount: checks.length,
        failureCount: failures.length,
        checks,
        failures
    };
}

module.exports = {
    criticalDiscordChannelIds,
    runExternalDependencySmoke
};
