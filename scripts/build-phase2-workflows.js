'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function cleanExtractBody(body) {
    return body
        .replace(/^\uFEFF/, '')
        .replace(/\/\*\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\* \[[^\]]+\]\s*$/gm, '')
        .replace(/^\s*\*\/\s*$/gm, '')
        .trimStart();
}

function commonStateReplacements(body) {
    let out = fixOvertimeAssignments(body);
    out = out
        .replace(/\battendanceData\b/g, 'getAttendanceData()')
        .replace(/\bovertimeUsers\b/g, 'getOvertimeUsers()')
        .replace(/\bannounceData\b/g, 'getAnnounceData()')
        .replace(/\bliveExceptions\b/g, 'getLiveExceptions()')
        .replace(/(?<!\.)statusMessageId\b/g, 'getStatusMessageId()');
    return fixObjectShorthand(fixStatusAssignments(out));
}

function fixStatusAssignments(body) {
    return body
        .replace(/getStatusMessageId\(\)\s*=\s*([^;]+);/g, 'setStatusMessageId($1);');
}

function fixObjectShorthand(body) {
    return body
        .replace(/\{\s*getAttendanceData\(\),/g, '{ attendanceData: getAttendanceData(),')
        .replace(/,\s*getAttendanceData\(\),/g, ', attendanceData: getAttendanceData(),')
        .replace(/\{\s*getStatusMessageId\(\),/g, '{ statusMessageId: getStatusMessageId(),')
        .replace(/,\s*getStatusMessageId\(\),/g, ', statusMessageId: getStatusMessageId(),');
}

function fixOvertimeAssignments(body) {
    return body.replace(
        /overtimeUsers\s*=\s*overtimeUsers\.filter\(([^;]+)\);/g,
        'setOvertimeUsers(getOvertimeUsers().filter($1));'
    );
}

function stripTrailingSectionMarkers(body) {
    return body.replace(/\n\/\*\*[\s\S]*$/g, '').trimEnd();
}

function wrapWorkflow(name, factory, extractFile, header, footer, transformBody) {
    let body = cleanExtractBody(fs.readFileSync(path.join(root, extractFile), 'utf8').replace(/\r\n/g, '\n'));
    if (typeof transformBody === 'function') body = transformBody(body);
    const content = [
        "'use strict';",
        '',
        `function ${factory}(deps) {`,
        header,
        body,
        footer,
        '}',
        '',
        `module.exports = { ${factory} };`,
        ''
    ].join('\n');
    fs.writeFileSync(path.join(root, 'src/workflows', name), content, 'utf8');
}

const dashboardTransform = body => {
    let b = stripTrailingSectionMarkers(cleanExtractBody(body));
    b = b.replace(/^const DASHBOARD[\s\S]*?let dashboardPendingStableKeyAt = 0;\s*/m, '');
    return commonStateReplacements(b);
};

wrapWorkflow(
    'dashboardWorkflow.js',
    'createDashboardWorkflow',
    'src/workflows/_extract-dashboard.txt',
    `    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        dashboardMessageService,
        dashboardStateUtils,
        getAttendanceData,
        getOvertimeUsers,
        setOvertimeUsers,
        getStatusMessageId,
        setStatusMessageId,
        saveSystemAsync,
        refreshGuildMembers,
        syncVoiceStates,
        expireDayOffSessions,
        isMaintenanceWindow,
        isWithinPreShiftWindow,
        getDashboardShift,
        getShiftBounds,
        getMemberShiftRole,
        getActiveApprovedDayOffReservation,
        applyApprovedDayOffReservation,
        ensureUserData,
        determineShift,
        normalizeCurrentShiftSession,
        handleClockOut,
        transitionRecordedStatus,
        isOvertimeEntryStillValid,
        getRankingWorkerShift,
        getDashboardName,
        applyCurrentShiftLiveOnState,
        logger = console
    } = deps;

    const DASHBOARD_LAYOUT_VERSION = 'classic-dashboard-wide-blank-v14';
    const DASHBOARD_INSTANCE_TAG = \`pid:\${process.pid}\`;
    const DASHBOARD_RENDER_DEBOUNCE_MS = 2500;
    const DASHBOARD_MIN_VISIBLE_WORKERS = 10;
    const DASHBOARD_STATE_SETTLE_MS = 15 * 1000;

    let dashboardRenderTimer = null;
    let dashboardRenderPending = { forceMemberRefresh: false, reconcileSession: false };
    let dashboardRenderChain = Promise.resolve();
    let dashboardLastPublishedStableKey = null;
    let dashboardPendingStableKey = null;
    let dashboardPendingStableKeyAt = 0;`,
    `    return {
        getLayoutVersion: () => DASHBOARD_LAYOUT_VERSION,
        getInstanceTag: () => DASHBOARD_INSTANCE_TAG,
        queueDashboardRender,
        renderDashboardCore,
        reconcileDashboardSessionState,
        getDayNightWorkerStats,
        getDayNightWorkerOvertimeUsers,
        getActiveLiveException,
        readMemberVoicePresence,
        buildLiveOffVoiceIds
    };`,
    dashboardTransform
);

wrapWorkflow(
    'voiceSyncWorkflow.js',
    'createVoiceSyncWorkflow',
    'src/workflows/_extract-voice.txt',
    `    const {
        client,
        CONFIG,
        moment,
        getAttendanceData,
        saveSystemAsync,
        refreshGuildMembers,
        determineShift,
        ensureUserData,
        getMemberShiftRole,
        getActiveLiveException,
        getShiftBounds,
        getScheduledEndMoment,
        isMaintenanceWindow,
        isWithinPreShiftWindow,
        isCurrentShiftRegularWorker,
        canStartPostShiftOvertime,
        getRestorableOvertimeSession,
        appendAttendanceEvent,
        transitionRecordedStatus,
        setFinishedPresence,
        handleClockOut,
        applyDisconnectedState,
        recordLog,
        getActiveApprovedDayOffReservation,
        clearStaleDayOffState,
        applyLiveExceptionState,
        handleClockIn,
        activatePendingManualOvertime,
        restoreOvertimeAfterFinish,
        startPostShiftOvertime,
        recordLiveConfirmation,
        recordLiveRecovery,
        markLiveOffState,
        clearLiveOffState,
        logger = console
    } = deps;`,
    `    return {
        applyVoiceSnapshot,
        syncVoiceStates
    };`,
    body => commonStateReplacements(stripTrailingSectionMarkers(cleanExtractBody(body)))
);

wrapWorkflow(
    'membershipWorkflow.js',
    'createMembershipWorkflow',
    'src/workflows/_extract-membership.txt',
    `    const {
        client,
        CONFIG,
        moment,
        getAttendanceData,
        getOvertimeUsers,
        setOvertimeUsers,
        saveSystemAsync,
        refreshGuildMembers,
        updateWorkingRole,
        ensureUserData,
        determineShift,
        getMemberShiftRole,
        isAssignedWorker,
        hasManagedAttendanceRole,
        roleService,
        getWorkerProfileForRawSync,
        logger = console
    } = deps;`,
    `    return {
        syncWorkingRoles,
        reconcileAttendanceMembership,
        autoAssignGuestForUnassignedMembers,
        syncManualGuestNickname,
        syncNicknameFromAssignedRoles,
        syncRolesFromStructuredNickname
    };`,
    body => commonStateReplacements(stripTrailingSectionMarkers(cleanExtractBody(body)))
);

wrapWorkflow(
    'scheduledJobsWorkflow.js',
    'createScheduledJobsWorkflow',
    'src/workflows/_extract-scheduled.txt',
    `    const {
        client,
        CONFIG,
        moment,
        EmbedBuilder,
        getAttendanceData,
        getOvertimeUsers,
        setOvertimeUsers,
        getLiveExceptions,
        getAnnounceData,
        saveSystemAsync,
        recordLog,
        handleClockOut,
        transitionRecordedStatus,
        updateWorkingRole,
        getScheduledEndMoment,
        getShiftBounds,
        formatKoreanDateTime,
        renderDashboardCore,
        logger = console
    } = deps;`,
    `    return {
        performSmartReset,
        checkGracePeriods,
        autoOvertimeCheck,
        grantLiveException,
        checkLiveExceptions,
        checkScheduledAnnouncements
    };`,
    body => commonStateReplacements(stripTrailingSectionMarkers(cleanExtractBody(body)))
);

console.log('phase2 workflow modules built');
