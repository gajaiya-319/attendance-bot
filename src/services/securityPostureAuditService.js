'use strict';

const fsDefault = require('fs');
const pathDefault = require('path');
const { PermissionFlagsBits } = require('discord.js');
const { criticalDiscordChannelIds } = require('./externalDependencySmokeService');

const REQUIRED_GUILD_PERMISSIONS = [
    ['ManageRoles', PermissionFlagsBits.ManageRoles],
    ['ManageNicknames', PermissionFlagsBits.ManageNicknames]
];
const REQUIRED_TEXT_PERMISSIONS = [
    ['ViewChannel', PermissionFlagsBits.ViewChannel],
    ['SendMessages', PermissionFlagsBits.SendMessages],
    ['ReadMessageHistory', PermissionFlagsBits.ReadMessageHistory]
];
const REQUIRED_REVIEW_PERMISSIONS = [
    ['AddReactions', PermissionFlagsBits.AddReactions],
    ['ManageMessages', PermissionFlagsBits.ManageMessages]
];
const ELEVATED_PERMISSIONS = [
    ['Administrator', PermissionFlagsBits.Administrator],
    ['ManageGuild', PermissionFlagsBits.ManageGuild],
    ['ManageChannels', PermissionFlagsBits.ManageChannels],
    ['ManageWebhooks', PermissionFlagsBits.ManageWebhooks],
    ['BanMembers', PermissionFlagsBits.BanMembers],
    ['KickMembers', PermissionFlagsBits.KickMembers],
    ['ModerateMembers', PermissionFlagsBits.ModerateMembers]
];

function unique(values = []) {
    return [...new Set(values.filter(Boolean).map(String))];
}

function permissionBits(value) {
    try {
        return BigInt(value || 0);
    } catch {
        return 0n;
    }
}

function hasPermission(bits, flag) {
    if ((bits & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator) return true;
    return (bits & flag) === flag;
}

function applyOverwrite(bits, overwrite) {
    if (!overwrite) return bits;
    const denied = permissionBits(overwrite.deny);
    const allowed = permissionBits(overwrite.allow);
    return (bits & ~denied) | allowed;
}

function calculateGuildPermissions(guildId, roles = [], memberRoleIds = []) {
    const selected = new Set([String(guildId), ...memberRoleIds.map(String)]);
    return roles
        .filter(role => selected.has(String(role.id)))
        .reduce((bits, role) => bits | permissionBits(role.permissions), 0n);
}

function calculateChannelPermissions({ guildId, botId, memberRoleIds, guildPermissions, channel }) {
    if (hasPermission(guildPermissions, PermissionFlagsBits.Administrator)) return guildPermissions;
    const overwrites = Array.isArray(channel?.permission_overwrites) ? channel.permission_overwrites : [];
    let bits = applyOverwrite(
        guildPermissions,
        overwrites.find(item => String(item.id) === String(guildId) && Number(item.type) === 0)
    );
    const roleOverwrites = overwrites.filter(item => (
        Number(item.type) === 0 && memberRoleIds.map(String).includes(String(item.id))
    ));
    const denied = roleOverwrites.reduce((value, item) => value | permissionBits(item.deny), 0n);
    const allowed = roleOverwrites.reduce((value, item) => value | permissionBits(item.allow), 0n);
    bits = (bits & ~denied) | allowed;
    return applyOverwrite(
        bits,
        overwrites.find(item => String(item.id) === String(botId) && Number(item.type) === 1)
    );
}

async function fetchJson(fetchFn, url, options = {}) {
    const response = await fetchFn(url, {
        ...options,
        signal: options.signal || globalThis.AbortSignal?.timeout?.(15000)
    });
    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }
    if (!response.ok) {
        throw Object.assign(new Error(body?.message || `HTTP ${response.status}`), { status: response.status });
    }
    return body;
}

