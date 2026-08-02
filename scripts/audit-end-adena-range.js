'use strict';

require('dotenv').config({ override: true });

const fs = require('fs');
const path = require('path');
const moment = require('moment-timezone');
const { google } = require('googleapis');
const { CONFIG, SHIFT_SCHEDULE, MAINTENANCE_WINDOWS } = require('../src/config/constants');
const createTimeLogic = require('../time-logic');
const { parseEndAdenaMessage } = require('../src/utils/endAdenaMessage');
const {
    findSectionHeader,
    findDayRow,
    getColumnLetter,
    normalizeAliasMap,
    normalizePayrollServer,
    parseNumber,
    resolveAdenaCell,
    resolveAdenaSummaryCell
} = require('../src/services/purchaseSheetService');

const DISCORD_API = 'https://discord.com/api/v10';
const MAX_DISCORD_PAGES = 20;

function readArg(argv, name, fallback = '') {
    const index = argv.indexOf(name);
    return index >= 0 ? argv[index + 1] : fallback;
}

function parseArgs(argv) {
    return {
        from: readArg(argv, '--from'),
        to: readArg(argv, '--to'),
        attendanceFile: readArg(argv, '--attendance-file', CONFIG.FILES.DATA),
        operationFiles: readArg(argv, '--operation-files')
            .split(',')
            .map(value => value.trim())
            .filter(Boolean),
        output: readArg(argv, '--output', path.join('outputs', 'end-adena-range-audit-latest.json')),
        noOutput: argv.includes('--no-output')
    };
}

function parseBusinessDate(value, label) {
    const parsed = moment.tz(String(value || ''), 'YYYY-MM-DD', true, CONFIG.TIMEZONE);
    if (!parsed.isValid()) throw new Error(`${label} must use YYYY-MM-DD`);
    return parsed.startOf('day');
}

function dateKeysBetween(from, to) {
    const keys = [];
    for (const cursor = from.clone(); cursor.isSameOrBefore(to, 'day'); cursor.add(1, 'day')) {
        keys.push(cursor.format('YYYY-MM-DD'));
    }
    return keys;
}

function normalizeEmoji(value) {
    return String(value || '').replace(/\uFE0F/g, '');
}

function hasReaction(message, emoji) {
    const target = normalizeEmoji(emoji);
    return (message?.reactions || []).some(reaction => (
        normalizeEmoji(reaction?.emoji?.name) === target && Number(reaction?.count || 0) > 0
    ));
}

function parseJsonLines(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => JSON.parse(line));
}

function loadOperations(files) {
    return files.flatMap(parseJsonLines).sort((left, right) => (
        Date.parse(left?.createdAt || '') - Date.parse(right?.createdAt || '')
    ));
}

function latestEndAdenaOperations(operations) {
    const latest = new Map();
    for (const operation of operations || []) {
        if (operation?.kind !== 'end-adena' || operation?.status !== 'success' || !operation?.messageId) continue;
        latest.set(String(operation.messageId), operation);
    }
    return latest;
}

function parseDeclaredStart(parsed) {
    if (!parsed?.startDate || !parsed?.startTime) return null;
    const formats = [
        'M/D/YYYY h:mm A', 'MM/D/YYYY h:mm A',
        'M/DD/YYYY h:mm A', 'MM/DD/YYYY h:mm A',
        'M-D-YYYY h:mm A', 'MM-D-YYYY h:mm A',
        'M-DD-YYYY h:mm A', 'MM-DD-YYYY h:mm A',
        'YYYY-M-D h:mm A', 'YYYY-MM-DD h:mm A',
        'M/D/YYYY H:mm', 'YYYY-M-D H:mm'
    ];
    const declared = moment.tz(
        `${parsed.startDate} ${parsed.startTime}`,
        formats,
        true,
        parsed.startTimezone || CONFIG.TIMEZONE
    );
    return declared.isValid() ? declared.tz(CONFIG.TIMEZONE) : null;
}

function shiftFromText(value) {
    const text = String(value || '').toLowerCase();
    if (/\bday\s*time\b|\bdaytime\b/.test(text)) return 'DAY';
    if (/\bnight\s*time\b|\bnighttime\b/.test(text)) return 'NIGHT';
    return null;
}

function memberShift(member) {
    const roles = new Set(member?.roles || []);
    if (roles.has(CONFIG.ROLES.DAY)) return 'DAY';
    if (roles.has(CONFIG.ROLES.NIGHT)) return 'NIGHT';
    return shiftFromText(member?.nick || member?.user?.global_name || member?.user?.username);
}

