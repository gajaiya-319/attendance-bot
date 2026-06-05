'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { CONFIG } = require('../src/config/constants');

const SPREADSHEET_ID_RE = /^[a-zA-Z0-9_-]{20,}$/;
const WEBAPP_URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[a-zA-Z0-9_-]+\/exec$/;

/** @typedef {'ok' | 'warn' | 'fail' | 'skip'} CheckStatus */

/**
 * @param {string} name
 * @param {{ required?: boolean, validate?: (value: string) => string | null, secret?: boolean }} options
 */
function envSpec(name, options = {}) {
    return { name, ...options };
}

const GOOGLE_ENV_SPECS = [
    envSpec('PURCHASE_GOOGLE_KEY_FILE', { required: true }),
    envSpec('GOOGLE_APPLICATION_CREDENTIALS', { required: true }),
    envSpec('PURCHASE_SPREADSHEET_ID', {
        required: true,
        validate: value => (SPREADSHEET_ID_RE.test(value) ? null : 'invalid spreadsheet id format')
    }),
    envSpec('PAYROLL_SUMMARY_SPREADSHEET_ID', {
        required: true,
        validate: value => (SPREADSHEET_ID_RE.test(value) ? null : 'invalid spreadsheet id format')
    }),
    envSpec('PAYROLL_ARCHIVE_SPREADSHEET_ID', {
        validate: value => (SPREADSHEET_ID_RE.test(value) ? null : 'invalid spreadsheet id format')
    }),
    envSpec('RAW_ATTENDANCE_WEBAPP_URL', {
        required: true,
        validate: value => (WEBAPP_URL_RE.test(value) ? null : 'expected https://script.google.com/macros/s/.../exec')
    }),
    envSpec('PURCHASE_HEINE_TAB_NAME'),
    envSpec('PURCHASE_PAAGRIO_TAB_NAME'),
    envSpec('PURCHASE_DAY_SECTION_LABEL'),
    envSpec('PURCHASE_NIGHT_SECTION_LABEL'),
    envSpec('SHEET_NAME_ALIASES'),
    envSpec('PURCHASE_CHANNEL_ID'),
    envSpec('PURCHASE_CHANNEL_NAME'),
    envSpec('PURCHASE_APPROVAL_EMOJI'),
    envSpec('PURCHASE_CANCEL_EMOJI'),
    envSpec('PURCHASE_UNIT_PRICE'),
    envSpec('DEATH_PENALTY_AMOUNT'),
    envSpec('DEATH_PENALTY_PAAGRIO_CHANNEL_ID'),
    envSpec('DEATH_PENALTY_HEINE_CHANNEL_ID'),
    envSpec('DEATH_PENALTY_REVIEWER_ROLE_IDS'),
    envSpec('END_ADENA_PAAGRIO_CHANNEL_ID'),
    envSpec('END_ADENA_HEINE_CHANNEL_ID'),
    envSpec('END_ADENA_REVIEWER_ROLE_IDS')
];

const CONFIG_DEFAULTS = {
    PURCHASE_SPREADSHEET_ID: CONFIG.PURCHASE_SPREADSHEET_ID,
    PAYROLL_SUMMARY_SPREADSHEET_ID: CONFIG.PAYROLL_SUMMARY_SPREADSHEET_ID,
    PAYROLL_ARCHIVE_SPREADSHEET_ID: CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID,
    RAW_ATTENDANCE_WEBAPP_URL: CONFIG.RAW_ATTENDANCE_WEBAPP_URL,
    PURCHASE_GOOGLE_KEY_FILE: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
    PURCHASE_HEINE_TAB_NAME: CONFIG.PURCHASE_SERVER_TABS?.HEINE,
    PURCHASE_PAAGRIO_TAB_NAME: CONFIG.PURCHASE_SERVER_TABS?.PAAGRIO,
    PURCHASE_DAY_SECTION_LABEL: CONFIG.PURCHASE_SECTION_LABELS?.DAY,
    PURCHASE_NIGHT_SECTION_LABEL: CONFIG.PURCHASE_SECTION_LABELS?.NIGHT
};

function resolveKeyPath() {
    const fromEnv = process.env.PURCHASE_GOOGLE_KEY_FILE
        || process.env.GOOGLE_APPLICATION_CREDENTIALS
        || CONFIG.PURCHASE_GOOGLE_KEY_FILE;
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
}

function resolveEnvPath(name) {
    const raw = process.env[name];
    if (!raw) return null;
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
}

function hasEnvFile() {
    return fs.existsSync(path.resolve(process.cwd(), '.env'));
}

