'use strict';

require('dotenv').config({ override: true });

const { Client, GatewayIntentBits } = require('discord.js');
const { CONFIG } = require('../src/config/constants');

function baseName(value) {
    return String(value || '')
        .split(/\s*[-\u2013\u2014]\s*/)[0]
        .trim();
}

async function main() {
    if (!process.env.TOKEN) throw new Error('Missing TOKEN in .env');
    const client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
    });

    await new Promise((resolve, reject) => {
        client.once('ready', resolve);
        client.login(process.env.TOKEN).catch(reject);
    });

    const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
    await guild.members.fetch();

    const rows = [];
    for (const member of guild.members.cache.values()) {
        if (member.user?.bot) continue;
        const server = member.roles.cache.has(CONFIG.ROLES.HEINE)
            ? '\uBC1C\uB77C\uCE74\uC2A4'
            : (member.roles.cache.has(CONFIG.ROLES.PAAGRIO) ? '\uD30C\uC544\uADF8\uB9AC\uC624' : null);
        const shift = member.roles.cache.has(CONFIG.ROLES.DAY)
            ? 'DAY'
            : (member.roles.cache.has(CONFIG.ROLES.NIGHT) ? 'NIGHT' : null);
        if (server && shift) rows.push(`${server}|${shift}|${baseName(member.displayName || member.user.username)}`);
    }

    rows.sort((a, b) => a.localeCompare(b));
    console.log(`discordWorkers=${rows.length}`);
    console.log(rows.join('\n'));
    client.destroy();
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
