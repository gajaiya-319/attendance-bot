'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PermissionFlagsBits } = require('discord.js');
const {
    calculateChannelPermissions,
    runSecurityPostureAudit
} = require('../src/services/securityPostureAuditService');

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body
    };
}

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-posture-audit-'));
    try {
        fs.writeFileSync(path.join(dir, '.env'), 'TOKEN=not-a-real-token\n');
        fs.writeFileSync(path.join(dir, '.gitignore'), '.env\n*sheet*key*.json\n');
        fs.writeFileSync(path.join(dir, 'sheet-bot-key.json'), JSON.stringify({
            type: 'service_account',
            project_id: 'test-project',
            private_key_id: 'test-key-id',
            private_key: 'test-private-key',
            client_email: 'test@test-project.iam.gserviceaccount.com'
        }));

        const guildId = '100000000000000001';
        const botId = '100000000000000002';
        const botRoleId = '100000000000000003';
        const managedRoleId = '100000000000000004';
        const channelId = '100000000000000005';
        const permissions = PermissionFlagsBits.ManageRoles |
            PermissionFlagsBits.ManageNicknames |
            PermissionFlagsBits.ViewChannel |
            PermissionFlagsBits.SendMessages |
            PermissionFlagsBits.ReadMessageHistory |
            PermissionFlagsBits.AddReactions |
            PermissionFlagsBits.ManageMessages;
        const roles = [
            { id: guildId, name: '@everyone', position: 0, permissions: '0' },
            { id: managedRoleId, name: 'Working', position: 2, permissions: '0' },
            { id: botRoleId, name: 'Attendance Bot', position: 10, permissions: permissions.toString() }
        ];
        const CONFIG = {
            GUILD_ID: guildId,
            OWNER_IDS: ['100000000000000006'],
            PURCHASE_GOOGLE_KEY_FILE: './sheet-bot-key.json',
            LOG_CHANNEL: channelId,
            DAYOFF_CHANNEL: channelId,
            ROLES: { WORKING: managedRoleId },
            DEATH_PENALTY_CHANNEL_IDS: {},
            END_ADENA_CHANNEL_IDS: {}
        };
        let publicBot = false;
        const fetchFn = async url => {
            if (url.endsWith('/users/@me')) return response({ id: botId, username: 'Attendance Bot', bot: true });
            if (url.endsWith('/oauth2/applications/@me')) {
                return response({ id: 'app-id', bot_public: publicBot, bot_require_code_grant: false });
            }
            if (url.endsWith(`/guilds/${guildId}/members/${botId}`)) return response({ user: { id: botId }, roles: [botRoleId] });
            if (url.endsWith(`/guilds/${guildId}/roles`)) return response(roles);
            if (url.endsWith(`/channels/${channelId}`)) return response({ id: channelId, type: 0, permission_overwrites: [] });
            return response({ message: 'not found' }, 404);
        };
        const baseOptions = {
            CONFIG,
            token: 'x'.repeat(40),
            cwd: dir,
            fetchFn,
            platform: 'win32',
            validateGoogleCredentials: async () => ({ authenticated: true }),
            now: new Date()
        };
        const healthy = await runSecurityPostureAudit(baseOptions);
        assert.strictEqual(healthy.ok, true);
        assert.strictEqual(healthy.criticalCount, 0);
        assert.strictEqual(healthy.advisoryCount, 0);

        publicBot = true;
        const advisory = await runSecurityPostureAudit(baseOptions);
        assert.strictEqual(advisory.ok, true, 'advisory does not block required operations');
        assert.strictEqual(advisory.advisoryCount, 1);
        assert.strictEqual(advisory.advisories[0].name, 'discord-application-policy');

        const denied = calculateChannelPermissions({
            guildId,
            botId,
            memberRoleIds: [botRoleId],
            guildPermissions: permissions,
            channel: {
                permission_overwrites: [{
                    id: botId,
                    type: 1,
                    allow: '0',
                    deny: PermissionFlagsBits.SendMessages.toString()
                }]
            }
        });
        assert.strictEqual((denied & PermissionFlagsBits.SendMessages) === PermissionFlagsBits.SendMessages, false);
        console.log('security-posture-audit-service tests passed');
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
})().catch(error => {
    console.error(error);
    process.exit(1);
});
