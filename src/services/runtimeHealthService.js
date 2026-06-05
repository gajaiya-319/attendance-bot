'use strict';

function createRuntimeHealthService({
    fs,
    moment,
    timezone,
    filePath = './logs/runtime-health.json',
    pid = () => process.pid,
    logger = console
}) {
    async function write(stage, state = {}, extra = {}) {
        try {
            await fs.mkdir('./logs', { recursive: true });
            const payload = {
                stage,
                pid: pid(),
                at: moment().tz(timezone).toISOString(),
                commandRegister: {
                    lastOk: state.commandRegister?.lastOk || null,
                    count: Number(state.commandRegister?.count) || 0,
                    error: state.commandRegister?.error || null
                },
                memberFetch: {
                    lastOk: state.memberFetch?.lastOk || null,
                    retryAfter: state.memberFetch?.retryAfter || null,
                    error: state.memberFetch?.error || null
                },
                ...extra
            };
            await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`);
            return payload;
        } catch (error) {
            logger.error?.('[RUNTIME HEALTH WRITE ERROR]', error);
            return null;
        }
    }

    async function read(expectedCommandCount = 0) {
        try {
            const parsed = JSON.parse(await fs.readFile(filePath, 'utf8'));
            return evaluate(parsed, expectedCommandCount, pid());
        } catch (error) {
            return {
                ok: false,
                stage: 'missing',
                pid: null,
                pidMatches: false,
                at: 'unknown',
                commandCount: 0,
                commandCountMatches: false,
                commandError: error.message || 'runtime health read failed',
                expectedCommandCount
            };
        }
    }

    return {
        evaluate,
        read,
        write
    };
}

function evaluate(parsed = {}, expectedCommandCount = 0, currentPid = process.pid) {
    const filePid = Number(parsed.pid) || null;
    const commandCount = Number(parsed.commandRegister?.count) || 0;
    const commandError = parsed.commandRegister?.error || null;
    const pidMatches = filePid === Number(currentPid);
    const commandCountMatches = commandCount === expectedCommandCount;
    const readyComplete = parsed.stage === 'client-ready-complete';
    return {
        ok: pidMatches && commandCountMatches && readyComplete && !commandError,
        stage: parsed.stage || 'unknown',
        pid: filePid,
        pidMatches,
        at: parsed.at || 'unknown',
        commandCount,
        commandCountMatches,
        commandError: commandError || 'none',
        expectedCommandCount
    };
}

module.exports = {
    createRuntimeHealthService,
    evaluate
};
