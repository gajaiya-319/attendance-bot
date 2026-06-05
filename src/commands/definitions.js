const { SlashCommandBuilder } = require('discord.js');

const hiddenCommandAliases = new Set([
    'live-exception',
    'assign-roles',
    'report-regular',
    'report-analysis',
    'combined-ranking',
    'refresh',
    'sync-working',
    'permission-check',
    'data-audit',
    'inactive-candidates',
    'ops-check',
    'ops-pending',
    'ops-retry',
    'today-audit',
    'payroll-audit',
    'status-audit',
    'status-trace',
    'status-sync',
    'time-audit',
    'dayoff-log',
    'dayoff-list',
    'dayoff-approve',
    'dayoff-cancel',
    'dayoff-cancel-force',
    'dayoff-reject',
    'force-in',
    'force-out',
    'force-early-out',
    'force-off',
    'force-ot',
    'reset-all',
    'my-info',
    'diagnostics',
    'backup-create',
    'backup-list',
    'backup-restore',
    'set-announce',
    'cancel-announce',
    'list-announce',
    'fire',
    'clear-roles',
    'manual-adjust'
]);

function buildCommandDefinitions() {
    return [
        new SlashCommandBuilder().setName('라이브예외').setDescription('Approve live exception').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('사유').setRequired(true).setDescription('Reason')).addIntegerOption(o=>o.setName('시간').setDescription('Hours; leave blank to use shift end').setMinValue(1).setMaxValue(12)),
        new SlashCommandBuilder().setName('live-exception').setDescription('Approve live exception').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('reason').setRequired(true).setDescription('Reason')).addIntegerOption(o=>o.setName('hours').setDescription('Hours; leave blank to use shift end').setMinValue(1).setMaxValue(12)),
        new SlashCommandBuilder().setName('역할').setDescription('Assign roles').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('서버').setRequired(true).setDescription('Server').addChoices({name:'Heine',value:'HEINE'},{name:'Paagrio',value:'PAAGRIO'})).addStringOption(o=>o.setName('시프트').setRequired(true).setDescription('Shift').addChoices({name:'Day',value:'DAY'},{name:'Night',value:'NIGHT'})),
        new SlashCommandBuilder().setName('assign-roles').setDescription('Assign roles').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('server').setRequired(true).setDescription('Server').addChoices({name:'Heine',value:'HEINE'},{name:'Paagrio',value:'PAAGRIO'})).addStringOption(o=>o.setName('shift').setRequired(true).setDescription('Shift').addChoices({name:'Day',value:'DAY'},{name:'Night',value:'NIGHT'})),
        new SlashCommandBuilder().setName('일반보고').setDescription('Summary report'), new SlashCommandBuilder().setName('report-regular').setDescription('Summary report'),
        new SlashCommandBuilder().setName('정밀보고').setDescription('Deep report'), new SlashCommandBuilder().setName('report-analysis').setDescription('Deep report'),
        new SlashCommandBuilder().setName('통합랭킹').setDescription('Combined day/night worker ranking').addStringOption(o=>o.setName('구분').setDescription('Ranking group').addChoices({name:'주/야 통합',value:'all'},{name:'주간',value:'day'},{name:'야간',value:'night'})),
        new SlashCommandBuilder().setName('combined-ranking').setDescription('Combined day/night worker ranking').addStringOption(o=>o.setName('shift').setDescription('Ranking group').addChoices({name:'All',value:'all'},{name:'Day',value:'day'},{name:'Night',value:'night'})),
        new SlashCommandBuilder().setName('현황판갱신').setDescription('Refresh'), new SlashCommandBuilder().setName('refresh').setDescription('Refresh'),
        new SlashCommandBuilder().setName('워킹동기화').setDescription('Sync WORKING roles'), new SlashCommandBuilder().setName('sync-working').setDescription('Sync WORKING roles'),
        new SlashCommandBuilder().setName('권한진단').setDescription('Permission check'), new SlashCommandBuilder().setName('permission-check').setDescription('Permission check'),
        new SlashCommandBuilder().setName('데이터검사').setDescription('Data audit'), new SlashCommandBuilder().setName('data-audit').setDescription('Data audit'),
        new SlashCommandBuilder().setName('비활동검사').setDescription('Inactive kick candidate report').addIntegerOption(o=>o.setName('일수').setDescription('Inactive days').setMinValue(1).setMaxValue(30)),
        new SlashCommandBuilder().setName('inactive-candidates').setDescription('Inactive kick candidate report').addIntegerOption(o=>o.setName('days').setDescription('Inactive days').setMinValue(1).setMaxValue(30)),
        new SlashCommandBuilder().setName('운영점검').setDescription('Operational health check'), new SlashCommandBuilder().setName('ops-check').setDescription('Operational health check'),
        new SlashCommandBuilder().setName('작업대기').setDescription('실패해서 재시도 대기 중인 시트 작업을 확인합니다'), new SlashCommandBuilder().setName('ops-pending').setDescription('List pending sheet operations'),
        new SlashCommandBuilder().setName('작업재시도').setDescription('실패해서 대기 중인 시트 작업을 다시 입력합니다'), new SlashCommandBuilder().setName('ops-retry').setDescription('Retry pending sheet operations'),
        new SlashCommandBuilder().setName('오늘기록검사').setDescription('오늘 출결 기록, 이름 중복, 0기록 근무자를 검사합니다'), new SlashCommandBuilder().setName('today-audit').setDescription('Audit today raw attendance records'),
        new SlashCommandBuilder().setName('급여검사').setDescription('급여 시트 실패, 백업 로그, 중복 의심 작업을 검사합니다'), new SlashCommandBuilder().setName('payroll-audit').setDescription('Audit payroll sheet operations'),
        new SlashCommandBuilder().setName('급여기록').setDescription('3일 급여 마감을 Raw_Data 시트에 기록합니다').addStringOption(o=>o.setName('기간').setDescription('회차 라벨 (예: 31~2일 3일차)')),
        new SlashCommandBuilder().setName('상태검사').setDescription('Recorded status audit'), new SlashCommandBuilder().setName('status-audit').setDescription('Recorded status audit'),
        new SlashCommandBuilder().setName('상태추적').setDescription('Trace one user status history').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('status-trace').setDescription('Trace one user status history').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('상태동기화').setDescription('Sync one user recorded status').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('status-sync').setDescription('Sync one user recorded status').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('시간검사').setDescription('Time logic audit'), new SlashCommandBuilder().setName('time-audit').setDescription('Time logic audit'),
        new SlashCommandBuilder()
            .setName('점검')
            .setDescription('정기점검 예외를 관리합니다')
            .addSubcommand(s=>s
                .setName('설정')
                .setDescription('특정 날짜의 정기점검 예외를 설정합니다')
                .addStringOption(o=>o.setName('날짜').setRequired(true).setDescription('기준 날짜 YYYY-MM-DD'))
                .addStringOption(o=>o.setName('사용').setRequired(true).setDescription('정기점검 적용 여부').addChoices({name:'켜기',value:'true'},{name:'끄기',value:'false'}))
                .addStringOption(o=>o.setName('주간시작').setDescription('주간 시작 HH:mm'))
                .addStringOption(o=>o.setName('주간종료').setDescription('주간 종료 HH:mm'))
                .addStringOption(o=>o.setName('야간시작').setDescription('야간 시작 HH:mm'))
                .addStringOption(o=>o.setName('야간종료').setDescription('야간 종료 HH:mm'))
                .addStringOption(o=>o.setName('점검날짜').setDescription('점검창 날짜 YYYY-MM-DD'))
                .addStringOption(o=>o.setName('점검시작').setDescription('점검 시작 HH:mm'))
                .addStringOption(o=>o.setName('점검종료').setDescription('점검 종료 HH:mm'))
                .addStringOption(o=>o.setName('사유').setDescription('사유')))
            .addSubcommand(s=>s
                .setName('목록')
                .setDescription('정기점검 예외 목록을 확인합니다'))
            .addSubcommand(s=>s
                .setName('삭제')
                .setDescription('특정 날짜의 정기점검 예외를 삭제합니다')
                .addStringOption(o=>o.setName('날짜').setRequired(true).setDescription('기준 날짜 YYYY-MM-DD'))),
        new SlashCommandBuilder().setName('휴무로그').setDescription('Day off audit log').addIntegerOption(o=>o.setName('갯수').setDescription('Limit').setMinValue(1).setMaxValue(30)),
        new SlashCommandBuilder().setName('dayoff-log').setDescription('Day off audit log').addIntegerOption(o=>o.setName('limit').setDescription('Limit').setMinValue(1).setMaxValue(30)),
        new SlashCommandBuilder().setName('휴무목록').setDescription('Day off list').addStringOption(o=>o.setName('상태').setDescription('Status').addChoices({name:'All',value:'all'},{name:'Pending',value:'pending'},{name:'Approved',value:'approved'},{name:'Today',value:'today'},{name:'Worked',value:'worked'},{name:'Cancelled',value:'cancelled'},{name:'Rejected',value:'rejected'})),
        new SlashCommandBuilder().setName('dayoff-list').setDescription('Day off list').addStringOption(o=>o.setName('status').setDescription('Status').addChoices({name:'All',value:'all'},{name:'Pending',value:'pending'},{name:'Approved',value:'approved'},{name:'Today',value:'today'},{name:'Worked',value:'worked'},{name:'Cancelled',value:'cancelled'},{name:'Rejected',value:'rejected'})),
        new SlashCommandBuilder().setName('dayoff-panel').setDescription('Post the day-off request button panel'),
        new SlashCommandBuilder().setName('휴무승인').setDescription('Approve day off').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('날짜').setRequired(true).setDescription('Date')),
        new SlashCommandBuilder().setName('dayoff-approve').setDescription('Approve day off').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('date').setRequired(true).setDescription('Date')),
        new SlashCommandBuilder().setName('휴무취소').setDescription('Cancel day off').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('날짜').setRequired(true).setDescription('Date')),
        new SlashCommandBuilder().setName('dayoff-cancel').setDescription('Cancel day off').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('date').setRequired(true).setDescription('Date')),
        new SlashCommandBuilder().setName('강제휴무취소').setDescription('Cancel exactly one day off without date').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('dayoff-cancel-force').setDescription('Cancel exactly one day off without date').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('휴무반려').setDescription('Reject day off').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('날짜').setRequired(true).setDescription('Date')).addStringOption(o=>o.setName('사유').setDescription('Reason')),
        new SlashCommandBuilder().setName('dayoff-reject').setDescription('Reject day off').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('date').setRequired(true).setDescription('Date')).addStringOption(o=>o.setName('reason').setDescription('Reason')),
        new SlashCommandBuilder().setName('강제출근').setDescription('Force in').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('force-in').setDescription('Force in').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('강제퇴근').setDescription('Force out').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('force-out').setDescription('Force out').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('강제조기퇴근').setDescription('Force early out').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('force-early-out').setDescription('Force early out').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('강제휴무').setDescription('Force off').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('force-off').setDescription('Force off').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('강제연장').setDescription('Force OT').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('force-ot').setDescription('Force OT').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('리셋').setDescription('Reset one user').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('전체리셋').setDescription('Reset all attendance data'), new SlashCommandBuilder().setName('reset-all').setDescription('Reset all attendance data'),
        new SlashCommandBuilder().setName('내정보').setDescription('My info'), new SlashCommandBuilder().setName('my-info').setDescription('My info'),
        new SlashCommandBuilder().setName('진단').setDescription('Diagnostics'), new SlashCommandBuilder().setName('diagnostics').setDescription('Diagnostics'),
        new SlashCommandBuilder().setName('백업생성').setDescription('Backup create'), new SlashCommandBuilder().setName('backup-create').setDescription('Backup create'),
        new SlashCommandBuilder().setName('백업목록').setDescription('Backup list'), new SlashCommandBuilder().setName('backup-list').setDescription('Backup list'),
        new SlashCommandBuilder().setName('백업복구').setDescription('Backup restore').addStringOption(o=>o.setName('파일').setDescription('File')), new SlashCommandBuilder().setName('backup-restore').setDescription('Backup restore').addStringOption(o=>o.setName('file').setDescription('File')),
        new SlashCommandBuilder()
    .setName('공지설정')
    .setDescription('Schedule announcement')
    .addIntegerOption(o=>o.setName('slot').setRequired(true).setMinValue(1).setMaxValue(6).setDescription('Announcement slot'))
    .addRoleOption(o=>o.setName('target').setRequired(true).setDescription('First target role'))
    .addStringOption(o=>o.setName('time').setRequired(true).setDescription('Send time (HH:mm)'))
    .addStringOption(o=>o.setName('content').setRequired(true).setDescription('Announcement content'))
    .addRoleOption(o=>o.setName('target2').setDescription('Second target role')),

