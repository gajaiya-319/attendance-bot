'use strict';

const { execFileSync } = require('child_process');
const { waitForOpsHealth } = require('./wait-ops-health');
const { formatHealthSummary } = require('./ops-health-check');

function resolvePm2Command() {
    return process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
}

function buildPm2RestartCall(processName) {
    if (process.platform === 'win32') {
        return {
            command: 'cmd.exe',
            args: ['/d', '/s', '/c', 'pm2.cmd', 'restart', processName, '--update-env']
        };
    }
    return {
        command: 'pm2',
        args: ['restart', processName, '--update-env']
    };
}

function restartPm2Process(processName, runner, quiet) {
    const { command, args } = buildPm2RestartCall(processName);
    run(command, args, runner, quiet);
}

function parseArgs(argv = []) {
    const options = {
        processName: 'attendance-bot',
        timeoutSeconds: 90,
        intervalSeconds: 5,
        skipPredeploy: false,
        skipRestart: false,
        healthOptions: {}
    };

    for (const arg of argv) {
        if (arg === '--skip-predeploy') {
            options.skipPredeploy = true;
        } else if (arg === '--skip-restart') {
            options.skipRestart = true;
        } else if (arg.startsWith('--process=')) {
            options.processName = arg.slice('--process='.length);
            options.healthOptions.processName = options.processName;
        } else if (arg.startsWith('--timeout=')) {
            options.timeoutSeconds = Number(arg.slice('--timeout='.length));
        } else if (arg.startsWith('--interval=')) {
            options.intervalSeconds = Number(arg.slice('--interval='.length));
        } else if (arg.startsWith('--runtime-health-file=')) {
            options.healthOptions.runtimeHealthFile = arg.slice('--runtime-health-file='.length);
        } else if (arg.startsWith('--expected-command-count=')) {
            options.healthOptions.expectedCommandCount = Number(arg.slice('--expected-command-count='.length));
        }
    }

    return options;
}

function run(command, args, runner = execFileSync, quiet = false) {
    const label = [command, ...args].join(' ');
    if (!quiet) console.log(`\n> ${label}`);
    runner(command, args, { stdio: 'inherit' });
}

async function deployCheck({
    processName = 'attendance-bot',
    timeoutSeconds = 90,
    intervalSeconds = 5,
    skipPredeploy = false,
    skipRestart = false,
    healthOptions = {},
    runner = execFileSync,
    wait = waitForOpsHealth,
    quiet = false
} = {}) {
    if (!skipPredeploy) {
        if (process.platform === 'win32') {
            run('cmd.exe', ['/d', '/s', '/c', 'npm.cmd', 'run', 'predeploy'], runner, quiet);
        } else {
            run('npm', ['run', 'predeploy'], runner, quiet);
        }
    }
    if (!skipRestart) {
        restartPm2Process(processName, runner, quiet);
    }

    const waitResult = await wait({
        timeoutSeconds,
        intervalSeconds,
        healthOptions: {
            processName,
            ...healthOptions
        }
    });
    if (!quiet) console.log(formatHealthSummary(waitResult.result));
    if (!waitResult.ok) {
        const health = waitResult.result || {};
        const pm2Online = Boolean(health.checks?.pm2?.ok);
        const commandsOk = Boolean(health.checks?.commandRegistration?.ok);
        if (health.status === 'warn' && pm2Online && commandsOk) {
            if (!quiet) {
                console.log(formatHealthSummary(health));
                console.log(`Deploy completed with health WARN after ${waitResult.attempt} attempt(s) (bot online, commands registered).`);
            }
            return waitResult;
        }
        throw new Error(`Ops health did not become OK after ${waitResult.attempt} attempt(s).`);
    }
    if (!quiet) console.log(`Deploy check passed after ${waitResult.attempt} health attempt(s).`);
    return waitResult;
}

async function main() {
    try {
        await deployCheck(parseArgs(process.argv.slice(2)));
    } catch (error) {
        console.error(error.message || error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = {
    deployCheck,
    parseArgs,
    run,
    resolvePm2Command,
    buildPm2RestartCall,
    restartPm2Process
};
