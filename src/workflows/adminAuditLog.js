'use strict';

function createAdminAuditLog({
    CONFIG,
    moment,
    fs,
    client,
    getAttendanceData,
    appendAttendanceEvent,
    writeDayOffLog,
    logger = console
}) {
    async function appendAdminAudit(action, payload = {}) {
        try {
            await fs.mkdir('./logs', { recursive: true });
            const record = {
                time: moment().tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss'),
                action,
                ...payload
            };
            await fs.appendFile('./logs/admin-audit.jsonl', `${JSON.stringify(record)}\n`);
        } catch (e) {
            logger.error('[ADMIN AUDIT LOG ERROR]', e);
        }
    }

    async function readAdminAudit(limit = 10) {
        try {
            const raw = await fs.readFile('./logs/admin-audit.jsonl', 'utf8');
            return raw.trim().split(/\r?\n/).filter(Boolean).slice(-limit);
        } catch {
            return [];
        }
    }

    async function writeAdminActionLog(action, actorMember, targetMember = null, details = []) {
        const now = moment().tz(CONFIG.TIMEZONE);
        const actorName = actorMember?.displayName || actorMember?.user?.username || actorMember?.id || 'Unknown';
        const targetName = targetMember?.displayName || targetMember?.user?.username || targetMember?.id || 'N/A';
        const cleanDetails = details.filter(Boolean).map(line => String(line));
        const lines = [
            `\`[${now.format('MM/DD HH:mm')}]\` 🛡️ ADMIN ACTION: **${action}**`,
            `👑 Actor: **${actorName}** (${actorMember?.id || 'unknown'})`,
            `👤 Target: **${targetName}**${targetMember?.id ? ` (${targetMember.id})` : ''}`,
            ...cleanDetails.map(line => `📌 ${line}`)
        ];
        const attendanceData = getAttendanceData();
        if (targetMember?.id && attendanceData[targetMember.id]) {
            appendAttendanceEvent(attendanceData[targetMember.id], 'admin_action', now, 'admin-command', {
                action,
                actorId: actorMember?.id || null,
                actorName,
                targetId: targetMember.id,
                targetName,
                details: cleanDetails
            });
        }
        await appendAdminAudit(action, {
            actorId: actorMember?.id || null,
            actorName,
            targetId: targetMember?.id || null,
            targetName,
            details: cleanDetails
        });
        await writeDayOffLog(lines.join('\n'));
    }

    return {
        appendAdminAudit,
        readAdminAudit,
        writeAdminActionLog
    };
}

module.exports = {
    createAdminAuditLog
};
