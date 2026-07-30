'use strict';

/** Worker-facing DM messages. Keep these ASCII-only because most workers read English. */

function buildLiveOffClockOutDm(liveOffClockOutMins) {
    return [
        '[WORK SESSION ENDED]',
        'Reminder 3/3',
        '',
        `Your live stream stayed OFF for about ${liveOffClockOutMins} minutes.`,
        'Your work activity could not be verified, so the bot has clocked you out automatically.',
        '',
        'LIVE STREAM ON is mandatory for work credit.',
        'Time without LIVE ON is NOT counted as work.',
        '',
        'To work again, turn LIVE ON and press CLOCK IN.'
    ].join('\n');
}

function buildDcTimeoutClockOutDm(gracePeriodMins, autoResumeWindowMins) {
    return [
        '[WORK SESSION ENDED]',
        '',
        `You were away from the voice channel for about ${gracePeriodMins} minutes.`,
        'Your work activity could not be verified, so the bot has clocked you out automatically.',
        '',
        'To continue working, you must:',
        '1. Rejoin the correct voice channel',
        '2. Turn LIVE ON',
        '3. Press CLOCK IN if the bot does not resume you automatically',
        '',
        'LIVE STREAM ON is mandatory for work credit.',
        'Time without voice presence and LIVE ON is NOT counted as work.',
        '',
        `If more than ${autoResumeWindowMins} minutes have passed, automatic resume is not available. Press CLOCK IN again.`
    ].join('\n');
}

function buildDcGraceHoldDm(gracePeriodMins, shiftEndText = null) {
    return [
        '[VOICE DISCONNECT NOTICE]',
        '',
        `You have been away from the voice channel for about ${gracePeriodMins} minutes.`,
        'Your work session is NOT ended yet because your regular shift is still in progress.',
        '',
        'Rejoin the correct voice channel and turn LIVE ON as soon as possible.',
        'If you return before shift end, the disconnect clock-out candidate will be cleared.',
        '',
        shiftEndText
            ? `If you do not return by shift end (${shiftEndText}), the bot may finalize the session at shift close.`
            : 'If you do not return by shift end, the bot may finalize the session at shift close.',
        '',
        'LIVE STREAM ON is mandatory for work credit.'
    ].join('\n');
}

function buildLiveOffGraceHoldDm(liveOffClockOutMins, shiftEndText = null) {
    return [
        '[LIVE OFF NOTICE]',
        '',
        `Your live stream has been OFF for about ${liveOffClockOutMins} minutes.`,
        'Your work session is NOT ended yet because your regular shift is still in progress.',
        '',
        'Turn LIVE ON again as soon as possible.',
        'If you return before shift end, the live-off clock-out candidate will be cleared.',
        '',
        shiftEndText
            ? `If you do not return by shift end (${shiftEndText}), the bot may finalize the session at shift close.`
            : 'If you do not return by shift end, the bot may finalize the session at shift close.',
        '',
        'LIVE STREAM ON is mandatory for work credit.',
        'LIVE OFF time is NOT counted as verified work.'
    ].join('\n');
}

function buildManualResumeRequiredDm(reminderNumber) {
    return [
        '[CLOCK IN REQUIRED]',
        `Reminder ${reminderNumber}/3`,
        '',
        'Your LIVE is ON, but you are NOT clocked in.',
        'Your previous work session already ended after exceeding the grace period.',
        '',
        'You must press CLOCK IN now if you are working.',
        'Time is NOT counted as work until CLOCK IN is accepted.',
        '',
        'Keep LIVE ON and press CLOCK IN immediately.',
        'Contact a manager only if you believe this is a system error.'
    ].join('\n');
}

function buildLiveOffWarningDm(reminderNumber, warningMarkMins, liveOffClockOutMins) {
    return [
        '[MANDATORY LIVE NOTICE]',
        `Reminder ${reminderNumber}/3`,
        '',
        'Your live stream is OFF.',
        'You are required to keep LIVE ON while working.',
        'LIVE OFF time is not counted as verified work time.',
        '',
        `Live stream off duration: about ${warningMarkMins} minutes.`,
        'Turn LIVE ON immediately.',
        '',
        `If LIVE stays OFF, the bot may end your work session automatically after about ${liveOffClockOutMins} more minutes.`
    ].join('\n');
}

