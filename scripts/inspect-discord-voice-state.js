'use strict';

require('dotenv').config();

const { Client, GatewayIntentBits } = require('discord.js');
const { CONFIG } = require('../src/config/constants');

const query = String(process.argv[2] || '').trim().toLowerCase();
if (!query) {
    console.error('Usage: node scripts/inspect-discord-voice-state.js <user-id-or-name>');
    process.exit(1);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates
    ]
});

client.once('ready', async () => {
    try {
        const guild = await client.guilds.fetch(CONFIG.GUILD_ID);
        await guild.members.fetch().catch(error => {
            console.warn('[member fetch warning]', error.message || error);
        });

        const matches = [];
        for (const voiceState of guild.voiceStates.cache.values()) {
            const member = voiceState.member || guild.members.cache.get(voiceState.id);
            const displayName = member?.displayName || member?.user?.username || voiceState.id;
            const username = member?.user?.username || '';
            const searchable = `${voiceState.id} ${displayName} ${username}`.toLowerCase();
            if (!searchable.includes(query)) continue;
            matches.push({
                id: voiceState.id,
                displayName,
                username,
                channelId: voiceState.channelId || null,
                channelName: voiceState.channel?.name || null,
                streaming: Boolean(voiceState.streaming),
                selfMute: Boolean(voiceState.selfMute),
                selfDeaf: Boolean(voiceState.selfDeaf),
                serverMute: Boolean(voiceState.serverMute),
                serverDeaf: Boolean(voiceState.serverDeaf)
            });
        }

        console.log(JSON.stringify({
            voiceStateCount: guild.voiceStates.cache.size,
            matches
        }, null, 2));
    } catch (error) {
        console.error(error);
        process.exitCode = 1;
    } finally {
        client.destroy();
    }
});

client.login(process.env.TOKEN);