function memberServer(member) {
    const roles = new Set(member?.roles || []);
    if (roles.has(CONFIG.ROLES.PAAGRIO)) return 'PAAGRIO';
    if (roles.has(CONFIG.ROLES.HEINE)) return 'VALAKAS';
    const text = String(member?.nick || member?.user?.global_name || member?.user?.username || '');
    if (/\s-\s*p\b/i.test(text)) return 'PAAGRIO';
    if (/\s-\s*v\b/i.test(text)) return 'VALAKAS';
    return null;
}

function cleanMemberName(value) {
    return String(value || '').split('-')[0].trim();
}

function resolvePostContext({ parsed, message, attendanceUser, operation, timeLogic }) {
    const operationAudit = operation?.payload?.audit || operation?.audit || {};
    const operationShift = String(operation?.shift || operation?.payload?.shift || '').toUpperCase();
    const created = moment(
        message?.timestamp || message?.created_at || operationAudit.messageCreatedAt || operation?.createdAt
    ).tz(CONFIG.TIMEZONE);
    if (!created.isValid()) return { ok: false, code: 'post-date-unresolved' };
    let shift = String(attendanceUser?.shift || '').toUpperCase() ||
        memberShift(message?.member) ||
        operationShift ||
        shiftFromText(message?.member?.nick);
    if (!['DAY', 'NIGHT'].includes(shift)) {
        const hour = created.hour();
        shift = hour >= 9 && hour < 21 ? 'DAY' : 'NIGHT';
    }
    if (!['DAY', 'NIGHT'].includes(shift)) return { ok: false, code: 'shift-unresolved' };

    const operationSessionType = String(operationAudit?.attendanceSessionType || '').toUpperCase();
    let submissionType = String(parsed?.submissionType || '').toUpperCase();
    if (!submissionType && operationSessionType) {
        submissionType = operationSessionType === 'REGULAR' ? 'REGULAR' : 'OVERTIME';
    }
    if (!['REGULAR', 'OVERTIME'].includes(submissionType)) submissionType = 'REGULAR';

    let bounds = null;
    const trustedAttendanceWindow = Boolean(
        operationAudit.attendanceSessionId &&
        operationAudit.shiftStartAt &&
        operationAudit.shiftEndAt
    );
    if (trustedAttendanceWindow) {
        const start = moment(operationAudit.shiftStartAt).tz(CONFIG.TIMEZONE);
        const end = moment(operationAudit.shiftEndAt).tz(CONFIG.TIMEZONE);
        if (start.isValid() && end.isValid()) {
            bounds = { start, end };
            if (['DAY', 'NIGHT'].includes(operationShift)) shift = operationShift;
        }
    }
    if (!bounds && operationAudit.shiftStartAt) {
        const start = moment(operationAudit.shiftStartAt).tz(CONFIG.TIMEZONE);
        const end = moment(operationAudit.shiftEndAt).tz(CONFIG.TIMEZONE);
        if (start.isValid() && end.isValid()) {
            bounds = { start, end };
        }
    }
    if (!bounds) {
        bounds = timeLogic.getShiftBounds(shift.toLowerCase(), created);
    }

    return {
        ok: true,
        shift,
        submissionType,
        declaredStartAt: null,
        businessDate: created.format('YYYY-MM-DD'),
        shiftStartAt: bounds.start.toISOString(),
        shiftEndAt: bounds.end.toISOString(),
        dateSource: 'message-created-at',
        declaredDateConflict: false
    };
}

function getMessageState(message, operation) {
    const cancelled = hasReaction(message, CONFIG.PURCHASE_CANCEL_EMOJI) ||
        String(operation?.action || '').toLowerCase() === 'cancel';
    if (cancelled) return 'CANCELLED';
    const approved = hasReaction(message, CONFIG.PURCHASE_APPROVAL_EMOJI);
    const succeeded = hasReaction(message, CONFIG.PURCHASE_SUCCESS_EMOJI) ||
        String(operation?.action || '').toLowerCase() === 'approve';
    if (approved && succeeded) return 'APPROVED';
    if (approved && hasReaction(message, CONFIG.PURCHASE_FAILURE_EMOJI)) return 'FAILED';
    if (approved) return 'PENDING';
    return 'UNAPPROVED';
}

