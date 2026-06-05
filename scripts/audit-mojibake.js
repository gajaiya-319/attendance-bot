'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_ROOTS = ['index.js', 'src', 'tests', 'scripts', 'package.json'];
const DEFAULT_EXTENSIONS = new Set(['.js', '.json', '.html', '.bat']);
const DEFAULT_SKIP_DIRS = new Set(['.git', 'node_modules', 'outputs', 'backups']);
const MOJIBAKE_PATTERN = new RegExp(
    [
        '\\uFFFD',
        '[\\u5a9b\\u6e72\\u6c85\\u7570\\u8adb\\u8e42\\u6f61\\u5bc3\\uf9de\\u8b70]',
        '[?][\\u317d\\ubb52\\ub311\\ub300\\uc88e\\uc392\\uc397\\ubee4\\uacf3\\uaeb9\\ub368\\ub2ff\\ubc40\\uae43\\ubee4\\uc392]',
        '[\\u0080]'
    ].join('|'),
    'u'
);

function collectFiles(target, files = []) {
    if (!fs.existsSync(target)) return files;
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
        const base = path.basename(target);
        if (DEFAULT_SKIP_DIRS.has(base)) return files;
        for (const entry of fs.readdirSync(target)) {
            collectFiles(path.join(target, entry), files);
        }
        return files;
    }
    if (stat.isFile() && DEFAULT_EXTENSIONS.has(path.extname(target))) {
        files.push(target);
    }
    return files;
}

function findMojibakeInText(text, filePath) {
    const findings = [];
    const lines = String(text || '').split(/\r?\n/);
    lines.forEach((line, index) => {
        if (MOJIBAKE_PATTERN.test(line)) {
            findings.push({
                file: filePath,
                line: index + 1,
                text: line.trim().slice(0, 180)
            });
        }
    });
    return findings;
}

function auditMojibake({ roots = DEFAULT_ROOTS, readFile = fs.readFileSync } = {}) {
    const files = [...new Set(roots.flatMap(root => collectFiles(root)))].sort();
    const findings = [];
    for (const file of files) {
        const text = readFile(file, 'utf8');
        findings.push(...findMojibakeInText(text, file.replace(/\\/g, '/')));
    }
    return { checked: files.length, findings };
}

function formatFindings(result) {
    if (!result.findings.length) {
        return `Mojibake audit passed: checked ${result.checked} file(s).`;
    }
    return [
        `Mojibake audit failed: ${result.findings.length} suspicious line(s) in ${result.checked} file(s).`,
        ...result.findings.slice(0, 50).map(item => `${item.file}:${item.line} ${item.text}`)
    ].join('\n');
}

function main() {
    const roots = process.argv.slice(2);
    const result = auditMojibake({ roots: roots.length ? roots : DEFAULT_ROOTS });
    const output = formatFindings(result);
    if (result.findings.length) {
        console.error(output);
        process.exit(1);
    }
    console.log(output);
}

if (require.main === module) {
    main();
}

module.exports = {
    auditMojibake,
    findMojibakeInText,
    formatFindings,
    MOJIBAKE_PATTERN
};
