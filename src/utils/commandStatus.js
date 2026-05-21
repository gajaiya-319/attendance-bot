'use strict';

function hasStatusPrefix(text) {
    return /^[✅❌⏳]/u.test(text);
}

function okText(content) {
    const text = String(content || 'Completed.');
    return hasStatusPrefix(text) ? text : `✅ ${text}`;
}

function failText(content) {
    const text = String(content || 'Failed.');
    return hasStatusPrefix(text) ? text : `❌ ${text}`;
}

function pendingText(content) {
    const text = String(content || 'Processing...');
    return hasStatusPrefix(text) ? text : `⏳ ${text}`;
}

function commandStatusText(content) {
    const text = String(content || '');
    if (!text || hasStatusPrefix(text)) return text;
    const failPattern = /no perms|admin only|owner only|not found|not checked in|no role|invalid|failed|fail|cannot|could not|restore failed|backup failed|찾지 못|없습니다|권한|올바르지|실패|오류/i;
    return failPattern.test(text) ? failText(text) : okText(text);
}

function withCommandStatusPayload(payload) {
    if (typeof payload === 'string') return commandStatusText(payload);
    if (!payload || typeof payload !== 'object' || !Object.prototype.hasOwnProperty.call(payload, 'content')) return payload;
    return {
        ...payload,
        content: commandStatusText(payload.content)
    };
}

module.exports = {
    okText,
    failText,
    pendingText,
    commandStatusText,
    withCommandStatusPayload
};
