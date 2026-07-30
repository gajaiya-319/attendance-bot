'use strict';

const AUTO_OT_CONFIRM_PREFIX = 'auto_ot_confirm';

function normalizeActivityText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function getOvertimeActivityDenylist(CONFIG = {}) {
    const configured = Array.isArray(CONFIG.OT_ACTIVITY_DENYLIST)
        ? CONFIG.OT_ACTIVITY_DENYLIST
        : String(CONFIG.OT_ACTIVITY_DENYLIST || '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    return configured
        .map(normalizeActivityText)
        .filter(Boolean);
}

function getOvertimeActivityAllowlist(CONFIG = {}) {
    const configured = Array.isArray(CONFIG.OT_ACTIVITY_ALLOWLIST)
        ? CONFIG.OT_ACTIVITY_ALLOWLIST
        : String(CONFIG.OT_ACTIVITY_ALLOWLIST || '')
            .split(',')
            .map(item => item.trim())
            .filter(Boolean);
    return configured
        .map(normalizeActivityText)
        .filter(Boolean);
}

function getUnknownActivityPolicy(CONFIG = {}) {
    const policy = String(CONFIG.AUTO_OT_UNKNOWN_ACTIVITY_POLICY || 'allow').toLowerCase();
    return ['allow', 'hold', 'block'].includes(policy) ? policy : 'allow';
}

function getMemberActivities(member) {
    const activities = member?.presence?.activities ||
        member?.guild?.presences?.cache?.get?.(member.id)?.activities ||
        [];
    return Array.isArray(activities) ? activities : [];
}

function isCustomStatusActivity(activity) {
    const type = activity?.type;
    return type === 4 ||
        String(type || '').toLowerCase() === 'custom' ||
        String(activity?.name || '').toLowerCase() === 'custom status';
}

function getMemberActivityEntries(member, { trustedOnly = true } = {}) {
    const activities = getMemberActivities(member);
    return activities
        .filter(activity => !trustedOnly || !isCustomStatusActivity(activity))
        .flatMap(activity => [
            { value: activity?.name, field: 'name', type: activity?.type ?? null },
            { value: activity?.details, field: 'details', type: activity?.type ?? null },
            { value: activity?.state, field: 'state', type: activity?.type ?? null },
            { value: activity?.assets?.largeText, field: 'largeText', type: activity?.type ?? null },
            { value: activity?.assets?.smallText, field: 'smallText', type: activity?.type ?? null }
        ])
        .map(entry => ({
            ...entry,
            text: String(entry.value || '').trim()
        }))
        .filter(entry => Boolean(entry.text));
}

function getMemberActivityNames(member) {
    return getMemberActivityEntries(member).map(entry => entry.text);
}

function findDeniedOvertimeActivity(member, CONFIG = {}) {
    const denylist = getOvertimeActivityDenylist(CONFIG);
    if (denylist.length === 0) return null;
    for (const entry of getMemberActivityEntries(member)) {
        const rawName = entry.text;
        const normalized = normalizeActivityText(rawName);
        if (!normalized) continue;
        const matched = denylist.find(denied => normalized.includes(denied));
        if (matched) {
            return {
                name: rawName,
                matched,
                field: entry.field,
                type: entry.type
            };
        }
    }
    return null;
}

function findAllowedOvertimeActivity(member, CONFIG = {}) {
    const allowlist = getOvertimeActivityAllowlist(CONFIG);
    if (allowlist.length === 0) return null;
    for (const entry of getMemberActivityEntries(member)) {
        const rawName = entry.text;
        const normalized = normalizeActivityText(rawName);
        if (!normalized) continue;
        const matched = allowlist.find(allowed => normalized.includes(allowed));
        if (matched) {
            return {
                name: rawName,
                matched,
                field: entry.field,
                type: entry.type
            };
        }
    }
    return null;
}

function classifyOvertimeActivityRisk(member, CONFIG = {}) {
    const activityNames = getMemberActivityNames(member);
    const denied = findDeniedOvertimeActivity(member, CONFIG);
    if (denied) {
        return {
            status: 'denied',
            shouldBlock: true,
            reason: 'denied-activity',
            activityName: denied.name,
            matched: denied.matched,
            activityNames
        };
    }

    if (activityNames.length === 0) {
        const policy = getUnknownActivityPolicy(CONFIG);
        return {
            status: 'unknown',
            shouldBlock: policy !== 'allow',
            reason: 'activity-not-visible',
            policy,
            activityName: null,
            matched: null,
            activityNames
        };
    }

    const allowlist = getOvertimeActivityAllowlist(CONFIG);
    if (allowlist.length > 0) {
        const allowed = findAllowedOvertimeActivity(member, CONFIG);
        return {
            status: allowed ? 'allowed' : 'unverified',
            shouldBlock: !allowed,
            reason: allowed ? 'allowed-activity' : 'activity-not-allowlisted',
            activityName: allowed?.name || null,
            matched: allowed?.matched || null,
            activityNames
        };
    }

    return {
        status: 'visible',
        shouldBlock: false,
        reason: 'visible-activity',
        activityName: null,
        matched: null,
        activityNames
    };
}

function createAutoOtConfirmToken(now) {
    const base = now?.valueOf ? now.valueOf() : Date.now();
    return `${base.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function buildAutoOtConfirmCustomId(action, userId, token) {
    return `${AUTO_OT_CONFIRM_PREFIX}:${action}:${userId}:${token}`;
}

function parseAutoOtConfirmCustomId(customId) {
    const parts = String(customId || '').split(':');
    if (parts.length !== 4 || parts[0] !== AUTO_OT_CONFIRM_PREFIX) return null;
    const [, action, userId, token] = parts;
    if (!['start', 'cancel'].includes(action) || !userId || !token) return null;
    return { action, userId, token };
}

function isAutoOtConfirmCustomId(customId) {
    return Boolean(parseAutoOtConfirmCustomId(customId));
}

function formatAutoOtActivityEvidence({ activityStatus = null, activityNames = [], activityName = null } = {}) {
    const names = Array.isArray(activityNames)
        ? [...new Set(activityNames.map(name => String(name || '').trim()).filter(Boolean))]
        : [];
    const visibleNames = names.slice(0, 4).join(', ');
    const suffix = names.length > 4 ? `, +${names.length - 4} more` : '';
    const primaryName = String(activityName || '').trim();

    if (primaryName) return `Activity evidence: ${primaryName}`;
    if (visibleNames) return `Activity evidence: ${visibleNames}${suffix}`;
    if (activityStatus === 'unknown') return 'Activity evidence: not visible';
    return 'Activity evidence: not verified';
}

function buildAutoOtConfirmDmPayload({
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    userId,
    token,
    expiresAt,
    reminder = false,
    reminderCount = 0,
    activityStatus = null,
    activityNames = [],
    activityName = null,
    activityFallback = null
}) {
    const fire = '\uD83D\uDD25';
    const hasContinuousLiveFallback = activityStatus === 'unknown' && activityFallback === 'continuous-live';
    const lines = [
        reminder ? `${fire} OT confirmation reminder` : `${fire} Are you planning to do OT?`,
        '',
        'I detected that your LIVE continued after your scheduled shift.',
        'Please confirm only if this is work-related overtime.',
        'LIVE must stay ON to count as OT. Voice-channel presence alone is not OT.',
        'If LIVE is OFF when you press Start OT, OT will not start.',
        formatAutoOtActivityEvidence({ activityStatus, activityNames, activityName }),
        hasContinuousLiveFallback
            ? 'Fallback evidence: continuous LIVE from shift end. Start OT will re-check it.'
            : null,
        activityStatus === 'unknown' && activityFallback === 'late-return-live'
            ? 'Fallback evidence: LIVE is on now. Start OT will open a new OT session from now.'
            : null,
        activityStatus === 'unknown' && !hasContinuousLiveFallback
            && activityFallback !== 'late-return-live'
            ? 'If activity stays hidden, Start OT will not start automatically.'
            : null,
        expiresAt
            ? `This request expires at ${expiresAt.format('HH:mm')}.`
            : 'This request stays open until you choose Start OT or Cancel.',
        reminder && reminderCount > 0 ? `Reminder #${reminderCount}.` : null
    ].filter(Boolean);

    const payload = { content: lines.join('\n') };
    if (!ActionRowBuilder || !ButtonBuilder || !ButtonStyle) return payload;

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(buildAutoOtConfirmCustomId('start', userId, token))
            .setLabel(`${fire} Start OT`)
            .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
            .setCustomId(buildAutoOtConfirmCustomId('cancel', userId, token))
            .setLabel('Cancel')
            .setStyle(ButtonStyle.Secondary)
    );
    payload.components = [row];
    return payload;
}

module.exports = {
    AUTO_OT_CONFIRM_PREFIX,
    classifyOvertimeActivityRisk,
    normalizeActivityText,
    getOvertimeActivityAllowlist,
    getOvertimeActivityDenylist,
    getMemberActivityEntries,
    getMemberActivityNames,
    findAllowedOvertimeActivity,
    findDeniedOvertimeActivity,
    createAutoOtConfirmToken,
    buildAutoOtConfirmCustomId,
    parseAutoOtConfirmCustomId,
    isAutoOtConfirmCustomId,
    buildAutoOtConfirmDmPayload
};
