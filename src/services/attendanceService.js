'use strict';

const { evaluateStatusTransition } = require('./stateTransitionPolicy');

function createAttendanceService(deps) {
    const {
        CONFIG,
        moment,
        getAttendanceData,
        getOvertimeUsers,
        determineShift,
        getShiftSessionKey,
        getShiftBounds
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
                totalAbsent: 0,
                totalEarly: 0,
                totalOT: 0,
                dcCount: 0,
                offCount: 0,
                voiceJoinedAt: null,
                liveOffStartedAt: null,
                lastLiveOnAt: null,
                lastLiveOffAt: null,
                preShiftLiveAt: null,
                pendingClockOut: null,
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
        if (!Object.prototype.hasOwnProperty.call(user, 'preShiftLiveAt')) user.preShiftLiveAt = null;
        if (!Object.prototype.hasOwnProperty.call(user, 'pendingClockOut')) user.pendingClockOut = null;
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

    function sumSessionPeriods(periods, fallbackEnd) {
        if (!Array.isArray(periods)) return 0;
        const end = moment(fallbackEnd).tz(CONFIG.TIMEZONE);
        return periods.reduce((total, period) => {
            if (!period?.startedAt) return total;
            const started = moment(period.startedAt).tz(CONFIG.TIMEZONE);
            const ended = period.endedAt ? moment(period.endedAt).tz(CONFIG.TIMEZONE) : end;
            const minutes = Math.max(0, ended.diff(started, 'minutes'));
            return total + minutes;
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
        const liveOffMinutes = Math.min(grossMinutes, sumSessionPeriods(session.liveOffPeriods, end));
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

    function addOvertimeUser(user, type = 'AUTO', startedAt = null) {
        if (!user) return false;
        const overtimeUsers = getOvertimeUsers();
        const otStartedAt = startedAt
            ? moment(startedAt).tz(CONFIG.TIMEZONE)
            : moment().tz(CONFIG.TIMEZONE);
        const existing = overtimeUsers.find(o => o.id === user.id);
        if (existing) {
            existing.name = user.name || existing.name;
            if (type === 'FORCED') existing.type = 'FORCED';
            existing.shift = user.shift || existing.shift || null;
            existing.startedAt = existing.startedAt || otStartedAt.toISOString();
            return false;
        }
        overtimeUsers.push({
            id: user.id,
            name: user.name,
            type,
            shift: user.shift || null,
            shiftSessionKey: user.shift ? getShiftSessionKey(user.shift, moment().tz(CONFIG.TIMEZONE)) : null,
            startedAt: otStartedAt.toISOString()
        });
        const session = getOpenSession(user);
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
        user.attendanceEvents.push({
            at: eventAt.toISOString(),
            type,
            source,
            meta
        });
        if (user.attendanceEvents.length > 100) {
            user.attendanceEvents = user.attendanceEvents.slice(-100);
        }
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
        appendAttendanceEvent(user, 'clock_in_attempt', now, source, { shift });

        if (!clockInRule.ok) {
            user.shift = shift;
            user.preShiftLiveAt = now.toISOString();
            user.isFinished = false;
            user.dayOff = false;
            user.disconnected = false;
            user.disconnectedAt = null;
            const waitLogKey = `${shift}:${clockInRule.bounds.start.format('YYYY-MM-DD HH:mm')}:too-early`;
            const shouldLogPreShiftWait = user.lastPreShiftWaitLogKey !== waitLogKey;
            if (shouldLogPreShiftWait) user.lastPreShiftWaitLogKey = waitLogKey;
            return {
                ok: false,
                user,
                waitLogKey,
                shouldLogPreShiftWait,
                preShiftStart: clockInRule.bounds.start
            };
        }

        const recognizedAt = clockInRule.recognizedAt;
        const overtimeUsers = getOvertimeUsers();
        const overtimeBefore = overtimeUsers.length;
        const filteredOvertimeUsers = overtimeUsers.filter(o => o.id !== member.id);
        overtimeUsers.splice(0, overtimeUsers.length, ...filteredOvertimeUsers);

        user.checkedIn = true;
        user.dayOff = false;
        user.dayOffExpireAt = null;
        user.isFinished = false;
        transitionRecordedStatus(user, {
            attendanceStatus: 'WORKING',
            voiceStatus: 'LIVE_ON'
        }, recognizedAt, isAuto ? 'live-on' : 'button-or-command', clockInRule.preShift ? 'pre-shift-clock-in' : 'clock-in');
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.earlyOut = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.liveOffStartedAt = null;
        user.pendingClockOut = null;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.lastManualResumePromptKey = null;
        user.manualResumePromptMarks = [];
        user.finishedLiveOffReminderMarks = [];
        user.preShiftLiveAt = clockInRule.preShift ? now.toISOString() : null;
        user.lastPreShiftWaitLogKey = null;
        user.lastLiveOnAt = now.toISOString();
        user.shift = shift;
        user.checkInTime = recognizedAt.format('hh:mm A');
        user.checkInRaw = recognizedAt.toISOString();

        const session = startAttendanceSession(user, shift, recognizedAt, clockInRule.preShift ? 'pre-shift-live' : (isAuto ? 'live-on' : 'button-or-command'));
        if (session) {
            session.clockInDetectedAt = now.toISOString();
            if (clockInRule.preShift) session.firstLiveOnAt = now.toISOString();
        }
        appendAttendanceEvent(user, 'clock_in_confirmed', recognizedAt, source, {
            detectedAt: now.toISOString(),
            preShift: clockInRule.preShift
        });

        if (shift) {
            const diffMins = recognizedAt.diff(getShiftBounds(shift, recognizedAt).start, 'minutes');
            if (diffMins > 120) {
                user.status = 'absent';
                if (!user.strikeReceivedThisShift) {
                    user.strikes = (user.strikes || 0) + 1;
                    user.points = (user.points || 0) + CONFIG.POINTS.ABSENT;
                    user.totalAbsent = (user.totalAbsent || 0) + 1;
                    user.strikeReceivedThisShift = true;
                }
            } else if (diffMins > 5) {
                user.status = 'late';
                if (!user.strikeReceivedThisShift) {
                    user.strikes = (user.strikes || 0) + 1;
                    user.points = (user.points || 0) + CONFIG.POINTS.LATE;
                    user.totalLate = (user.totalLate || 0) + 1;
                    user.strikeReceivedThisShift = true;
                }
            } else {
                user.status = 'ontime';
                user.points = (user.points || 0) + CONFIG.POINTS.NORMAL_IN;
                user.totalNormal = (user.totalNormal || 0) + 1;
            }
        }

        return {
            ok: true,
            user,
            recognizedAt,
            session,
            status: user.status,
            preShift: clockInRule.preShift,
            removedOvertimeEntry: overtimeBefore !== overtimeUsers.length
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

    function getOvertimeStartMoment(user, now = moment().tz(CONFIG.TIMEZONE)) {
        return getScheduledEndMoment(user, now, {
            shiftOverride: user?.shift || null,
            ignoreMismatchedSessionShift: true
        });
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

    function applyPreShiftOvertimeCore(member, user, shift, now, source = 'button-or-command') {
        if (!member || !user || !shift || !canStartPreShiftOvertime(user, now)) {
            return { ok: false, reason: 'not-pre-shift-overtime-window' };
        }

        const at = moment(now).tz(CONFIG.TIMEZONE);
        user.checkedIn = true;
        user.dayOff = false;
        user.isFinished = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingClockOut = null;
        user.pendingManualOT = false;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.lastManualResumePromptKey = null;
        user.manualResumePromptMarks = [];
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.lastLiveOnAt = at.toISOString();
        user.shift = shift;
        user.checkInTime = at.format('hh:mm A');
        user.checkInRaw = at.toISOString();
        const session = startAttendanceSession(user, shift, at, 'pre-shift-ot');

        const added = addOvertimeUser(user, 'PRE_OT', at);
        transitionRecordedStatus(user, {
            attendanceStatus: 'OVERTIME',
            voiceStatus: 'LIVE_ON'
        }, at, source, 'pre-shift-ot-started');
        if (added) {
            user.totalOT = (user.totalOT || 0) + 1;
            user.points = (user.points || 0) + CONFIG.POINTS.OT;
        }

        return {
            ok: true,
            user,
            session,
            added,
            startedAt: at,
            shiftStart: getShiftBounds(shift, at).start
        };
    }

    function applyPendingManualOvertimeCore(user, now) {
        if (!user?.pendingManualOT) return { ok: false, reason: 'not-pending-manual-ot' };
        if (!canStartOvertimeNow(user, now)) return { ok: false, reason: 'not-overtime-window' };

        const overtimeStart = getOvertimeStartMoment(user, now);
        const otStart = overtimeStart || moment(now).tz(CONFIG.TIMEZONE);
        const added = addOvertimeUser(user, 'MANUAL', overtimeStart || now);
        user.pendingManualOT = false;
        if (!added) {
            return {
                ok: false,
                reason: 'already-overtime',
                added,
                otStart
            };
        }

        user.checkedIn = true;
        user.dayOff = false;
        user.isFinished = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.liveOffStartedAt = null;
        user.pendingClockOut = null;
        user.checkInTime = user.checkInTime || otStart.format('hh:mm A');
        user.checkInRaw = user.checkInRaw || otStart.toISOString();
        const session = startAttendanceSession(user, user.shift, otStart, 'manual-ot');
        if (session) {
            session.scheduledStartAt = otStart.toISOString();
            session.scheduledEndAt = otStart.toISOString();
            session.otType = 'MANUAL';
            session.otStartedAt = otStart.toISOString();
        }
        transitionRecordedStatus(user, {
            attendanceStatus: 'OVERTIME',
            voiceStatus: 'LIVE_ON'
        }, otStart, 'manual-ot', 'pending-manual-ot-activated');
        user.totalOT = (user.totalOT || 0) + 1;
        user.points = (user.points || 0) + CONFIG.POINTS.OT;

        return {
            ok: true,
            user,
            added,
            otStart,
            session
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
        if (!user?.isFinished || user.checkedIn || user.dayOff || overtimeUsers.some(ot => ot.id === user.id)) return null;
        const session = getLatestOvertimeSession(user);
        if (!session) return null;

        const otStartedAt = moment(session.otStartedAt || session.scheduledEndAt || session.clockOutAt).tz(CONFIG.TIMEZONE);
        if (!otStartedAt.isValid() || now.isBefore(otStartedAt)) return null;
        if (now.diff(otStartedAt, 'hours', true) > CONFIG.PURGE_MANUAL_OT) return null;

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
        user.checkedIn = true;
        user.dayOff = false;
        user.isFinished = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.pendingClockOut = null;
        user.manualResumeRequired = false;
        user.manualResumeRequiredSince = null;
        user.manualResumeRequiredReason = null;
        user.lastManualResumePromptKey = null;
        user.manualResumePromptMarks = [];
        user.finishedPresence = null;
        user.finalLeftAt = null;
        user.lastLiveOnAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
        user.shift = shift || user.shift;

        const session = startAttendanceSession(user, user.shift, now, 'overtime-restore');
        if (session) {
            session.scheduledStartAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
            session.scheduledEndAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
            session.otType = otType;
            session.otStartedAt = otStartedAt.toISOString();
            session.restoredFromSessionId = restorable.session.id || null;
        }

        addOvertimeUser(user, otType, otStartedAt);
        transitionRecordedStatus(user, {
            attendanceStatus: 'OVERTIME',
            voiceStatus: 'LIVE_ON'
        }, now, source, 'overtime-restored-after-finish');
        appendAttendanceEvent(user, 'overtime_restored_after_finish', now, source, {
            restoredFromSessionId: restorable.session.id || null,
            otStartedAt: otStartedAt.toISOString(),
            otType
        });

        return {
            ok: true,
            user,
            session,
            restoredFromSessionId: restorable.session.id || null,
            otStartedAt,
            otType
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

    function normalizeCurrentShiftSessionCore(member, user, shift, now) {
        if (!member || !user || !shift) return { changed: false, action: 'none', reason: 'missing-input' };
        const sessionKey = getShiftSessionKey(shift, now);
        if (user.shiftSessionKey === sessionKey) return { changed: false, action: 'none', reason: 'same-session' };

        const previousShift = user.shift || null;
        const shiftChanged = Boolean(previousShift && previousShift !== shift);
        user.shiftSessionKey = sessionKey;
        user.shift = shift;
        user.status = null;
        user.strikeReceivedThisShift = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.voiceJoinedAt = null;
        user.liveOffStartedAt = null;
        user.liveOffWarnedFor = null;
        user.lastLiveLogKey = null;

        const overtimeUsers = getOvertimeUsers();
        overtimeUsers.splice(0, overtimeUsers.length, ...overtimeUsers.filter(ot => ot.id !== member.id));

        const bounds = getShiftBounds(shift, now);
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
        calculateSessionWorkedMinutes,
        getUserLatestSessionSummary,
        applyClockInCore,
        applyClockOutCore,
        getOvertimeStartMoment,
        canStartOvertimeNow,
        canStartPreShiftOvertime,
        applyPreShiftOvertimeCore,
        applyPendingManualOvertimeCore,
        getLatestOvertimeSession,
        getRestorableOvertimeSession,
        applyRestoreOvertimeAfterFinishCore,
        createPendingClockOut,
        recoverPendingClockOut,
        markLiveOffState,
        clearLiveOffState,
        normalizeCurrentShiftSessionCore
    };
}

module.exports = {
    createAttendanceService
};
