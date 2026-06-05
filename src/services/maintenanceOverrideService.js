'use strict';

const path = require('path');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function createMaintenanceOverrideService({ fs, filePath, moment, timezone, logger = console }) {
    if (!fs?.readFile || !fs?.writeFile) throw new TypeError('fs with readFile/writeFile must be provided');
    if (!filePath) throw new TypeError('filePath must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (!timezone) throw new TypeError('timezone must be provided');

    let overrides = {};

    function validateDate(dateKey, label = 'date') {
        if (!DATE_RE.test(String(dateKey || ''))) return `${label} must be YYYY-MM-DD.`;
        const parsed = moment.tz(dateKey, 'YYYY-MM-DD', true, timezone);
        if (!parsed.isValid() || parsed.format('YYYY-MM-DD') !== dateKey) return `${label} is invalid.`;
        return null;
    }

    function validateTime(value, label) {
        if (value == null || value === '') return null;
        return TIME_RE.test(String(value)) ? null : `${label} must be HH:mm.`;
    }

    function normalizeEnabled(value) {
        const text = String(value ?? '').trim().toLowerCase();
        if (['true', 'yes', 'on', '1', 'enabled', 'add'].includes(text)) return true;
        if (['false', 'no', 'off', '0', 'disabled', 'cancel'].includes(text)) return false;
        return null;
    }

    function getPreviousDefaultMaintenanceDate(dateKey) {
        const target = moment.tz(dateKey, 'YYYY-MM-DD', timezone).startOf('day');
        if (target.format('dddd') === 'Tuesday') return null;
        for (let daysBack = 1; daysBack <= 6; daysBack += 1) {
            const candidate = target.clone().subtract(daysBack, 'days');
            if (candidate.format('dddd') === 'Tuesday') return candidate.format('YYYY-MM-DD');
        }
        return null;
    }

    function getAll() {
        return overrides;
    }

    async function load() {
        try {
            const raw = await fs.readFile(filePath, 'utf8');
            const parsed = JSON.parse(raw);
            overrides = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (error) {
            if (error?.code !== 'ENOENT') logger.warn?.('[MAINTENANCE OVERRIDE LOAD]', error);
            overrides = {};
        }
        return overrides;
    }

    async function save() {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, `${JSON.stringify(overrides, null, 2)}\n`, 'utf8');
    }

    async function setOverride(input) {
        const dateKey = String(input?.date || '').trim();
        const dateError = validateDate(dateKey);
        if (dateError) return { ok: false, message: dateError };
        const enabled = normalizeEnabled(input.enabled);
        if (enabled == null) return { ok: false, message: 'enabled must be true/false.' };

        const timeFields = [
            ['dayStart', 'day-start'],
            ['dayEnd', 'day-end'],
            ['nightStart', 'night-start'],
            ['nightEnd', 'night-end'],
            ['windowStart', 'window-start'],
            ['windowEnd', 'window-end']
        ];
        for (const [key, label] of timeFields) {
            const error = validateTime(input[key], label);
            if (error) return { ok: false, message: error };
        }
        if (input.windowDate) {
            const error = validateDate(input.windowDate, 'window-date');
            if (error) return { ok: false, message: error };
        }

        const nowIso = moment().tz(timezone).toISOString();
        const entry = { enabled, updatedAt: nowIso };
        for (const [key] of timeFields) {
            if (input[key]) entry[key] = String(input[key]).trim();
        }
        if (input.windowDate) entry.windowDate = String(input.windowDate).trim();
        if (input.reason) entry.reason = String(input.reason).trim();

        const nextOverrides = { ...overrides, [dateKey]: entry };
        let autoCancelledDate = null;
        if (enabled && input.autoCancelPreviousDefault !== false) {
            const previousDefaultDate = getPreviousDefaultMaintenanceDate(dateKey);
            if (previousDefaultDate && !nextOverrides[previousDefaultDate]) {
                autoCancelledDate = previousDefaultDate;
                nextOverrides[previousDefaultDate] = {
                    enabled: false,
                    reason: input.reason
                        ? `auto-cancelled: ${String(input.reason).trim()}`
                        : `auto-cancelled because maintenance moved to ${dateKey}`,
                    movedTo: dateKey,
                    updatedAt: nowIso
                };
            }
        }

        overrides = nextOverrides;
        await save();
        return { ok: true, date: dateKey, override: entry, autoCancelledDate };
    }

    async function deleteOverride(dateKey) {
        const date = String(dateKey || '').trim();
        const dateError = validateDate(date);
        if (dateError) return { ok: false, message: dateError };
        if (!overrides[date]) return { ok: false, message: 'No override for that date.' };
        const removed = overrides[date];
        const next = { ...overrides };
        delete next[date];
        overrides = next;
        await save();
        return { ok: true, date, removed };
    }

    async function moveOverride(input) {
        const fromDate = String(input?.fromDate || '').trim();
        const toDate = String(input?.toDate || '').trim();
        const fromError = validateDate(fromDate, 'from-date');
        if (fromError) return { ok: false, message: fromError };
        const toError = validateDate(toDate, 'to-date');
        if (toError) return { ok: false, message: toError };
        if (fromDate === toDate) return { ok: false, message: 'from-date and to-date must be different.' };

        const nowIso = moment().tz(timezone).toISOString();
        const reason = input?.reason ? String(input.reason).trim() : `maintenance moved to ${toDate}`;
        const fromEntry = {
            enabled: false,
            reason,
            movedTo: toDate,
            updatedAt: nowIso
        };
        const toEntry = {
            enabled: true,
            reason,
            movedFrom: fromDate,
            updatedAt: nowIso
        };

        overrides = {
            ...overrides,
            [fromDate]: fromEntry,
            [toDate]: toEntry
        };
        await save();
        return { ok: true, fromDate, toDate, fromOverride: fromEntry, toOverride: toEntry };
    }

    function listOverrides() {
        return Object.entries(overrides)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([date, override]) => ({ date, ...override }));
    }

    return {
        load,
        save,
        getAll,
        setOverride,
        deleteOverride,
        moveOverride,
        listOverrides,
        validateDate,
        validateTime,
        normalizeEnabled
    };
}

module.exports = {
    createMaintenanceOverrideService
};
