'use strict';

function getStrWidth(str) {
    return [...String(str)].reduce((acc, ch) => {
        const code = ch.charCodeAt(0);
        return acc + (code > 0x1100 ? 2 : 1);
    }, 0);
}

function padWidth(str, len) {
    return str + ' '.repeat(Math.max(0, len - getStrWidth(str)));
}

function truncateWidth(str, maxW) {
    let out = '';
    let w = 0;
    for (const ch of String(str)) {
        const cw = ch.charCodeAt(0) > 0x1100 ? 2 : 1;
        if (w + cw > maxW) break;
        out += ch;
        w += cw;
    }
    return out;
}

function formatDuration(mins) {
    return `${Math.floor(mins / 60)}시간 ${mins % 60}분`;
}

function formatExactWidth(str, width) {
    return padWidth(truncateWidth(str, width), width);
}

module.exports = {
    getStrWidth,
    padWidth,
    truncateWidth,
    formatDuration,
    formatExactWidth
};
