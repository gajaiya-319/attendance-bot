'use strict';

const fs = require('fs');
const path = require('path');
const { findApprovedDayOffReservation } = require('../src/utils/dayOffReservationPolicy');

function parseArgs(argv = []) {
    const options = {
        apply: false,
        date: null,
        file: 'attendanceData.json',
        rollbackPenaltyFor: []
    };
    for (const arg of argv) {
        if (arg === '--apply') options.apply = true;
        else if (arg.startsWith('--date=')) options.date = arg.slice('--date='.length);
        else if (arg.startsWith('--file=')) options.file = arg.slice('--file='.length);
        else if (arg.startsWith('--rollback-penalty-for=')) {
            options.rollbackPenaltyFor = arg.slice('--rollback-penalty-for='.length)
                .split(',')
                .map(value => value.trim())
                .filter(Boolean);
        }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(options.date || ''))) {
        throw new Error('A valid --date=YYYY-MM-DD is required.');
    }
    return options;
}

function getFinalAbsentEvent(user, date, shift) {
    const sessionPrefix = `${String(shift).toLowerCase()}:${date} `;
    if (!String(user?.finalAbsentSessionKey || '').startsWith(sessionPrefix)) return null;
    return [...(user.attendanceEvents || [])].reverse().find(event => (
        event?.type === 'recorded_status_changed' &&
        event?.source === 'final-absent' &&
        event?.meta?.reason === 'shift-ended-without-clock-in'
    )) || null;
}

function collectRepairCandidates(state, date) {
    const users = state?.attendanceData || {};
    const reservations = state?.dayOffReservations || {};
    const candidates = [];
    const seen = new Set();

    for (const reservation of Object.values(reservations)) {
        if (!reservation || reservation.leaveDate !== date || reservation.appliedDate !== date) continue;
        const approved = findApprovedDayOffReservation(reservations, {
            userId: reservation.userId,
            shift: reservation.shift,
            businessDate: date
        });
        if (!approved || approved.messageId !== reservation.messageId) continue;
        const user = users[reservation.userId];
        const finalAbsentEvent = getFinalAbsentEvent(user, date, reservation.shift);
        if (!user || !finalAbsentEvent) continue;
        const repairKey = `${date}|${String(reservation.shift).toLowerCase()}|${reservation.userId}`;
        if (seen.has(repairKey)) continue;
        seen.add(repairKey);
        candidates.push({ repairKey, reservation, user, finalAbsentEvent });
    }
    return candidates;
}

function inferServer(user) {
    const name = String(user?.name || '');
    if (/\s-\s*V\s+(?:Day|Night)\s+Time/i.test(name)) return 'VALAKAS';
    if (/\s-\s*P\s+(?:Day|Night)\s+Time/i.test(name)) return 'PAAGRIO';
    return user?.server || '-';
}

function buildDayOffRawRow(candidate) {
    return {
        date: candidate.reservation.leaveDate,
        server: inferServer(candidate.user),
        shift: String(candidate.reservation.shift || '').toUpperCase(),
        name: candidate.user.name || candidate.reservation.name,
        status: 'day_off',
        inTime: '-',
        outTime: '-',
        note: '\uC2B9\uC778\uB41C \uD734\uAC00 \uAE30\uB85D \uBCF5\uAD6C - \uACB0\uC11D \uC624\uCC98\uB9AC \uC790\uB3D9 \uC815\uC815',
        forceStatus: true
    };
}

function applyCandidateStateRepair(candidate, { rollbackPenalty = false, absentPoints = -25, repairedAt } = {}) {
    const previous = candidate.user.falseAbsentRepairs?.[candidate.repairKey];
    if (previous) return { changed: false, penaltyRolledBack: Boolean(previous.penaltyRolledBack) };

    let penaltyRolledBack = false;
    if (rollbackPenalty) {
        candidate.user.points = Number(candidate.user.points || 0) - Number(absentPoints || 0);
        candidate.user.strikes = Math.max(0, Number(candidate.user.strikes || 0) - 1);
        candidate.user.totalAbsent = Math.max(0, Number(candidate.user.totalAbsent || 0) - 1);
        const monthly = candidate.user.monthlyStats;
        if (monthly?.month === candidate.reservation.leaveDate.slice(0, 7)) {
            monthly.totalAbsent = Math.max(0, Number(monthly.totalAbsent || 0) - 1);
            monthly.points = Number(monthly.points || 0) - Number(absentPoints || 0);
        }
        penaltyRolledBack = true;
    }

    candidate.user.falseAbsentRepairs = {
        ...(candidate.user.falseAbsentRepairs || {}),
        [candidate.repairKey]: {
            repairedAt,
            reservationMessageId: candidate.reservation.messageId,
            penaltyRolledBack
        }
    };
    candidate.reservation.falseAbsentRepairedAt = repairedAt;
    candidate.reservation.falseAbsentRepairKey = candidate.repairKey;
    return { changed: true, penaltyRolledBack };
}

