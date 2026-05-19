async function recordLog(user, actionType, customText = null, earlyOverrideTime = null, options = {}) {
    // 출근/퇴근/휴무/DC/복구 로그를 LOG_CHANNEL에 남깁니다.
    // 조기퇴근 벌점도 이 함수에서 계산되므로 퇴근 판정 변경 시 함께 확인하세요.
    if (!user) return;
    const now = moment().tz(CONFIG.TIMEZONE);
    const shiftIcon = user.id === CONFIG.EXCEPTIONS.SHARED_SEAT_USER ? '👥' : user.shift === 'day' ? '☀️' : '🌙';
    let aIcon = actionType === 'in'
        ? (user.status === 'absent' ? '❌' : user.status === 'late' ? '🟠' : '🟢')
        : actionType === 'out'
            ? '👋'
            : actionType === 'ot'
                ? '🔥'
                : actionType === 'disconnect'
                    ? '⚡'
                    : actionType === 'reconnect'
                        ? '🔗'
                        : '🔵';
    let baseTxt = customText || (actionType === 'in'
        ? (user.status === 'absent' ? '무단 결석' : user.status === 'late' ? '지각 출근' : '정상 출근')
        : actionType === 'out'
            ? '퇴근'
            : actionType === 'ot'
                ? '연장 시작'
                : actionType === 'disconnect'
                    ? `DC (${formatDuration(CONFIG.GRACE_PERIOD_MINS)} 접속 유예 시작)`
                    : '휴무');

    if (actionType === 'out' && !user.dayOff && !options.skipEarlyPenalty) {
        const bounds = getShiftBounds(user.shift, earlyOverrideTime || now);
        const earlyMins = bounds.end.diff(moment(earlyOverrideTime || now).tz(CONFIG.TIMEZONE), 'minutes');
        if (earlyMins > 10) {
            aIcon = '🔴';
            baseTxt = `${baseTxt} (⚠️ 조기퇴근 ${formatDuration(earlyMins)} 전)`;
            user.totalEarly = (user.totalEarly || 0) + 1;
            user.points = (user.points || 0) + CONFIG.POINTS.EARLY_OUT;
        }
    }
    if (options.forceIcon) aIcon = options.forceIcon;

    if (actionType === 'out' && user.checkInRaw && !baseTxt.includes('[근무:')) {
        const workedMins = Math.max(0, now.diff(moment(user.checkInRaw).tz(CONFIG.TIMEZONE), 'minutes'));
        baseTxt = `${baseTxt} [근무: ${formatDuration(workedMins)}]`;
    }

    const logChan = client.channels.cache.get(CONFIG.LOG_CHANNEL) ||
        await client.channels.fetch(CONFIG.LOG_CHANNEL).catch(() => null);
    if (logChan) {
        logChan.send(`\`[${now.format('MM/DD HH:mm')}]\` ${shiftIcon} 👤 **${user.name}** → ${aIcon} ${baseTxt}`)
            .catch(e => console.error('[LOG SEND ERROR]', e));
    }