'use strict';

require('dotenv').config();

const fs = require('fs/promises');
const path = require('path');

const STATUS_EMOJI = {
    pending: '⏳',
    approved: '✅',
    rejected: '❌',
    cancelled: '❌'
};
const STATUS_EMOJIS = [...new Set(Object.values(STATUS_EMOJI))];

function usage() {
    console.error('Usage: node scripts/repair-dayoff-status-reaction.js <messageId> <pending|approved|rejected|cancelled>');
    process.exit(2);
}

async function react(channelId, messageId, emoji) {
    const token = process.env.TOKEN;
    if (!token) return { ok: false, skipped: true, reason: 'missing-token' };
    const encodedEmoji = encodeURIComponent(emoji);
    const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`;
    const response = await fetch(url, {
        method: 'PUT',
        headers: {
            Authorization: `Bot ${token}`
        }
    });
    if (response.ok || response.status === 204) return { ok: true, status: response.status };
    let body = null;
    try {
        body = await response.json();
    } catch {
        body = await response.text().catch(() => null);
    }
    return { ok: false, status: response.status, body };
}

async function removeOwnReaction(channelId, messageId, emoji) {
    const token = process.env.TOKEN;
    if (!token) return { ok: false, skipped: true, reason: 'missing-token' };
    const encodedEmoji = encodeURIComponent(emoji);
    const url = `https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`;
    const response = await fetch(url, {
        method: 'DELETE',
        headers: {
            Authorization: `Bot ${token}`
        }
    });
    if (response.ok || response.status === 204 || response.status === 404) return { ok: true, status: response.status };
    let body = null;
    try {
        body = await response.json();
    } catch {
        body = await response.text().catch(() => null);
    }
    return { ok: false, status: response.status, body };
}

async function replaceStatusReaction(channelId, messageId, targetEmoji) {
    const removed = [];
    for (const emoji of STATUS_EMOJIS) {
        if (emoji === targetEmoji) continue;
        removed.push({ emoji, result: await removeOwnReaction(channelId, messageId, emoji) });
    }
    return {
        removed,
        added: await react(channelId, messageId, targetEmoji)
    };
}

async function main() {
    const [messageId, status] = process.argv.slice(2);
    if (!messageId || !STATUS_EMOJI[status]) usage();

    const file = path.resolve('attendanceData.json');
    const raw = await fs.readFile(file, 'utf8');
    const state = JSON.parse(raw);
    const reservations = state.dayOffReservations || {};
    const reservation = reservations[messageId];
    if (!reservation) throw new Error(`Reservation not found: ${messageId}`);

    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 12);
    await fs.copyFile(file, path.resolve('backups', `attendanceData-${stamp}-before-dayoff-status-reaction-repair.json`));

    reservation.status = status;
    reservation.updatedAt = new Date().toISOString();
    if (status === 'approved') {
        reservation.approvedBy = reservation.approvedBy || process.env.DAYOFF_REVIEWER_ID || null;
        reservation.approvedByName = reservation.approvedByName || 'Repair Script';
        for (const duplicate of Object.values(reservations)) {
            if (!duplicate || duplicate.messageId === messageId) continue;
            if (
                ['pending', 'approved'].includes(duplicate.status) &&
                duplicate.userId === reservation.userId &&
                duplicate.leaveDate === reservation.leaveDate &&
                duplicate.shift === reservation.shift
            ) {
                duplicate.status = 'cancelled';
                duplicate.cancelledAt = new Date().toISOString();
                duplicate.cancelledBy = process.env.DAYOFF_REVIEWER_ID || 'repair-script';
                duplicate.cancelledByName = 'Superseded by repaired approved request';
                duplicate.cancelReason = `Superseded by repaired request ${messageId}`;
            }
        }
    }
    reservations[messageId] = reservation;
    state.dayOffReservations = reservations;
    await fs.writeFile(file, JSON.stringify(state, null, 2));

    const emoji = STATUS_EMOJI[status];
    const originalReaction = await replaceStatusReaction(reservation.channelId, reservation.messageId, emoji);
    let fallbackReaction = null;
    if (!originalReaction.added.ok && reservation.statusFallbackMessageId) {
        fallbackReaction = await replaceStatusReaction(reservation.channelId, reservation.statusFallbackMessageId, emoji);
    }

    console.log(JSON.stringify({
        messageId,
        status,
        emoji,
        originalReaction,
        fallbackReaction
    }, null, 2));
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