function writeStateAtomically(file, state) {
    const temp = `${file}.repair-tmp`;
    fs.writeFileSync(temp, JSON.stringify(state, null, 2));
    fs.renameSync(temp, file);
    fs.copyFileSync(file, `${file}.bak`);
}

async function main() {
    require('dotenv').config();
    const { google } = require('googleapis');
    const { CONFIG } = require('../src/config/constants');
    const { createRawAttendanceSheetService } = require('../src/services/rawAttendanceSheetService');
    const options = parseArgs(process.argv.slice(2));
    const file = path.resolve(options.file);
    const state = JSON.parse(fs.readFileSync(file, 'utf8'));
    const candidates = collectRepairCandidates(state, options.date);
    const candidateIds = new Set(candidates.map(candidate => String(candidate.reservation.userId)));
    const rollbackIds = new Set(options.rollbackPenaltyFor.map(String));
    const missingRollbackIds = [...rollbackIds].filter(id => !candidateIds.has(id));
    if (missingRollbackIds.length) {
        throw new Error(`Penalty rollback target is not a verified candidate: ${missingRollbackIds.join(', ')}`);
    }

    const preview = candidates.map(candidate => ({
        repairKey: candidate.repairKey,
        userId: candidate.reservation.userId,
        name: candidate.user.name,
        finalAbsentSessionKey: candidate.user.finalAbsentSessionKey,
        rollbackPenalty: rollbackIds.has(String(candidate.reservation.userId)),
        rawRow: buildDayOffRawRow(candidate)
    }));
    if (!options.apply) {
        console.log(JSON.stringify({ apply: false, candidates: preview }, null, 2));
        return;
    }
    if (!candidates.length) throw new Error('No verified approved day-off absence candidates found.');

    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const backupDir = path.resolve('backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const backup = path.join(backupDir, `attendanceData-${stamp}-before-approved-dayoff-absence-repair.json`);
    fs.copyFileSync(file, backup);

    const rawAttendanceSheetService = createRawAttendanceSheetService({
        google,
        keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
        spreadsheetId: CONFIG.RAW_ATTENDANCE_SPREADSHEET_ID || CONFIG.PAYROLL_ARCHIVE_SPREADSHEET_ID,
        webAppUrl: null,
        pendingFilePath: './logs/raw-attendance-pending.json',
        repairAuditFilePath: './logs/raw-attendance-repair.jsonl',
        logger: console
    });
    const rawResults = [];
    for (const candidate of candidates) {
        const result = await rawAttendanceSheetService.sendAttendanceRow(buildDayOffRawRow(candidate));
        if (!result?.ok) throw new Error(`Raw attendance repair failed for ${candidate.repairKey}`);
        rawResults.push({ repairKey: candidate.repairKey, ok: true, row: result.row || null });
    }

    const repairedAt = new Date().toISOString();
    const stateResults = candidates.map(candidate => ({
        repairKey: candidate.repairKey,
        ...applyCandidateStateRepair(candidate, {
            rollbackPenalty: rollbackIds.has(String(candidate.reservation.userId)),
            absentPoints: CONFIG.POINTS.ABSENT,
            repairedAt
        })
    }));
    writeStateAtomically(file, state);
    console.log(JSON.stringify({ apply: true, backup, rawResults, stateResults }, null, 2));
}

if (require.main === module) {
    main().catch(error => {
        console.error(error);
        process.exit(1);
    });
}

module.exports = {
    applyCandidateStateRepair,
    buildDayOffRawRow,
    collectRepairCandidates,
    getFinalAbsentEvent,
    parseArgs
};
