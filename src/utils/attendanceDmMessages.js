'use strict';

/** Worker-facing DM / panel messages (Korean). */

function buildLiveOffClockOutDm(liveOffClockOutMins) {
    return [
        '🌿 출퇴근 안내',
        '알림 3/3',
        '',
        `라이브 방송이 약 ${liveOffClockOutMins}분째 꺼져 있습니다.`,
        '근무 시간을 확인할 수 없어 봇이 자동 퇴근 처리했습니다.',
        '',
        '다시 근무하려면 라이브를 켠 뒤 출근(CLOCK IN) 버튼을 눌러 주세요.'
    ].join('\n');
}

function buildDcTimeoutClockOutDm(gracePeriodMins, autoResumeWindowMins) {
    return [
        '🌿 출퇴근 안내',
        '',
        `음성 채널에서 약 ${gracePeriodMins}분 이탈되어 봇이 자동 퇴근 처리했습니다.`,
        '',
        '아직 이번 근무조 시간대라면:',
        '1. 음성 채널에 다시 접속',
        '2. 라이브 방송 켜기',
        '3. 봇이 근무를 자동 재개할 수 있습니다',
        '',
        `근무조 시간 밖이거나 ${autoResumeWindowMins}분이 지나면 라이브만 켜서는 출근이 복구되지 않습니다. 출근(CLOCK IN) 버튼을 다시 눌러야 합니다.`,
        '이번 퇴근에 대한 DC 추가 안내는 더 이상 보내지 않습니다. 🙂'
    ].join('\n');
}

function buildManualResumeRequiredDm(reminderNumber) {
    return [
        '🌿 출퇴근 안내',
        `알림 ${reminderNumber}/3`,
        '',
        '라이브는 켜져 있지만 출근 상태가 아닙니다.',
        '이전에 DC/라이브 OFF 유예를 넘어 출근이 이미 종료되었습니다.',
        '',
        '60분이 지나 자동 재개는 되지 않습니다.',
        '',
        '✅ 라이브를 켠 상태에서 출근(CLOCK IN) 버튼을 눌러 주세요.',
        '⚠️ CLOCK IN을 누르지 않으면 근무 시간으로 인정되지 않습니다.',
        '',
        '오류라면 관리자에게 문의해 주세요. 🙂'
    ].join('\n');
}

function buildLiveOffWarningDm(reminderNumber, warningMarkMins, liveOffClockOutMins) {
    return [
        '🌿 출퇴근 안내',
        `알림 ${reminderNumber}/3`,
        '',
        '음성 채널에는 있지만 라이브 방송이 꺼진 것으로 보입니다.',
        '가능하면 라이브를 다시 켜 주시면 근무 시간이 계속 집계됩니다.',
        '',
        `라이브 OFF 지속: 약 ${warningMarkMins}분`,
        `약 ${liveOffClockOutMins}분 더 꺼져 있으면 자동 퇴근될 수 있습니다.`,
        '감사합니다. 🙂'
    ].join('\n');
}

function buildDayOffClockInPromptMessage(reminderNumber, reminderMark) {
    return [
        '🌿 **출근 안내**',
        `알림 **${reminderNumber}/2**${reminderMark ? ` · 라이브 시작 후 약 **${reminderMark}분**` : ''}`,
        '',
        '오늘 근무를 시작하셨나요?',
        '',
        '맞다면 **라이브를 켜 두고** **출근(CLOCK IN)** 버튼을 눌러 주세요.',
        '',
        '⚠️ **CLOCK IN을 눌러야만 출근으로 인정됩니다.**',
        '접속만 하거나 라이브만 켠 것은 출근으로 처리되지 않습니다.',
        '',
        '감사합니다. ✅'
    ].join('\n');
}

function buildDayOffPresenceDm() {
    return [
        '🌿 **출근 안내**',
        '',
        '현재 **휴무(Day Off)** 로 등록되어 있습니다.',
        '음성 채널 접속은 감지됐지만, 출근은 **자동으로 처리되지 않습니다**.',
        '',
        '근무를 시작하려면 **라이브를 켜고** **출근(CLOCK IN)** 버튼을 눌러 주세요.'
    ].join('\n');
}

/** Admin log channel (Korean). */
function buildDayOffPresenceLogLines(nowLabel, userName, action) {
    return [
        `\`[${nowLabel}]\` 🔵 **휴무 중 접속 감지**`,
        `👤 대상: **${userName}**`,
        `📌 동작: ${action}`,
        '✅ 결과: 휴무 유지, 출근 처리 없음'
    ];
}

function buildAfterFinishPresenceDm() {
    return [
        '중요: 이미 퇴근 처리된 상태입니다.',
        '',
        '라이브가 감지됐지만 출근은 자동으로 다시 시작되지 않습니다.',
        '',
        '다시 근무하려면 라이브를 켠 뒤 출근(CLOCK IN) 버튼을 **반드시** 눌러 주세요.',
        'CLOCK IN 없이는 출근으로 인정되지 않습니다.',
        '',
        '연장 근무라면 OVERTIME 버튼을 쓰거나 관리자에게 문의해 주세요.'
    ].join('\n');
}

