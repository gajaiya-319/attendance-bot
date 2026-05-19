function createStatePolicy({ CONFIG, moment }) {
    function cloneUser(user) {
        return {
            ...user,
            attendanceEvents: Array.isArray(user.attendanceEvents) ? [...user.attendanceEvents] : [],
            sessions: Array.isArray(user.sessions) ? user.sessions.map(session => ({ ...session })) : []
        };
    }

    function appendEvent(user, type, at, meta = {}) {
        user.attendanceEvents.push({
            type,
            at: moment(at).tz(CONFIG.TIMEZONE).toISOString(),
            meta
        });
    }

    function applyFinishedVoiceSnapshot(inputUser, snapshot, now) {
        const user = cloneUser(inputUser);
        const joinedVoice = !snapshot.wasConnected && snapshot.isConnected;
        const isStreaming = Boolean(snapshot.isConnected && snapshot.isStreaming);

        if (!user.isFinished || user.checkedIn) {
            return { user, changed: false, prompts: [] };
        }

        const prompts = [];
        user.checkedIn = false;
        user.isFinished = true;
        user.disconnected = false;
        user.attendanceStatus = 'FINISHED';
        user.voiceStatus = snapshot.isConnected ? (isStreaming ? 'LIVE_ON' : 'LIVE_OFF') : 'OFFLINE';
        user.finishedPresence = snapshot.isConnected ? 'in_voice' : 'left_voice';

        if (joinedVoice) {
            const key = `${user.checkOutRaw || 'no-clockout'}:Returned to voice after clock-out`;
            if (user.lastFinishedReturnPromptKey !== key) {
                user.lastFinishedReturnPromptKey = key;
                prompts.push('finished-return-to-voice');
            }
        }

        if (isStreaming) {
            prompts.push('after-finish-live-on');
        }

        appendEvent(user, isStreaming ? 'after_finish_presence_detected' : 'finished_presence_kept', now, {
            result: 'finished_kept'
        });
        return { user, changed: true, prompts };
    }

    function applyDcTimeout(inputUser, now) {
        const user = cloneUser(inputUser);
        user.checkedIn = false;
        user.disconnected = false;
        user.disconnectedAt = null;
        user.isFinished = true;
        user.attendanceStatus = 'FINISHED';
        user.voiceStatus = 'OFFLINE';
        user.checkOutRaw = moment(now).tz(CONFIG.TIMEZONE).toISOString();
        user.lastClockOutSource = 'dc-timeout';
        user.finishedPresence = 'left_voice';
        appendEvent(user, 'clock_out_confirmed', now, { source: 'dc-timeout' });
        return user;
    }

    function applyLiveOffTimeout(inputUser, now) {
        const user = cloneUser(inputUser);
        user.checkedIn = false;
        user.disconnected = false;
        user.liveOffStartedAt = null;
        user.isFinished = true;
        user.attendanceStatus = 'FINISHED';
        user.voiceStatus = 'LIVE_OFF';
        user.checkOutRaw = moment(now).tz(CONFIG.TIMEZONE).toISOString();
        user.lastClockOutSource = 'live-off-timeout';
        user.finishedPresence = 'in_voice';
        appendEvent(user, 'clock_out_confirmed', now, { source: 'live-off-timeout' });
        return user;
    }

    function getLatestOvertimeSession(user) {
        return (Array.isArray(user.sessions) ? user.sessions : [])
            .filter(session => session.otStartedAt || session.otType)
            .sort((a, b) => moment(b.otStartedAt || b.scheduledEndAt || 0).valueOf() -
                moment(a.otStartedAt || a.scheduledEndAt || 0).valueOf())[0] || null;
    }

    function canRestoreOvertime(inputUser, now) {
        if (!inputUser.isFinished || inputUser.checkedIn || inputUser.dayOff) return false;
        const session = getLatestOvertimeSession(inputUser);
        if (!session) return false;
        const otStartedAt = moment(session.otStartedAt || session.scheduledEndAt).tz(CONFIG.TIMEZONE);
        if (!otStartedAt.isValid() || moment(now).tz(CONFIG.TIMEZONE).isBefore(otStartedAt)) return false;
        return moment(now).tz(CONFIG.TIMEZONE).diff(otStartedAt, 'hours', true) <= CONFIG.PURGE_MANUAL_OT;
    }

    function restoreOvertime(inputUser, now) {
        const user = cloneUser(inputUser);
        if (!canRestoreOvertime(user, now)) return { user, restored: false };
        const session = getLatestOvertimeSession(user);
        user.checkedIn = true;
        user.isFinished = false;
        user.disconnected = false;
        user.attendanceStatus = 'OVERTIME';
        user.voiceStatus = 'LIVE_ON';
        user.lastLiveOnAt = moment(now).tz(CONFIG.TIMEZONE).toISOString();
        user.restoredOvertimeType = session.otType || 'AUTO';
        appendEvent(user, 'overtime_restored_after_finish', now, {
            otStartedAt: session.otStartedAt || session.scheduledEndAt,
            otType: user.restoredOvertimeType
        });
        return { user, restored: true };
    }

    return {
        applyFinishedVoiceSnapshot,
        applyDcTimeout,
        applyLiveOffTimeout,
        canRestoreOvertime,
        restoreOvertime
    };
}

module.exports = createStatePolicy;
