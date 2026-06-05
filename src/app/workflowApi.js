'use strict';

const WORKFLOW_ROOT_METHODS = [
    ['buildDiagnosticsEmbed', 'audit'],
    ['buildOpsCheckEmbed', 'audit'],
    ['buildPermissionCheckEmbed', 'audit'],
    ['buildDataAuditEmbed', 'audit'],
    ['buildStatusAuditEmbed', 'audit'],
    ['buildStatusTraceEmbed', 'audit'],
    ['buildTimeAuditEmbed', 'audit'],
    ['buildDayOffLogEmbed', 'audit'],
    ['syncUserRecordedStatus', 'audit'],
    ['sendOpsReport', 'reporting'],
    ['sendDeepReport', 'reporting'],
    ['buildRankingEmbed', 'reporting'],
    ['buildInactiveCandidatesEmbed', 'reporting'],
    ['syncAutoPanels', 'notice'],
    ['checkOperationalIssues', 'ops'],
    ['processOpsQueueAutoRetry', 'ops'],
    ['submitDayOffRequestFromInteraction', 'dayOff'],
    ['processDayOffMessage', 'dayOff'],
    ['approveDayOffMessage', 'dayOff'],
    ['cancelDayOffRequest', 'dayOff'],
    ['cancelDayOffApproval', 'dayOff'],
    ['checkDayOffReservations', 'dayOff'],
    ['approveDayOffReservationByCommand', 'dayOff'],
    ['cancelDayOffReservationByCommand', 'dayOff'],
    ['cancelOnlyDayOffReservationByCommand', 'dayOff'],
    ['rejectDayOffReservationByCommand', 'dayOff'],
    ['writeDayOffLog', 'dayOff'],
    ['writeAdminActionLog', 'adminAuditLog'],
    ['applyApprovedDayOffReservation', 'dayOff'],
    ['sendFinishedLiveOffReminder', 'dayOff'],
    ['markWorkedOnDayOff', 'dayOff'],
    ['queueDashboardRender', 'dashboard'],
    ['renderDashboardCore', 'dashboard'],
    ['getActiveLiveException', 'dashboard'],
    ['getDayNightWorkerStats', 'dashboard'],
    ['getDayNightWorkerOvertimeUsers', 'dashboard'],
    ['applyVoiceSnapshot', 'voice'],
    ['syncVoiceStates', 'voice'],
    ['syncWorkingRoles', 'membership'],
    ['reconcileAttendanceMembership', 'membership'],
    ['autoAssignGuestForUnassignedMembers', 'membership'],
    ['syncManualGuestNickname', 'membership'],
    ['syncNicknameFromAssignedRoles', 'membership'],
    ['syncRolesFromStructuredNickname', 'membership'],
    ['performSmartReset', 'scheduled'],
    ['checkGracePeriods', 'scheduled'],
    ['autoOvertimeCheck', 'scheduled'],
    ['grantLiveException', 'scheduled'],
    ['checkLiveExceptions', 'scheduled'],
    ['checkScheduledAnnouncements', 'scheduled']
];

function createWorkflowApi() {
    const api = {};
    let runtime = null;

    function wire(nextRuntime) {
        runtime = nextRuntime;
        for (const [name, root] of WORKFLOW_ROOT_METHODS) {
            api[name] = (...args) => runtime[root][name](...args);
        }
        for (const [name, value] of Object.entries(runtime.clock)) {
            if (typeof value === 'function') {
                api[name] = (...args) => value(...args);
            }
        }
    }

    function getRuntime() {
        return runtime;
    }

    return { api, wire, getRuntime };
}

module.exports = {
    createWorkflowApi,
    WORKFLOW_ROOT_METHODS
};
