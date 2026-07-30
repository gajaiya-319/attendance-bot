'use strict';

const fs = require('fs').promises;
const path = require('path');
const moment = require('moment-timezone');
const createTimeLogic = require('../time-logic');
const { CONFIG, SHIFT_SCHEDULE, MAINTENANCE_WINDOWS } = require('../src/config/constants');
const { projectAttendanceFromEventLog } = require('../src/services/attendanceProjectionService');
const {
    runStagingReplaySuite,
    summarizeRuntimeReplay
} = require('../src/services/stagingReplayService');
const { createStagingPayrollHarness } = require('./lib/staging-replay-harness');

const DEFAULT_FIXTURE_PATH = path.join('fixtures', 'staging-replay-critical.json');
const DEFAULT_REPORT_PATH = path.join('outputs', 'staging-replay-report.json');

function getArg(argv, name, fallback = null) {
    const index = argv.indexOf(name);
    return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

function createReplayDependencies(timezone = CONFIG.TIMEZONE || 'Asia/Manila') {
    const replayConfig = { ...CONFIG, TIMEZONE: timezone };
    const timeLogic = createTimeLogic({
        CONFIG: replayConfig,
        SHIFT_SCHEDULE,
        MAINTENANCE_WINDOWS,
        moment
    });
    return {
        projectAttendanceFromEventLog,
        projectionOptions: {
            moment,
            timezone,
            getShiftBounds: timeLogic.getShiftBounds,
            clockOutGraceMins: replayConfig.CLOCK_OUT_GRACE_MINS
        },
        createPayrollHarness: () => createStagingPayrollHarness()
    };
}

function extractRuntimeEvents(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.attendanceEventLog)) return value.attendanceEventLog;
    if (Array.isArray(value?.events)) return value.events;
    return [];
}

async function loadJson(filePath) {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function writeReport(filePath, report) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(report, null, 2) + '\n', 'utf8');
}

async function run({
    fixturePath = DEFAULT_FIXTURE_PATH,
    inputPath = null,
    reportPath = DEFAULT_REPORT_PATH,
    salt = process.env.STAGING_REPLAY_SALT || 'attendance-staging-replay'
} = {}) {
    const fixture = await loadJson(fixturePath);
    const dependencies = createReplayDependencies(fixture.timezone || CONFIG.TIMEZONE);
    const suite = await runStagingReplaySuite(fixture, dependencies);
    let runtime = null;

    if (inputPath) {
        const input = await loadJson(inputPath);
        runtime = summarizeRuntimeReplay(extractRuntimeEvents(input), {
            ...dependencies,
            salt
        });
    }

    const report = {
        ok: suite.ok && (!runtime || runtime.ok),
        generatedAt: new Date().toISOString(),
        mode: inputPath ? 'critical-and-runtime-read-only' : 'critical-fixtures',
        externalWritesEnabled: false,
        fixturePath: path.normalize(fixturePath),
        runtimeInputReadOnly: Boolean(inputPath),
        suite,
        runtime
    };
    await writeReport(reportPath, report);
    return report;
}

async function main() {
    const argv = process.argv.slice(2);
    const report = await run({
        fixturePath: getArg(argv, '--fixture', DEFAULT_FIXTURE_PATH),
        inputPath: getArg(argv, '--input'),
        reportPath: getArg(argv, '--report', DEFAULT_REPORT_PATH)
    });
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
    main().catch(error => {
        console.error('[STAGING REPLAY FAILED]', error?.stack || error);
        process.exit(1);
    });
}

module.exports = {
    createReplayDependencies,
    extractRuntimeEvents,
    run
};
