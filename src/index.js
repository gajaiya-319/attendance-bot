require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { CONFIG } = require('./config/constants');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

client.commands = new Collection();

function loadEvents(targetClient) {
    const eventsPath = path.join(__dirname, 'events');
    if (!fs.existsSync(eventsPath)) return;

    const eventFiles = fs.readdirSync(eventsPath).filter(file => file.endsWith('.js'));
    for (const file of eventFiles) {
        const event = require(path.join(eventsPath, file));
        if (!event?.name || typeof event.execute !== 'function') continue;

        if (event.once) {
            targetClient.once(event.name, (...args) => event.execute(...args, targetClient));
        } else {
            targetClient.on(event.name, (...args) => event.execute(...args, targetClient));
        }
    }
}

client.on('error', e => console.error('[CLIENT ERROR]', e));
process.on('unhandledRejection', e => console.error('[UNHANDLED REJECTION]', e));

loadEvents(client);

if (require.main === module) {
    if (!process.env.TOKEN) {
        console.error('[CONFIG ERROR] Missing TOKEN in .env');
        process.exit(1);
    }

    console.log(`[BOOT] ${CONFIG.VERSION} - loading modular entry`);
    client.login(process.env.TOKEN);
}

module.exports = {
    client,
    loadEvents
};
