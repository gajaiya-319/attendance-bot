'use strict';

const { evaluateStatusTransition } = require('./stateTransitionPolicy');
const {
    incrementMonthlyAttendanceStat,
    markMonthlyOvertimeAward
} = require('../utils/monthlyAttendanceStats');

function createAttendanceService(deps) {
    const {
        CONFIG,
        moment,
        getAttendanceData,
        getOvertimeUsers,
        determineShift,
        getShiftSessionKey,
        getShiftBounds,
        appendSystemEvent = null
    } = deps;

    function ensureUserData(member, shift = null) {
        if (!member) return null;
        const attendanceData = getAttendanceData();
        const s = shift || determineShift(member);
        if (!attendanceData[member.id]) {
            attendanceData[member.id] = {
                id: member.id,
                name: member.displayName || member.user?.username || 'Unknown',
                shift: s,
                checkedIn: false,
                dayOff: false,
                attendanceStatus: 'PRE_SHIFT',
                voiceStatus: 'OFFLINE',
                attendanceStatusChangedAt: null,
                voiceStatusChangedAt: null,
                dayOffExpireAt: null,
                disconnected: false,
                disconnectedAt: null,
                isFinished: false,
                strikes: 0,
                points: 0,
                totalNormal: 0,
                totalLate: 0,
                totalExcessiveLate: 0,
                totalAbsent: 0,
                totalEarly: 0,
                totalOT: 0,
                dcCount: 0,
                offCount: 0,
                voiceJoinedAt: null,
                liveOffStartedAt: null,
                lastLiveOnAt: null,
                lastLiveOffAt: null,
                postShiftOtInterruptedAt: null,
                postShiftOtInterruptedReason: null,
                preShiftLiveAt: null,
                preShiftVoiceAt: null,
                preShiftVoiceMode: null,
                preShiftVoiceWindowStartAt: null,
                preShiftVoiceWindowEndAt: null,
                pendingClockOut: null,
                pendingAutoOTConfirm: null,
                attendanceEvents: [],
                statusTransitionSeq: 0,
                statusTransitionWarnings: [],
                lastEventKey: null,
                lastEventAt: null,
                lastPreShiftWaitLogKey: null,
                dayOffPresenceNotifiedFor: null,
                dayOffClockInPromptSessionKey: null,
                dayOffClockInPromptStartedAt: null,
                dayOffClockInPromptMarks: [],
                afterFinishPresenceNotifiedFor: null,
                standbyClockInPromptKey: null,
                finishedPresence: null,
                finalLeftAt: null,
                activeSessionId: null,
                sessions: [],
                pendingManualOT: false,
                manualResumeRequired: false,
                manualResumeRequiredSince: null,
                manualResumeRequiredReason: null,
                lastManualResumePromptKey: null,
                manualResumePromptMarks: [],
                reversibleEarlyPenaltyKey: null,
                reversibleEarlyPenaltyAppliedAt: null,
                reversibleEarlyPenaltyPoints: null,
                liveOffWarnedFor: null,
                liveOffWarningMarks: [],
                absentWarningMarks: [],
                lastAbsentWarningAt: null,
                excessiveLateCountedThisShift: false,
                monthlyStats: null,
                finishedLiveOffReminderMarks: [],
                lastFinishedReturnPromptKey: null,
                lastActivityAt: null,
                lastActivitySource: null,
                lastActivityDisplayName: member.displayName || member.user?.username || 'Unknown',
                lastActionAt: 0
            };
        }

        const user = attendanceData[member.id];
        user.name = member.displayName || member.user?.username || user.name || 'Unknown';
        if (s) user.shift = s;
        user.offCount = user.offCount || 0;
        user.totalOT = user.totalOT || 0;
        user.points = user.points || 0;
        if (!Object.prototype.hasOwnProperty.call(user, 'attendanceStatus')) user.attendanceStatus = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'voiceStatus')) user.voiceStatus = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'attendanceStatusChangedAt')) user.attendanceStatusChangedAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'voiceStatusChangedAt')) user.voiceStatusChangedAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'dayOffExpireAt')) user.dayOffExpireAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'liveOffStartedAt')) user.liveOffStartedAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'lastLiveOnAt')) user.lastLiveOnAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'lastLiveOffAt')) user.lastLiveOffAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'postShiftOtInterruptedAt')) user.postShiftOtInterruptedAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'postShiftOtInterruptedReason')) user.postShiftOtInterruptedReason = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'preShiftLiveAt')) user.preShiftLiveAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'preShiftVoiceAt')) user.preShiftVoiceAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'preShiftVoiceMode')) user.preShiftVoiceMode = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'preShiftVoiceWindowStartAt')) user.preShiftVoiceWindowStartAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'preShiftVoiceWindowEndAt')) user.preShiftVoiceWindowEndAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'pendingClockOut')) user.pendingClockOut = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'pendingAutoOTConfirm')) user.pendingAutoOTConfirm = null;
        if (!Array.isArray(user.attendanceEvents)) user.attendanceEvents = [];
        if (!Object.prototype.hasOwnProperty.call(user, 'statusTransitionSeq')) user.statusTransitionSeq = 0;
        if (!Array.isArray(user.statusTransitionWarnings)) user.statusTransitionWarnings = [];
        if (!Object.prototype.hasOwnProperty.call(user, 'lastEventKey')) user.lastEventKey = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'lastEventAt')) user.lastEventAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'lastPreShiftWaitLogKey')) user.lastPreShiftWaitLogKey = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'dayOffPresenceNotifiedFor')) user.dayOffPresenceNotifiedFor = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'dayOffClockInPromptSessionKey')) user.dayOffClockInPromptSessionKey = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'dayOffClockInPromptStartedAt')) user.dayOffClockInPromptStartedAt = null;
        if (!Array.isArray(user.dayOffClockInPromptMarks)) user.dayOffClockInPromptMarks = [];
        if (!Object.prototype.hasOwnProperty.call(user, 'afterFinishPresenceNotifiedFor')) user.afterFinishPresenceNotifiedFor = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'standbyClockInPromptKey')) user.standbyClockInPromptKey = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'finishedPresence')) user.finishedPresence = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'finalLeftAt')) user.finalLeftAt = null;
        if (!Array.isArray(user.sessions)) user.sessions = [];
        if (!Object.prototype.hasOwnProperty.call(user, 'activeSessionId')) user.activeSessionId = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'pendingManualOT')) user.pendingManualOT = false;
        if (!Object.prototype.hasOwnProperty.call(user, 'manualResumeRequired')) user.manualResumeRequired = false;
        if (!Object.prototype.hasOwnProperty.call(user, 'manualResumeRequiredSince')) user.manualResumeRequiredSince = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'manualResumeRequiredReason')) user.manualResumeRequiredReason = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'lastManualResumePromptKey')) user.lastManualResumePromptKey = null;
        if (!Array.isArray(user.manualResumePromptMarks)) user.manualResumePromptMarks = [];
        if (!Object.prototype.hasOwnProperty.call(user, 'reversibleEarlyPenaltyKey')) user.reversibleEarlyPenaltyKey = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'reversibleEarlyPenaltyAppliedAt')) user.reversibleEarlyPenaltyAppliedAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'reversibleEarlyPenaltyPoints')) user.reversibleEarlyPenaltyPoints = null;
        if (!Array.isArray(user.liveOffWarningMarks)) user.liveOffWarningMarks = [];
        if (!Array.isArray(user.absentWarningMarks)) user.absentWarningMarks = [];
        if (!Object.prototype.hasOwnProperty.call(user, 'lastAbsentWarningAt')) user.lastAbsentWarningAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'totalExcessiveLate')) user.totalExcessiveLate = 0;
        if (!Object.prototype.hasOwnProperty.call(user, 'excessiveLateCountedThisShift')) user.excessiveLateCountedThisShift = false;
        if (!Object.prototype.hasOwnProperty.call(user, 'monthlyStats')) user.monthlyStats = null;
        if (!Array.isArray(user.finishedLiveOffReminderMarks)) user.finishedLiveOffReminderMarks = [];
        if (!Object.prototype.hasOwnProperty.call(user, 'lastFinishedReturnPromptKey')) user.lastFinishedReturnPromptKey = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'lastActivityAt')) user.lastActivityAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'lastActivitySource')) user.lastActivitySource = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'lastActivityDisplayName')) user.lastActivityDisplayName = user.name;
        return user;
    }

    function ensureSessionStore(user) {
        if (!Array.isArray(user.sessions)) user.sessions = [];
        if (!Object.prototype.hasOwnProperty.call(user, 'activeSessionId')) user.activeSessionId = null;
    }

    function getOpenSession(user) {
        ensureSessionStore(user);
        return user.sessions.find(s => s.id === user.activeSessionId && !s.clockOutAt) ||
            user.sessions.slice().reverse().find(s => !s.clockOutAt) ||
            null;
    }

    function getRelevantSessionForTime(user, at) {
        if (!user || !Array.isArray(user.sessions)) return null;
        const ref = moment(at).tz(CONFIG.TIMEZONE);
        return user.sessions
            .filter(s => s?.scheduledEndAt && s.clockInAt && moment(s.clockInAt).tz(CONFIG.TIMEZONE).isSameOrBefore(ref))
            .sort((a, b) => moment(b.clockInAt).valueOf() - moment(a.clockInAt).valueOf())[0] || null;
    }

    function getScheduledEndMoment(user, fallbackAt = moment().tz(CONFIG.TIMEZONE), options = {}) {
        const shiftOverride = options.shiftOverride || null;
        const ignoreMismatchedSessionShift = Boolean(options.ignoreMismatchedSessionShift);
        const targetShift = shiftOverride || user?.shift || null;
        const openSession = getOpenSession(user);
        const relevantSession = openSession || getRelevantSessionForTime(user, fallbackAt);
        if (relevantSession?.scheduledEndAt) {
            if (ignoreMismatchedSessionShift && targetShift && relevantSession.shift && relevantSession.shift !== targetShift) {
                return getShiftBounds(targetShift, fallbackAt).end;
            }
            return moment(relevantSession.scheduledEndAt).tz(CONFIG.TIMEZONE);
        }
        if (!['day', 'night'].includes(targetShift)) return null;
        const reference = user.checkInRaw
            ? moment(user.checkInRaw).tz(CONFIG.TIMEZONE)
            : moment(fallbackAt).tz(CONFIG.TIMEZONE);
        return getShiftBounds(targetShift, reference).end;
    }

    function normalizeOpenSessions(user, now = moment().tz(CONFIG.TIMEZONE)) {
        ensureSessionStore(user);
        const openSessions = user.sessions.filter(s => !s.clockOutAt);
        if (openSessions.length <= 1) return;
        const keep = openSessions.slice().sort((a, b) => moment(a.clockInAt).valueOf() - moment(b.clockInAt).valueOf()).pop();
        for (const session of openSessions) {
            if (session.id === keep.id) continue;
            const closeAt = moment.min(moment(now).tz(CONFIG.TIMEZONE), moment(keep.clockInAt).tz(CONFIG.TIMEZONE));
            session.clockOutAt = closeAt.toISOString();
            session.clockOutDetectedAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
            session.clockOutSource = 'session-repair';
            session.clockOutReason = '중복 열린 세션 자동 정리';
            session.workedMinutes = Math.max(0, closeAt.diff(moment(session.clockInAt).tz(CONFIG.TIMEZONE), 'minutes'));
        }
        user.activeSessionId = keep.id;
    }

    function startAttendanceSession(user, shift, now, source = 'unknown') {
        ensureSessionStore(user);
        normalizeOpenSessions(user, now);
        const open = getOpenSession(user);
        if (open) {
            user.activeSessionId = open.id;
            return open;
        }

        const bounds = getShiftBounds(shift, now);
        const session = {
            id: `${shift}:${bounds.start.format('YYYY-MM-DD-HH-mm')}:${now.valueOf()}`,
            shift,
            sessionKey: getShiftSessionKey(shift, now),
            scheduledStartAt: bounds.start.toISOString(),
            scheduledEndAt: bounds.end.toISOString(),
            clockInAt: now.toISOString(),
            clockInDetectedAt: now.toISOString(),
            clockInSource: source,
            clockOutAt: null,
            clockOutDetectedAt: null,
            clockOutSource: null,
            clockOutReason: null,
            workedMinutes: 0,
            liveOffPeriods: [],
            dcPeriods: [],
            otType: null
        };
        user.sessions.push(session);
        user.activeSessionId = session.id;
        return session;
    }

    function finishAttendanceSession(user, outMoment, source = 'unknown', reason = null, detectedAt = null) {
        const session = getOpenSession(user);
        if (!session) return null;
        const outAt = moment(outMoment).tz(CONFIG.TIMEZONE);
        const confirmedAt = detectedAt ? moment(detectedAt).tz(CONFIG.TIMEZONE) : moment().tz(CONFIG.TIMEZONE);
        const inAt = moment(session.clockInAt).tz(CONFIG.TIMEZONE);
        closeOpenSessionPeriod(session.liveOffPeriods, outAt);
        closeOpenSessionPeriod(session.dcPeriods, outAt);
        session.clockOutAt = outAt.toISOString();
        session.clockOutDetectedAt = confirmedAt.toISOString();
        session.clockOutSource = source;
        session.clockOutReason = reason;
        session.workedMinutes = Math.max(0, outAt.diff(inAt, 'minutes'));
        const workedSummary = calculateSessionWorkedMinutes(session, outAt);
        session.grossMinutes = workedSummary.grossMinutes;
        session.liveOffMinutes = workedSummary.liveOffMinutes;
        session.dcMinutes = workedSummary.dcMinutes;
        session.creditedMinutes = workedSummary.creditedMinutes;
        user.activeSessionId = null;
        return session;
    }

    function getLatestAutoTimeoutSession(user, now, sources = ['dc-timeout', 'live-off-timeout']) {
        if (!user || !Array.isArray(user.sessions)) return null;
        const ref = moment(now).tz(CONFIG.TIMEZONE);
        return user.sessions
            .filter(session => {
                if (!session?.clockOutAt || !sources.includes(session.clockOutSource)) return false;
                const scheduledEnd = session.scheduledEndAt ? moment(session.scheduledEndAt).tz(CONFIG.TIMEZONE) : null;
                return Boolean(scheduledEnd?.isValid?.() && ref.isBefore(scheduledEnd));
            })
            .sort((a, b) => {
                const aAt = moment(a.clockOutAt).tz(CONFIG.TIMEZONE).valueOf();
                const bAt = moment(b.clockOutAt).tz(CONFIG.TIMEZONE).valueOf();
                return bAt - aAt;
            })[0] || null;
    }

    function startSessionPeriod(periods, startedAt, reason = null) {
        if (!Array.isArray(periods)) return;
        if (periods.some(p => !p.endedAt)) return;
        periods.push({
            startedAt: moment(startedAt).tz(CONFIG.TIMEZONE).toISOString(),
            endedAt: null,
            minutes: 0,
            reason
        });
    }

    function closeOpenSessionPeriod(periods, endedAt) {
        if (!Array.isArray(periods)) return;
        const open = periods.slice().reverse().find(p => !p.endedAt);
        if (!open) return;
        const end = moment(endedAt).tz(CONFIG.TIMEZONE);
        open.endedAt = end.toISOString();
        open.minutes = Math.max(0, end.diff(moment(open.startedAt).tz(CONFIG.TIMEZONE), 'minutes'));
    }

    function extendLastTimeoutPeriod(session, periodKey, recoveredAt) {
        if (!session) return null;
        if (!Array.isArray(session[periodKey])) session[periodKey] = [];
        const recovered = moment(recoveredAt).tz(CONFIG.TIMEZONE);
        const timeoutAt = session.clockOutAt ? moment(session.clockOutAt).tz(CONFIG.TIMEZONE) : recovered;
        let period = session[periodKey].slice().reverse().find(candidate => {
            if (!candidate?.startedAt) return false;
            if (!candidate.endedAt) return true;
            const ended = moment(candidate.endedAt).tz(CONFIG.TIMEZONE);
            return Math.abs(ended.diff(timeoutAt, 'minutes')) <= 1;
        });
        if (!period) {
            period = {
                startedAt: timeoutAt.toISOString(),
                endedAt: null,
                minutes: 0,
                reason: session.clockOutSource || periodKey
            };
            session[periodKey].push(period);
        }
        period.endedAt = recovered.toISOString();
        period.minutes = Math.max(0, recovered.diff(moment(period.startedAt).tz(CONFIG.TIMEZONE), 'minutes'));
        return period;
    }

    function getPeriodMinutes(period, fallbackEnd) {
        if (!period?.startedAt) return 0;
        const end = moment(fallbackEnd).tz(CONFIG.TIMEZONE);
        const started = moment(period.startedAt).tz(CONFIG.TIMEZONE);
        const ended = period.endedAt ? moment(period.endedAt).tz(CONFIG.TIMEZONE) : end;
        return Math.max(0, ended.diff(started, 'minutes'));
    }

    function sumSessionPeriods(periods, fallbackEnd) {
        if (!Array.isArray(periods)) return 0;
        return periods.reduce((total, period) => {
            return total + getPeriodMinutes(period, fallbackEnd);
        }, 0);
    }

    function sumCreditedLiveOffPeriods(periods, fallbackEnd) {
        if (!Array.isArray(periods)) return 0;
        const ignoreMins = Math.max(0, Number(CONFIG.LIVE_OFF_IGNORE_MINS || 0));
        return periods.reduce((total, period) => {
            const minutes = getPeriodMinutes(period, fallbackEnd);
            return total + (minutes > ignoreMins ? minutes : 0);
        }, 0);
    }

    function calculateSessionWorkedMinutes(session, now = moment().tz(CONFIG.TIMEZONE)) {
        if (!session?.clockInAt) {
            return {
                grossMinutes: 0,
                liveOffMinutes: 0,
                dcMinutes: 0,
                creditedMinutes: 0
            };
        }
        const end = session.clockOutAt
            ? moment(session.clockOutAt).tz(CONFIG.TIMEZONE)
            : moment(now).tz(CONFIG.TIMEZONE);
        const start = moment(session.clockInAt).tz(CONFIG.TIMEZONE);
        const grossMinutes = Math.max(0, end.diff(start, 'minutes'));
        const liveOffMinutes = Math.min(grossMinutes, sumCreditedLiveOffPeriods(session.liveOffPeriods, end));
        const dcMinutes = Math.min(grossMinutes, sumSessionPeriods(session.dcPeriods, end));
        const creditedMinutes = Math.max(0, grossMinutes - liveOffMinutes - dcMinutes);
        return {
            grossMinutes,
            liveOffMinutes,
            dcMinutes,
            creditedMinutes
        };
    }

    function getUserLatestSessionSummary(user, now = moment().tz(CONFIG.TIMEZONE)) {
        if (!user || !Array.isArray(user.sessions) || user.sessions.length === 0) return null;
        const session = getOpenSession(user) ||
            user.sessions.slice().sort((a, b) => {
                const aAt = moment(a.clockInAt || a.scheduledStartAt || 0).valueOf();
                const bAt = moment(b.clockInAt || b.scheduledStartAt || 0).valueOf();
                return bAt - aAt;
            })[0];
        if (!session) return null;
        return {
            session,
            ...calculateSessionWorkedMinutes(session, now)
        };
    }

    function getOvertimeSourceSession(user, at) {
        if (!user || !Array.isArray(user.sessions)) return null;
        const ref = moment(at).tz(CONFIG.TIMEZONE);
        return user.sessions
            .filter(session => {
                if (!session?.scheduledEndAt || !session?.clockInAt || !session?.clockOutAt) return false;
                const scheduledEnd = moment(session.scheduledEndAt).tz(CONFIG.TIMEZONE);
                if (!scheduledEnd.isValid() || scheduledEnd.isAfter(ref.clone().add(1, 'minute'))) return false;
                return ref.diff(scheduledEnd, 'hours', true) <= Number(CONFIG.PURGE_MANUAL_OT || 40);
            })
            .sort((a, b) => {
                const aEnd = moment(a.scheduledEndAt).tz(CONFIG.TIMEZONE).valueOf();
                const bEnd = moment(b.scheduledEndAt).tz(CONFIG.TIMEZONE).valueOf();
                return bEnd - aEnd;
            })[0] || null;
    }

    function addOvertimeUser(user, type = 'AUTO', startedAt = null) {
        if (!user) return false;
        const overtimeUsers = getOvertimeUsers();
        const otStartedAt = startedAt
            ? moment(startedAt).tz(CONFIG.TIMEZONE)
            : moment().tz(CONFIG.TIMEZONE);
        const session = getOpenSession(user);
        const shiftSessionKey = session?.sessionKey || (user.shift ? getShiftSessionKey(user.shift, otStartedAt) : null);
        const existing = overtimeUsers.find(o => o.id === user.id);
        if (existing) {
            existing.name = user.name || existing.name;
            if (type === 'FORCED') existing.type = 'FORCED';
            existing.shift = user.shift || existing.shift || null;
            existing.startedAt = existing.startedAt || otStartedAt.toISOString();
            existing.shiftSessionKey = shiftSessionKey || existing.shiftSessionKey || null;
            return false;
        }
        overtimeUsers.push({
            id: user.id,
            name: user.name,
            type,
            shift: user.shift || null,
            shiftSessionKey,
            startedAt: otStartedAt.toISOString()
        });
        if (session) {
            session.otType = type;
            session.otStartedAt = otStartedAt.toISOString();
        }
        return true;
    }

    function appendAttendanceEvent(user, type, at, source = 'system', meta = {}) {
        if (!user) return false;
        if (!Array.isArray(user.attendanceEvents)) user.attendanceEvents = [];
        const eventAt = moment(at).tz(CONFIG.TIMEZONE);
        const key = `${type}:${source}`;
        if (
            user.lastEventKey === key &&
            user.lastEventAt &&
            Math.abs(eventAt.diff(moment(user.lastEventAt).tz(CONFIG.TIMEZONE), 'seconds')) < 30
        ) {
            return false;
        }
        user.lastEventKey = key;
        user.lastEventAt = eventAt.toISOString();
        const event = {
            at: eventAt.toISOString(),
            type,
            source,
            meta
        };
        user.attendanceEvents.push(event);
        if (user.attendanceEvents.length > 100) {
            user.attendanceEvents = user.attendanceEvents.slice(-100);
        }
        if (typeof appendSystemEvent === 'function') {
            appendSystemEvent({
                ...event,
                userId: user.id || null,
                userName: user.name || null,
                shift: user.shift || null,
                attendanceStatus: user.attendanceStatus || null,
                voiceStatus: user.voiceStatus || null,
                sessionId: meta?.sessionId || user.activeSessionId || null
            });
        }
        return true;
    }

    function countExcessiveLateOnce(user, at) {
        if (!user || user.excessiveLateCountedThisShift) return false;
        user.totalExcessiveLate = (user.totalExcessiveLate || 0) + 1;
        user.points = (user.points || 0) + (CONFIG.POINTS.EXCESSIVE_LATE || 0);
        incrementMonthlyAttendanceStat(user, {
            moment,
            at,
            timezone: CONFIG.TIMEZONE,
            field: 'totalExcessiveLate',
            pointsDelta: CONFIG.POINTS.EXCESSIVE_LATE || 0
        });
        user.excessiveLateCountedThisShift = true;
        return true;
    }

    function transitionRecordedStatus(user, next = {}, now = moment().tz(CONFIG.TIMEZONE), source = 'system', reason = null) {
        if (!user) return false;
        const at = moment(now).tz(CONFIG.TIMEZONE);
        let changed = false;
        const policy = evaluateStatusTransition({ user, next, source, reason });
        const transitionId = (Number(user.statusTransitionSeq) || 0) + 1;
        const meta = { reason, transitionId };

        if (next.attendanceStatus && user.attendanceStatus !== next.attendanceStatus) {
            meta.attendanceStatus = {
                from: user.attendanceStatus || null,
                to: next.attendanceStatus
            };
            user.attendanceStatus = next.attendanceStatus;
            user.attendanceStatusChangedAt = at.toISOString();
            changed = true;
        }

        if (next.voiceStatus && user.voiceStatus !== next.voiceStatus) {
            meta.voiceStatus = {
                from: user.voiceStatus || null,
                to: next.voiceStatus
            };
            user.voiceStatus = next.voiceStatus;
            user.voiceStatusChangedAt = at.toISOString();
            changed = true;
        }

        if (policy.warnings.length) {
            meta.policyWarnings = policy.warnings;
            user.statusTransitionWarnings = [
                ...(Array.isArray(user.statusTransitionWarnings) ? user.statusTransitionWarnings : []),
                {
                    at: at.toISOString(),
                    source,
                    reason,
                    warnings: policy.warnings,
                    from: policy.from,
                    to: policy.to
                }
            ].slice(-50);
        }

        if (changed) {
            user.statusTransitionSeq = transitionId;
            appendAttendanceEvent(user, 'recorded_status_changed', at, source, meta);
        }
        return changed;
    }

    function setFinishedPresence(user, nextPresence, now, source = 'system') {
        if (!user || !['in_voice', 'left_voice'].includes(nextPresence)) return false;
        const at = moment(now).tz(CONFIG.TIMEZONE);
        if (user.finishedPresence === nextPresence) return false;
        const previous = user.finishedPresence || null;
        user.finishedPresence = nextPresence;
        if (nextPresence === 'left_voice') {
            user.finalLeftAt = at.toISOString();
        } else {
            user.finalLeftAt = null;
        }
        appendAttendanceEvent(user, 'finished_presence_changed', at, source, {
            from: previous,
            to: nextPresence
        });
        return true;
    }

    function applyClockInCore(user, member, shift, now, clockInRule, isAuto = false) {
        const source = isAuto ? 'live_on' : 'button_or_command';

        if (!clockInRule.ok) {
            user.shift = shift;
            user.preShiftLiveAt = now.toISOString();
            const waitLogKey = `${shift}:${clockInRule.bounds.start.format('YYYY-MM-DD HH:mm')}:too-early`;
            const shouldLogPreShiftWait = user.lastPreShiftWaitLogKey !== waitLogKey;
            if (shouldLogPreShiftWait) {
                user.lastPreShiftWaitLogKey = waitLogKey;
                appendAttendanceEvent(user, 'clock_in_attempt', now, source, { shift, result: 'waiting' });
            }
            return {
                ok: false,
                user,
                waitLogKey,
                shouldLogPreShiftWait,
                preShiftStart: clockInRule.bounds.start
            };
        }
        appendAttendanceEvent(user, 'clock_in_attempt', now, source, { shift, result: 'accepted' });

        let recognizedAt = clockInRule.recognizedAt;
        const bounds = clockInRule.bounds || getShiftBounds(shift, now);
        const previousPreShiftLiveAt = user.preShiftLiveAt ? moment(user.preShiftLiveAt).tz(CONFIG.TIMEZONE) : null;
        const previousPreShiftVoiceAt = user.preShiftVoiceAt ? moment(user.preShiftVoiceAt).tz(CONFIG.TIMEZONE) : null;
        const preShiftVoiceMode = user.preShiftVoiceMode === 'maintenance' ? 'maintenance' : 'regular';
        const preShiftVoiceWindowStartAt = user.preShiftVoiceWindowStartAt ? moment(user.preShiftVoiceWindowStartAt).tz(CONFIG.TIMEZONE) : null;
        const preShiftVoiceWindowEndAt = user.preShiftVoiceWindowEndAt ? moment(user.preShiftVoiceWindowEndAt).tz(CONFIG.TIMEZONE) : null;
        const preShiftMemoryMins = Math.max(
            Number(CONFIG.PRE_SHIFT_LIVE_MEMORY_MINS || 30),
            Number(CONFIG.PRE_SHIFT_LIVE_BUFFER_MINS || 0)
        );
        const reconnectGraceMins = Math.max(0, Number(CONFIG.PRE_SHIFT_RECONNECT_GRACE_MINS || CONFIG.GRACE_PERIOD_MINS || 10));
        const canRecognizePreShiftReconnect = Boolean(
            !clockInRule.preShift &&
            previousPreShiftLiveAt?.isValid?.() &&
            bounds?.start &&
            previousPreShiftLiveAt.isBefore(bounds.start) &&
            previousPreShiftLiveAt.isSameOrAfter(bounds.start.clone().subtract(preShiftMemoryMins, 'minutes')) &&
            moment(now).tz(CONFIG.TIMEZONE).diff(bounds.start, 'minutes') <= reconnectGraceMins
        );
        const voiceGraceMins = Math.max(0, Number(CONFIG.PRE_SHIFT_VOICE_LIVE_GRACE_MINS || CONFIG.PRE_SHIFT_RECONNECT_GRACE_MINS || CONFIG.GRACE_PERIOD_MINS || 10));
        const voiceMemoryMins = Math.max(voiceGraceMins, Number(CONFIG.PRE_SHIFT_VOICE_MEMORY_MINS || 7 * 60));
        const hasMaintenanceVoiceWindow = Boolean(
            preShiftVoiceMode === 'maintenance' &&
            preShiftVoiceWindowStartAt?.isValid?.() &&
            preShiftVoiceWindowEndAt?.isValid?.() &&
            bounds?.start &&
            preShiftVoiceWindowEndAt.isSame(bounds.start)
        );
        const preShiftVoiceAllowedStart = preShiftVoiceMode === 'maintenance'
            ? (hasMaintenanceVoiceWindow ? preShiftVoiceWindowStartAt : null)
            : bounds?.start?.clone?.().subtract(voiceMemoryMins, 'minutes');
        const preShiftVoiceAllowedEnd = preShiftVoiceMode === 'maintenance'
            ? (hasMaintenanceVoiceWindow ? preShiftVoiceWindowEndAt : null)
            : bounds?.start;
        const canRecognizePreShiftVoiceGrace = Boolean(
            !clockInRule.preShift &&
            previousPreShiftVoiceAt?.isValid?.() &&
            bounds?.start &&
            previousPreShiftVoiceAt.isBefore(bounds.start) &&
            preShiftVoiceAllowedStart?.isValid?.() &&
            preShiftVoiceAllowedEnd?.isValid?.() &&
            previousPreShiftVoiceAt.isSameOrAfter(preShiftVoiceAllowedStart) &&
            previousPreShiftVoiceAt.isBefore(preShiftVoiceAllowedEnd) &&
            moment(now).tz(CONFIG.TIMEZONE).diff(bounds.start, 'minutes') <= voiceGraceMins
        );
        if (canRecognizePreShiftReconnect || canRecognizePreShiftVoiceGrace) {
            recognizedAt = bounds.start.clone();
        }
        const wasFinalAbsent = user.status === 'absent' || user.attendanceStatus === 'ABSENT';
        const overtimeUsers = getOvertimeUsers();
        const overtimeBefore = overtimeUsers.length;
        const filteredOvertimeUsers = overtimeUsers.filter(o => o.id !== member.id);
        overtimeUsers.splice(0, overtimeUsers.length, ...filteredOvertimeUsers);

        user.checkedIn = true;
        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.isFinished = false;
        user.checkOutTime = null;
        user.checkOutRaw = null;
        user.lastClockOutSource = null;
        user.lastClockOutReason = null;
        user.lastClockOutDetectedAt = null;
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus: 'LIVE_ON'
        }, recognizedAt, isAuto ? 'live-on' : 'button-or-command', (clockInRule.preShift || canRecognizePreShiftReconnect || canRecognizePreShiftVoiceGrace) ? 'pre-shift-clock-in' : 'clock-in');
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.earlyOut = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.liveOffStartedAt = null;
        user.pendingClockOut = null;
        user.pendingAutoOTConfirm = null;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.lastManualResumePromptKey = null;
        user.manualResumePromptMarks = [];
        user.finishedLiveOffReminderMarks = [];
        user.preShiftLiveAt = null;
        user.preShiftVoiceAt = null;
        user.preShiftVoiceMode = null;
        user.preShiftVoiceWindowStartAt = null;
        user.preShiftVoiceWindowEndAt = null;
        user.lastPreShiftWaitLogKey = null;
        user.lastLiveOnAt = now.toISOString();
        user.shift = shift;
        user.checkInTime = recognizedAt.format('hh:mm A');
        user.checkInRaw = recognizedAt.toISOString();

        const session = startAttendanceSession(user, shift, recognizedAt, clockInRule.preShift ? 'pre-shift-live' : (isAuto ? 'live-on' : 'button-or-command'));
        if (session) {
            session.clockInDetectedAt = now.toISOString();
            if (clockInRule.preShift || canRecognizePreShiftReconnect || canRecognizePreShiftVoiceGrace) {
                session.firstLiveOnAt = (previousPreShiftLiveAt?.isValid?.() ? previousPreShiftLiveAt : moment(now).tz(CONFIG.TIMEZONE)).toISOString();
                session.firstVoiceJoinAt = previousPreShiftVoiceAt?.isValid?.() ? previousPreShiftVoiceAt.toISOString() : null;
                session.preShiftReconnectGrace = Boolean(canRecognizePreShiftReconnect);
                session.preShiftVoiceGrace = Boolean(canRecognizePreShiftVoiceGrace);
                session.preShiftVoiceMode = canRecognizePreShiftVoiceGrace ? preShiftVoiceMode : null;
                session.preShiftVoiceWindowStartAt = hasMaintenanceVoiceWindow ? preShiftVoiceWindowStartAt.toISOString() : null;
                session.preShiftVoiceWindowEndAt = hasMaintenanceVoiceWindow ? preShiftVoiceWindowEndAt.toISOString() : null;
            }
        }
        appendAttendanceEvent(user, 'clock_in_confirmed', recognizedAt, source, {
            detectedAt: now.toISOString(),
            preShift: Boolean(clockInRule.preShift || canRecognizePreShiftReconnect || canRecognizePreShiftVoiceGrace),
            preShiftDetectedAt: previousPreShiftLiveAt?.isValid?.() ? previousPreShiftLiveAt.toISOString() : null,
            preShiftVoiceAt: previousPreShiftVoiceAt?.isValid?.() ? previousPreShiftVoiceAt.toISOString() : null,
            preShiftVoiceMode: canRecognizePreShiftVoiceGrace ? preShiftVoiceMode : null,
            preShiftVoiceWindowStartAt: hasMaintenanceVoiceWindow ? preShiftVoiceWindowStartAt.toISOString() : null,
            preShiftVoiceWindowEndAt: hasMaintenanceVoiceWindow ? preShiftVoiceWindowEndAt.toISOString() : null,
            preShiftReconnectGrace: Boolean(canRecognizePreShiftReconnect),
            preShiftVoiceGrace: Boolean(canRecognizePreShiftVoiceGrace)
        });

        if (shift) {
            const diffMins = recognizedAt.diff(getShiftBounds(shift, recognizedAt).start, 'minutes');
            if (diffMins > 120) {
                user.status = 'late';
                user.excessiveLateThisShift = true;
                countExcessiveLateOnce(user, recognizedAt);
                if (wasFinalAbsent && user.strikeReceivedThisShift && !user.absentConvertedToLateThisShift) {
                    user.points = (user.points || 0) - (CONFIG.POINTS.ABSENT || 0) + (CONFIG.POINTS.LATE || 0);
                    user.totalAbsent = Math.max(0, (user.totalAbsent || 0) - 1);
                    user.totalLate = (user.totalLate || 0) + 1;
                    incrementMonthlyAttendanceStat(user, {
                        moment,
                        at: recognizedAt,
                        timezone: CONFIG.TIMEZONE,
                        field: 'totalAbsent',
                        pointsDelta: -(CONFIG.POINTS.ABSENT || 0),
                        countDelta: -1
                    });
                    incrementMonthlyAttendanceStat(user, {
                        moment,
                        at: recognizedAt,
                        timezone: CONFIG.TIMEZONE,
                        field: 'totalLate',
                        pointsDelta: CONFIG.POINTS.LATE || 0
                    });
                    user.absentConvertedToLateThisShift = true;
                } else if (!user.strikeReceivedThisShift) {
                    user.strikes = (user.strikes || 0) + 1;
                    user.points = (user.points || 0) + CONFIG.POINTS.LATE;
                    user.totalLate = (user.totalLate || 0) + 1;
                    incrementMonthlyAttendanceStat(user, {
                        moment,
                        at: recognizedAt,
                        timezone: CONFIG.TIMEZONE,
                        field: 'totalLate',
                        pointsDelta: CONFIG.POINTS.LATE
                    });
                    user.strikeReceivedThisShift = true;
                }
            } else if (diffMins > Math.max(0, Number(CONFIG.CLOCK_IN_GRACE_MINS || 0))) {
                user.status = 'late';
                user.excessiveLateThisShift = false;
                if (!user.strikeReceivedThisShift) {
                    user.strikes = (user.strikes || 0) + 1;
                    user.points = (user.points || 0) + CONFIG.POINTS.LATE;
                    user.totalLate = (user.totalLate || 0) + 1;
                    incrementMonthlyAttendanceStat(user, {
                        moment,
                        at: recognizedAt,
                        timezone: CONFIG.TIMEZONE,
                        field: 'totalLate',
                        pointsDelta: CONFIG.POINTS.LATE
                    });
                    user.strikeReceivedThisShift = true;
                }
            } else {
                user.status = 'ontime';
                user.excessiveLateThisShift = false;
                user.points = (user.points || 0) + CONFIG.POINTS.NORMAL_IN;
                user.totalNormal = (user.totalNormal || 0) + 1;
                incrementMonthlyAttendanceStat(user, {
                    moment,
                    at: recognizedAt,
                    timezone: CONFIG.TIMEZONE,
                    field: 'totalNormal',
                    pointsDelta: CONFIG.POINTS.NORMAL_IN
                });
            }
        }

        return {
            ok: true,
            user,
            recognizedAt,
            session,
            status: user.status,
            preShift: Boolean(clockInRule.preShift || canRecognizePreShiftReconnect || canRecognizePreShiftVoiceGrace),
            preShiftDetectedAt: previousPreShiftLiveAt?.isValid?.() ? previousPreShiftLiveAt : null,
            preShiftVoiceAt: previousPreShiftVoiceAt?.isValid?.() ? previousPreShiftVoiceAt : null,
            preShiftVoiceMode: canRecognizePreShiftVoiceGrace ? preShiftVoiceMode : null,
            preShiftVoiceWindowStartAt: hasMaintenanceVoiceWindow ? preShiftVoiceWindowStartAt : null,
            preShiftVoiceWindowEndAt: hasMaintenanceVoiceWindow ? preShiftVoiceWindowEndAt : null,
            preShiftReconnectGrace: Boolean(canRecognizePreShiftReconnect),
            preShiftVoiceGrace: Boolean(canRecognizePreShiftVoiceGrace),
            removedOvertimeEntry: overtimeBefore !== overtimeUsers.length,
            convertedAbsentToLate: Boolean(wasFinalAbsent && user.status === 'late'),
            excessiveLate: Boolean(user.excessiveLateThisShift),
            excessiveLateCounted: Boolean(user.excessiveLateCountedThisShift)
        };
    }

    function applyClockOutCore(member, user, now, customLogText = null, earlyOverrideTime = null, options = {}) {
        const memberId = member?.id || member;
        if (!user) return { ok: false, reason: 'missing-user' };
        if (!user.checkedIn && !user.disconnected) return { ok: false, reason: 'not-active' };

        const outMoment = options.effectiveTime ? moment(options.effectiveTime).tz(CONFIG.TIMEZONE) : moment(now).tz(CONFIG.TIMEZONE);
        const detectedAt = options.detectedAt ? moment(options.detectedAt).tz(CONFIG.TIMEZONE) : moment(now).tz(CONFIG.TIMEZONE);
        const clockOutSource = options.clockOutSource || 'clock-out';
        const hasVoiceChannel = Boolean(member?.voice?.channelId);
        const voiceStatus = hasVoiceChannel ? (member.voice?.streaming ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE';

        user.checkedIn = false;
        user.isFinished = true;
        transitionRecordedStatus(user, {
            attendanceStatus: 'FINISHED',
            voiceStatus
        }, outMoment, clockOutSource, customLogText || 'clock-out');
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.preShiftVoiceAt = null;
        user.preShiftVoiceMode = null;
        user.preShiftVoiceWindowStartAt = null;
        user.preShiftVoiceWindowEndAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.finishedLiveOffReminderMarks = [];
        user.pendingClockOut = null;
        user.checkOutTime = outMoment.format('hh:mm A');
        user.checkOutRaw = outMoment.toISOString();
        user.lastClockOutSource = clockOutSource;
        user.lastClockOutReason = customLogText || null;
        user.lastClockOutDetectedAt = detectedAt.toISOString();

        const reversibleEarlyPenaltyKey = ['dc-timeout', 'live-off-timeout'].includes(options.clockOutSource)
            ? `${options.clockOutSource}:${outMoment.toISOString()}`
            : null;
        setFinishedPresence(user, hasVoiceChannel ? 'in_voice' : 'left_voice', outMoment, clockOutSource);
        const session = finishAttendanceSession(user, outMoment, clockOutSource, customLogText, detectedAt);
        appendAttendanceEvent(user, 'clock_out_confirmed', outMoment, clockOutSource, {
            detectedAt: detectedAt.toISOString(),
            reason: customLogText || null
        });

        const overtimeUsers = getOvertimeUsers();
        const overtimeBefore = overtimeUsers.length;
        const filteredOvertimeUsers = overtimeUsers.filter(o => o.id !== memberId);
        overtimeUsers.splice(0, overtimeUsers.length, ...filteredOvertimeUsers);

        return {
            ok: true,
            user,
            outMoment,
            detectedAt,
            session,
            reversibleEarlyPenaltyKey,
            removedOvertimeEntry: overtimeBefore !== overtimeUsers.length,
            recordLogTime: earlyOverrideTime || outMoment,
            recordLogOptions: {
                ...options,
                reversibleEarlyPenaltyKey,
                effectiveTime: outMoment
            }
        };
    }

    function applyDayOffCore(user, now, source = 'day-off', reason = 'day-off-applied') {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const session = getOpenSession(user)
            ? finishAttendanceSession(user, at, source, reason, at)
            : null;

        user.dayOff = true;
        user.status = null;
        user.checkedIn = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.isFinished = true;
        user.pendingClockOut = null;
        user.voiceJoinedAt = null;
        user.preShiftVoiceAt = null;
        user.preShiftVoiceMode = null;
        user.preShiftVoiceWindowStartAt = null;
        user.preShiftVoiceWindowEndAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingManualOT = false;
        user.pendingAutoOTConfirm = null;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.finishedPresence = 'left_voice';
        user.finalLeftAt = at.toISOString();
        transitionRecordedStatus(user, {
            attendanceStatus: 'DAY_OFF',
            voiceStatus: 'OFFLINE'
        }, at, source, reason);
        appendAttendanceEvent(user, 'day_off_applied', at, source, { reason });

        const overtimeUsers = getOvertimeUsers();
        const overtimeBefore = overtimeUsers.length;
        const filteredOvertimeUsers = overtimeUsers.filter(o => o.id !== user.id);
        overtimeUsers.splice(0, overtimeUsers.length, ...filteredOvertimeUsers);

        return {
            ok: true,
            user,
            session,
            removedOvertimeEntry: overtimeBefore !== overtimeUsers.length
        };
    }

    function applyFinishedStateCore(user, now, source = 'state-finish', reason = 'finished-state-applied') {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const session = getOpenSession(user)
            ? finishAttendanceSession(user, at, source, reason, at)
            : null;

        user.checkedIn = false;
        user.dayOff = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.isFinished = true;
        user.status = null;
        user.pendingClockOut = null;
        user.voiceJoinedAt = null;
        user.preShiftVoiceAt = null;
        user.preShiftVoiceMode = null;
        user.preShiftVoiceWindowStartAt = null;
        user.preShiftVoiceWindowEndAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingManualOT = false;
        user.pendingAutoOTConfirm = null;
        user.checkOutTime = at.format('hh:mm A');
        user.checkOutRaw = at.toISOString();
        user.lastClockOutSource = source;
        if (user.shift) {
            user.shiftSessionKey = getShiftSessionKey(user.shift, at);
        }
        transitionRecordedStatus(user, {
            attendanceStatus: 'FINISHED',
            voiceStatus: 'OFFLINE'
        }, at, source, reason);
        setFinishedPresence(user, 'left_voice', at, source);
        appendAttendanceEvent(user, 'finished_state_applied', at, source, { reason });

        const overtimeUsers = getOvertimeUsers();
        const overtimeBefore = overtimeUsers.length;
        const filteredOvertimeUsers = overtimeUsers.filter(o => o.id !== user.id);
        overtimeUsers.splice(0, overtimeUsers.length, ...filteredOvertimeUsers);

        return {
            ok: true,
            user,
            session,
            removedOvertimeEntry: overtimeBefore !== overtimeUsers.length
        };
    }

    function applyLiveExceptionCore(user, shift, now, source = 'live-exception', reason = 'live-exception-applied', options = {}) {
        if (!user || !shift) return { ok: false, reason: 'missing-user-or-shift' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const voiceStatus = options.voiceStatus || 'EXCEPTION';
        const wasCheckedIn = Boolean(user.checkedIn);
        const shouldStartNewSession = options.startSession !== false && Boolean(user.isFinished || !user.checkedIn || !getOpenSession(user));

        user.checkedIn = true;
        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.disconnected = Boolean(options.disconnected);
        user.disconnectedAt = options.disconnected ? (user.disconnectedAt || at.toISOString()) : null;
        user.isFinished = false;
        user.shift = shift;
        user.status = 'exception';
        user.checkInTime = user.checkInTime || at.format('hh:mm A');
        user.checkInRaw = user.checkInRaw || at.toISOString();
        user.checkOutTime = null;
        user.checkOutRaw = null;
        user.lastClockOutSource = null;
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.voiceJoinedAt = null;
        user.preShiftVoiceAt = null;
        user.preShiftVoiceMode = null;
        user.preShiftVoiceWindowStartAt = null;
        user.preShiftVoiceWindowEndAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingClockOut = null;
        user.finishedLiveOffReminderMarks = [];
        if (voiceStatus !== 'DISCONNECTED') user.lastLiveOnAt = at.toISOString();
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus
        }, at, source, reason);

        const session = shouldStartNewSession
            ? startAttendanceSession(user, shift, at, source)
            : getOpenSession(user);

        const overtimeUsers = getOvertimeUsers();
        const overtimeBefore = overtimeUsers.length;
        const filteredOvertimeUsers = overtimeUsers.filter(o => o.id !== user.id);
        overtimeUsers.splice(0, overtimeUsers.length, ...filteredOvertimeUsers);

        appendAttendanceEvent(user, 'live_exception_applied', at, source, {
            reason,
            shift,
            voiceStatus,
            startedSession: Boolean(shouldStartNewSession && session),
            wasCheckedIn
        });

        return {
            ok: true,
            user,
            session,
            wasCheckedIn,
            startedSession: Boolean(shouldStartNewSession && session),
            removedOvertimeEntry: overtimeBefore !== overtimeUsers.length
        };
    }

    function clearStaleDayOffCore(user, shift, now, source = 'voice_snapshot', reason = 'stale-dayoff-cleared') {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const previousExpireAt = user.dayOffExpireAt || null;
        const wasFinished = Boolean(user.isFinished);

        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.isFinished = false;
        user.status = null;
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.dayOffPresenceNotifiedFor = null;
        user.dayOffClockInPromptSessionKey = null;
        user.dayOffClockInPromptStartedAt = null;
        user.dayOffClockInPromptMarks = [];
        if ((user.offCount || 0) > 0) user.offCount -= 1;
        transitionRecordedStatus(user, {
            attendanceStatus: user.checkedIn ? 'WORKING' : 'PRE_SHIFT',
            voiceStatus: 'LIVE_ON'
        }, at, source, reason);
        appendAttendanceEvent(user, 'stale_dayoff_cleared_for_current_worker', at, source, {
            shift,
            previousExpireAt,
            wasFinished,
            reason
        });

        return {
            ok: true,
            user,
            previousExpireAt,
            wasFinished
        };
    }

    function clearDayOffReservationStateCore(user, now, source = 'day-off-reservation', reason = 'day-off-reservation-cleared') {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const previousExpireAt = user.dayOffExpireAt || null;
        const wasDayOff = Boolean(user.dayOff);

        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.dayOffPresenceNotifiedFor = null;
        user.dayOffClockInPromptSessionKey = null;
        user.dayOffClockInPromptStartedAt = null;
        user.dayOffClockInPromptMarks = [];
        if (wasDayOff && (user.offCount || 0) > 0) user.offCount -= 1;
        if (wasDayOff && !user.checkedIn && user.attendanceStatus === 'DAY_OFF') {
            transitionRecordedStatus(user, {
                attendanceStatus: user.isFinished ? 'FINISHED' : 'PRE_SHIFT',
                voiceStatus: user.voiceStatus || 'OFFLINE'
            }, at, source, reason);
        }
        appendAttendanceEvent(user, 'dayoff_reservation_state_cleared', at, source, {
            reason,
            wasDayOff,
            previousExpireAt
        });

        return {
            ok: true,
            user,
            wasDayOff,
            previousExpireAt
        };
    }

    function applyManualResumeRequiredCore(user, now, source = 'button-or-command', reason = 'manual-resume-live-required', options = {}) {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const voiceStatus = options.voiceStatus || 'OFFLINE';

        user.checkedIn = false;
        user.isFinished = true;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingClockOut = null;
        setFinishedPresence(user, voiceStatus === 'OFFLINE' ? 'left_voice' : 'in_voice', at, source);
        transitionRecordedStatus(user, {
            attendanceStatus: 'FINISHED',
            voiceStatus
        }, at, source, reason);
        appendAttendanceEvent(user, 'manual_resume_required_kept_finished', at, source, {
            reason,
            voiceStatus
        });

        return { ok: true, user };
    }

    function applyPendingOvertimeReservationCore(user, now, source = 'button-or-command', reason = 'manual-ot-reserved', options = {}) {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const voiceConnected = Boolean(options.voiceConnected);

        user.pendingManualOT = true;
        user.isFinished = false;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        if (voiceConnected) markLiveOffState(user, at);
        appendAttendanceEvent(user, 'manual_overtime_reserved', at, source, {
            reason,
            voiceConnected
        });

        return { ok: true, user };
    }

    function expireDayOffStateCore(user, now, source = 'day-off-expiry', reason = 'day-off-expired') {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const previousExpireAt = user.dayOffExpireAt || null;

        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.isFinished = false;
        user.status = null;
        user.finishedPresence = null;
        user.finalLeftAt = null;
        transitionRecordedStatus(user, {
            attendanceStatus: 'PRE_SHIFT',
            voiceStatus: user.voiceStatus || 'OFFLINE'
        }, at, source, reason);
        appendAttendanceEvent(user, 'dayoff_expired', at, source, {
            previousExpireAt,
            reason
        });

        return { ok: true, user, previousExpireAt };
    }

    function resetFinishedForPreClockInCore(user, now, source = 'button-or-command', reason = 'clock-in-retry-before-live', options = {}) {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const voiceStatus = options.voiceStatus || user.voiceStatus || 'OFFLINE';

        user.isFinished = false;
        user.finishedPresence = null;
        user.finalLeftAt = null;
        transitionRecordedStatus(user, {
            attendanceStatus: 'PRE_SHIFT',
            voiceStatus
        }, at, source, reason);
        appendAttendanceEvent(user, 'finished_reset_for_clock_in_retry', at, source, {
            reason,
            voiceStatus
        });

        return { ok: true, user };
    }

    function applyCurrentShiftLiveOnCore(user, shift, now, source = 'dashboard-overtime-cleanup', reason = 'current-shift-live-on') {
        if (!user || !shift) return { ok: false, reason: 'missing-user-or-shift' };
        const at = moment(now).tz(CONFIG.TIMEZONE);

        user.shift = shift;
        user.isFinished = false;
        user.checkedIn = true;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.shiftSessionKey = getShiftSessionKey(shift, at);
        user.lastLiveLogKey = getShiftSessionKey(shift, at);
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus: 'LIVE_ON'
        }, at, source, reason);
        appendAttendanceEvent(user, 'current_shift_live_on_applied', at, source, {
            shift,
            reason
        });

        return { ok: true, user };
    }

    function applySmartResetCore(user, now, source = 'smart-reset', reason = 'smart-reset') {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);

        user.strikeReceivedThisShift = false;
        user.absentConvertedToLateThisShift = false;
        user.excessiveLateThisShift = false;
        user.excessiveLateCountedThisShift = false;
        user.checkedIn = false;
        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.isFinished = false;
        user.status = null;
        user.pendingClockOut = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.finishedPresence = null;
        user.finalLeftAt = null;
        transitionRecordedStatus(user, {
            attendanceStatus: 'PRE_SHIFT',
            voiceStatus: 'OFFLINE'
        }, at, source, reason);
        appendAttendanceEvent(user, 'smart_reset_applied', at, source, { reason });

        const overtimeUsers = getOvertimeUsers();
        const overtimeBefore = overtimeUsers.length;
        const filteredOvertimeUsers = overtimeUsers.filter(o => o.id !== user.id);
        overtimeUsers.splice(0, overtimeUsers.length, ...filteredOvertimeUsers);

        return {
            ok: true,
            user,
            removedOvertimeEntry: overtimeBefore !== overtimeUsers.length
        };
    }

    function getOvertimeStartMoment(user, now = moment().tz(CONFIG.TIMEZONE)) {
        return getScheduledEndMoment(user, now, {
            shiftOverride: user?.shift || null,
            ignoreMismatchedSessionShift: true
        });
    }

    function getPostShiftOvertimeStartMoment(user, now = moment().tz(CONFIG.TIMEZONE), options = {}) {
        const at = moment(now).tz(CONFIG.TIMEZONE);
        const overtimeStart = getOvertimeStartMoment(user, at);
        if (!overtimeStart || at.isBefore(overtimeStart)) return null;
        const continuousWindowMins = Math.max(0, Number(CONFIG.POST_SHIFT_CONTINUOUS_OT_WINDOW_MINS || 30));
        const elapsedMins = at.diff(overtimeStart, 'minutes');
        const interruptedAt = user?.postShiftOtInterruptedAt
            ? moment(user.postShiftOtInterruptedAt).tz(CONFIG.TIMEZONE)
            : null;
        if (
            options.allowLateReturn &&
            interruptedAt?.isValid?.() &&
            interruptedAt.isSameOrAfter(overtimeStart) &&
            interruptedAt.isSameOrBefore(at)
        ) {
            return at;
        }
        if (elapsedMins > continuousWindowMins && options.allowLateReturn) {
            return at;
        }
        return overtimeStart;
    }

    function canStartOvertimeNow(user, now = moment().tz(CONFIG.TIMEZONE)) {
        const overtimeStart = getOvertimeStartMoment(user, now);
        return Boolean(overtimeStart && moment(now).tz(CONFIG.TIMEZONE).isSameOrAfter(overtimeStart));
    }

    function canStartPreShiftOvertime(user, now = moment().tz(CONFIG.TIMEZONE)) {
        if (!user || !['day', 'night'].includes(user.shift)) return false;
        const bounds = getShiftBounds(user.shift, now);
        return Boolean(bounds?.start && moment(now).tz(CONFIG.TIMEZONE).isBefore(bounds.start));
    }

    function canStartPostShiftOvertime(user, now = moment().tz(CONFIG.TIMEZONE), options = {}) {
        if (!user || user.checkedIn || user.dayOff) return false;
        if (user.pendingManualOT || user.manualResumeRequired) return false;
        if (getOvertimeUsers().some(ot => ot.id === user.id)) return false;
        if (!['day', 'night'].includes(user.shift)) return false;

        const at = moment(now).tz(CONFIG.TIMEZONE);
        const overtimeStart = getOvertimeStartMoment(user, at);
        if (!overtimeStart || at.isBefore(overtimeStart)) return false;
        const elapsedMins = at.diff(overtimeStart, 'minutes');
        const continuousWindowMins = Math.max(0, Number(CONFIG.POST_SHIFT_CONTINUOUS_OT_WINDOW_MINS || 30));
        const autoOtLimitMins = Math.max(60, Number(CONFIG.MAX_AUTO_OT_MINS || 0) || CONFIG.PURGE_MANUAL_OT * 60);
        if (elapsedMins > continuousWindowMins && !options.allowLateReturn) return false;
        if (elapsedMins > autoOtLimitMins && !options.allowLateReturn) return false;

        const session = getRelevantSessionForTime(user, at);
        if (!session?.clockInAt || !session?.clockOutAt || !session?.scheduledEndAt) return false;
        const staleAutoRepairClosed = Boolean(
            session.clockOutSource === 'auto-repair-stale-overtime' ||
            user.lastClockOutSource === 'auto-repair-stale-overtime' ||
            user.lastClockOutSource === 'auto-repair-no-open-session'
        );
        if (staleAutoRepairClosed && options.allowLateReturn && (user.isFinished || user.attendanceStatus === 'FINISHED')) {
            return true;
        }
        if (staleAutoRepairClosed) {
            return false;
        }

        const scheduledEnd = moment(session.scheduledEndAt).tz(CONFIG.TIMEZONE);
        const requireContinuousLive = options.requireContinuousLive !== false && !options.allowLateReturn;
        if (requireContinuousLive) {
            const interruptedAt = user.postShiftOtInterruptedAt
                ? moment(user.postShiftOtInterruptedAt).tz(CONFIG.TIMEZONE)
                : null;
            if (
                interruptedAt?.isValid?.() &&
                interruptedAt.isSameOrAfter(scheduledEnd) &&
                interruptedAt.isSameOrBefore(at)
            ) return false;
            const lastLiveOnAt = user.lastLiveOnAt ? moment(user.lastLiveOnAt).tz(CONFIG.TIMEZONE) : null;
            if (!lastLiveOnAt?.isValid?.()) return false;
            if (lastLiveOnAt.isAfter(scheduledEnd.clone().add(1, 'minute'))) return false;
            if (user.disconnected || user.disconnectedAt || user.liveOffStartedAt) return false;
        }
        const clockOutAt = moment(session.clockOutAt).tz(CONFIG.TIMEZONE);
        const closedAtShiftEnd = Math.abs(clockOutAt.diff(scheduledEnd, 'minutes')) <= 5;
        const handoffClosed = user.lastClockOutSource === 'shift-handoff-auto-finish' ||
            session.clockOutSource === 'shift-handoff-auto-finish';

        return Boolean(closedAtShiftEnd && handoffClosed);
    }

    function applyOvertimeCore(user, now, type = 'AUTO', source = 'overtime', reason = 'overtime-started', options = {}) {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = options.startedAt ? moment(options.startedAt).tz(CONFIG.TIMEZONE) : moment(now).tz(CONFIG.TIMEZONE);
        const voiceStatus = options.voiceStatus || 'LIVE_ON';
        const sessionSource = options.sessionSource || `${String(type).toLowerCase()}-ot`;

        user.checkedIn = true;
        user.dayOff = false;
        user.isFinished = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingClockOut = null;
        user.pendingManualOT = false;
        user.pendingAutoOTConfirm = null;
        user.postShiftOtInterruptedAt = null;
        user.postShiftOtInterruptedReason = null;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.lastManualResumePromptKey = null;
        user.manualResumePromptMarks = [];
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.lastLiveOnAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
        if (options.resetClockInForOvertime) {
            user.checkInTime = at.format('hh:mm A');
            user.checkInRaw = at.toISOString();
            user.checkOutTime = null;
            user.checkOutRaw = null;
            user.lastClockOutSource = null;
            user.lastClockOutReason = null;
            user.lastClockOutDetectedAt = null;
        } else {
            user.checkInTime = user.checkInTime || at.format('hh:mm A');
            user.checkInRaw = user.checkInRaw || at.toISOString();
        }

        const sourceSession = options.sourceSession || (
            ['AUTO', 'MANUAL'].includes(type) ? getOvertimeSourceSession(user, at) : null
        );
        const monthlyAt = options.monthlyAt
            ? moment(options.monthlyAt).tz(CONFIG.TIMEZONE)
            : (sourceSession?.scheduledStartAt ? moment(sourceSession.scheduledStartAt).tz(CONFIG.TIMEZONE) : at);

        const session = startAttendanceSession(user, user.shift, at, sessionSource);
        if (session) {
            const sessionStartAt = options.sessionScheduledStartAt || sourceSession?.scheduledStartAt || options.sessionScheduledAt || at;
            const sessionEndAt = options.sessionScheduledEndAt || sourceSession?.scheduledEndAt || options.sessionScheduledAt || at;
            session.sessionKey = options.sessionKey || sourceSession?.sessionKey || session.sessionKey;
            session.scheduledStartAt = moment(sessionStartAt).tz(CONFIG.TIMEZONE).toISOString();
            session.scheduledEndAt = moment(sessionEndAt).tz(CONFIG.TIMEZONE).toISOString();
            session.otType = type;
            session.otStartedAt = at.toISOString();
            session.workDateAt = monthlyAt.toISOString();
            if (options.otEvidence) session.otEvidence = options.otEvidence;
            if (options.restoredFromSessionId) session.restoredFromSessionId = options.restoredFromSessionId;
        }

        const added = addOvertimeUser(user, type, at);
        transitionRecordedStatus(user, {
            attendanceStatus: 'OVERTIME',
            voiceStatus
        }, at, source, reason);
        appendAttendanceEvent(user, 'overtime_started', at, source, {
            type,
            reason,
            added,
            otEvidence: options.otEvidence || null,
            restoredFromSessionId: options.restoredFromSessionId || null
        });

        const shouldAwardOvertime = added && options.award !== false && markMonthlyOvertimeAward(user, {
            moment,
            at: monthlyAt,
            timezone: CONFIG.TIMEZONE,
            sourceKey: session?.id || at.toISOString()
        });

        if (shouldAwardOvertime) {
            user.totalOT = (user.totalOT || 0) + 1;
            user.points = (user.points || 0) + CONFIG.POINTS.OT;
            incrementMonthlyAttendanceStat(user, {
                moment,
                at: monthlyAt,
                timezone: CONFIG.TIMEZONE,
                field: 'totalOT',
                pointsDelta: CONFIG.POINTS.OT
            });
        }

        return {
            ok: true,
            user,
            added,
            otStart: at,
            session
        };
    }

    function applyPreShiftOvertimeCore(member, user, shift, now, source = 'button-or-command') {
        if (!member || !user || !shift || !canStartPreShiftOvertime(user, now)) {
            return { ok: false, reason: 'not-pre-shift-overtime-window' };
        }

        const at = moment(now).tz(CONFIG.TIMEZONE);
        user.shift = shift;
        const result = applyOvertimeCore(user, at, 'PRE_OT', source, 'pre-shift-ot-started', {
            sessionSource: 'pre-shift-ot'
        });
        user.voiceJoinedAt = null;

        return {
            ok: true,
            user,
            session: result.session,
            added: result.added,
            startedAt: at,
            shiftStart: getShiftBounds(shift, at).start
        };
    }

    function applyPendingManualOvertimeCore(user, now) {
        if (!user?.pendingManualOT) return { ok: false, reason: 'not-pending-manual-ot' };
        if (!canStartOvertimeNow(user, now)) return { ok: false, reason: 'not-overtime-window' };

        const overtimeStart = getOvertimeStartMoment(user, now);
        const otStart = overtimeStart || moment(now).tz(CONFIG.TIMEZONE);
        if (getOvertimeUsers().some(ot => ot.id === user.id)) {
            return {
                ok: false,
                reason: 'already-overtime',
                added: false,
                otStart
            };
        }
        const result = applyOvertimeCore(user, now, 'MANUAL', 'manual-ot', 'pending-manual-ot-activated', {
            startedAt: otStart,
            sessionSource: 'manual-ot'
        });

        return {
            ok: true,
            user,
            added: result.added,
            otStart,
            session: result.session
        };
    }

    function getLatestOvertimeSession(user) {
        if (!user || !Array.isArray(user.sessions)) return null;
        return user.sessions
            .filter(session => session?.otStartedAt || session?.otType)
            .sort((a, b) => moment(b.clockInAt || b.otStartedAt || b.scheduledEndAt || 0).valueOf() -
                moment(a.clockInAt || a.otStartedAt || a.scheduledEndAt || 0).valueOf())[0] || null;
    }

    function getRestorableOvertimeSession(user, shift, now = moment().tz(CONFIG.TIMEZONE)) {
        const overtimeUsers = getOvertimeUsers();
        const canConsiderRestore = Boolean(user?.isFinished || user?.attendanceStatus === 'PRE_SHIFT');
        if (!canConsiderRestore || user.checkedIn || user.dayOff || overtimeUsers.some(ot => ot.id === user.id)) return null;
        const session = getLatestOvertimeSession(user);
        if (!session) return null;
        if (
            session.clockOutSource === 'auto-repair-stale-overtime' ||
            user.lastClockOutSource === 'auto-repair-stale-overtime' ||
            user.lastClockOutSource === 'auto-repair-no-open-session'
        ) {
            return null;
        }

        const otStartedAt = moment(session.otStartedAt || session.scheduledEndAt || session.clockOutAt).tz(CONFIG.TIMEZONE);
        if (!otStartedAt.isValid() || now.isBefore(otStartedAt)) return null;
        const restoreLimitHours = session.otType === 'AUTO'
            ? Math.max(1, Number(CONFIG.MAX_AUTO_OT_MINS || 0) / 60 || CONFIG.PURGE_MANUAL_OT)
            : CONFIG.PURGE_MANUAL_OT;
        if (now.diff(otStartedAt, 'hours', true) > restoreLimitHours) return null;

        const currentBounds = getShiftBounds(shift || user.shift, now);
        const previousEnd = session.scheduledEndAt ? moment(session.scheduledEndAt).tz(CONFIG.TIMEZONE) : null;
        if (
            currentBounds?.start &&
            previousEnd &&
            currentBounds.start.isAfter(previousEnd) &&
            now.isSameOrAfter(currentBounds.start)
        ) {
            return null;
        }

        return { session, otStartedAt };
    }

    function applyRestoreOvertimeAfterFinishCore(user, shift, now, source = 'voice_snapshot') {
        const restorable = getRestorableOvertimeSession(user, shift, now);
        if (!restorable) return { ok: false, reason: 'not-restorable' };

        const otType = restorable.session.otType || 'AUTO';
        const otStartedAt = restorable.otStartedAt;
        user.shift = shift || user.shift;
        const result = applyOvertimeCore(user, now, otType, source, 'overtime-restored-after-finish', {
            startedAt: otStartedAt,
            sessionSource: 'overtime-restore',
            sessionScheduledAt: now,
            restoredFromSessionId: restorable.session.id || null,
            award: false
        });
        appendAttendanceEvent(user, 'overtime_restored_after_finish', now, source, {
            restoredFromSessionId: restorable.session.id || null,
            otStartedAt: otStartedAt.toISOString(),
            otType
        });

        return {
            ok: true,
            user,
            session: result.session,
            restoredFromSessionId: restorable.session.id || null,
            otStartedAt,
            otType
        };
    }

    function reverseAutoTimeoutEarlyPenalty(user, session, outAt, resumedAt, source) {
        if (!user || !session?.scheduledEndAt || !outAt?.isValid?.()) {
            return { reversed: false, reason: 'missing-input' };
        }
        if (session.autoTimeoutEarlyPenaltyReversedAt) {
            return { reversed: false, reason: 'already-reversed' };
        }
        const scheduledEnd = moment(session.scheduledEndAt).tz(CONFIG.TIMEZONE);
        const earlyMins = scheduledEnd.isValid() ? scheduledEnd.diff(outAt, 'minutes') : 0;
        if (earlyMins <= Number(CONFIG.CLOCK_OUT_GRACE_MINS || 0)) {
            return { reversed: false, reason: 'not-early' };
        }
        const timeoutKey = `${session.clockOutSource}:${outAt.toISOString()}`;
        if (user.reversibleEarlyPenaltyKey && user.reversibleEarlyPenaltyKey !== timeoutKey) {
            return { reversed: false, reason: 'different-penalty-key' };
        }
        if (Number(user.totalEarly || 0) <= 0) {
            return { reversed: false, reason: 'no-early-count' };
        }

        const pointDelta = Math.abs(Number(user.reversibleEarlyPenaltyPoints || CONFIG.POINTS?.EARLY_OUT || 0));
        user.totalEarly = Math.max(0, Number(user.totalEarly || 0) - 1);
        user.points = Number(user.points || 0) + pointDelta;
        incrementMonthlyAttendanceStat(user, {
            moment,
            at: outAt,
            timezone: CONFIG.TIMEZONE,
            field: 'totalEarly',
            countDelta: -1,
            pointsDelta: pointDelta
        });
        if (Number(user.totalEarly || 0) === 0) user.earlyOut = false;
        user.reversibleEarlyPenaltyKey = null;
        user.reversibleEarlyPenaltyAppliedAt = null;
        user.reversibleEarlyPenaltyPoints = null;
        session.autoTimeoutEarlyPenaltyReversedAt = moment(resumedAt).tz(CONFIG.TIMEZONE).toISOString();
        appendAttendanceEvent(user, 'early_penalty_reversed', resumedAt, source, {
            reason: 'auto-timeout-returned-before-shift-end',
            clockOutSource: session.clockOutSource,
            clockOutAt: outAt.toISOString(),
            earlyMins
        });
        return { reversed: true, earlyMins, pointDelta };
    }

    function applyAutoTimeoutResumeCore(user, shift, now, source = 'voice_snapshot') {
        if (!user) return { ok: false, reason: 'missing-user' };
        const resumedAt = moment(now).tz(CONFIG.TIMEZONE);
        const session = getLatestAutoTimeoutSession(user, resumedAt);
        if (!session) return { ok: false, reason: 'no-timeout-session' };

        const timeoutSource = session.clockOutSource;
        const timeoutAt = moment(session.clockOutAt).tz(CONFIG.TIMEZONE);
        const detectedAt = session.clockOutDetectedAt ? moment(session.clockOutDetectedAt).tz(CONFIG.TIMEZONE) : null;
        const periodKey = timeoutSource === 'dc-timeout' ? 'dcPeriods' : 'liveOffPeriods';
        const period = extendLastTimeoutPeriod(session, periodKey, resumedAt);
        const penalty = reverseAutoTimeoutEarlyPenalty(user, session, timeoutAt, resumedAt, source);

        const previousClockOut = {
            clockOutAt: session.clockOutAt,
            clockOutDetectedAt: session.clockOutDetectedAt,
            clockOutSource: session.clockOutSource,
            clockOutReason: session.clockOutReason
        };

        session.reopenedAfterAutoTimeoutAt = resumedAt.toISOString();
        session.reopenedAfterAutoTimeoutSource = source;
        session.previousAutoTimeoutClockOut = previousClockOut;
        session.clockOutAt = null;
        session.clockOutDetectedAt = null;
        session.clockOutSource = null;
        session.clockOutReason = null;
        const workedSummary = calculateSessionWorkedMinutes(session, resumedAt);
        session.grossMinutes = workedSummary.grossMinutes;
        session.liveOffMinutes = workedSummary.liveOffMinutes;
        session.dcMinutes = workedSummary.dcMinutes;
        session.creditedMinutes = workedSummary.creditedMinutes;

        user.activeSessionId = session.id;
        user.checkedIn = true;
        user.isFinished = false;
        user.dayOff = false;
        user.checkOutTime = null;
        user.checkOutRaw = null;
        user.lastClockOutSource = null;
        user.lastClockOutReason = null;
        user.lastClockOutDetectedAt = null;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.liveOffWarningMarks = [];
        user.pendingClockOut = null;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.lastManualResumePromptKey = null;
        user.manualResumePromptMarks = [];
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.lastLiveOnAt = resumedAt.toISOString();
        if (shift) user.shift = shift;
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus: 'LIVE_ON'
        }, resumedAt, source, 'auto-timeout-returned-before-shift-end');
        appendAttendanceEvent(user, 'auto_timeout_resume_before_shift_end', resumedAt, source, {
            timeoutSource,
            timeoutAt: timeoutAt.toISOString(),
            timeoutDetectedAt: detectedAt?.isValid?.() ? detectedAt.toISOString() : null,
            periodStartedAt: period?.startedAt || null,
            periodEndedAt: period?.endedAt || null,
            periodMinutes: Number(period?.minutes || 0),
            penaltyReversed: Boolean(penalty.reversed)
        });

        return {
            ok: true,
            user,
            session,
            timeoutSource,
            timeoutAt,
            detectedAt,
            period,
            periodMinutes: Number(period?.minutes || 0),
            penaltyReversed: Boolean(penalty.reversed)
        };
    }

    function createPendingClockOut(user, source, at, graceMins, reason = null) {
        if (!user) return false;
        const start = moment(at).tz(CONFIG.TIMEZONE);
        const existing = user.pendingClockOut;
        if (existing && !existing.recoveredAt && existing.source === source) return false;
        user.pendingClockOut = {
            source,
            at: start.toISOString(),
            expiresAt: start.clone().add(graceMins, 'minutes').toISOString(),
            detectedAt: null,
            recoveredAt: null,
            reason
        };
        appendAttendanceEvent(user, 'clockout_candidate', start, source, {
            expiresAt: user.pendingClockOut.expiresAt,
            reason
        });
        return true;
    }

    function recoverPendingClockOut(user, recoveredAt, reason = 'recovered') {
        if (!user?.pendingClockOut || user.pendingClockOut.recoveredAt) return false;
        const recovered = moment(recoveredAt).tz(CONFIG.TIMEZONE);
        user.pendingClockOut.recoveredAt = recovered.toISOString();
        appendAttendanceEvent(user, 'clockout_candidate_recovered', recovered, user.pendingClockOut.source, { reason });
        user.pendingClockOut = null;
        return true;
    }

    function applyDisconnectedCore(user, now, source = 'voice-state', options = {}) {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        let changed = false;

        if (options.ensureCheckedIn) {
            user.checkedIn = true;
            user.dayOff = false;
            user.isFinished = false;
            changed = true;
        }
        if (!user.disconnected) {
            user.disconnected = true;
            user.disconnectedAt = at.toISOString();
            changed = true;
        }
        const session = getOpenSession(user);
        if (session) startSessionPeriod(session.dcPeriods, at, source === 'heartbeat' ? 'voice-left-heartbeat' : 'voice-left');
        if (createPendingClockOut(user, 'voice_leave', at, options.graceMins || CONFIG.GRACE_PERIOD_MINS, options.pendingReason || 'voice leave grace started')) {
            changed = true;
        }
        if (options.incrementDc !== false) {
            user.dcCount = (user.dcCount || 0) + 1;
            changed = true;
        }
        if (transitionRecordedStatus(user, {
            attendanceStatus: (user.checkedIn || options.ensureCheckedIn) ? 'WORKING' : undefined,
            voiceStatus: 'DISCONNECTED'
        }, at, source, options.reason || 'voice-disconnected')) changed = true;
        appendAttendanceEvent(user, 'disconnected_started', at, source, {
            graceMins: options.graceMins || CONFIG.GRACE_PERIOD_MINS
        });

        return { ok: true, changed, user, session };
    }

    function markLiveOffState(user, now) {
        if (!user) return false;
        let changed = false;
        const wasLiveOff = Boolean(user.liveOffStartedAt);
        if (transitionRecordedStatus(user, {
            voiceStatus: 'LIVE_OFF'
        }, now, 'voice-state', 'live-off')) changed = true;
        const session = getOpenSession(user);
        if (session) startSessionPeriod(session.liveOffPeriods, now, 'live-off');
        if (user.checkedIn) {
            if (createPendingClockOut(user, 'live_off', now, CONFIG.LIVE_OFF_CLOCK_OUT_MINS, '라이브 OFF 유예 시작')) changed = true;
        }
        if (!user.liveOffStartedAt) {
            user.liveOffStartedAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
            changed = true;
        }
        user.lastLiveOffAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
        if (!user.voiceJoinedAt) {
            user.voiceJoinedAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
            changed = true;
        }
        if (!wasLiveOff) {
            user.liveOffWarnedFor = null;
            user.liveOffWarningMarks = [];
        }
        return changed;
    }

    function clearLiveOffState(user, now) {
        if (!user) return false;
        const session = getOpenSession(user);
        if (session) closeOpenSessionPeriod(session.liveOffPeriods, now);
        recoverPendingClockOut(user, now, 'live_on_recovered');
        const changed = Boolean(user.voiceJoinedAt || user.liveOffStartedAt || user.liveOffWarnedFor || user.liveOffWarningMarks?.length);
        transitionRecordedStatus(user, {
            voiceStatus: 'LIVE_ON'
        }, now, 'voice-state', 'live-on-recovered');
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.liveOffWarningMarks = [];
        return changed;
    }

    function applyLiveOnCore(user, now, source = 'voice-state', reason = 'live-on-recovered') {
        if (!user) return { ok: false, reason: 'missing-user' };
        const at = moment(now).tz(CONFIG.TIMEZONE);
        let changed = false;
        const session = getOpenSession(user);
        if (session) {
            closeOpenSessionPeriod(session.liveOffPeriods, at);
            closeOpenSessionPeriod(session.dcPeriods, at);
        }
        if (recoverPendingClockOut(user, at, reason)) changed = true;
        if (user.disconnected) {
            user.disconnected = false;
            user.disconnectedAt = null;
            changed = true;
        }
        if (user.voiceJoinedAt || user.liveOffStartedAt || user.liveOffWarnedFor || user.liveOffWarningMarks?.length) {
            changed = true;
        }
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.liveOffWarningMarks = [];
        user.lastLiveOnAt = at.toISOString();
        if (transitionRecordedStatus(user, {
            voiceStatus: 'LIVE_ON'
        }, at, source, reason)) changed = true;
        if (changed) {
            appendAttendanceEvent(user, 'live_on_recovered', at, source, { reason });
        }

        return { ok: true, changed, user, session };
    }

    function normalizeCurrentShiftSessionCore(member, user, shift, now) {
        if (!member || !user || !shift) return { changed: false, action: 'none', reason: 'missing-input' };
        const sessionKey = getShiftSessionKey(shift, now);
        const bounds = getShiftBounds(shift, now);
        const staleCheckInBeforeCurrentStart = Boolean(
            user.checkedIn &&
            user.checkInRaw &&
            bounds?.start &&
            moment(user.checkInRaw).tz(CONFIG.TIMEZONE).isBefore(bounds.start)
        );
        if (user.shiftSessionKey === sessionKey && !staleCheckInBeforeCurrentStart) return { changed: false, action: 'none', reason: 'same-session' };

        const previousShift = user.shift || null;
        const shiftChanged = Boolean(previousShift && previousShift !== shift);
        user.shiftSessionKey = sessionKey;
        user.shift = shift;
        user.status = null;
        user.strikeReceivedThisShift = false;
        user.absentConvertedToLateThisShift = false;
        user.excessiveLateThisShift = false;
        user.excessiveLateCountedThisShift = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.lastLiveLogKey = null;

        const overtimeUsers = getOvertimeUsers();
        overtimeUsers.splice(0, overtimeUsers.length, ...overtimeUsers.filter(ot => ot.id !== member.id));

        const alreadyCheckedThisSession = Boolean(
            user.checkedIn &&
            user.checkInRaw &&
            moment(user.checkInRaw).tz(CONFIG.TIMEZONE).isSameOrAfter(bounds.start)
        );
        const alreadyFinishedThisSession = Boolean(
            user.isFinished &&
            !shiftChanged &&
            user.checkOutRaw &&
            moment(user.checkOutRaw).tz(CONFIG.TIMEZONE).isSameOrAfter(bounds.start)
        );
        const finishedBeforeCurrentSession = Boolean(
            user.isFinished &&
            user.checkOutRaw &&
            moment(user.checkOutRaw).tz(CONFIG.TIMEZONE).isBefore(bounds.start)
        );

        if (alreadyFinishedThisSession) {
            user.checkedIn = false;
            user.disconnected = false;
            user.disconnectedAt = null;
            user.voiceJoinedAt = null;
            user.liveOffStartedAt = null;
            user.liveOffWarnedFor = null;
            return { changed: true, action: 'working-role-off', reason: 'already-finished-this-session' };
        }

        if (user.dayOff) {
            user.checkedIn = false;
            user.isFinished = true;
            user.status = null;
            user.disconnected = false;
            user.disconnectedAt = null;
            transitionRecordedStatus(user, {
                attendanceStatus: 'DAY_OFF',
                voiceStatus: 'OFFLINE'
            }, now, 'shift-normalize', 'day-off-kept-during-shift-normalize');
            return { changed: true, action: 'working-role-off', reason: 'day-off' };
        }

        user.isFinished = false;
        if (staleCheckInBeforeCurrentStart) {
            user.checkedIn = false;
            user.checkInTime = null;
            user.checkInRaw = null;
            user.checkOutTime = null;
            user.checkOutRaw = null;
            user.activeSessionId = null;
        }
        if (finishedBeforeCurrentSession || user.attendanceStatus === 'FINISHED') {
            transitionRecordedStatus(user, {
                attendanceStatus: 'PRE_SHIFT',
                voiceStatus: member.voice?.channelId ? (member.voice?.streaming ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE'
            }, now, 'shift-normalize', 'previous-finished-reset-for-new-shift');
            user.finishedPresence = null;
            user.finalLeftAt = null;
        }

        if (member.voice?.streaming) {
            if (alreadyCheckedThisSession) {
                user.checkedIn = true;
                user.isFinished = false;
                user.lastLiveLogKey = getShiftSessionKey(shift, now);
                return { changed: true, action: 'working-role-on', reason: 'already-checked-streaming' };
            }
            return { changed: true, action: 'clock-in', reason: 'streaming-new-session' };
        }

        if (alreadyCheckedThisSession) {
            user.checkedIn = true;
            user.isFinished = false;
            if (member.voice?.channelId && !user.voiceJoinedAt) {
                user.voiceJoinedAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
            }
            return { changed: true, action: 'working-role-on', reason: 'already-checked-live-off' };
        }

        user.checkedIn = false;
        return { changed: true, action: 'working-role-off', reason: 'not-checked' };
    }

    return {
        ensureUserData,
        addOvertimeUser,
        appendAttendanceEvent,
        transitionRecordedStatus,
        setFinishedPresence,
        ensureSessionStore,
        getOpenSession,
        getRelevantSessionForTime,
        getScheduledEndMoment,
        normalizeOpenSessions,
        startAttendanceSession,
        finishAttendanceSession,
        startSessionPeriod,
        closeOpenSessionPeriod,
        sumSessionPeriods,
        sumCreditedLiveOffPeriods,
        calculateSessionWorkedMinutes,
        getUserLatestSessionSummary,
        applyClockInCore,
        applyClockOutCore,
        applyDayOffCore,
        applyFinishedStateCore,
        applyLiveExceptionCore,
        clearStaleDayOffCore,
        clearDayOffReservationStateCore,
        applyManualResumeRequiredCore,
        applyPendingOvertimeReservationCore,
        expireDayOffStateCore,
        resetFinishedForPreClockInCore,
        applyCurrentShiftLiveOnCore,
        applySmartResetCore,
        getOvertimeStartMoment,
        canStartOvertimeNow,
        canStartPreShiftOvertime,
        canStartPostShiftOvertime,
        getPostShiftOvertimeStartMoment,
        applyOvertimeCore,
        applyPreShiftOvertimeCore,
        applyPendingManualOvertimeCore,
        getLatestOvertimeSession,
        getRestorableOvertimeSession,
        applyRestoreOvertimeAfterFinishCore,
        applyAutoTimeoutResumeCore,
        createPendingClockOut,
        recoverPendingClockOut,
        applyDisconnectedCore,
        markLiveOffState,
        clearLiveOffState,
        applyLiveOnCore,
        normalizeCurrentShiftSessionCore
    };
}

module.exports = {
    createAttendanceService
};