new SlashCommandBuilder()
    .setName('set-announce')
    .setDescription('Schedule announcement')
    .addIntegerOption(o=>o.setName('slot').setRequired(true).setMinValue(1).setMaxValue(6).setDescription('Announcement slot'))
    .addRoleOption(o=>o.setName('target').setRequired(true).setDescription('First target role'))
    .addStringOption(o=>o.setName('time').setRequired(true).setDescription('Send time (HH:mm)'))
    .addStringOption(o=>o.setName('content').setRequired(true).setDescription('Announcement content'))
    .addRoleOption(o=>o.setName('target2').setDescription('Second target role')),
        new SlashCommandBuilder().setName('공지취소').setDescription('Cancel scheduled announcement').addIntegerOption(o=>o.setName('slot').setRequired(true).setMinValue(1).setMaxValue(6).setDescription('Announcement slot to cancel')), new SlashCommandBuilder().setName('cancel-announce').setDescription('Cancel scheduled announcement').addIntegerOption(o=>o.setName('slot').setRequired(true).setMinValue(1).setMaxValue(6).setDescription('Announcement slot to cancel')),
        new SlashCommandBuilder().setName('공지목록').setDescription('List announce'), new SlashCommandBuilder().setName('list-announce').setDescription('List announce'),
        new SlashCommandBuilder().setName('해고').setDescription('Kick').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('fire').setDescription('Kick').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('역할삭제').setDescription('Clear roles').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')), new SlashCommandBuilder().setName('clear-roles').setDescription('Clear roles').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')),
        new SlashCommandBuilder().setName('수동수정').setDescription('Manual adjust').addUserOption(o=>o.setName('대상').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('항목').setRequired(true).setDescription('Field').addChoices({name:'points',value:'points'},{name:'status',value:'status'},{name:'shift',value:'shift'},{name:'checked-in',value:'checked-in'},{name:'day-off',value:'day-off'},{name:'disconnected',value:'disconnected'},{name:'finished',value:'finished'},{name:'normal',value:'normal'},{name:'late',value:'late'},{name:'absent',value:'absent'},{name:'early',value:'early'},{name:'ot',value:'ot'},{name:'off',value:'off'},{name:'dc',value:'dc'},{name:'strikes',value:'strikes'})).addStringOption(o=>o.setName('값').setRequired(true).setDescription('Value')),
        new SlashCommandBuilder().setName('manual-adjust').setDescription('Manual adjust').addUserOption(o=>o.setName('target').setRequired(true).setDescription('Target')).addStringOption(o=>o.setName('field').setRequired(true).setDescription('Field').addChoices({name:'points',value:'points'},{name:'status',value:'status'},{name:'shift',value:'shift'},{name:'checked-in',value:'checked-in'},{name:'day-off',value:'day-off'},{name:'disconnected',value:'disconnected'},{name:'finished',value:'finished'},{name:'normal',value:'normal'},{name:'late',value:'late'},{name:'absent',value:'absent'},{name:'early',value:'early'},{name:'ot',value:'ot'},{name:'off',value:'off'},{name:'dc',value:'dc'},{name:'strikes',value:'strikes'})).addStringOption(o=>o.setName('value').setRequired(true).setDescription('Value'))
    ];
}

module.exports = {
    buildCommandDefinitions,
    hiddenCommandAliases
};