function buildFinishedReturnWithinShiftDm() {
    return [
        '🌿 다시 오신 것을 환영합니다',
        '',
        '음성 채널을 나가 퇴근(FINISHED) 처리된 상태입니다.',
        '',
        '라이브를 켤 수 없는 상황인 것 같습니다.',
        '그렇다면 출근 채널에서 **출근(CLOCK IN)** 버튼을 눌러 주세요.',
        '',
        '✅ CLOCK IN 후에는 **라이브 예외** 로 근무를 이어갈 수 있습니다.',
        '🚫 CLOCK IN 없이는 이 시간이 근무로 잡히지 않습니다.',
        '',
        '라이브를 정말 켤 수 없을 때만 이용해 주세요. 🙏'
    ].join('\n');
}

function buildFinishedReturnDefaultDm() {
    return [
        '🌿 다시 오신 것을 환영합니다',
        '',
        '음성 채널에는 들어왔지만 아직 퇴근(FINISHED) 상태입니다.',
        '',
        '근무 시간을 다시 집계하려면:',
        '1. 라이브 방송 켜기',
        '2. 출근 패널에서 출근(CLOCK IN) 버튼 누르기',
        '',
        '라이브만 켜서는 출근이 재개되지 않습니다. 🙂'
    ].join('\n');
}

function buildStandbyClockInRequiredDm() {
    return [
        '🌿 출근 안내',
        '',
        '라이브는 켜져 있지만 아직 출근 처리되지 않았습니다.',
        '출근 채널에서 **출근(CLOCK IN)** 버튼을 눌러 주세요.',
        '',
        '✅ CLOCK IN을 눌러야 근무 시간이 기록됩니다.'
    ].join('\n');
}

function buildLiveOffGuidanceDm({ final = false, minutes = null } = {}) {
    const lines = [
        final ? '⚠️ 라이브가 계속 꺼져 있어 출근이 종료되었습니다.' : '📹 라이브 방송을 켜 주세요.',
        '',
        '❓ 지금 라이브를 켤 수 없나요?',
        '인터넷/PC 문제로 라이브를 켤 수 없다면, 음성 채널에 남아 **출근(CLOCK IN)** 을 눌러 라이브 예외로 다시 시작할 수 있습니다.',
        '✅ 이렇게 해야만 근무로 인정됩니다.',
        '',
        '🙏 라이브를 정말 켤 수 없을 때만 이용해 주세요.',
        '🚫 CLOCK IN 없이는 출근이 인정되지 않습니다.'
    ];
    if (minutes !== null) {
        lines.splice(1, 0, `⏱️ 라이브 OFF 지속: 약 ${minutes}분`);
    }
    return lines.join('\n');
}

function buildFinishedLiveOffReminderDm(reminderIndex, reminderTotal, guidanceBody) {
    return [
        '🌿 퇴근 후 라이브 OFF 안내',
        `알림 ${reminderIndex}/${reminderTotal}`,
        '',
        guidanceBody
    ].join('\n');
}

function buildDayOffApprovedDm(reservation) {
    return [
        '휴무 신청이 승인되었습니다.',
        '',
        `이름: ${reservation.name}`,
        `근무조: ${reservation.shiftLabel}`,
        `휴무일: ${reservation.leaveDate}`,
        '',
        '일정을 확인해 주시고 편히 쉬다 오세요.'
    ].join('\n');
}

function buildDayOffRejectedDm(reservation) {
    const reason = reservation.rejectReason || '관리자 반려';
    return [
        '휴무 신청이 반려되었습니다.',
        '',
        `이름: ${reservation.name}`,
        `근무조: ${reservation.shiftLabel}`,
        `휴무일: ${reservation.leaveDate}`,
        `반려자: ${reservation.rejectedByName || '관리자'}`,
        `사유: ${reason}`,
        '',
        '문의가 필요하면 관리자에게 연락해 주세요.'
    ].join('\n');
}

function buildScheduledBroadcastTitle(slotIndex) {
    return `📢 시스템 공지 [슬롯 ${slotIndex}]`;
}

module.exports = {
    buildLiveOffClockOutDm,
    buildDcTimeoutClockOutDm,
    buildManualResumeRequiredDm,
    buildLiveOffWarningDm,
    buildDayOffClockInPromptMessage,
    buildDayOffPresenceDm,
    buildDayOffPresenceLogLines,
    buildAfterFinishPresenceDm,
    buildFinishedReturnWithinShiftDm,
    buildFinishedReturnDefaultDm,
    buildStandbyClockInRequiredDm,
    buildLiveOffGuidanceDm,
    buildFinishedLiveOffReminderDm,
    buildDayOffApprovedDm,
    buildDayOffRejectedDm,
    buildScheduledBroadcastTitle
};