function buildDayOffClockInPromptMessage(reminderNumber, reminderMark) {
    return [
        '[CLOCK IN REQUIRED]',
        `Reminder ${reminderNumber}/2${reminderMark ? ` - about ${reminderMark} minutes since your LIVE started` : ''}`,
        '',
        'Are you working today?',
        '',
        'If you are working, you must keep LIVE ON and press CLOCK IN.',
        'Voice channel or LIVE alone does not count as attendance.',
        '',
        'Time is NOT counted as work until CLOCK IN is accepted.'
    ].join('\n');
}

function buildDayOffPresenceDm() {
    return [
        '[CLOCK IN REQUIRED]',
        '',
        'You are currently registered as Day Off.',
        'Your voice-channel presence was detected, but you will NOT be clocked in automatically.',
        '',
        'If you are working today, turn LIVE ON and press CLOCK IN.',
        'Time is NOT counted as work until CLOCK IN is accepted.'
    ].join('\n');
}

/** Admin log channel (Korean). */
function buildDayOffPresenceLogLines(nowLabel, userName, action) {
    return [
        `\`[${nowLabel}]\` 휴무 중 접속 감지`,
        `대상: **${userName}**`,
        `동작: ${action}`,
        '결과: 휴무 유지, 출근 처리 없음'
    ];
}

function buildAfterFinishPresenceDm() {
    return [
        '[CLOCK IN REQUIRED]',
        '',
        'You have already been clocked out.',
        'Your LIVE was detected, but attendance will NOT restart automatically.',
        '',
        'If you are working again, turn LIVE ON and press CLOCK IN.',
        'Time is NOT counted as work until CLOCK IN is accepted.',
        '',
        'For overtime, use the OVERTIME button or contact a manager.'
    ].join('\n');
}

function buildFinishedReturnWithinShiftDm() {
    return [
        '[CLOCK IN REQUIRED]',
        '',
        'You left the voice channel and were marked as FINISHED.',
        '',
        'If you are working again, you must press CLOCK IN.',
        'LIVE STREAM ON is mandatory for normal work credit.',
        '',
        'If you cannot stream because of an internet or PC issue, stay in voice and press CLOCK IN to request a live-stream exception.',
        'Use the exception only when you truly cannot turn LIVE ON.',
        '',
        'Time is NOT counted as work until CLOCK IN is accepted.'
    ].join('\n');
}

function buildFinishedReturnDefaultDm() {
    return [
        '[CLOCK IN REQUIRED]',
        '',
        'You rejoined the voice channel, but you are still marked as FINISHED.',
        '',
        'To resume work:',
        '1. Turn LIVE ON',
        '2. Press CLOCK IN in the attendance panel',
        '',
        'LIVE alone does not clock you in.',
        'Time is NOT counted as work until CLOCK IN is accepted.'
    ].join('\n');
}

function buildStandbyClockInRequiredDm() {
    return [
        '[CLOCK IN REQUIRED]',
        '',
        'Your LIVE is ON, but you are NOT clocked in.',
        '',
        'Press CLOCK IN in the attendance channel immediately.',
        'Time is NOT counted as work until CLOCK IN is accepted.'
    ].join('\n');
}

function buildAbsentWarningDm(reminderNumber, elapsedMins, absentAfterMins = 120) {
    const remainingMins = Math.max(0, absentAfterMins - elapsedMins);
    const isFinal = elapsedMins >= absentAfterMins;
    const title = isFinal ? '[ABSENT MARKED]' : '[ATTENDANCE WARNING]';
    const statusLine = isFinal
        ? 'You have been marked ABSENT because you did not clock in for this shift.'
        : `You have not clocked in. You have about ${remainingMins} minutes before ABSENT status.`;

    return [
        title,
        `Reminder ${reminderNumber}/4`,
        '',
        statusLine,
        `Shift time elapsed: about ${elapsedMins} minutes.`,
        '',
        'You must explain immediately if you cannot work today.',
        'If you have any issue, emergency, illness, internet problem, or personal reason, report it to a manager TODAY.',
        '',
        'Unexplained absence is a serious violation.',
        'Unexplained absence may result in termination.',
        '',
        'If you are working, join the correct voice channel, turn LIVE ON, and press CLOCK IN immediately.',
        'Voice channel alone, LIVE alone, or silence does NOT count as attendance.',
        'Work is not counted until CLOCK IN is accepted.'
    ].join('\n');
}

