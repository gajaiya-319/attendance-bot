'use strict';

const SERVER_LABELS = {
    HEINE: '\uBC1C\uB77C\uCE74\uC2A4',
    PAAGRIO: '\uD30C\uC544\uADF8\uB9AC\uC624'
};

const PLAYER_HEADER_ROW_INDEX = 6;
const TOTAL_COLUMN_INDEX = 12;
const MIN_ADENA_CELL = 1000;

function parseNumber(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    const parsed = Number.parseFloat(String(value || '0').replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : 0;
}

function columnIndexToLetter(index) {
    let n = index + 1;
    let letters = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        letters = String.fromCharCode(65 + rem) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}

function cellText(row, index) {
    return String(row?.[index] ?? '').trim();
}

function isNonPlayerHeaderLabel(label) {
    const text = String(label || '').trim().toLowerCase();
    if (!text) return true;
    return text === 'day'
        || text === 'night'
        || text === 'bonus'
        || text === 'd&c'
        || text === 'ot'
        || text === 'note'
        || /^day\s*time$/i.test(text)
        || /^night\s*time$/i.test(text);
}

function findRowIndexes(rows, matcher) {
    const hits = [];
    for (let r = 0; r < rows.length; r += 1) {
        const left = `${cellText(rows[r], 0)} ${cellText(rows[r], 1)}`.trim();
        if (matcher(left, rows[r], r)) hits.push(r);
    }
    return hits;
}

function pruneRollupColumns(rows, labelRowIndexes, playerCols) {
    if (!labelRowIndexes.length || playerCols.length < 2) return playerCols;

    const hasNearbyPlayerHeader = col => {
        const header = rows[PLAYER_HEADER_ROW_INDEX] || [];
        for (const offset of [0, -1, -2]) {
            const label = cellText(header, col + offset);
            if (label && !isNonPlayerHeaderLabel(label)) return true;
        }
        return false;
    };

    return playerCols.filter(col => {
        if (hasNearbyPlayerHeader(col)) return true;

        let comparedRows = 0;
        let rollupMatches = 0;
        for (const rowIndex of labelRowIndexes) {
            const row = rows[rowIndex];
            const value = parseNumber(row?.[col]);
            if (!value) continue;
            const otherValues = playerCols
                .filter(otherCol => otherCol !== col)
                .map(otherCol => parseNumber(row?.[otherCol]))
                .filter(Boolean);
            const otherSum = otherValues.reduce((sum, otherValue) => sum + otherValue, 0);
            comparedRows += 1;
            if (otherValues.length >= 2 && otherSum > 0 && Math.abs(value - otherSum) < 1) {
                rollupMatches += 1;
            }
        }

        if (comparedRows > 0 && rollupMatches === comparedRows) return false;
        return true;
    });
}

function discoverPlayerAdenaColumnIndices(rows) {
    const adenaRows = findRowIndexes(rows, text => /total\s*gain\s*adena/i.test(text));
    const fromAdenaRow = new Set();

    for (const rowIndex of adenaRows) {
        const row = rows[rowIndex];
        if (!row) continue;
        for (let col = 0; col < row.length; col += 1) {
            const value = parseNumber(row[col]);
            if (value >= MIN_ADENA_CELL) fromAdenaRow.add(col);
        }
    }

    let cols = [...fromAdenaRow].sort((a, b) => a - b);
    if (adenaRows.length) {
        cols = pruneRollupColumns(rows, adenaRows, cols);
    }

    if (cols.length) return cols;

    const header = rows[PLAYER_HEADER_ROW_INDEX] || [];
    const fromHeader = [];
    for (let col = 0; col < header.length; col += 1) {
        const label = cellText(header, col);
        if (isNonPlayerHeaderLabel(label)) continue;
        fromHeader.push(col);
    }
    if (fromHeader.length && adenaRows.length) {
        return pruneRollupColumns(rows, adenaRows, fromHeader);
    }
    if (fromHeader.length) return fromHeader;

    return [TOTAL_COLUMN_INDEX];
}

function playerAdenaColumnLetters(rows) {
    return discoverPlayerAdenaColumnIndices(rows).map(columnIndexToLetter);
}

function sumLabelRowNumericCells(row, playerCols) {
    if (!row || !playerCols.length) return 0;

    let sum = 0;
    for (const col of playerCols) {
        const value = row[col];
        if (typeof value === 'number' && Number.isFinite(value)) {
            sum += value;
            continue;
        }
        const text = String(value ?? '').trim();
        if (text && /^[\d,.\s]+$/.test(text)) sum += parseNumber(value);
    }

    if (!sum) {
        sum = parseNumber(row[TOTAL_COLUMN_INDEX]);
    }
    return sum;
}

function sumAcrossPlayerColumns(rows, rowIndexes, playerCols) {
    let sum = 0;
    for (const rowIndex of rowIndexes) {
        sum += sumLabelRowNumericCells(rows[rowIndex], playerCols);
    }
    return sum;
}

function parseGreatTabPayrollRows(rows, serverLabel, options = {}) {
    if (!Array.isArray(rows) || rows.length < 20) {
        return { ok: false, code: 'tab-too-short' };
    }

    const playerCols = discoverPlayerAdenaColumnIndices(rows);
    if (!playerCols.length) {
        return { ok: false, code: 'no-player-columns' };
    }

    const totalAdena = sumAcrossPlayerColumns(rows, findRowIndexes(rows, text => /total\s*gain\s*adena/i.test(text)), playerCols);
    const grossSalary = sumAcrossPlayerColumns(rows, findRowIndexes(rows, (text, row) => {
        const a = cellText(row, 0).toUpperCase();
        const b = cellText(row, 1).toUpperCase();
        return a === 'TOTAL' || b === 'TOTAL';
    }), playerCols);
    const txFee = sumAcrossPlayerColumns(rows, findRowIndexes(rows, (text, row) => {
        const a = cellText(row, 0);
        const b = cellText(row, 1);
        return /^5%$/i.test(a) || /^5%$/i.test(b) || /tx\s*fee/i.test(text);
    }), playerCols);
    const playerShare = sumAcrossPlayerColumns(rows, findRowIndexes(rows, (text, row) => {
        const a = cellText(row, 0);
        const b = cellText(row, 1);
        return /^0\.(?:65|70)$/i.test(a) || /^0\.(?:65|70)$/i.test(b) || /^player$/i.test(a) || /^player$/i.test(b);
    }), playerCols);
    const ownerShare = sumAcrossPlayerColumns(rows, findRowIndexes(rows, (text, row) => {
        const a = cellText(row, 0);
        const b = cellText(row, 1);
        return /^0\.(?:35|30)$/i.test(a) || /^0\.(?:35|30)$/i.test(b) || /^owner$/i.test(a) || /^owner$/i.test(b);
    }), playerCols);
    const totalPeso = sumAcrossPlayerColumns(rows, findRowIndexes(rows, text => /expected\s*peso/i.test(text)), playerCols);

    if (!totalAdena && !grossSalary && !playerShare && !ownerShare && !options.allowEmptyTotals) {
        return { ok: false, code: 'no-payroll-totals' };
    }

    return {
        ok: true,
        row: {
            server: serverLabel,
            totalAdena,
            grossSalary,
            txFee,
            playerShare,
            ownerShare,
            totalPeso
        },
        playerColumns: playerCols.map(columnIndexToLetter)
    };
}

module.exports = {
    SERVER_LABELS,
    PLAYER_HEADER_ROW_INDEX,
    TOTAL_COLUMN_INDEX,
    MIN_ADENA_CELL,
    parseNumber,
    columnIndexToLetter,
    discoverPlayerAdenaColumnIndices,
    playerAdenaColumnLetters,
    sumLabelRowNumericCells,
    sumAcrossPlayerColumns,
    parseGreatTabPayrollRows
};
