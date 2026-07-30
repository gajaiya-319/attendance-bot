'use strict';

require('dotenv').config({ override: true });

const { Client, GatewayIntentBits } = require('discord.js');
const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const createRoleService = require('../src/services/roleService');
const { createRawAttendanceSheetService } = require('../src/services/rawAttendanceSheetService');

async function main() {
    if (!process.env.TOKEN) throw new Error('Missing TOKEN in .env');

    const roleService = createRoleService({ CONFIG });
    const rawAttendanceSheetService = createRawAttendanceSheetService({
        google,
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        spreadsheetId: CONFIG.RAW_ATTENDANCE_SPREADSHEET_ID || CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID,
        webAppUrl: null,
        logger: console
    });

    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });
    await new Promise((resolve, reject) => {
        client.once('ready', resolve);
        client.login(process.env.TOKEN).catch(reject);
    });

    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    await guild.members.fetch();

    const profiles = [];
    for (const member of guild.members.cache.values()) {
        if (!member || member.user?.bot) continue;
        const profile = roleService.getWorkerRoleProfileFromMember(member);
        if (!profile) continue;
        profiles.push({
            name: roleService.getWorkerNicknameBase(member.displayName || member.user?.username || 'Unknown'),
            server: profile.server,
            shift: profile.shift
        });
    }

    const result = await rawAttendanceSheetService.syncWorkerProfiles(profiles);
    const count = result?.count ?? profiles.length;
    const rows = profiles
        .map(profile => `${profile.server === 'HEINE' ? '\uBC1C\uB77C\uCE74\uC2A4' : '\uD30C\uC544\uADF8\uB9AC\uC624'}|${profile.shift}|${profile.name}`)
        .sort((a, b) => a.localeCompare(b));

    console.log(`syncedCurrentWorkers=${count}`);
    console.log(rows.join('\n'));
    client.destroy();
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