async function discordRequest(route, token, attempt = 1) {
    const response = await fetch(`${DISCORD_API}${route}`, {
        headers: { Authorization: `Bot ${token}` }
    });
    if (response.status === 429 && attempt < 5) {
        const body = await response.json().catch(() => ({}));
        await new Promise(resolve => setTimeout(resolve, Math.ceil(Number(body.retry_after || 1) * 1000)));
        return discordRequest(route, token, attempt + 1);
    }
    if (!response.ok) throw new Error(`Discord ${response.status} for ${route}: ${await response.text()}`);
    return response.json();
}

async function fetchChannelMessages(channelId, oldestMs, token) {
    const messages = [];
    let before = '';
    for (let page = 0; page < MAX_DISCORD_PAGES; page += 1) {
        const query = new URLSearchParams({ limit: '100' });
        if (before) query.set('before', before);
        const batch = await discordRequest(`/channels/${channelId}/messages?${query}`, token);
        if (!batch.length) break;
        messages.push(...batch);
        before = batch[batch.length - 1].id;
        const batchOldest = Math.min(...batch.map(message => Date.parse(message.timestamp || '')));
        if (Number.isFinite(batchOldest) && batchOldest < oldestMs) break;
        if (batch.length < 100) break;
    }
    return messages;
}

async function fetchMember(userId, token) {
    return discordRequest(`/guilds/${CONFIG.GUILD_ID}/members/${userId}`, token).catch(() => null);
}

function createSheetContext(tab, rows) {
    return { tab, rows };
}

function resolveSheetEntry(sheetContexts, aliases, { server, shift, businessDate, userName }) {
    const normalizedServer = normalizePayrollServer(server);
    const sheet = sheetContexts[normalizedServer];
    if (!sheet) return { ok: false, code: 'server-sheet-not-found' };
    const sectionLabel = CONFIG.PURCHASE_SECTION_LABELS[shift];
    const dayOfMonth = Number(String(businessDate).slice(-2));
    const cell = resolveAdenaCell(sheet.rows, {
        sectionLabel,
        sectionLabels: CONFIG.PURCHASE_SECTION_LABELS,
        userName,
        dayOfMonth,
        aliases
    });
    if (!cell.ok) return { ...cell, server: normalizedServer, tab: sheet.tab };
    const headerRowIndex = findSectionHeader(sheet.rows, sectionLabel);
    const sheetUserName = String(sheet.rows[headerRowIndex]?.[cell.colIndex] || userName).trim();
    const summary = resolveAdenaSummaryCell(sheet.rows, { shift, userName: sheetUserName, aliases });
    return {
        ok: true,
        server: normalizedServer,
        tab: sheet.tab,
        shift,
        businessDate,
        userName: sheetUserName,
        range: `'${sheet.tab}'!${getColumnLetter(cell.colIndex)}${cell.rowIndex + 1}`,
        value: parseNumber(sheet.rows[cell.rowIndex]?.[cell.colIndex]),
        summaryRange: summary.ok ? `'${sheet.tab}'!${getColumnLetter(summary.colIndex)}${summary.rowIndex + 1}` : null,
        summaryValue: summary.ok ? parseNumber(sheet.rows[summary.rowIndex]?.[summary.colIndex]) : null
    };
}

function enumerateSheetEntries(sheetContexts, dateKeys) {
    const entries = [];
    for (const [server, sheet] of Object.entries(sheetContexts)) {
        for (const shift of ['DAY', 'NIGHT']) {
            const sectionLabel = CONFIG.PURCHASE_SECTION_LABELS[shift];
            const headerRowIndex = findSectionHeader(sheet.rows, sectionLabel);
            if (headerRowIndex < 0) continue;
            const header = sheet.rows[headerRowIndex] || [];
            for (const businessDate of dateKeys) {
                const rowIndex = findDayRow(
                    sheet.rows,
                    Number(businessDate.slice(-2)),
                    headerRowIndex + 1,
                    sheet.rows.length
                );
                if (rowIndex < 0) continue;
                for (let column = 0; column < header.length; column += 1) {
                    const userName = String(header[column] || '').trim();
                    const next = String(header[column + 1] || '').trim().toUpperCase();
                    const afterNext = String(header[column + 2] || '').trim().toUpperCase();
                    if (!userName || next !== 'BONUS' || afterNext !== 'D&C') continue;
                    const value = parseNumber(sheet.rows[rowIndex]?.[column]);
                    entries.push({
                        ok: true,
                        server,
                        tab: sheet.tab,
                        shift,
                        businessDate,
                        userName,
                        range: `'${sheet.tab}'!${getColumnLetter(column)}${rowIndex + 1}`,
                        value
                    });
                }
            }
        }
    }
    return entries;
}

