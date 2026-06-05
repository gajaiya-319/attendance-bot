'use strict';

const { runOpsHealthCheck, formatHealthSummary } = require('./ops-health-check');

function parseArgs(argv = []) {
    const options = {
        timeoutSeconds: 90,
        intervalSeconds: 5,
        healthOptions: {}
    };

    for (const arg of argv) {
        if (arg.startsWith('--timeout=')) {
            options.timeoutSeconds = Number(arg.slice('--timeout='.length));
        } else if (arg.startsWith('--interval=')) {
            options.intervalSeconds = Number(arg.slice('--interval='.length));
        } else if (arg.startsWith('--process=')) {
            options.healthOptions.processName = arg.slice('--process='.length);
        } else if (arg.startsWith('--data=')) {
            options.healthOptions.dataFile = arg.slice('--data='.length);
        } else if (arg.startsWith('--runtime-health-file=')) {
            options.healthOptions.runtimeHealthFile = arg.slice('--runtime-health-file='.length);
        } else if (arg.startsWith('--expected-command-count=')) {
            options.healthOptions.expectedCommandCount = Number(arg.slice('--expected-command-count='.length));
        }
    }

    return options;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForOpsHealth({
    timeoutSeconds = 90,
    intervalSeconds = 5,
    healthOptions = {},
    healthCheck = runOpsHealthCheck,
    now = () => Date.now(),
    sleepFn = sleep
} = {}) {
    const deadline = now() + Math.max(1, timeoutSeconds) * 1000;
    const intervalMs = Math.max(1, intervalSeconds) * 1000;
    let attempt = 0;
    let lastResult = null;

    do {
        attempt++;
        lastResult = healthCheck(healthOptions);
        if (lastResult.status === 'ok') {
            return { ok: true, attempt, result: lastResult };
        }
        if (now() >= deadline) break;
        await sleepFn(Math.min(intervalMs, Math.max(0, deadline - now())));
    } while (now() <= deadline);

    return { ok: false, attempt, result: lastResult };
}

async function main() {
    const options = parseArgs(process.argv.slice(2));
    const result = await waitForOpsHealth(options);
    console.log(formatHealthSummary(result.result));
    if (!result.ok) {
        console.error(`Ops health did not become OK after ${result.attempt} attempt(s).`);
        process.exit(1);
    }
    console.log(`Ops health OK after ${result.attempt} attempt(s).`);
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = {
    parseArgs,
    waitForOpsHealth
};
