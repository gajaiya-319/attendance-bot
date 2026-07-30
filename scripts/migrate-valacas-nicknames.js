'use strict';

require('dotenv').config({ override: true });

const { Client, GatewayIntentBits } = require('discord.js');
const { CONFIG } = require('../src/config/constants');
const createRoleService = require('../src/services/roleService');

const apply = process.argv.includes('--apply');
const limitArg = process.argv.find(arg => arg.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const roleService = createRoleService({ CONFIG });

function getMemberProfile(member) {
    const fromNickname = roleService.getWorkerRoleProfileFromNickname(member.displayName || member.user?.username);
    if (fromNickname?.server === 'HEINE') return fromNickname;
    return null;
}

function shouldMigrate(member, profile) {
    if (!profile || member.user?.bot) return false;
    if (profile.server !== 'HEINE') return false;
    const current = member.displayName || member.user?.username || '';
    const next = roleService.buildWorkerNickname(current, profile);
    return current !== next;
}

async function main() {
    if (!process.env.TOKEN) throw new Error('Missing TOKEN in .env');
    const client = new Client({
        intents: [
            GatewayIntentBits.Guilds,
            GatewayIntentBits.GuildMembers
        ]
    });

    await client.login(process.env.TOKEN);
    try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        await guild.members.fetch();
        const changes = [];

        for (const member of guild.members.cache.values()) {
            const profile = getMemberProfile(member);
            if (!shouldMigrate(member, profile)) continue;
            const current = member.displayName || member.user?.username || member.id;
            const next = roleService.buildWorkerNickname(current, profile);
            changes.push({ member, current, next, profile });
        }

        const selected = changes.slice(0, Number.isFinite(limit) ? limit : changes.length);
        console.log(JSON.stringify({
            mode: apply ? 'apply' : 'dry-run',
            guild: guild.name,
            totalCandidates: changes.length,
            selected: selected.length
        }, null, 2));

        let updated = 0;
        let failed = 0;
        for (const item of selected) {
            const line = `${item.member.id} | ${item.current} -> ${item.next}`;
            if (!apply) {
                console.log(`[DRY] ${line}`);
                continue;
            }
            if (!item.member.manageable) {
                failed += 1;
                console.warn(`[SKIP unmanaged] ${line}`);
                continue;
            }
            try {
                await item.member.setNickname(item.next, 'Valacas server rename: H nickname prefix to V');
                updated += 1;
                console.log(`[OK] ${line}`);
            } catch (error) {
                failed += 1;
                console.warn(`[FAIL] ${line} :: ${error?.message || error}`);
            }
        }

        console.log(JSON.stringify({ updated, failed, dryRun: !apply }, null, 2));
    } finally {
        client.destroy();
    }
}

main().catch(error => {
    console.error(error?.stack || error?.message || error);
    process.exit(1);
});
