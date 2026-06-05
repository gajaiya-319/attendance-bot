const assert = require('assert');
const { createDashboardMessageService } = require('../src/services/dashboardMessageService');

function createChannel(options = {}) {
    const calls = [];
    const botMessage = {
        id: 'existing',
        author: { id: 'bot' },
        embeds: [{ title: 'INTEGRATED OPS CONTROL CENTER' }],
        edit: async payload => {
            calls.push(`edit:${payload.embeds[0].id}`);
            if (options.editFails) throw new Error('edit failed');
        }
    };
    const otherMessage = {
        id: 'other',
        author: { id: 'other' },
        embeds: [{ title: 'Other' }],
        edit: async () => calls.push('edit-other')
    };
    const sentMessage = { id: 'sent', author: { id: 'bot' }, embeds: [] };
    return {
        calls,
        channel: {
            messages: {
                fetch: async arg => {
                    calls.push(typeof arg === 'string' ? `fetch-id:${arg}` : `fetch-list:${arg.limit}`);
                    if (typeof arg === 'string') {
                        if (options.idFetchFails || arg === 'missing') throw new Error('not found');
                        return botMessage;
                    }
                    if (options.listFetchFails) throw new Error('list failed');
                    const messages = options.hasExisting === false ? [otherMessage] : [otherMessage, botMessage];
                    return {
                        find: predicate => messages.find(predicate)
                    };
                }
            },
            send: async payload => {
                calls.push(`send:${payload.embeds[0].id}`);
                return sentMessage;
            }
        }
    };
}

(async () => {
    const logs = [];
    let fakeNowMs = 1000;
    const service = createDashboardMessageService({
        client: { user: { id: 'bot' } },
        nowMs: () => fakeNowMs,
        logger: { error: (label, error) => logs.push(`${label}:${error.message}`) }
    });

    const { channel: existingChannel, calls: existingCalls } = createChannel();
    const found = await service.findExistingStatusMessage(existingChannel);
    assert.strictEqual(found.id, 'existing');
    assert.deepStrictEqual(existingCalls, ['fetch-list:20']);

    const { channel: sendChannel, calls: sendCalls } = createChannel({ hasExisting: false, idFetchFails: true });
    const created = await service.upsertStatusMessage(sendChannel, {
        statusMessageId: 'missing',
        embed: { id: 'embed1' }
    });
    assert.deepStrictEqual(created, {
        statusMessageId: 'sent',
        created: true,
        updated: false,
        message: { id: 'sent', author: { id: 'bot' }, embeds: [] }
    });
    assert.deepStrictEqual(sendCalls, ['fetch-id:missing', 'fetch-list:20', 'send:embed1']);

    const { channel: editChannel, calls: editCalls } = createChannel();
    const edited = await service.upsertStatusMessage(editChannel, {
        statusMessageId: 'existing',
        embed: { id: 'embed2' }
    });
    assert.strictEqual(edited.statusMessageId, 'existing');
    assert.strictEqual(edited.created, false);
    assert.strictEqual(edited.updated, true);
    assert.deepStrictEqual(editCalls, ['fetch-id:existing', 'edit:embed2']);

    const throttled = await service.upsertStatusMessage(editChannel, {
        statusMessageId: 'existing',
        embed: { id: 'embed3' },
        stableKey: 'same-dashboard-state',
        minEditIntervalMs: 300000
    });
    assert.strictEqual(throttled.updated, true);
    fakeNowMs += 60000;
    const skipped = await service.upsertStatusMessage(editChannel, {
        statusMessageId: 'existing',
        embed: { id: 'embed4' },
        stableKey: 'same-dashboard-state',
        minEditIntervalMs: 300000
    });
    assert.strictEqual(skipped.skipped, true);
    assert.deepStrictEqual(editCalls, [
        'fetch-id:existing',
        'edit:embed2',
        'fetch-id:existing',
        'edit:embed3',
        'fetch-id:existing'
    ]);
    fakeNowMs += 300000;
    const afterThrottle = await service.upsertStatusMessage(editChannel, {
        statusMessageId: 'existing',
        embed: { id: 'embed5' },
        stableKey: 'same-dashboard-state',
        minEditIntervalMs: 300000
    });
    assert.strictEqual(afterThrottle.updated, true);

    const { channel: stableKeyChannel, calls: stableKeyCalls } = createChannel();
    const firstStable = await service.upsertStatusMessage(stableKeyChannel, {
        statusMessageId: 'existing',
        embed: { id: 'embed6' },
        stableKey: 'dashboard-v3'
    });
    assert.strictEqual(firstStable.updated, true);
    const skippedStable = await service.upsertStatusMessage(stableKeyChannel, {
        statusMessageId: 'existing',
        embed: { id: 'embed7' },
        stableKey: 'dashboard-v3'
    });
    assert.strictEqual(skippedStable.skipped, true);
    assert.strictEqual(skippedStable.updated, false);
    const forcedStable = await service.upsertStatusMessage(stableKeyChannel, {
        statusMessageId: 'existing',
        embed: { id: 'embed8' },
        stableKey: 'dashboard-v3',
        forceEdit: true
    });
    assert.strictEqual(forcedStable.updated, true);
    assert.deepStrictEqual(stableKeyCalls, [
        'fetch-id:existing',
        'edit:embed6',
        'fetch-id:existing',
        'fetch-id:existing',
        'edit:embed8'
    ]);

    const { channel: failedEditChannel } = createChannel({ editFails: true });
    const failedEdit = await service.upsertStatusMessage(failedEditChannel, {
        statusMessageId: 'existing',
        embed: { id: 'embed3' }
    });
    assert.strictEqual(failedEdit.statusMessageId, 'existing');
    assert.strictEqual(failedEdit.updated, false);

    const { channel: failedFindChannel } = createChannel({ listFetchFails: true });
    const missing = await service.findExistingStatusMessage(failedFindChannel);
    assert.strictEqual(missing, null);
    assert.match(logs[0], /^\[MSG FIND ERROR\]:list failed$/);

    const lazyClientService = createDashboardMessageService({ client: {} });
    const { channel: lazyChannel, calls: lazyCalls } = createChannel();
    assert.strictEqual(await lazyClientService.findExistingStatusMessage(lazyChannel), null);
    assert.deepStrictEqual(lazyCalls, []);

    assert.throws(() => createDashboardMessageService({}), /client must be provided/);

    console.log('dashboard-message-service tests passed');
})().catch(error => {
    console.error(error);
    process.exit(1);
});
