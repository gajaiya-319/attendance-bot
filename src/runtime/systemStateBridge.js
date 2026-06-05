'use strict';

function createSystemStateBridge({
    dataStore,
    getLiveState,
    setLiveState,
    onMetaSynced
}) {
    if (typeof getLiveState !== 'function') {
        throw new TypeError('getLiveState must be a function');
    }
    if (typeof setLiveState !== 'function') {
        throw new TypeError('setLiveState must be a function');
    }

    function collectSystemState() {
        return getLiveState();
    }

    function applySystemState(state = dataStore.db) {
        const current = getLiveState();
        setLiveState({
            attendanceData: state.attendanceData || {},
            overtimeUsers: state.overtimeUsers || [],
            statusMessageId: state.statusMessageId || null,
            panelInfo: state.panelInfo || current.panelInfo,
            announceData: state.announceData || current.announceData,
            dayOffReservations: state.dayOffReservations || {},
            liveExceptions: state.liveExceptions || {}
        });
    }

    function syncDataStoreMeta() {
        if (typeof onMetaSynced === 'function') {
            onMetaSynced(dataStore.meta);
        }
    }

    return {
        collectSystemState,
        applySystemState,
        syncDataStoreMeta
    };
}

module.exports = {
    createSystemStateBridge
};