function enumerateItemSaleEntries(sheetContexts) {
    const entries = [];
    for (const [server, sheet] of Object.entries(sheetContexts)) {
        for (const shift of ['DAY', 'NIGHT']) {
            const sectionLabel = CONFIG.PURCHASE_SECTION_LABELS[shift];
            const headerRowIndex = findSectionHeader(sheet.rows, sectionLabel);
            if (headerRowIndex < 0) continue;
            const header = sheet.rows[headerRowIndex] || [];
            for (let rowIndex = headerRowIndex + 1; rowIndex < sheet.rows.length; rowIndex += 1) {
                const rowLabel = String(sheet.rows[rowIndex]?.[0] || '').trim();
                if (/^total\s+gain\s+adena$/i.test(rowLabel)) break;
                if (rowLabel.toUpperCase() !== 'OT') continue;
                for (let column = 0; column < header.length; column += 1) {
                    const userName = String(header[column] || '').trim();
                    const next = String(header[column + 1] || '').trim().toUpperCase();
                    const afterNext = String(header[column + 2] || '').trim().toUpperCase();
                    if (!userName || next !== 'BONUS' || afterNext !== 'D&C') continue;
                    const value = parseNumber(sheet.rows[rowIndex]?.[column]);
                    if (!value) continue;
                    entries.push({
                        server,
                        tab: sheet.tab,
                        shift,
                        userName,
                        range: `'${sheet.tab}'!${getColumnLetter(column)}${rowIndex + 1}`,
                        value
                    });
                }
            }
        }
    }
    return entries;
}

function auditKey(item) {
    return [item.businessDate, item.shift, normalizePayrollServer(item.server), String(item.userName || '').trim().toLowerCase()].join('|');
}

function detectDuplicateSegments(posts) {
    const regular = posts.filter(post => post.submissionType === 'REGULAR');
    const overtime = posts.filter(post => post.submissionType === 'OVERTIME');
    const overtimeFingerprints = new Set();
    let duplicateOvertime = false;
    for (const post of overtime) {
        const fingerprint = `${post.declaredStartAt || ''}|${post.rawAmount}`;
        if (overtimeFingerprints.has(fingerprint)) duplicateOvertime = true;
        overtimeFingerprints.add(fingerprint);
    }
    return {
        duplicate: regular.length > 1 || duplicateOvertime,
        regularCount: regular.length,
        overtimeCount: overtime.length,
        duplicateOvertime
    };
}

function selectCanonicalPosts(posts) {
    const byCreatedAt = [...posts].sort((left, right) => (
        Date.parse(left.createdAt || '') - Date.parse(right.createdAt || '')
    ));
    const regular = byCreatedAt.filter(post => post.submissionType === 'REGULAR').slice(-1);
    const overtimeByFingerprint = new Map();
    for (const post of byCreatedAt.filter(item => item.submissionType === 'OVERTIME')) {
        overtimeByFingerprint.set(`${post.declaredStartAt || ''}|${post.rawAmount}`, post);
    }
    return [...regular, ...overtimeByFingerprint.values()];
}

function classifyAuditRow({ actualValue, approvedPosts, attendanceExpected, sheetResolved }) {
    const duplicate = detectDuplicateSegments(approvedPosts);
    const canonicalPosts = selectCanonicalPosts(approvedPosts);
    const expectedValue = canonicalPosts.reduce((sum, post) => sum + post.amount, 0);
    if (!sheetResolved) return { status: 'SHEET_USER_UNRESOLVED', expectedValue, ...duplicate };
    if (duplicate.duplicate) return { status: 'DUPLICATE_REVIEW', expectedValue, ...duplicate };
    if (actualValue !== expectedValue && expectedValue > 0) return { status: 'MISMATCH', expectedValue, ...duplicate };
    if (actualValue !== 0 && expectedValue === 0) return { status: 'ORPHAN_SHEET_VALUE', expectedValue, ...duplicate };
    if (attendanceExpected && expectedValue === 0) return { status: 'MISSING_SUBMISSION', expectedValue, ...duplicate };
    if (!attendanceExpected && expectedValue > 0) return { status: 'UNEXPECTED_SUBMISSION', expectedValue, ...duplicate };
    return { status: 'MATCH', expectedValue, ...duplicate };
}