function buildExcessiveLateDm() {
    return [
        '[SERIOUS LATE ATTENDANCE]',
        '',
        'You were over 2 hours late for your shift.',
        'This is recorded as serious late attendance.',
        '',
        'You must explain to a manager TODAY why you were late.',
        'Repeated serious late attendance may lead to termination.',
        '',
        'Clocking in late does not erase the violation.',
        'Be on time and keep LIVE ON while working.'
    ].join('\n');
}

function buildLiveOffGuidanceDm({ final = false, minutes = null } = {}) {
    const lines = final
        ? [
            '[WORK SESSION ENDED]',
            'Your LIVE remained OFF, so your work session has ended.'
        ]
        : [
            '[MANDATORY LIVE NOTICE]',
            'Turn LIVE ON immediately.'
        ];

    if (minutes !== null) {
        lines.push(`Live stream off duration: about ${minutes} minutes.`);
    }

    lines.push(
        '',
        'LIVE STREAM ON is mandatory for work credit.',
        'LIVE OFF time is NOT counted as verified work.',
        '',
        'If you cannot stream because of an internet or PC issue, stay in voice and press CLOCK IN to request a live-stream exception.',
        'Use the exception only when you truly cannot turn LIVE ON.'
    );

    if (final) {
        lines.push('', 'To work again, turn LIVE ON and press CLOCK IN.');
    } else {
        lines.push('', 'If LIVE stays OFF, the bot may end your work session automatically.');
    }

    return lines.join('\n');
}

function buildFinishedLiveOffReminderDm(reminderIndex, reminderTotal, guidanceBody) {
    return [
        '[POST-CLOCK-OUT LIVE OFF NOTICE]',
        `Reminder ${reminderIndex}/${reminderTotal}`,
        '',
        guidanceBody
    ].join('\n');
}

function buildDayOffApprovedDm(reservation) {
    return [
        'Your day-off request has been approved.',
        '',
        `Name: ${reservation.name}`,
        `Shift: ${reservation.shiftLabel}`,
        `Leave Date: ${reservation.leaveDate}`,
        '',
        'Please confirm the date.'
    ].join('\n');
}

function buildDayOffRejectedDm(reservation) {
    const reason = reservation.rejectReason || 'Rejected by a manager';
    return [
        'Your day-off request has been rejected.',
        '',
        `Name: ${reservation.name}`,
        `Shift: ${reservation.shiftLabel}`,
        `Leave Date: ${reservation.leaveDate}`,
        `Rejected By: ${reservation.rejectedByName || 'Manager'}`,
        `Reason: ${reason}`,
        '',
        'Please contact a manager if you have any questions.'
    ].join('\n');
}

function buildScheduledBroadcastTitle(slotIndex) {
    return `System Notice [Slot ${slotIndex}]`;
}

module.exports = {
    buildLiveOffClockOutDm,
    buildDcTimeoutClockOutDm,
    buildDcGraceHoldDm,
    buildLiveOffGraceHoldDm,
    buildManualResumeRequiredDm,
    buildLiveOffWarningDm,
    buildDayOffClockInPromptMessage,
    buildDayOffPresenceDm,
    buildDayOffPresenceLogLines,
    buildAfterFinishPresenceDm,
    buildFinishedReturnWithinShiftDm,
    buildFinishedReturnDefaultDm,
    buildStandbyClockInRequiredDm,
    buildAbsentWarningDm,
    buildExcessiveLateDm,
    buildLiveOffGuidanceDm,
    buildFinishedLiveOffReminderDm,
    buildDayOffApprovedDm,
    buildDayOffRejectedDm,
    buildScheduledBroadcastTitle
};
