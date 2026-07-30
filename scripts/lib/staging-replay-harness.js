'use strict';

const { createPurchaseSheetService, parseNumber } = require('../../src/services/purchaseSheetService');

function createPayrollRows() {
    const rows = [
        ['Great Team (Day Time)'],
        [],
        ['Day', '', 'Ryuji', 'BONUS', 'D&C', 'Gab', 'BONUS', 'D&C'],
        ['31', 'Day Time', '', '', '1000', '', '', ''],
        ['1', 'Day Time', '', '', '', '', '', '2000'],
        ['Great Team (Night Time)'],
        ['Night', '', 'Daba', 'BONUS', 'D&C', 'Gab', 'BONUS', 'D&C'],
        ['31', 'Night Time', '', '', '', '', '', '3000'],
        ['1', 'Night Time', '', '', '4000', '', '', ''],
        [],
        [],
        ['', 'Day Time', '', '', '', 'Night Time', '', '', 'Player', 'P', '', 'Adena', '', 'Gain Adena', '', '', 'Player', 'P', '', 'Adena', '', 'Gain Adena'],
        ['', '', '', '', '', '', '', '', 'Ryuji', '', '', '250000', '', '=N59', '', '', 'Daba', '', '', '230000', '', '=V59'],
        ['', '', '', '', '', '', '', '', 'Gab', '', '', '0', '', '=N60', '', '', 'Gab', '', '', '261000', '', '=V60'],
        ['', '', '', '', '', '', '', '', 'Total', '0', '', '=SUM(L59:L60)', '', '=SUM(N59:N60)', '', '', 'Total', '0', '', '=SUM(T59:T60)', '', '=SUM(V59:V60)']
    ];
    return rows;
}

function columnIndex(column) {
    return String(column || '').split('').reduce((value, char) => value * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

function parseSingleCell(range) {
    const cell = String(range || '').split('!').pop();
    const match = cell.match(/^([A-Z]+)(\d+)$/i);
    if (!match) return null;
    return { rowIndex: Number(match[2]) - 1, colIndex: columnIndex(match[1].toUpperCase()) };
}

function cloneRows(rows) {
    return rows.map(row => [...row]);
}

function createInMemoryGoogle(rows, requestStats) {
    function readCell(range) {
        const cell = parseSingleCell(range);
        if (!cell) throw new Error(`Unsupported staging range: ${range}`);
        return rows[cell.rowIndex]?.[cell.colIndex] ?? '';
    }

    function writeCell(range, value) {
        const cell = parseSingleCell(range);
        if (!cell) throw new Error(`Unsupported staging range: ${range}`);
        if (!rows[cell.rowIndex]) rows[cell.rowIndex] = [];
        rows[cell.rowIndex][cell.colIndex] = value;
    }

    return {
        auth: { GoogleAuth: class {} },
        sheets: () => ({
            spreadsheets: {
                values: {
                    get: async request => {
                        requestStats.getRequests += 1;
                        if (String(request.range).includes(':')) return { data: { values: cloneRows(rows) } };
                        return { data: { values: [[readCell(request.range)]] } };
                    },
                    update: async request => {
                        requestStats.updateRequests += 1;
                        writeCell(request.range, request.requestBody.values[0][0]);
                        return {};
                    },
                    batchUpdate: async request => {
                        requestStats.batchUpdateRequests += 1;
                        for (const item of request.requestBody.data || []) writeCell(item.range, item.values[0][0]);
                        return {};
                    }
                }
            }
        }),
        readCell
    };
}

function createStagingPayrollHarness() {
    const rows = createPayrollRows();
    const operations = [];
    const requestStats = { getRequests: 0, updateRequests: 0, batchUpdateRequests: 0 };
    const google = createInMemoryGoogle(rows, requestStats);
    const operationLog = {
        listRecent: async () => operations,
        record: async input => {
            const entry = {
                ...input,
                action: input.action || (input.payload?.amount < 0 || input.payload?.rawAmount < 0 ? 'cancel' : 'approve'),
                messageId: input.messageId || input.payload?.messageId || null,
                status: input.status || input.result?.status || null
            };
            operations.push(entry);
            return entry;
        }
    };
    const service = createPurchaseSheetService({
        google,
        keyFile: 'staging-memory-only.json',
        spreadsheetId: 'staging-memory-only',
        serverTabs: { PAAGRIO: 'Paagrio Great' },
        sectionLabels: { DAY: 'Day', NIGHT: 'Night' },
        operationLog,
        logger: { warn: () => {}, error: () => {} }
    });

    async function apply(event) {
        if (event.type !== 'payroll-mutation') throw new Error(`Unsupported staging payroll event: ${event.type}`);
        const payload = { ...event.payload };
        if (event.kind === 'end-adena') return service.addAdenaWithSummary(payload);
        return service.addPurchase({ ...payload, payrollKind: event.kind || 'purchase' });
    }

    function snapshot(results = [], expectedCells = {}) {
        const cells = {};
        for (const cell of Object.keys(expectedCells)) cells[cell] = parseNumber(google.readCell(cell));
        return {
            cells,
            successfulOperations: operations.filter(entry => entry.status === 'success' || entry.result?.ok === true).length,
            duplicateResults: results.filter(result => result?.duplicate === true).length,
            ...requestStats
        };
    }

    return { apply, snapshot };
}

module.exports = {
    createPayrollRows,
    createStagingPayrollHarness,
    parseSingleCell
};