function buildAuditRows({ sheetEntries, expectedEntries, posts }) {
    const rowsByKey = new Map();
    function ensure(item) {
        const key = auditKey(item);
        if (!rowsByKey.has(key)) {
            rowsByKey.set(key, {
                businessDate: item.businessDate,
                shift: item.shift,
                server: normalizePayrollServer(item.server),
                userName: item.userName,
                range: null,
                actualValue: 0,
                sheetResolved: false,
                attendanceExpected: false,
                approvedPosts: []
            });
        }
        return rowsByKey.get(key);
    }
    for (const entry of sheetEntries) {
        const row = ensure(entry);
        row.range = entry.range;
        row.actualValue = entry.value;
        row.sheetResolved = true;
    }
    for (const entry of expectedEntries) ensure(entry).attendanceExpected = true;
    for (const post of posts.filter(item => ['APPROVED', 'RECORDED_ONLY'].includes(item.state) && item.sheet?.ok)) {
        const row = ensure({ ...post.sheet, businessDate: post.businessDate });
        row.approvedPosts.push(post);
    }
    return [...rowsByKey.values()]
        .map(row => {
            const classification = classifyAuditRow(row);
            return {
                businessDate: row.businessDate,
                shift: row.shift,
                server: row.server,
                userName: row.userName,
                range: row.range,
                actualValue: row.actualValue,
                expectedValue: classification.expectedValue,
                delta: row.actualValue - classification.expectedValue,
                attendanceExpected: row.attendanceExpected,
                status: classification.status,
                regularCount: classification.regularCount,
                overtimeCount: classification.overtimeCount,
                messageIds: row.approvedPosts.map(post => post.messageId),
                messages: row.approvedPosts.map(post => ({
                    messageId: post.messageId,
                    amount: post.amount,
                    rawAmount: post.rawAmount,
                    submissionType: post.submissionType,
                    declaredStartAt: post.declaredStartAt,
                    createdAt: post.createdAt,
                    state: post.state,
                    contentChangedAfterApproval: post.contentChangedAfterApproval,
                    url: post.url
                }))
            };
        })
        .filter(row => row.actualValue || row.expectedValue || row.attendanceExpected)
        .sort((left, right) => (
            left.businessDate.localeCompare(right.businessDate) ||
            left.shift.localeCompare(right.shift) ||
            left.server.localeCompare(right.server) ||
            left.userName.localeCompare(right.userName)
        ));
}

function summarizeRows(rows) {
    const statusCounts = {};
    const totals = {};
    for (const row of rows) {
        statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
        const key = `${row.businessDate}|${row.shift}|${row.server}`;
        const total = totals[key] || { businessDate: row.businessDate, shift: row.shift, server: row.server, actual: 0, expected: 0 };
        total.actual += row.actualValue;
        total.expected += row.expectedValue;
        total.delta = total.actual - total.expected;
        totals[key] = total;
    }
    return { statusCounts, totals: Object.values(totals) };
}

async function readSheets() {
    const auth = new google.auth.GoogleAuth({
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly']
    });
    const sheets = google.sheets({ version: 'v4', auth });
    const uniqueTabs = new Map();
    for (const server of ['PAAGRIO', 'VALAKAS']) {
        const tab = CONFIG.PURCHASE_SERVER_TABS[server];
        if (!uniqueTabs.has(tab)) {
            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
                range: `'${tab}'!A1:ZZ120`,
                valueRenderOption: 'UNFORMATTED_VALUE'
            });
            uniqueTabs.set(tab, createSheetContext(tab, response.data.values || []));
        }
    }
    return {
        PAAGRIO: uniqueTabs.get(CONFIG.PURCHASE_SERVER_TABS.PAAGRIO),
        VALAKAS: uniqueTabs.get(CONFIG.PURCHASE_SERVER_TABS.VALAKAS)
    };
}