async function validateDefaultGoogleCredentials(keyFile) {
    const { google } = require('googleapis');
    const auth = new google.auth.GoogleAuth({
        keyFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    const client = await auth.getClient();
    const accessToken = await client.getAccessToken();
    if (!accessToken?.token) throw new Error('Google access token was not issued');
    return { authenticated: true };
}

function safeFileMode(stat, platform) {
    if (platform === 'win32') return { enforced: false, secure: true, mode: null };
    const mode = stat.mode & 0o777;
    return { enforced: true, secure: (mode & 0o077) === 0, mode: mode.toString(8).padStart(3, '0') };
}

async function runSecurityPostureAudit({
    CONFIG,
    token,
    cwd = process.cwd(),
    fetchFn = globalThis.fetch,
    fs = fsDefault,
    path = pathDefault,
    platform = process.platform,
    validateGoogleCredentials = validateDefaultGoogleCredentials,
    now = new Date()
} = {}) {
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (typeof fetchFn !== 'function') throw new TypeError('fetchFn must be a function');
    const checkedAt = new Date(now).toISOString();
    const checks = [];

    async function check(name, operation, severity = 'critical') {
        const startedAt = Date.now();
        try {
            const detail = await operation();
            checks.push({ name, ok: true, severity, durationMs: Date.now() - startedAt, detail });
        } catch (error) {
            checks.push({
                name,
                ok: false,
                severity,
                durationMs: Date.now() - startedAt,
                error: error?.message || String(error),
                status: error?.status || error?.code || null
            });
        }
    }

    await check('secret-config', async () => {
        if (!token || String(token).length < 30) throw new Error('Discord token is missing or malformed');
        const owners = unique(CONFIG.OWNER_IDS || []);
        if (!owners.length || owners.some(id => !/^\d{15,22}$/.test(id))) throw new Error('OWNER_IDS is missing or malformed');
        return { tokenPresent: true, ownerCount: owners.length };
    });

    const envPath = path.resolve(cwd, '.env');
    await check('secret-file:.env', async () => {
        const stat = fs.statSync(envPath);
        const fileMode = safeFileMode(stat, platform);
        if (!fileMode.secure) throw new Error(`.env permissions are too broad (${fileMode.mode})`);
        return { exists: true, ...fileMode };
    });

    const keyPath = path.resolve(cwd, CONFIG.PURCHASE_GOOGLE_KEY_FILE || 'sheet-bot-key.json');
    let keyData = null;
    await check('google-key-structure', async () => {
        const stat = fs.statSync(keyPath);
        const fileMode = safeFileMode(stat, platform);
        if (!fileMode.secure) throw new Error(`Google key permissions are too broad (${fileMode.mode})`);
        keyData = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        if (keyData?.type !== 'service_account') throw new Error('Google key is not a service account credential');
        for (const field of ['project_id', 'private_key_id', 'private_key', 'client_email']) {
            if (!keyData[field]) throw new Error(`Google key is missing ${field}`);
        }
        return { exists: true, credentialType: keyData.type, ...fileMode };
    });
    await check('google-authentication', async () => validateGoogleCredentials(keyPath));

    await check('google-key-rotation-age', async () => {
        const stat = fs.statSync(keyPath);
        const ageDays = Math.max(0, (new Date(now).getTime() - stat.mtimeMs) / (24 * 60 * 60 * 1000));
        if (ageDays > 180) throw new Error(`Google key file is ${Math.floor(ageDays)} days old`);
        return { ageDays: Math.floor(ageDays), rotateBeforeDays: 180 };
    }, 'advisory');

    await check('secret-ignore-policy', async () => {
        const ignore = fs.readFileSync(path.resolve(cwd, '.gitignore'), 'utf8');
        if (!/^\.env$/m.test(ignore)) throw new Error('.env is not explicitly ignored');
        if (!/sheet[^\n]*key[^\n]*\.json/i.test(ignore)) throw new Error('Google key files are not ignored');
        return { envIgnored: true, googleKeyIgnored: true };
    });

    if (!token) {
        const critical = checks.filter(item => !item.ok && item.severity === 'critical');
        return {
            ok: false,
            checkedAt,
            checkCount: checks.length,
            criticalCount: critical.length,
            advisoryCount: 0,
            checks,
            failures: critical,
            advisories: []
        };
    }

    const headers = { Authorization: `Bot ${token}` };
    let bot = null;
    let member = null;
    let roles = [];
    let guildPermissions = 0n;
    await check('discord-identity', async () => {
        bot = await fetchJson(fetchFn, 'https://discord.com/api/v10/users/@me', { headers });
        if (!bot?.id || bot.bot !== true) throw new Error('Authenticated Discord identity is not a bot');
        return { botId: bot.id, username: bot.username || null };
    });
    await check('discord-application-policy', async () => {
        const application = await fetchJson(fetchFn, 'https://discord.com/api/v10/oauth2/applications/@me', { headers });
        if (application?.bot_public === true) throw new Error('Discord bot is publicly installable');
        return { botPublic: Boolean(application?.bot_public), requireCodeGrant: Boolean(application?.bot_require_code_grant) };
    }, 'advisory');
    await check('discord-guild-permissions', async () => {
        if (!bot?.id) throw new Error('Discord bot identity is unavailable');
        [member, roles] = await Promise.all([
            fetchJson(fetchFn, `https://discord.com/api/v10/guilds/${CONFIG.GUILD_ID}/members/${bot.id}`, { headers }),
            fetchJson(fetchFn, `https://discord.com/api/v10/guilds/${CONFIG.GUILD_ID}/roles`, { headers })
        ]);
        const memberRoleIds = unique(member?.roles || []);
        guildPermissions = calculateGuildPermissions(CONFIG.GUILD_ID, roles, memberRoleIds);
        const missing = REQUIRED_GUILD_PERMISSIONS
            .filter(([, flag]) => !hasPermission(guildPermissions, flag))
            .map(([name]) => name);
        if (missing.length) throw new Error(`Missing guild permission(s): ${missing.join(', ')}`);
        return { required: REQUIRED_GUILD_PERMISSIONS.map(([name]) => name), missing: [] };
    });
    await check('discord-elevated-permissions', async () => {
        const elevated = ELEVATED_PERMISSIONS
            .filter(([, flag]) => (guildPermissions & flag) === flag)
            .map(([name]) => name);
        if (elevated.length) throw new Error(`Elevated permission(s): ${elevated.join(', ')}`);
        return { elevated: [] };
    }, 'advisory');
    await check('discord-role-hierarchy', async () => {
        if (!member || !roles.length) throw new Error('Discord role data is unavailable');
        const memberRoleIds = unique(member.roles || []);
        const botPosition = Math.max(0, ...roles.filter(role => memberRoleIds.includes(String(role.id))).map(role => Number(role.position || 0)));
        const managedRoleIds = unique(Object.values(CONFIG.ROLES || {}));
        const managedRoles = managedRoleIds.map(id => roles.find(role => String(role.id) === id)).filter(Boolean);
        const missingRoleIds = managedRoleIds.filter(id => !managedRoles.some(role => String(role.id) === id));
        const blockedRoles = managedRoles.filter(role => Number(role.position || 0) >= botPosition).map(role => role.name || role.id);
        if (missingRoleIds.length) throw new Error(`Configured Discord role(s) missing: ${missingRoleIds.join(', ')}`);
        if (blockedRoles.length) throw new Error(`Bot role is not above managed role(s): ${blockedRoles.join(', ')}`);
        return { botRolePosition: botPosition, managedRoleCount: managedRoles.length, blockedRoles: [] };
    });

    const reviewChannelIds = new Set(unique([
        CONFIG.DAYOFF_CHANNEL,
        CONFIG.PURCHASE_CHANNEL_ID,
        ...Object.values(CONFIG.DEATH_PENALTY_CHANNEL_IDS || {}),
        ...Object.values(CONFIG.END_ADENA_CHANNEL_IDS || {})
    ]));
    const channelIds = criticalDiscordChannelIds(CONFIG);
    await check('discord-channel-permissions', async () => {
        if (!bot?.id || !member) throw new Error('Discord member data is unavailable');
        const memberRoleIds = unique(member.roles || []);
        const missing = [];
        for (const channelId of channelIds) {
            const channel = await fetchJson(fetchFn, `https://discord.com/api/v10/channels/${channelId}`, { headers });
            const bits = calculateChannelPermissions({
                guildId: CONFIG.GUILD_ID,
                botId: bot.id,
                memberRoleIds,
                guildPermissions,
                channel
            });
            const required = reviewChannelIds.has(channelId)
                ? [...REQUIRED_TEXT_PERMISSIONS, ...REQUIRED_REVIEW_PERMISSIONS]
                : REQUIRED_TEXT_PERMISSIONS;
            const missingNames = required.filter(([, flag]) => !hasPermission(bits, flag)).map(([name]) => name);
            if (missingNames.length) missing.push(`${channelId}:${missingNames.join('+')}`);
        }
        if (missing.length) throw new Error(`Missing channel permission(s): ${missing.join(', ')}`);
        return { channelCount: channelIds.length, reviewChannelCount: reviewChannelIds.size, missing: [] };
    });

    const critical = checks.filter(item => !item.ok && item.severity === 'critical');
    const advisories = checks.filter(item => !item.ok && item.severity === 'advisory');
    return {
        ok: critical.length === 0,
        checkedAt,
        checkCount: checks.length,
        criticalCount: critical.length,
        advisoryCount: advisories.length,
        checks,
        failures: critical.map(item => ({ name: item.name, error: item.error, status: item.status })),
        advisories: advisories.map(item => ({ name: item.name, error: item.error, status: item.status }))
    };
}

module.exports = {
    calculateChannelPermissions,
    calculateGuildPermissions,
    runSecurityPostureAudit
};
