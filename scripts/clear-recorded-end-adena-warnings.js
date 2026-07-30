'use strict';

require('dotenv').config({ override: true });

const fs = require('fs').promises;
const https = require('https');
const { CONFIG } = require('../src/config/constants');

const messageIds = new Set(process.argv.slice(2).filter(Boolean));

if (!messageIds.size) {
    console.error('Usage: node scripts/clear-recorded-end-adena-warnings.js <messageId> [messageId...]');
    process.exit(1);
}

if (!process.env.TOKEN) {
    console.error('Missing TOKEN in .env');
    process.exit(1);
}

function requestDiscord(method, path) {
    return new Promise((resolve, reject) => {
        const req = https.request({
            method,
            hostname: 'discord.com',
            path: `/api/v10${path}`,
            headers: {
                Authorization: `Bot ${process.env.TOKEN}`,
                'User-Agent': 'attendance-bot-maintenance'
            }
        }, res => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ statusCode: res.statusCode, body });
                    return;
                }
                if (method === 'DELETE' && res.statusCode === 404) {
                    resolve({ statusCode: res.statusCode, body });
                    return;
                }
                reject(new Error(`${method} ${path} failed: ${res.statusCode} ${body}`));
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function removeBotReaction(channelId, messageId, emoji) {
    if (!emoji) return;
    await requestDiscord(
        'DELETE',
        `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`
    );
}

async function addBotReaction(channelId, messageId, emoji) {
    if (!emoji) return;
    await requestDiscord(
        'PUT',
        `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`
    );
}

async function main() {
    const file = CONFIG.FILES?.OPS_PENDING || './logs/ops-pending.json';
    const raw = await fs.readFile(file, 'utf8').catch(() => '{"items":[]}');
    const data = JSON.parse(raw);
    const items = Array.isArray(data.items) ? data.items : [];
    const targets = items.filter(item => messageIds.has(String(item.messageId || '')));
    const remaining = items.filter(item => !messageIds.has(String(item.messageId || '')));

    if (!targets.length) {
        console.log('No matching pending items found.');
    }

    for (const item of targets) {
        if (!item.channelId || !item.messageId) continue;
        await removeBotReaction(item.channelId, item.messageId, CONFIG.PURCHASE_FAILURE_EMOJI);
        await removeBotReaction(item.channelId, item.messageId, CONFIG.PURCHASE_PROCESSING_EMOJI);
        await removeBotReaction(item.channelId, item.messageId, CONFIG.PURCHASE_CANCEL_EMOJI);
        await addBotReaction(item.channelId, item.messageId, CONFIG.PURCHASE_APPROVAL_EMOJI);
        await addBotReaction(item.channelId, item.messageId, CONFIG.PURCHASE_SUCCESS_EMOJI);
        console.log(`Marked recorded: ${item.userName || item.messageId} (${item.messageId})`);
    }

    await fs.writeFile(file, JSON.stringify({
        updatedAt: new Date().toISOString(),
        items: remaining
    }, null, 2) + '\n', 'utf8');
    console.log(`Removed ${items.length - remaining.length} pending item(s). Remaining: ${remaining.length}`);
}

main().catch(error => {
    console.error(error.message || error);
    process.exit(1);
});
