'use strict';

const path = require('path');

function listStartupBuildFiles(dir, baseDir, fsSync, files = []) {
    const skipDirs = new Set(['.git', 'node_modules', 'logs', 'backups', 'outputs']);
    const entries = fsSync.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!skipDirs.has(entry.name)) {
                listStartupBuildFiles(fullPath, baseDir, fsSync, files);
            }
            continue;
        }

        if (!entry.isFile()) {
            continue;
        }

        const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
        const isSourceFile = relativePath === 'index.js'
            || relativePath === 'attendance-bot.js'
            || relativePath === 'time-logic.js'
            || relativePath === 'state-policy.js'
            || relativePath === 'package.json'
            || (relativePath.startsWith('src/') && relativePath.endsWith('.js'))
            || (relativePath.startsWith('tests/') && relativePath.endsWith('.js'));
        if (isSourceFile) {
            files.push(fullPath);
        }
    }
    return files;
}

function createStartupRuntime({
    CONFIG,
    moment,
    crypto,
    fsSync,
    runtimeHealthService,
    getCommandRegisterHealth,
    getMemberFetchHealth,
    projectRoot,
    logger = console
}) {
    if (!CONFIG) throw new TypeError('CONFIG must be provided');
    if (!moment) throw new TypeError('moment must be provided');
    if (!crypto) throw new TypeError('crypto must be provided');
    if (!fsSync) throw new TypeError('fsSync must be provided');
    if (!runtimeHealthService) throw new TypeError('runtimeHealthService must be provided');
    if (typeof getCommandRegisterHealth !== 'function') {
        throw new TypeError('getCommandRegisterHealth must be a function');
    }
    if (typeof getMemberFetchHealth !== 'function') {
        throw new TypeError('getMemberFetchHealth must be a function');
    }

    const baseDir = projectRoot || path.join(__dirname, '..', '..');

    function getStartupBuildInfo() {
        try {
            const files = listStartupBuildFiles(baseDir, baseDir, fsSync).sort();
            const hash = crypto.createHash('sha1');
            let latestMtime = 0;

            for (const file of files) {
                const stat = fsSync.statSync(file);
                const relativePath = path.relative(baseDir, file).replace(/\\/g, '/');
                hash.update(relativePath);
                hash.update('\0');
                hash.update(fsSync.readFileSync(file));
                hash.update('\0');
                latestMtime = Math.max(latestMtime, stat.mtimeMs);
            }

            return {
                hash: hash.digest('hex').slice(0, 8),
                changedAt: latestMtime
                    ? moment(latestMtime).tz(CONFIG.TIMEZONE).format('YYYY-MM-DD HH:mm:ss')
                    : 'unknown',
                fileCount: files.length
            };
        } catch (error) {
            return {
                hash: 'unknown',
                changedAt: 'unknown',
                fileCount: 0,
                error: error.message
            };
        }
    }

    function getRuntimeHealthSnapshot(now = moment().tz(CONFIG.TIMEZONE)) {
        const memberFetch = getMemberFetchHealth();
        const retryAfter = memberFetch.memberFetchRetryAfter
            ? moment(memberFetch.memberFetchRetryAfter).tz(CONFIG.TIMEZONE)
            : null;
        const memberFetchBackoffSeconds = retryAfter && retryAfter.isAfter(now)
            ? retryAfter.diff(now, 'seconds')
            : 0;
        const commandRegister = getCommandRegisterHealth();
        return {
            memberFetch: {
                lastOk: memberFetch.lastMemberFetchAt
                    ? moment(memberFetch.lastMemberFetchAt).tz(CONFIG.TIMEZONE).format('MM-DD HH:mm:ss')
                    : 'none',
                backoffSeconds: memberFetchBackoffSeconds,
                error: memberFetch.lastMemberFetchError || 'none'
            },
            commandRegister: {
                lastOk: commandRegister.lastCommandRegisterAt || 'none',
                count: commandRegister.lastCommandRegisterCount,
                error: commandRegister.lastCommandRegisterError || 'none'
            }
        };
    }

    async function writeRuntimeHealthFile(stage, extra = {}) {
        const memberFetch = getMemberFetchHealth();
        const commandRegister = getCommandRegisterHealth();
        return runtimeHealthService.write(stage, {
            commandRegister: {
                lastOk: commandRegister.lastCommandRegisterAt,
                count: commandRegister.lastCommandRegisterCount,
                error: commandRegister.lastCommandRegisterError
            },
            memberFetch: {
                lastOk: memberFetch.lastMemberFetchAt,
                retryAfter: memberFetch.memberFetchRetryAfter,
                error: memberFetch.lastMemberFetchError
            }
        }, extra);
    }

    async function readRuntimeHealthFile(expectedCommandCount = 0) {
        return runtimeHealthService.read(expectedCommandCount);
    }

    function printStartupBanner({ instanceTag = `pid:${process.pid}`, layoutVersion = 'unknown' } = {}) {
        const now = moment().tz(CONFIG.TIMEZONE);
        const buildInfo = getStartupBuildInfo();
        const lines = [
            '',
            '============================================================',
            ' ATTENDANCE BOT ONLINE',
            '------------------------------------------------------------',
            ` Version : ${CONFIG.VERSION}`,
            ' Entry   : index.js',
            ` Update  : ${CONFIG.RELEASE_NOTE}`,
            ` Build   : ${buildInfo.hash} (${buildInfo.fileCount} files)`,
            ` Changed : ${buildInfo.changedAt}`,
            ` Timezone: ${CONFIG.TIMEZONE}`,
            ` Started : ${now.format('YYYY-MM-DD HH:mm:ss')}`,
            ` Instance: ${instanceTag} ${layoutVersion}`,
            '============================================================',
            ''
        ];
        logger.log(lines.join('\n'));
    }

    return {
        getStartupBuildInfo,
        getRuntimeHealthSnapshot,
        writeRuntimeHealthFile,
        readRuntimeHealthFile,
        printStartupBanner
    };
}

module.exports = {
    createStartupRuntime,
    listStartupBuildFiles
};