function getEffectiveValue(name) {
    const raw = process.env[name];
    if (raw !== undefined && String(raw).trim() !== '') {
        return { value: String(raw).trim(), source: 'env' };
    }
    const fallback = CONFIG_DEFAULTS[name];
    if (fallback !== undefined && String(fallback).trim() !== '') {
        return { value: String(fallback).trim(), source: 'default' };
    }
    return { value: '', source: 'missing' };
}

function maskValue(name, value) {
    if (!value) return '(empty)';
    if (name.includes('KEY_FILE') || name.includes('CREDENTIALS')) {
        return value.length > 60 ? `...${value.slice(-48)}` : value;
    }
    if (name === 'RAW_ATTENDANCE_WEBAPP_URL') {
        return value.replace(/\/macros\/s\/[^/]+/, '/macros/s/***');
    }
    return value;
}

/**
 * @param {typeof GOOGLE_ENV_SPECS[number]} spec
 */
function checkEnvSpec(spec) {
    const { name, required = false, validate } = spec;
    const effective = getEffectiveValue(name);
    const inDotEnv = process.env[name] !== undefined && String(process.env[name]).trim() !== '';

    if (effective.source === 'missing') {
        if (required) {
            return {
                status: 'fail',
                name,
                message: 'missing (not in .env and no code default)',
                inDotEnv,
                source: effective.source,
                display: ''
            };
        }
        return {
            status: 'skip',
            name,
            message: 'optional — using runtime defaults where applicable',
            inDotEnv,
            source: effective.source,
            display: ''
        };
    }

    if (validate) {
        const validationError = validate(effective.value);
        if (validationError) {
            return {
                status: 'fail',
                name,
                message: validationError,
                inDotEnv,
                source: effective.source,
                display: maskValue(name, effective.value)
            };
        }
    }

    if (!inDotEnv && effective.source === 'default' && required) {
        return {
            status: 'warn',
            name,
            message: 'using constants.js default — set explicitly in .env for production',
            inDotEnv,
            source: effective.source,
            display: maskValue(name, effective.value)
        };
    }

    return {
        status: 'ok',
        name,
        message: inDotEnv ? 'set in .env' : `default (${effective.source})`,
        inDotEnv,
        source: effective.source,
        display: maskValue(name, effective.value)
    };
}

function checkKeyFiles(errors, warnings) {
    const purchasePath = resolveEnvPath('PURCHASE_GOOGLE_KEY_FILE') || resolveKeyPath();
    const gacPath = resolveEnvPath('GOOGLE_APPLICATION_CREDENTIALS');
    const paths = [...new Set([purchasePath, gacPath].filter(Boolean))];

    if (paths.length === 2 && path.resolve(paths[0]) !== path.resolve(paths[1])) {
        warnings.push('PURCHASE_GOOGLE_KEY_FILE and GOOGLE_APPLICATION_CREDENTIALS point to different files');
    }

    let clientEmail = null;
    for (const keyPath of paths) {
        if (!fs.existsSync(keyPath)) {
            errors.push(`Service account key not found: ${keyPath}`);
            continue;
        }
        try {
            const parsed = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
            if (!parsed.client_email || !parsed.private_key) {
                errors.push(`Key file is not a valid service-account JSON: ${keyPath}`);
            } else if (!clientEmail) {
                clientEmail = parsed.client_email;
            }
        } catch (error) {
            errors.push(`Could not read key file (${keyPath}): ${error.message}`);
        }
    }

    return { keyPath: purchasePath, clientEmail, paths };
}

function statusIcon(status) {
    if (status === 'ok') return '[ok]';
    if (status === 'warn') return '[warn]';
    if (status === 'fail') return '[fail]';
    return '[--]';
}

