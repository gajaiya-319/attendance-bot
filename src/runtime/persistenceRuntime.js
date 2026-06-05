'use strict';

function createPersistenceRuntime({
    dataStore,
    maintenanceOverrideService,
    collectSystemState,
    applySystemState,
    syncDataStoreMeta,
    logger = console
}) {
    if (typeof collectSystemState !== 'function') {
        throw new TypeError('collectSystemState must be a function');
    }
    if (typeof applySystemState !== 'function') {
        throw new TypeError('applySystemState must be a function');
    }
    if (typeof syncDataStoreMeta !== 'function') {
        throw new TypeError('syncDataStoreMeta must be a function');
    }

    let lastMemberFetchAt = 0;
    let memberFetchPromise = null;
    let memberFetchRetryAfter = 0;
    let lastMemberFetchSkipLogAt = 0;
    let lastMemberFetchError = null;

    function getMemberFetchHealth() {
        return {
            lastMemberFetchAt,
            memberFetchRetryAfter,
            lastMemberFetchError
        };
    }

    async function refreshGuildMembers(guild, { force = false, minIntervalMs = 10 * 60 * 1000 } = {}) {
        if (!guild) return false;
        const now = Date.now();
        if (!force && now - lastMemberFetchAt < minIntervalMs) return true;
        if (now < memberFetchRetryAfter) {
            if (now - lastMemberFetchSkipLogAt > 60 * 1000) {
                const retryIn = Math.ceil((memberFetchRetryAfter - now) / 1000);
                logger.log(`[MEMBER FETCH SKIP] Backoff active. Retry in ${retryIn}s.`);
                lastMemberFetchSkipLogAt = now;
            }
            return false;
        }
        if (memberFetchPromise) return memberFetchPromise;

        memberFetchPromise = guild.members.fetch()
            .then(() => {
                lastMemberFetchAt = Date.now();
                memberFetchRetryAfter = 0;
                lastMemberFetchError = null;
                return true;
            })
            .catch(e => {
                const retrySeconds = Number(e?.data?.retry_after) || 30;
                memberFetchRetryAfter = Date.now() + Math.ceil(retrySeconds * 1000);
                lastMemberFetchError = e?.message || e?.rawError?.message || 'member fetch failed';
                const retry = ` Retry after ${retrySeconds}s.`;
                logger.log(`[MEMBER FETCH SKIP] Guild member fetch skipped.${retry}`);
                lastMemberFetchSkipLogAt = Date.now();
                return false;
            })
            .finally(() => {
                memberFetchPromise = null;
            });

        return memberFetchPromise;
    }

    async function saveSystemAsync() {
        await dataStore.saveSystemAsync(collectSystemState());
        syncDataStoreMeta();
    }

    async function createBackupSnapshot(reason = 'manual') {
        const backupPath = await dataStore.createBackupSnapshot(reason, collectSystemState());
        syncDataStoreMeta();
        return backupPath;
    }

    async function createScheduledBackupIfDue() {
        await dataStore.createScheduledBackupIfDue(collectSystemState());
        syncDataStoreMeta();
    }

    async function listBackupSnapshots() {
        return dataStore.listBackupSnapshots();
    }

    async function restoreBackupSnapshot(fileName = null) {
        const restored = await dataStore.restoreBackupSnapshot(fileName, collectSystemState());
        if (restored) applySystemState(dataStore.getState());
        syncDataStoreMeta();
        return restored;
    }

    async function loadSystem() {
        await maintenanceOverrideService.load();
        dataStore.assignState(collectSystemState());
        dataStore.loadSystem();
        applySystemState(dataStore.getState());
        syncDataStoreMeta();
    }

    return {
        getMemberFetchHealth,
        refreshGuildMembers,
        saveSystemAsync,
        createBackupSnapshot,
        createScheduledBackupIfDue,
        listBackupSnapshots,
        restoreBackupSnapshot,
        loadSystem
    };
}

module.exports = {
    createPersistenceRuntime
};
