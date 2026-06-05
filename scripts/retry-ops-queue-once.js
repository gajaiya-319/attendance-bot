'use strict';

const { google } = require('googleapis');
const { CONFIG } = require('../src/config/constants');
const { createPurchaseSheetService } = require('../src/services/purchaseSheetService');
const { createOpsQueueService } = require('../src/services/opsQueueService');

const purchaseSheetService = createPurchaseSheetService({
    google,
    keyFile: CONFIG.PURCHASE_GOOGLE_KEY_FILE,
    spreadsheetId: CONFIG.PURCHASE_SPREADSHEET_ID,
    serverTabs: CONFIG.PURCHASE_SERVER_TABS,
    sectionLabels: CONFIG.PURCHASE_SECTION_LABELS,
    sheetNameAliases: CONFIG.SHEET_NAME_ALIASES
});

const opsQueueService = createOpsQueueService({
    filePath: CONFIG.FILES.OPS_PENDING
});

async function retryItem(item) {
    if (item.kind === 'end-adena') {
        return item.method === 'addAdenaWithSummary'
            ? purchaseSheetService.addAdenaWithSummary(item.payload)
            : purchaseSheetService.addAdena(item.payload);
    }
    if (item.kind === 'death-penalty' || item.kind === 'purchase') {
        return purchaseSheetService.addPurchase(item.payload);
    }
    return { ok: false, code: 'unknown-kind' };
}

(async () => {
    const result = await opsQueueService.retryAll(retryItem);
    console.log(JSON.stringify(result, null, 2));
})().catch(error => {
    console.error(error);
    process.exit(1);
});
