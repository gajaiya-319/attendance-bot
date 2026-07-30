'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const DEFAULT_RETENTION = 35;
const FIXED_FILES = [
    'attendanceData.json',
    'attendanceData.json.bak',
    'logs/admin-audit.jsonl',
    'logs/ops-pending.json',
    'logs/raw-attendance-pending.json',
    'logs/raw-attendance-repair.jsonl',
    'logs/runtime-health.json',
    'logs/external-dependency-smoke.json',
    'logs/recovery-drill.json',
    'logs/security-posture-audit.json',
    'logs/operational-evidence.json'
];

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function safeRelativePath(value) {
    const normalized = String(value || '').replace(/\\/g, '/').replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
        throw new Error(`Unsafe disaster recovery path: ${value}`);
    }
    return normalized;
}

function listSourceFiles(rootDir, backupLimit = 2, maxFileBytes = 20 * 1024 * 1024) {
    const isSmallEnough = file => fs.statSync(path.join(rootDir, file)).size <= maxFileBytes;
    const files = FIXED_FILES.filter(file => fs.existsSync(path.join(rootDir, file)) && isSmallEnough(file));
    const backupDir = path.join(rootDir, 'backups');
    if (fs.existsSync(backupDir)) {
        const backups = fs.readdirSync(backupDir)
            .filter(name => /^attendanceData-.*\.json$/.test(name))
            .sort()
            .reverse()
            .slice(0, backupLimit)
            .map(name => `backups/${name}`)
            .filter(isSmallEnough);
        files.push(...backups);
    }
    return [...new Set(files)].sort();
}

function validatePrimaryState(rootDir, validateState) {
    const file = path.join(rootDir, 'attendanceData.json');
    if (!fs.existsSync(file)) throw new Error('attendanceData.json is required for a disaster recovery bundle');
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    const issues = typeof validateState === 'function' ? validateState(parsed) : [];
    if (issues?.length) throw new Error(`Primary state is not restorable: ${issues.join('; ')}`);
}

function pruneBundles(outputDir, retention = DEFAULT_RETENTION) {
    const files = fs.readdirSync(outputDir)
        .filter(name => /^attendance-bot-dr-.*\.json\.gz$/.test(name))
        .sort()
        .reverse();
    for (const name of files.slice(Math.max(1, retention))) {
        fs.rmSync(path.join(outputDir, name), { force: true });
    }
    return Math.min(files.length, Math.max(1, retention));
}

function createBundle({
    rootDir = process.cwd(),
    outputDir = process.env.DR_BACKUP_DIR || path.resolve(rootDir, '..', 'attendance-bot-dr'),
    retention = DEFAULT_RETENTION,
    backupLimit = 2,
    validateState = null,
    now = new Date()
} = {}) {
    validatePrimaryState(rootDir, validateState);
    const sourceFiles = listSourceFiles(rootDir, backupLimit);
    const files = {};
    for (const relative of sourceFiles) {
        const safePath = safeRelativePath(relative);
        const data = fs.readFileSync(path.join(rootDir, safePath));
        files[safePath] = {
            bytes: data.length,
            sha256: sha256(data),
            base64: data.toString('base64')
        };
    }

    const createdAt = now.toISOString();
    const stamp = createdAt.replace(/[-:.TZ]/g, '').slice(0, 14);
    const payload = {
        format: 'attendance-bot-disaster-recovery-v1',
        createdAt,
        fileCount: sourceFiles.length,
        files
    };
    const encoded = Buffer.from(JSON.stringify(payload));
    const compressed = zlib.gzipSync(encoded, { level: 9 });
    fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
    const outputPath = path.join(outputDir, `attendance-bot-dr-${stamp}.json.gz`);
    const temporaryPath = `${outputPath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, compressed, { mode: 0o600 });
    fs.renameSync(temporaryPath, outputPath);
    pruneBundles(outputDir, retention);
    return {
        ok: true,
        outputPath,
        createdAt,
        fileCount: sourceFiles.length,
        compressedBytes: compressed.length,
        sha256: sha256(compressed)
    };
}

function latestBundle(outputDir) {
    if (!fs.existsSync(outputDir)) return null;
    const name = fs.readdirSync(outputDir)
        .filter(item => /^attendance-bot-dr-.*\.json\.gz$/.test(item))
        .sort()
        .reverse()[0];
    return name ? path.join(outputDir, name) : null;
}

function verifyBundle({ filePath, outputDir, restoreDir = null, validateState = null } = {}) {
    const selected = filePath || latestBundle(outputDir);
    if (!selected || !fs.existsSync(selected)) throw new Error('No disaster recovery bundle found');
    const compressed = fs.readFileSync(selected);
    const payload = JSON.parse(zlib.gunzipSync(compressed).toString('utf8'));
    if (payload.format !== 'attendance-bot-disaster-recovery-v1') throw new Error('Unsupported disaster recovery format');
    const entries = Object.entries(payload.files || {});
    if (!entries.length) throw new Error('Disaster recovery bundle is empty');

    for (const [relative, metadata] of entries) {
        const safePath = safeRelativePath(relative);
        const data = Buffer.from(metadata.base64 || '', 'base64');
        if (data.length !== metadata.bytes || sha256(data) !== metadata.sha256) {
            throw new Error(`Disaster recovery checksum mismatch: ${safePath}`);
        }
        if (restoreDir) {
            const destination = path.join(restoreDir, safePath);
            fs.mkdirSync(path.dirname(destination), { recursive: true });
            fs.writeFileSync(destination, data);
        }
    }

    const primary = payload.files?.['attendanceData.json'];
    if (!primary) throw new Error('Disaster recovery bundle has no attendanceData.json');
    const state = JSON.parse(Buffer.from(primary.base64, 'base64').toString('utf8'));
    const issues = typeof validateState === 'function' ? validateState(state) : [];
    if (issues?.length) throw new Error(`Restored state is invalid: ${issues.join('; ')}`);

    return {
        ok: true,
        filePath: selected,
        createdAt: payload.createdAt,
        fileCount: entries.length,
        compressedBytes: compressed.length,
        sha256: sha256(compressed),
        restoreDrill: Boolean(restoreDir)
    };
}

module.exports = {
    DEFAULT_RETENTION,
    createBundle,
    latestBundle,
    listSourceFiles,
    pruneBundles,
    safeRelativePath,
    sha256,
    verifyBundle
};