async function runAudit(options) {
    const from = parseBusinessDate(options.from, '--from');
    const to = parseBusinessDate(options.to, '--to');
    if (to.isBefore(from)) throw new Error('--to must be on or after --from');
    const dateKeys = dateKeysBetween(from, to);
    const attendanceState = JSON.parse(fs.readFileSync(options.attendanceFile, 'utf8'));
    const attendanceData = attendanceState.attendanceData || attendanceState;
    const excludedIds = new Set(CONFIG.EXCEPTIONS.EXCLUDED_USER_IDS || []);
    const operations = loadOperations(options.operationFiles);
    const latestOperations = latestEndAdenaOperations(operations);
    const token = process.env.TOKEN || process.env.DISCORD_TOKEN;
    if (!token) throw new Error('Missing TOKEN/DISCORD_TOKEN');

    const timeLogic = createTimeLogic({
        CONFIG,
        SHIFT_SCHEDULE,
        MAINTENANCE_WINDOWS,
        moment
    });
    const sheetContexts = await readSheets();
    const aliases = normalizeAliasMap(CONFIG.SHEET_NAME_ALIASES || {});
    const oldestMessageMs = from.clone().subtract(1, 'day').valueOf();
    const rawMessages = [];
    const seenChannels = new Set();
    for (const [server, channelId] of Object.entries(CONFIG.END_ADENA_CHANNEL_IDS || {})) {
        const normalizedServer = normalizePayrollServer(server);
        if (!channelId || seenChannels.has(channelId) || !['PAAGRIO', 'VALAKAS'].includes(normalizedServer)) continue;
        seenChannels.add(channelId);
        const messages = await fetchChannelMessages(channelId, oldestMessageMs, token);
        rawMessages.push(...messages.map(message => ({ ...message, auditServer: normalizedServer, auditChannelId: channelId })));
    }

    const memberIds = new Set();
    for (const message of rawMessages) if (message.author?.id && !excludedIds.has(message.author.id)) memberIds.add(message.author.id);
    for (const [userId, user] of Object.entries(attendanceData)) {
        if (excludedIds.has(userId)) continue;
        const targetSession = (user?.sessions || []).some(session => {
            const start = moment(session.scheduledStartAt || session.clockInAt).tz(CONFIG.TIMEZONE);
            return start.isValid() && dateKeys.includes(start.format('YYYY-MM-DD'));
        });
        if (targetSession) memberIds.add(userId);
    }
    const members = new Map();
    for (const userId of memberIds) {
        const fromMessage = rawMessages.find(message => message.author?.id === userId)?.member;
        members.set(userId, fromMessage || await fetchMember(userId, token));
    }

    const posts = [];
    for (const message of rawMessages) {
        if (message.author?.bot || excludedIds.has(message.author?.id)) continue;
        const parsed = parseEndAdenaMessage(message.content);
        if (!parsed) continue;
        const operation = latestOperations.get(String(message.id)) || null;
        const member = members.get(message.author?.id) || message.member || null;
        const context = resolvePostContext({
            parsed,
            message: { ...message, member },
            attendanceUser: attendanceData[message.author?.id],
            operation,
            timeLogic
        });
        if (!context.ok || !dateKeys.includes(context.businessDate)) continue;
        const server = normalizePayrollServer(message.auditServer || memberServer(member));
        const requestedName = parsed.requestedName || cleanMemberName(member?.nick || message.author?.global_name || message.author?.username);
        const sheet = resolveSheetEntry(sheetContexts, aliases, {
            server,
            shift: context.shift,
            businessDate: context.businessDate,
            userName: requestedName
        });
        posts.push({
            messageId: message.id,
            channelId: message.auditChannelId,
            authorId: message.author?.id || null,
            authorName: message.author?.global_name || message.author?.username || null,
            requestedName,
            server,
            amount: parsed.amount,
            rawAmount: parsed.rawAmount,
            operationAmount: Number(operation?.payload?.rawAmount ?? operation?.payload?.amount) || null,
            contentChangedAfterApproval: Boolean(
                operation &&
                Number(operation?.payload?.rawAmount ?? operation?.payload?.amount) !== parsed.rawAmount
            ),
            createdAt: message.timestamp,
            state: getMessageState(message, operation),
            reactionNames: (message.reactions || []).map(reaction => reaction?.emoji?.name).filter(Boolean),
            url: `https://discord.com/channels/${CONFIG.GUILD_ID}/${message.auditChannelId}/${message.id}`,
            sheet,
            ...context
        });
    }

    const fetchedMessageIds = new Set(rawMessages.map(message => String(message.id)));
    for (const [messageId, operation] of latestOperations.entries()) {
        if (fetchedMessageIds.has(messageId) || String(operation?.action || '').toLowerCase() !== 'approve') continue;
        const audit = operation?.payload?.audit || operation?.audit || {};
        const created = moment(audit.messageCreatedAt || operation.messageCreatedAt || operation.createdAt).tz(CONFIG.TIMEZONE);
        if (!created.isValid()) continue;
        const businessDate = created.format('YYYY-MM-DD');
        if (!dateKeys.includes(businessDate)) continue;
        const shift = String(operation.shift || operation.payload?.shift || '').toUpperCase();
        const server = normalizePayrollServer(operation.server || operation.payload?.server);
        const requestedName = operation.userName || operation.payload?.userName;
        const sheet = resolveSheetEntry(sheetContexts, aliases, { server, shift, businessDate, userName: requestedName });
        const rawAmount = Number(operation.payload?.rawAmount ?? operation.payload?.amount);
        if (!Number.isFinite(rawAmount) || rawAmount <= 0) continue;
        posts.push({
            messageId,
            channelId: operation.channelId || operation.payload?.channelId || null,
            authorId: audit.authorId || null,
            authorName: audit.authorName || null,
            requestedName,
            server,
            amount: Math.floor(rawAmount / 1000) * 1000,
            rawAmount,
            operationAmount: rawAmount,
            contentChangedAfterApproval: false,
            createdAt: audit.messageCreatedAt || operation.createdAt,
            state: 'RECORDED_ONLY',
            reactionNames: [],
            url: operation.channelId || operation.payload?.channelId
                ? `https://discord.com/channels/${CONFIG.GUILD_ID}/${operation.channelId || operation.payload.channelId}/${messageId}`
                : null,
            sheet,
            shift,
            submissionType: String(audit.attendanceSessionType || '').toUpperCase() === 'REGULAR' ? 'REGULAR' : 'OVERTIME',
            declaredStartAt: null,
            businessDate,
            shiftStartAt: audit.shiftStartAt,
            shiftEndAt: audit.shiftEndAt || null,
            dateSource: 'message-created-at',
            declaredDateConflict: false
        });
    }

    const expectedEntries = [];
    const unresolvedAttendance = [];
    for (const [userId, user] of Object.entries(attendanceData)) {
        if (excludedIds.has(userId)) continue;
        const member = members.get(userId);
        for (const session of user?.sessions || []) {
            const start = moment(session.scheduledStartAt || session.clockInAt).tz(CONFIG.TIMEZONE);
            if (!start.isValid()) continue;
            const expectedAt = moment(session.scheduledEndAt || session.clockOutAt || session.scheduledStartAt || session.clockInAt)
                .tz(CONFIG.TIMEZONE);
            const businessDate = expectedAt.isValid() ? expectedAt.format('YYYY-MM-DD') : start.format('YYYY-MM-DD');
            if (!dateKeys.includes(businessDate)) continue;
            const shift = String(session.shift || user.shift || '').toUpperCase();
            if (!['DAY', 'NIGHT'].includes(shift)) continue;
            const server = memberServer(member) || posts.find(post => post.authorId === userId)?.server;
            const userName = posts.find(post => post.authorId === userId)?.requestedName ||
                cleanMemberName(member?.nick || user.name || userId);
            if (!server || !userName) {
                unresolvedAttendance.push({ userId, userName, businessDate, shift, code: !server ? 'server-unresolved' : 'name-unresolved' });
                continue;
            }
            const sheet = resolveSheetEntry(sheetContexts, aliases, { server, shift, businessDate, userName });
            if (!sheet.ok) {
                unresolvedAttendance.push({ userId, userName, businessDate, shift, server, code: sheet.code });
                continue;
            }
            const key = auditKey(sheet);
            if (!expectedEntries.some(entry => auditKey(entry) === key)) expectedEntries.push(sheet);
        }
    }

    const sheetEntries = enumerateSheetEntries(sheetContexts, dateKeys);
    const rows = buildAuditRows({ sheetEntries, expectedEntries, posts });
    const summary = summarizeRows(rows);
    const activePosts = posts.filter(post => ['APPROVED', 'RECORDED_ONLY'].includes(post.state));
    const itemSaleEntries = enumerateItemSaleEntries(sheetContexts).map(entry => ({
        ...entry,
        source: 'MANUAL_ITEM_SALE'
    }));
    summary.approvedDateTotal = summary.totals.reduce((sum, item) => sum + item.expected, 0);
    summary.itemSaleTotal = itemSaleEntries.reduce((sum, entry) => sum + entry.value, 0);
    summary.verifiedGrandTotal = summary.approvedDateTotal + summary.itemSaleTotal;
    summary.serverTotals = ['PAAGRIO', 'VALAKAS'].map(server => {
        const approvedDateTotal = summary.totals
            .filter(item => item.server === server)
            .reduce((sum, item) => sum + item.expected, 0);
        const itemSaleTotal = itemSaleEntries
            .filter(item => item.server === server)
            .reduce((sum, item) => sum + item.value, 0);
        return { server, approvedDateTotal, itemSaleTotal, verifiedTotal: approvedDateTotal + itemSaleTotal };
    });
    const report = {
        ok: rows.every(row => row.status === 'MATCH'),
        generatedAt: new Date().toISOString(),
        scope: { from: options.from, to: options.to, timezone: CONFIG.TIMEZONE, dates: dateKeys },
        source: {
            attendanceFile: path.resolve(options.attendanceFile),
            operationFiles: options.operationFiles.map(file => path.resolve(file)),
            discordChannels: [...seenChannels],
            sheetTabs: Object.values(sheetContexts).map(sheet => sheet.tab)
        },
        counts: {
            discordMessagesFetched: rawMessages.length,
            parsedTargetPosts: posts.length,
            approvedPosts: activePosts.length,
            recordedOnlyPosts: posts.filter(post => post.state === 'RECORDED_ONLY').length,
            editedAfterApprovalPosts: posts.filter(post => post.contentChangedAfterApproval).length,
            failedPosts: posts.filter(post => post.state === 'FAILED').length,
            pendingPosts: posts.filter(post => post.state === 'PENDING').length,
            cancelledPosts: posts.filter(post => post.state === 'CANCELLED').length,
            attendanceExpectedRows: expectedEntries.length,
            auditedRows: rows.length,
            issueRows: rows.filter(row => row.status !== 'MATCH').length,
            itemSaleEntries: itemSaleEntries.length
        },
        summary,
        rows,
        itemSaleEntries,
        nonApprovedPosts: posts.filter(post => post.state !== 'APPROVED'),
        unresolvedPosts: posts.filter(post => !post.sheet?.ok),
        posts,
        unparsedWorkerMessages: rawMessages
            .filter(message => memberIds.has(message.author?.id))
            .filter(message => !parseEndAdenaMessage(message.content))
            .filter(message => Date.parse(message.timestamp || '') >= oldestMessageMs)
            .map(message => ({
                messageId: message.id,
                authorId: message.author?.id || null,
                authorName: message.author?.global_name || message.author?.username || null,
                createdAt: message.timestamp,
                content: String(message.content || '').slice(0, 500),
                reactionNames: (message.reactions || []).map(reaction => reaction?.emoji?.name).filter(Boolean),
                url: `https://discord.com/channels/${CONFIG.GUILD_ID}/${message.auditChannelId}/${message.id}`
            })),
        unresolvedAttendance
    };

    if (!options.noOutput) {
        fs.mkdirSync(path.dirname(options.output), { recursive: true });
        fs.writeFileSync(options.output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    }
    return report;
}

function printReport(report) {
    console.log(JSON.stringify({
        ok: report.ok,
        generatedAt: report.generatedAt,
        scope: report.scope,
        counts: report.counts,
        statusCounts: report.summary.statusCounts,
        totals: report.summary.totals,
        approvedDateTotal: report.summary.approvedDateTotal,
        itemSaleTotal: report.summary.itemSaleTotal,
        verifiedGrandTotal: report.summary.verifiedGrandTotal,
        serverTotals: report.summary.serverTotals,
        issues: report.rows.filter(row => row.status !== 'MATCH'),
        itemSaleEntries: report.itemSaleEntries
    }, null, 2));
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    if (!options.from || !options.to) {
        throw new Error('Usage: node scripts/audit-end-adena-range.js --from YYYY-MM-DD --to YYYY-MM-DD --attendance-file <path> --operation-files <path,path>');
    }
    printReport(await runAudit(options));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error?.stack || error?.message || error);
        process.exit(1);
    });
}

module.exports = {
    auditKey,
    buildAuditRows,
    classifyAuditRow,
    dateKeysBetween,
    detectDuplicateSegments,
    enumerateItemSaleEntries,
    getMessageState,
    parseDeclaredStart,
    resolvePostContext,
    selectCanonicalPosts,
    summarizeRows
};