function printChecklist(results, keyInfo) {
    console.log('');
    console.log('=== Google / Sheets .env checklist ===');
    console.log(`- .env file: ${hasEnvFile() ? 'found' : 'NOT FOUND (using process env + defaults only)'}`);
    if (keyInfo.clientEmail) {
        console.log(`- service account: ${keyInfo.clientEmail}`);
        console.log('- share spreadsheets with this email as Editor');
    }
    if (keyInfo.keyPath) {
        console.log(`- key file: ${keyInfo.keyPath}`);
    }
    console.log('');

    const requiredNames = new Set(GOOGLE_ENV_SPECS.filter(s => s.required).map(s => s.name));
    console.log('Required for bot Google integration:');
    for (const spec of GOOGLE_ENV_SPECS.filter(s => s.required)) {
        const row = results.find(r => r.name === spec.name);
        console.log(`  ${statusIcon(row.status)} ${row.name}`);
        console.log(`       ${row.message}`);
        if (row.display) console.log(`       value: ${row.display}`);
    }

    console.log('');
    console.log('Optional overrides (purchase layout / reactions):');
    for (const spec of GOOGLE_ENV_SPECS.filter(s => !s.required)) {
        const row = results.find(r => r.name === spec.name);
        if (row.status === 'skip' && !row.inDotEnv) continue;
        console.log(`  ${statusIcon(row.status)} ${row.name}: ${row.message}`);
        if (row.display) console.log(`       value: ${row.display}`);
    }

    const purchaseId = getEffectiveValue('PURCHASE_SPREADSHEET_ID').value;
    const payrollId = getEffectiveValue('PAYROLL_SUMMARY_SPREADSHEET_ID').value;
    console.log('');
    console.log('Workbook layout hints:');
    console.log('  - Work list: Great source tabs only. Payroll API tabs must stay in PAYROLL_* spreadsheets.');
    console.log(`  - purchase bot writes: tabs like "${getEffectiveValue('PURCHASE_HEINE_TAB_NAME').value || 'Heine Great'}" / "${getEffectiveValue('PURCHASE_PAAGRIO_TAB_NAME').value || 'Paagrio Great'}"`);
    console.log('  - raw attendance: Raw_Attendance, Current_Workers (Apps Script + Sheets API)');
    console.log('  - Work list payroll setup: disabled; do not create Raw_Data or payroll summary tabs here.');
    console.log('  - 급여토탈 최근_3일_요약: 봇 API sync (npm run ops:sync-live-3day, 1분 cron)');
    console.log('  - 월간_누적_요약: SUM from Raw_Data (/급여기록 마감 누적)');
    console.log('  - Apps Script: migratePayrollToNewLayout (not old createPerfectPayrollSheets LOOKUP)');
    const archiveId = getEffectiveValue('PAYROLL_ARCHIVE_SPREADSHEET_ID').value || payrollId;
    console.log('  - /급여기록: snapshot Great -> Raw_Data before 3-day Great tab reset');
    if (archiveId && purchaseId && archiveId !== purchaseId) {
        console.log(`  [ok] PAYROLL_ARCHIVE (${archiveId.slice(0, 8)}...) is separated from PURCHASE sheet`);
    } else if (archiveId && purchaseId) {
        console.log('  [fail] PAYROLL_ARCHIVE must not be the Work list spreadsheet');
    }
    if (purchaseId && payrollId && purchaseId !== payrollId) {
        console.log('  [ok] split workbooks: PURCHASE=Great tabs, PAYROLL_SUMMARY=3-day view (expected)');
    }
    console.log('');
    console.log('After changing Apps Script: deploy new web app version and update RAW_ATTENDANCE_WEBAPP_URL');
    console.log('First-time payroll layout: run migratePayrollToNewLayout in Apps Script (deletes 월간 기록 tab)');
    console.log('  or: node scripts/migrate-payroll-layout.js (after deploying updated Code.js)');
    console.log('Empty reset only: createPerfectPayrollSheets (wipes Raw_Data)');
}

function main() {
    const errors = [];
    const warnings = [];

    const keyInfo = checkKeyFiles(errors, warnings);
    const results = GOOGLE_ENV_SPECS.map(spec => {
        const row = checkEnvSpec(spec);
        if (row.status === 'fail') {
            errors.push(`${row.name}: ${row.message}`);
        } else if (row.status === 'warn') {
            warnings.push(`${row.name}: ${row.message}`);
        }
        return row;
    });
    const purchaseId = getEffectiveValue('PURCHASE_SPREADSHEET_ID').value;
    const payrollId = getEffectiveValue('PAYROLL_SUMMARY_SPREADSHEET_ID').value;
    const archiveId = getEffectiveValue('PAYROLL_ARCHIVE_SPREADSHEET_ID').value || payrollId;
    if (purchaseId && archiveId && purchaseId === archiveId) {
        errors.push('PAYROLL_ARCHIVE_SPREADSHEET_ID must not equal PURCHASE_SPREADSHEET_ID; Raw_Data belongs in the payroll/API workbook.');
    }
    if (purchaseId && payrollId && purchaseId === payrollId) {
        errors.push('PAYROLL_SUMMARY_SPREADSHEET_ID must not equal PURCHASE_SPREADSHEET_ID; payroll API values belong outside Work list.');
    }

    printChecklist(results, keyInfo);

    if (warnings.length) {
        console.log('Warnings:');
        for (const warning of warnings) console.log(`- ${warning}`);
    }

    if (errors.length) {
        console.error('');
        console.error('Google config check failed:');
        for (const issue of errors) console.error(`- ${issue}`);
        process.exit(1);
    }

    console.log('Google config check passed.');
}

if (require.main === module) {
    main();
}

module.exports = {
    GOOGLE_ENV_SPECS,
    getEffectiveValue,
    checkEnvSpec,
    checkKeyFiles,
    SPREADSHEET_ID_RE,
    WEBAPP_URL_RE
};
