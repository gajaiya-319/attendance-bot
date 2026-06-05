// Google Apps Script for Raw_Attendance + payroll (Work list workbook).
// Deploy web app after edits. First-time payroll layout: run migratePayrollToNewLayout (not createPerfectPayrollSheets).

const RAW_ATTENDANCE_SHEET_NAME = 'Raw_Attendance';
const RAW_ATTENDANCE_HEADERS = [
  '\uB0A0\uC9DC',
  '\uC11C\uBC84',
  '\uADFC\uBB34\uC870',
  '\uC774\uB984',
  '\uC0C1\uD0DC',
  '\uCD9C\uADFC\uC2DC\uAC04',
  '\uD1F4\uADFC\uC2DC\uAC04',
  '\uBE44\uACE0',
  '\uD0A4',
  '\uC218\uC815\uC2DC\uAC04'
];
const CURRENT_WORKERS_SHEET_NAME = 'Current_Workers';
const CURRENT_WORKERS_HEADERS = [
  '\uC774\uB984',
  '\uC11C\uBC84',
  '\uADFC\uBB34\uC870',
  '\uD0A4',
  '\uC218\uC815\uC2DC\uAC04'
];
const PAYROLL_PAAGRIO_TAB = 'Paagrio Great';
const PAYROLL_HEINE_TAB = 'Heine Great';
const MIRROR_PAAGRIO_TAB = '_Great_Paagrio_Mirror';
const MIRROR_HEINE_TAB = '_Great_Heine_Mirror';
/** Work list ID — Paagrio/Heine Great live here when payroll summary is a separate workbook. */
const PAYROLL_GREAT_SPREADSHEET_ID_DEFAULT = '1oScjqyvV0EHZffLYxZL4fI_pLVr7R2ABvLv7n-_gJTk';
const RAW_DATA_SHEET_NAME = 'Raw_Data';
const RECENT_THREE_DAY_SUMMARY_SHEET = '\uCD5C\uADFC_3\uC77C_\uC694\uC57D';
const MONTHLY_SUMMARY_SHEET = '\uC6D4\uAC04_\uB204\uC801_\uC694\uC57D';
const PAYROLL_TOTAL_COLUMN = 12;

function doGet(e) {
  try {
    const params = e && e.parameter ? e.parameter : {};
    if (params.api === 'raw' || params.format === 'json') {
      return json_(getRawAttendanceRows());
    }

    return HtmlService
      .createHtmlOutputFromFile('AttendanceDashboard')
      .setTitle('\uCD9C\uACB0\uAD00\uB9AC')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (error) {
    return json_({ success: false, error: String(error && error.message ? error.message : error) });
  }
}

function getRawAttendanceRows() {
  return getRawAttendanceRows_();
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    const params = JSON.parse(e.postData.contents || '{}');
    if (params.mode === 'profile' || params.mode === 'workerProfile') {
      return upsertCurrentWorkerProfile_(params);
    }
    if (params.mode === 'removeProfile' || params.mode === 'workerProfileRemove') {
      return removeCurrentWorkerProfile_(params);
    }
    if (params.mode === 'payroll-sync' || params.mode === 'appendPayroll') {
      return syncPayrollFromGreatTabs_(params);
    }
    if (params.mode === 'migrate-payroll-layout' || params.mode === 'migratePayroll') {
      return json_(migratePayrollToNewLayout(params));
    }
    if (params.mode === 'import-legacy-3day' || params.mode === 'importLegacyThreeDay') {
      return json_(importLegacyThreeDayToRawData_(params));
    }
    if (params.mode === 'enable-live-3day-summary' || params.mode === 'enableLiveThreeDaySummary') {
      return json_(enableLiveThreeDaySummary());
    }

    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RAW_ATTENDANCE_SHEET_NAME);
    if (!sheet) throw new Error('Raw_Attendance sheet not found');
    ensureRawAttendanceHeaders_(sheet);

    const key = params.key || makeRawAttendanceKey_(params);
    const rowNumber = findRawAttendanceRow_(sheet, key);
    const previousStatus = rowNumber ? clean_(sheet.getRange(rowNumber, 5).getValue()) : '';
    const nextStatus = clean_(params.status);

    const rowValues = [
      clean_(params.date),
      clean_(params.server).toUpperCase(),
      clean_(params.shift).toUpperCase(),
      clean_(params.name, 'Unknown'),
      chooseFinalStatus_(previousStatus, nextStatus, params.forceStatus === true),
      chooseFinalInTime_(sheet, rowNumber, clean_(params.inTime)),
      clean_(params.outTime),
      mergeNote_(sheet, key, clean_(params.note)),
      key,
      new Date()
    ];

    if (rowNumber) {
      sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
      return json_({ success: true, mode: 'updated', row: rowNumber, key: key });
    }

    sheet.appendRow(rowValues);
    return json_({ success: true, mode: 'created', row: sheet.getLastRow(), key: key });
  } catch (error) {
    return json_({ success: false, error: String(error && error.message ? error.message : error) });
  } finally {
    lock.releaseLock();
  }
}

function archiveAndResetRawAttendance() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RAW_ATTENDANCE_SHEET_NAME);
  if (!sheet) {
    const fresh = ss.insertSheet(RAW_ATTENDANCE_SHEET_NAME);
    setupRawAttendanceSheet_(fresh);
    return json_({ success: true, mode: 'created-empty' });
  }

  const tz = Session.getScriptTimeZone() || 'Asia/Manila';
  const archiveBase = Utilities.formatDate(new Date(), tz, 'yyyy\uB144MM\uC6D4') + '_\uB9C8\uAC10';
  const archiveName = uniqueSheetName_(ss, archiveBase);
  sheet.setName(archiveName);

  const fresh = ss.insertSheet(RAW_ATTENDANCE_SHEET_NAME, sheet.getIndex() + 1);
  setupRawAttendanceSheet_(fresh);
  return json_({ success: true, mode: 'archived-reset', archiveName: archiveName });
}

function resetRawAttendanceOnly() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RAW_ATTENDANCE_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(RAW_ATTENDANCE_SHEET_NAME);
  sheet.clear();
  setupRawAttendanceSheet_(sheet);
  return json_({ success: true, mode: 'reset-only' });
}

function getRawAttendanceRows_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RAW_ATTENDANCE_SHEET_NAME);
  if (!sheet) return [];

  ensureRawAttendanceHeaders_(sheet);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const profiles = getCurrentWorkerProfiles_();
  const headers = values[0].map(function(header) { return clean_(header, ''); });
  return values.slice(1)
    .filter(function(row) {
      const attendanceCells = row.slice(0, RAW_ATTENDANCE_HEADERS.length);
      return attendanceCells.some(function(cell) { return clean_(cell, '') !== ''; });
    })
    .map(function(row) {
      const item = {};
      headers.forEach(function(header, index) {
        item[header] = formatCellForJson_(row[index]);
      });
      const name = canonicalName_(item['\uC774\uB984']);
      const hasIdentity = name && name !== 'Unknown';
      const hasAttendanceScope = clean_(item['\uC11C\uBC84'], '') && clean_(item['\uADFC\uBB34\uC870'], '');
      const hasAttendanceFact = clean_(item['\uB0A0\uC9DC'], '') || clean_(item['\uC0C1\uD0DC'], '') || clean_(item['\uD0A4'], '');
      if (!hasIdentity && !hasAttendanceScope && !hasAttendanceFact) return null;
      const profile = profiles[name.toLowerCase()];
      item['\uC774\uB984'] = name;
      if (profile) {
        item['\uC11C\uBC84'] = profile.server || item['\uC11C\uBC84'];
        item['\uADFC\uBB34\uC870'] = profile.shift || item['\uADFC\uBB34\uC870'];
        item.currentProfileApplied = true;
      }
      item.statusNormalized = normalizeStatus_(item['\uC0C1\uD0DC']);
      return item;
    })
    .filter(Boolean);
}

function getCurrentWorkerProfiles_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CURRENT_WORKERS_SHEET_NAME);
  if (!sheet) return {};

  ensureCurrentWorkersHeaders_(sheet);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};

  return values.slice(1).reduce(function(map, row) {
    const name = canonicalName_(row[0]);
    if (!name || name === 'Unknown') return map;
    map[name.toLowerCase()] = {
      name: name,
      server: clean_(row[1], '').toUpperCase(),
      shift: clean_(row[2], '').toUpperCase(),
      updatedAt: formatCellForJson_(row[4])
    };
    return map;
  }, {});
}

function setupRawAttendanceSheet_(sheet) {
  sheet.getRange(1, 1, 1, RAW_ATTENDANCE_HEADERS.length).setValues([RAW_ATTENDANCE_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, RAW_ATTENDANCE_HEADERS.length)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.hideColumns(9);
}

function setupCurrentWorkersSheet_(sheet) {
  sheet.getRange(1, 1, 1, CURRENT_WORKERS_HEADERS.length).setValues([CURRENT_WORKERS_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, CURRENT_WORKERS_HEADERS.length)
    .setFontWeight('bold')
    .setHorizontalAlignment('center');
  sheet.hideColumns(4);
}

function uniqueSheetName_(ss, baseName) {
  if (!ss.getSheetByName(baseName)) return baseName;
  let index = 2;
  while (ss.getSheetByName(baseName + '_' + index)) index += 1;
  return baseName + '_' + index;
}

function ensureRawAttendanceHeaders_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, RAW_ATTENDANCE_HEADERS.length).getValues()[0];
  const hasHeader = firstRow[0] === RAW_ATTENDANCE_HEADERS[0] && firstRow[8] === RAW_ATTENDANCE_HEADERS[8];
  if (!hasHeader) setupRawAttendanceSheet_(sheet);
}

function ensureCurrentWorkersHeaders_(sheet) {
  const firstRow = sheet.getRange(1, 1, 1, CURRENT_WORKERS_HEADERS.length).getValues()[0];
  const hasHeader = firstRow[0] === CURRENT_WORKERS_HEADERS[0] && firstRow[3] === CURRENT_WORKERS_HEADERS[3];
  if (!hasHeader) setupCurrentWorkersSheet_(sheet);
}

function getCurrentWorkersSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CURRENT_WORKERS_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CURRENT_WORKERS_SHEET_NAME);
    setupCurrentWorkersSheet_(sheet);
  } else {
    ensureCurrentWorkersHeaders_(sheet);
  }
  return sheet;
}

function findCurrentWorkerRow_(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const keys = sheet.getRange(2, 4, lastRow - 1, 1).getValues();
  for (let i = 0; i < keys.length; i += 1) {
    if (String(keys[i][0]) === String(key)) return i + 2;
  }
  return null;
}

function upsertCurrentWorkerProfile_(params) {
  const sheet = getCurrentWorkersSheet_();
  const name = canonicalName_(params.name || 'Unknown');
  const key = makeCurrentWorkerKey_(params);
  const rowNumber = findCurrentWorkerRow_(sheet, key);
  const rowValues = [
    name,
    clean_(params.server, '').toUpperCase(),
    clean_(params.shift, '').toUpperCase(),
    key,
    new Date()
  ];

  if (rowNumber) {
    sheet.getRange(rowNumber, 1, 1, rowValues.length).setValues([rowValues]);
    return json_({ success: true, mode: 'profile-updated', row: rowNumber, key: key });
  }

  sheet.appendRow(rowValues);
  return json_({ success: true, mode: 'profile-created', row: sheet.getLastRow(), key: key });
}

function removeCurrentWorkerProfile_(params) {
  const sheet = getCurrentWorkersSheet_();
  const key = makeCurrentWorkerKey_(params);
  const rowNumber = findCurrentWorkerRow_(sheet, key);
  if (!rowNumber) return json_({ success: true, mode: 'profile-not-found', key: key });
  sheet.deleteRow(rowNumber);
  return json_({ success: true, mode: 'profile-removed', key: key });
}

function findRawAttendanceRow_(sheet, key) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;

  const keys = sheet.getRange(2, 9, lastRow - 1, 1).getValues();
  for (let i = 0; i < keys.length; i += 1) {
    if (String(keys[i][0]) === String(key)) return i + 2;
  }
  return null;
}

function chooseFinalInTime_(sheet, rowNumber, nextInTime) {
  if (!rowNumber) return nextInTime;
  const previousInTime = clean_(sheet.getRange(rowNumber, 6).getValue());
  if (previousInTime && previousInTime !== '-' && (!nextInTime || nextInTime === '-')) {
    return previousInTime;
  }
  return nextInTime;
}

function mergeNote_(sheet, key, nextNote) {
  const note = clean_(nextNote);
  const rowNumber = findRawAttendanceRow_(sheet, key);
  if (!rowNumber) return note;

  const previousNote = clean_(sheet.getRange(rowNumber, 8).getValue());
  if (!previousNote || previousNote === '-') return note;
  if (!note || note === '-' || previousNote.includes(note)) return previousNote;
  return previousNote + ' / ' + note;
}

function chooseFinalStatus_(previousStatus, nextStatus, forceStatus) {
  const previous = normalizeStatus_(previousStatus);
  const next = normalizeStatus_(nextStatus);
  if (forceStatus) return next;
  if (!previous || previous === '-') return next;
  if (!next || next === '-') return previous;
  return statusRank_(next) >= statusRank_(previous) ? next : previous;
}

function normalizeStatus_(status) {
  const text = clean_(status);
  const map = {
    normal: '\uC815\uCD9C',
    on_time: '\uC815\uCD9C',
    ontime: '\uC815\uCD9C',
    clock_in: '\uC815\uCD9C',
    '\uC815': '\uC815\uCD9C',
    late: '\uC9C0\uAC01',
    '\uC9C0': '\uC9C0\uAC01',
    absent: '\uACB0\uC11D',
    '\uACB0': '\uACB0\uC11D',
    early: '\uC870\uD1F4',
    early_out: '\uC870\uD1F4',
    '\uC870': '\uC870\uD1F4',
    overtime: '\uC5F0\uC7A5\uADFC\uBB34',
    ot: '\uC5F0\uC7A5\uADFC\uBB34',
    '\uC5F0': '\uC5F0\uC7A5\uADFC\uBB34',
    day_off: '\uD734\uBB34',
    off: '\uD734\uBB34',
    '\uD734': '\uD734\uBB34'
  };
  return map[text.toLowerCase()] || text;
}

function statusRank_(status) {
  const ranks = {
    '\uD734\uBB34': 5,
    '\uC815\uCD9C': 10,
    '\uC5F0\uC7A5\uADFC\uBB34': 20,
    '\uC9C0\uAC01': 30,
    '\uACB0\uC11D': 40,
    '\uC870\uD1F4': 50
  };
  return ranks[normalizeStatus_(status)] || 0;
}

function makeRawAttendanceKey_(params) {
  return [
    clean_(params.date).toLowerCase(),
    clean_(params.server).toUpperCase(),
    clean_(params.shift).toUpperCase(),
    canonicalName_(params.name || 'Unknown').toLowerCase()
  ].join('|');
}

function makeCurrentWorkerKey_(params) {
  return canonicalName_(params.name || 'Unknown').toLowerCase();
}

function canonicalName_(value) {
  const name = clean_(value, 'Unknown')
    .replace(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:[PH]\s*)?(?:Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i, ' ')
    .replace(/\s*[-\u2013\u2014]\s*(?:(?:Great\s*)?(?:Manager|Trainee|Traine)\s+)?(?:Heine|Paagrio)\s*(?:Day|Night)\s*Time(?:\s*\([^)]*\))?(?:\s+.*)?$/i, ' ')
    .replace(/\s*[-\u2013\u2014]\s*(?:Great\s*)?(?:Manager|Trainee|Guest)(?:\s+.*)?$/i, ' ')
    .replace(/\(\s*(?:over\s*time|overtime|ot)\s*\)/gi, ' ')
    .replace(/\b(?:over\s*time|overtime|ot)\b/gi, ' ')
    .replace(/ding\s*[-\u2013\u2014]\s*dong/gi, 'Ding dong')
    .replace(/\s+/g, ' ')
    .trim() || 'Unknown';
  const aliases = {
    ding: 'Ding dong',
    'ding-dong': 'Ding dong',
    'ding dong': 'Ding dong',
    shijiro: 'Shiijiro'
  };
  return aliases[name.toLowerCase()] || name;
}

function clean_(value, fallback) {
  const text = String(value == null ? '' : value).trim();
  return text || fallback || '-';
}

function formatCellForJson_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss');
  }
  return value == null ? '' : value;
}

function json_(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseSheetNumber_(value) {
  const parsed = Number.parseFloat(String(value == null ? '' : value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function findPayrollRowIndexes_(rows, matcher) {
  const hits = [];
  for (let r = 0; r < rows.length; r += 1) {
    const left = (clean_(rows[r][0], '') + ' ' + clean_(rows[r][1], '')).trim();
    if (matcher(left, rows[r], r)) hits.push(r);
  }
  return hits;
}

function sumPayrollColumn_(rows, rowIndexes, columnIndex) {
  const columns = columnIndex === PAYROLL_TOTAL_COLUMN ? [12, 2] : [columnIndex];
  for (let c = 0; c < columns.length; c += 1) {
    let sum = 0;
    for (let i = 0; i < rowIndexes.length; i += 1) {
      sum += parseSheetNumber_(rows[rowIndexes[i]][columns[c]]);
    }
    if (sum) return sum;
  }
  return 0;
}

function readGreatTabPayroll_(rows, serverLabel) {
  const totalAdena = sumPayrollColumn_(rows, findPayrollRowIndexes_(rows, function(text) {
    return /total\s*gain\s*adena/i.test(text);
  }), PAYROLL_TOTAL_COLUMN);
  const grossSalary = sumPayrollColumn_(rows, findPayrollRowIndexes_(rows, function(text, row) {
    const a = clean_(row[0], '').toUpperCase();
    const b = clean_(row[1], '').toUpperCase();
    return a === 'TOTAL' || b === 'TOTAL';
  }), PAYROLL_TOTAL_COLUMN);
  const txFee = sumPayrollColumn_(rows, findPayrollRowIndexes_(rows, function(text, row) {
    const a = clean_(row[0], '');
    const b = clean_(row[1], '');
    return /^5%$/i.test(a) || /^5%$/i.test(b) || /tx\s*fee/i.test(text);
  }), PAYROLL_TOTAL_COLUMN);
  const playerShare = sumPayrollColumn_(rows, findPayrollRowIndexes_(rows, function(text, row) {
    const a = clean_(row[0], '');
    const b = clean_(row[1], '');
    return /^0\.65$/i.test(a) || /^0\.65$/i.test(b) || /^player$/i.test(a) || /^player$/i.test(b);
  }), PAYROLL_TOTAL_COLUMN);
  const ownerShare = sumPayrollColumn_(rows, findPayrollRowIndexes_(rows, function(text, row) {
    const a = clean_(row[0], '');
    const b = clean_(row[1], '');
    return /^0\.35$/i.test(a) || /^0\.35$/i.test(b) || /^owner$/i.test(a) || /^owner$/i.test(b);
  }), PAYROLL_TOTAL_COLUMN);
  const totalPeso = sumPayrollColumn_(rows, findPayrollRowIndexes_(rows, function(text) {
    return /expected\s*peso/i.test(text);
  }), PAYROLL_TOTAL_COLUMN);

  return {
    server: serverLabel,
    totalAdena: totalAdena,
    grossSalary: grossSalary,
    txFee: txFee,
    playerShare: playerShare,
    ownerShare: ownerShare,
    totalPeso: totalPeso
  };
}

function ensureRawDataSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RAW_DATA_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(RAW_DATA_SHEET_NAME);
  const header = sheet.getRange(1, 1, 1, 10).getValues()[0];
  if (clean_(header[0], '') !== '\uC800\uC7A5\uC77C\uC2DC') {
    sheet.getRange(1, 1, 1, 10).setValues([[
      '\uC800\uC7A5\uC77C\uC2DC',
      '\uD68C\uCC28',
      '\uC11C\uBC84',
      '\uCD1D \uD68D\uB4DD \uC544\uB370\uB098',
      '\uCD1D \uAE09\uC5EC',
      '\uC218\uC218\uB8CC 5%',
      '\uC9C1\uC6D0 65%',
      '\uC624\uB108 35%',
      '\uCD1D \uD398\uC18C',
      '\uC800\uC7A5\uC790'
    ]]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function syncPayrollFromGreatTabs_(params) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const specs = [
    { tab: PAYROLL_PAAGRIO_TAB, server: '\uD30C\uC544\uADF8\uB9AC\uC624' },
    { tab: PAYROLL_HEINE_TAB, server: '\uD558\uC774\uB124' }
  ];
  const snapshots = [];

  for (let i = 0; i < specs.length; i += 1) {
    const sheet = ss.getSheetByName(specs[i].tab);
    if (!sheet) {
      return json_({ success: false, error: 'Missing tab: ' + specs[i].tab });
    }
    const rows = sheet.getDataRange().getValues();
    snapshots.push(readGreatTabPayroll_(rows, specs[i].server));
  }

  const rawSheet = ensureRawDataSheet_();
  const tz = Session.getScriptTimeZone() || 'Asia/Manila';
  const timestamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const periodLabel = clean_(params.periodLabel || params.period || '', '') || ('\uD68C\uCC28 ' + Math.max(1, rawSheet.getLastRow()));
  const savedBy = clean_(params.savedBy, 'Apps Script');

  const values = snapshots.map(function(row) {
    return [
      timestamp,
      periodLabel,
      row.server,
      row.totalAdena,
      row.grossSalary,
      row.txFee,
      row.playerShare,
      row.ownerShare,
      row.totalPeso,
      savedBy
    ];
  });

  const startRow = rawSheet.getLastRow() + 1;
  rawSheet.getRange(startRow, 1, startRow + values.length - 1, 10).setValues(values);
  return json_({
    success: true,
    mode: 'payroll-sync',
    sheet: RAW_DATA_SHEET_NAME,
    row: rawSheet.getLastRow() - values.length + 1,
    count: values.length,
    snapshots: snapshots
  });
}

const LEGACY_PAYROLL_SHEETS = [
  '\uC804\uCCB4 \uC694\uC57D',
  '\uD30C\uC544\uADF8\uB9AC\uC624 3\uC77C\uC815\uC0B0',
  '\uD558\uC774\uB124 3\uC77C\uC815\uC0B0',
  '\uC6D4\uAC04 \uAE30\uB85D',
  'Total Summary',
  'Paagrio 3-Day',
  'Heine 3-Day'
];

const LEGACY_THREE_DAY_TAB_SPECS = [
  { names: ['\uD30C\uC544\uADF8\uB9AC\uC624 3\uC77C\uC815\uC0B0', 'Paagrio 3-Day'], server: '\uD30C\uC544\uADF8\uB9AC\uC624' },
  { names: ['\uD558\uC774\uB124 3\uC77C\uC815\uC0B0', 'Heine 3-Day'], server: '\uD558\uC774\uB124' }
];

const LEGACY_TOTAL_SUMMARY_SHEETS = ['\uC804\uCCB4 \uC694\uC57D', 'Total Summary'];

function findSheetByNames_(names) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  for (let i = 0; i < names.length; i += 1) {
    const sheet = ss.getSheetByName(names[i]);
    if (sheet) return sheet;
  }
  return null;
}

function hasPayrollNumbers_(nums) {
  if (!nums) return false;
  return nums.totalAdena > 0 || nums.grossSalary > 0 || nums.totalPeso > 0;
}

function extractPayrollNumbersFromLegacyRow_(row) {
  const serverInFirst = normalizePayrollServerLabel_(row[0]);
  if (serverInFirst && parseSheetNumber_(row[1]) > 0) {
    return {
      totalAdena: parseSheetNumber_(row[1]),
      grossSalary: parseSheetNumber_(row[2]),
      txFee: parseSheetNumber_(row[3]),
      playerShare: parseSheetNumber_(row[4]),
      ownerShare: parseSheetNumber_(row[5]),
      totalPeso: parseSheetNumber_(row[6])
    };
  }
  return {
    totalAdena: parseSheetNumber_(row[2]),
    grossSalary: parseSheetNumber_(row[3]),
    txFee: parseSheetNumber_(row[4]),
    playerShare: parseSheetNumber_(row[5]),
    ownerShare: parseSheetNumber_(row[6]),
    totalPeso: parseSheetNumber_(row[7])
  };
}

function readLegacyThreeDaySheetSnapshot_(sheet, serverLabel) {
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 0; i -= 1) {
    const row = values[i];
    const labelA = clean_(row[0], '');
    if (labelA.indexOf('\uD569\uACC4') >= 0 || labelA.toLowerCase().indexOf('total') >= 0) {
      const nums = extractPayrollNumbersFromLegacyRow_(row);
      if (hasPayrollNumbers_(nums)) {
        return Object.assign({ server: serverLabel }, nums);
      }
    }
  }
  const fallbackIndexes = [5, 4, 3];
  for (let f = 0; f < fallbackIndexes.length; f += 1) {
    const row = values[fallbackIndexes[f]];
    if (!row) continue;
    const nums = extractPayrollNumbersFromLegacyRow_(row);
    if (hasPayrollNumbers_(nums)) {
      return Object.assign({ server: serverLabel }, nums);
    }
  }
  return null;
}

function readLegacyTotalSummaryRows_() {
  const sheet = findSheetByNames_(LEGACY_TOTAL_SUMMARY_SHEETS);
  if (!sheet) return [];

  const values = sheet.getDataRange().getValues();
  const tz = Session.getScriptTimeZone() || 'Asia/Manila';
  const timestamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const periodLabel = '\uC804\uCCB4 \uC694\uC57D \uC774\uAD00';
  const rows = [];

  for (let i = 0; i < values.length; i += 1) {
    const row = values[i];
    const firstCell = clean_(row[0], '').toLowerCase();
    const server = normalizePayrollServerLabel_(row[0] || row[1]);
    if (!server) continue;
    if (firstCell.indexOf('\uD569\uACC4') >= 0 || firstCell.indexOf('total') >= 0) continue;
    if (firstCell.indexOf('\uC11C\uBC84') >= 0 || firstCell.indexOf('\uAD6C\uBD84') >= 0) continue;
    if (firstCell.indexOf('\uC6D0\uBCF8') >= 0 || firstCell.indexOf('\uAE30\uC900') >= 0 || firstCell.indexOf('\uC548\uB0B4') >= 0) continue;

    const nums = extractPayrollNumbersFromLegacyRow_(row);
    if (!hasPayrollNumbers_(nums)) continue;

    rows.push([
      timestamp,
      periodLabel,
      server,
      nums.totalAdena,
      nums.grossSalary,
      nums.txFee,
      nums.playerShare,
      nums.ownerShare,
      nums.totalPeso,
      'legacy-total-summary'
    ]);
  }
  return rows;
}

function readLegacyThreeDaySettlementRows_() {
  const fromTotal = readLegacyTotalSummaryRows_();
  if (fromTotal.length >= 1) return fromTotal;

  const tz = Session.getScriptTimeZone() || 'Asia/Manila';
  const timestamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const periodLabel = '\uAE30\uC874 3\uC77C\uC815\uC0B0 \uC774\uAD00';
  const rows = [];

  for (let i = 0; i < LEGACY_THREE_DAY_TAB_SPECS.length; i += 1) {
    const spec = LEGACY_THREE_DAY_TAB_SPECS[i];
    const sheet = findSheetByNames_(spec.names);
    if (!sheet) continue;
    const snapshot = readLegacyThreeDaySheetSnapshot_(sheet, spec.server);
    if (!snapshot) continue;
    rows.push([
      timestamp,
      periodLabel,
      snapshot.server,
      snapshot.totalAdena,
      snapshot.grossSalary,
      snapshot.txFee,
      snapshot.playerShare,
      snapshot.ownerShare,
      snapshot.totalPeso,
      'legacy-3day-sheet'
    ]);
  }
  return rows;
}

function formatPayrollTimestamp_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss');
  }
  const text = clean_(value, '');
  return text && text !== '-' ? text : Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Manila', 'yyyy-MM-dd HH:mm:ss');
}

function normalizePayrollServerLabel_(value) {
  const text = clean_(value, '').toLowerCase();
  if (text.indexOf('\uD30C') >= 0 || text.indexOf('paagrio') >= 0) return '\uD30C\uC544\uADF8\uB9AC\uC624';
  if (text.indexOf('\uD558') >= 0 || text.indexOf('heine') >= 0) return '\uD558\uC774\uB124';
  return clean_(value, '');
}

function mapPayrollArchiveRow_(row, defaultPeriodLabel) {
  const server = normalizePayrollServerLabel_(row[2]);
  if (!server) return null;
  return [
    formatPayrollTimestamp_(row[0]),
    clean_(row[1], defaultPeriodLabel),
    server,
    parseSheetNumber_(row[3]),
    parseSheetNumber_(row[4]),
    parseSheetNumber_(row[5]),
    parseSheetNumber_(row[6]),
    parseSheetNumber_(row[7]),
    parseSheetNumber_(row[8]),
    clean_(row[9], '\uC774\uAD00')
  ];
}

function readExistingRawDataRows_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(RAW_DATA_SHEET_NAME);
  if (!sheet) return [];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0].map(function(cell) { return clean_(cell, ''); });
  if (header[0] !== '\uC800\uC7A5\uC77C\uC2DC') return [];
  const rows = [];
  for (let i = 1; i < values.length; i += 1) {
    const mapped = mapPayrollArchiveRow_(values[i], '\uAE30\uC874 Raw_Data');
    if (mapped) rows.push(mapped);
  }
  return rows;
}

function deleteLegacyPayrollSheets_(ss) {
  const deleted = [];
  LEGACY_PAYROLL_SHEETS.forEach(function(sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      ss.deleteSheet(sheet);
      deleted.push(sheetName);
      Logger.log('Deleted legacy payroll sheet: ' + sheetName);
    }
  });
  return deleted;
}

function setupRawDataSheetTemplate_(ss, clearData) {
  let rawSheet = ss.getSheetByName(RAW_DATA_SHEET_NAME);
  if (!rawSheet) rawSheet = ss.insertSheet(RAW_DATA_SHEET_NAME);
  if (clearData) rawSheet.clear();

  const rawHeaders = [[
    '\uC800\uC7A5\uC77C\uC2DC',
    '\uD68C\uCC28',
    '\uC11C\uBC84',
    '\uCD1D \uD68D\uB4DD \uC544\uB370\uB098',
    '\uCD1D \uAE09\uC5EC',
    '\uC218\uC218\uB8CC 5%',
    '\uC9C1\uC6D0 65%',
    '\uC624\uB108 35%',
    '\uCD1D \uD398\uC18C',
    '\uC800\uC7A5\uC790'
  ]];
  rawSheet.getRange(1, 1, 1, 10).setValues(rawHeaders)
    .setBackground('#2C3E50').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');

  rawSheet.setColumnWidth(1, 150);
  for (let col = 2; col <= 10; col += 1) rawSheet.setColumnWidth(col, 110);
  rawSheet.setFrozenRows(1);

  rawSheet.getRange('A2:J500').setBorder(true, true, true, true, true, true, '#BDC3C7', SpreadsheetApp.BorderStyle.SOLID);
  rawSheet.getRange('A2:C500').setHorizontalAlignment('center');
  rawSheet.getRange('D2:I500').setNumberFormat('#,##0');
  return rawSheet;
}

function appendRawDataRows_(rawSheet, rows) {
  if (!rows || rows.length < 1) return 0;
  const startRow = Math.max(rawSheet.getLastRow() + 1, 2);
  const endRow = startRow + rows.length - 1;
  rawSheet.getRange(startRow, 1, endRow, 10).setValues(rows);
  return rows.length;
}

function readGreatTabSnapshotRows_(periodLabel, savedBy) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const specs = [
    { tab: PAYROLL_PAAGRIO_TAB, server: '\uD30C\uC544\uADF8\uB9AC\uC624' },
    { tab: PAYROLL_HEINE_TAB, server: '\uD558\uC774\uB124' }
  ];
  const tz = Session.getScriptTimeZone() || 'Asia/Manila';
  const timestamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm:ss');
  const rows = [];

  for (let i = 0; i < specs.length; i += 1) {
    const sheet = ss.getSheetByName(specs[i].tab);
    if (!sheet) throw new Error('Missing tab: ' + specs[i].tab);
    const snapshot = readGreatTabPayroll_(sheet.getDataRange().getValues(), specs[i].server);
    rows.push([
      timestamp,
      periodLabel,
      snapshot.server,
      snapshot.totalAdena,
      snapshot.grossSalary,
      snapshot.txFee,
      snapshot.playerShare,
      snapshot.ownerShare,
      snapshot.totalPeso,
      savedBy
    ]);
  }
  return rows;
}

function quoteSheet_(tabName) {
  return "'" + String(tabName).replace(/'/g, "''") + "'";
}

function payrollGreatSpreadsheetId_() {
  try {
    const v = PropertiesService.getScriptProperties().getProperty('PAYROLL_GREAT_SPREADSHEET_ID');
    if (v) return v;
  } catch (e) { /* ignore */ }
  return PAYROLL_GREAT_SPREADSHEET_ID_DEFAULT;
}

function ensureGreatMirrorSheet_(ss, mirrorName, sourceTab) {
  let sheet = ss.getSheetByName(mirrorName);
  if (!sheet) {
    sheet = ss.insertSheet(mirrorName);
    sheet.hideSheet();
  } else if (!sheet.isSheetHidden()) {
    sheet.hideSheet();
  }
  const src = payrollGreatSpreadsheetId_();
  sheet.getRange('A1').setFormula('=IMPORTRANGE("' + src + '","' + quoteSheet_(sourceTab) + '!A1:M120")');
  return sheet;
}

/** Mirror tab (preferred), local Great, or IMPORTRANGE per cell. */
function greatRange_(tabName, a1) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const mirror = tabName === PAYROLL_PAAGRIO_TAB ? MIRROR_PAAGRIO_TAB
    : (tabName === PAYROLL_HEINE_TAB ? MIRROR_HEINE_TAB : null);
  if (mirror && ss.getSheetByName(mirror)) {
    return quoteSheet_(mirror) + '!' + a1;
  }
  if (ss.getSheetByName(tabName)) {
    return quoteSheet_(tabName) + '!' + a1;
  }
  const src = payrollGreatSpreadsheetId_();
  return 'IMPORTRANGE("' + src + '","' + quoteSheet_(tabName) + '!' + a1 + '")';
}

/** Great 탭: 선수 아데나 열 C, F, I, L, O, R, … (3칸 간격, BONUS/D&C 제외). */
function greatTabRowPlayerSum_(tabName) {
  var parts = [];
  for (var col = 2; col <= 90; col += 3) {
    var letter = columnIndexToLetter_(col);
    parts.push('IFERROR(VALUE(' + greatRange_(tabName, letter + '2:' + letter + '120') + '),0)');
  }
  return parts.join('+');
}

function columnIndexToLetter_(index) {
  var n = index + 1;
  var letters = '';
  while (n > 0) {
    var rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function greatTabMetricFormula_(tabName, metric) {
  var colSum = greatTabRowPlayerSum_(tabName);
  var colA = greatRange_(tabName, 'A2:A120');
  var colB = greatRange_(tabName, 'B2:B120');
  var matchA;
  var matchB;

  if (metric === 'totalAdena') {
    matchA = 'REGEXMATCH(TO_TEXT(' + colA + '), "(?i)total\\\\s*gain\\\\s*adena")';
    matchB = 'REGEXMATCH(TO_TEXT(' + colB + '), "(?i)total\\\\s*gain\\\\s*adena")';
    return '=SUM(ARRAYFORMULA(((' + matchA + ')+(' + matchB + ')>0)*(' + colSum + ')))';
  }
  if (metric === 'grossSalary') {
    matchA = 'REGEXMATCH(TO_TEXT(' + colA + '), "(?i)^total$")';
    matchB = 'REGEXMATCH(TO_TEXT(' + colB + '), "(?i)^total$")';
    return '=SUM(ARRAYFORMULA(((' + matchA + ')+(' + matchB + ')>0)*(' + colSum + ')))';
  }
  if (metric === 'txFee') {
    matchA = 'REGEXMATCH(TO_TEXT(' + colA + '), "(?i)^5%$|tx\\\\s*fee")';
    matchB = 'REGEXMATCH(TO_TEXT(' + colB + '), "(?i)^5%$|tx\\\\s*fee")';
    return '=SUM(ARRAYFORMULA(((' + matchA + ')+(' + matchB + ')>0)*(' + colSum + ')))';
  }
  if (metric === 'playerShare') {
    matchA = 'REGEXMATCH(TO_TEXT(' + colA + '), "(?i)^0\\\\.65$|^player$")';
    matchB = 'REGEXMATCH(TO_TEXT(' + colB + '), "(?i)^0\\\\.65$|^player$")';
    return '=SUM(ARRAYFORMULA(((' + matchA + ')+(' + matchB + ')>0)*(' + colSum + ')))';
  }
  if (metric === 'ownerShare') {
    matchA = 'REGEXMATCH(TO_TEXT(' + colA + '), "(?i)^0\\\\.35$|^owner$")';
    matchB = 'REGEXMATCH(TO_TEXT(' + colB + '), "(?i)^0\\\\.35$|^owner$")';
    return '=SUM(ARRAYFORMULA(((' + matchA + ')+(' + matchB + ')>0)*(' + colSum + ')))';
  }
  if (metric === 'totalPeso') {
    matchA = 'REGEXMATCH(TO_TEXT(' + colA + '), "(?i)expected\\\\s*peso")';
    matchB = 'REGEXMATCH(TO_TEXT(' + colB + '), "(?i)expected\\\\s*peso")';
    return '=SUM(ARRAYFORMULA(((' + matchA + ')+(' + matchB + ')>0)*(' + colSum + ')))';
  }
  return '0';
}

function greatTabPayrollFormulaRow_(tabName) {
  return [
    greatTabMetricFormula_(tabName, 'totalAdena'),
    greatTabMetricFormula_(tabName, 'grossSalary'),
    greatTabMetricFormula_(tabName, 'txFee'),
    greatTabMetricFormula_(tabName, 'playerShare'),
    greatTabMetricFormula_(tabName, 'ownerShare'),
    greatTabMetricFormula_(tabName, 'totalPeso')
  ];
}

function applyLivePayrollServerRowFormulas_(sheet, paagrioRow, heineRow) {
  sheet.getRange(paagrioRow, 3, 1, 6).setFormulas([greatTabPayrollFormulaRow_(PAYROLL_PAAGRIO_TAB)])
    .setNumberFormat('#,##0').setFontWeight('bold');
  sheet.getRange(heineRow, 3, 1, 6).setFormulas([greatTabPayrollFormulaRow_(PAYROLL_HEINE_TAB)])
    .setNumberFormat('#,##0').setFontWeight('bold');
}

function applyLiveThreeDaySummaryFormulas_(daySheet) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const paagrioTab = ss.getSheetByName(PAYROLL_PAAGRIO_TAB) ? PAYROLL_PAAGRIO_TAB : MIRROR_PAAGRIO_TAB;
  const heineTab = ss.getSheetByName(PAYROLL_HEINE_TAB) ? PAYROLL_HEINE_TAB : MIRROR_HEINE_TAB;
  daySheet.getRange(5, 3, 1, 6).setFormulas([greatTabPayrollFormulaRow_(paagrioTab)])
    .setNumberFormat('#,##0').setFontWeight('bold');
  daySheet.getRange(6, 3, 1, 6).setFormulas([greatTabPayrollFormulaRow_(heineTab)])
    .setNumberFormat('#,##0').setFontWeight('bold');
}

/** Great 탭은 3일 지급 후 초기화되므로, 월간 누적은 Raw_Data 저장분만 SUMIF. */
function applyMonthlyRawDataFormulas_(monthSheet) {
  const sumPaagrio = [
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD30C\uC544\uADF8\uB9AC\uC624", ' + RAW_DATA_SHEET_NAME + '!$D:$D), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD30C\uC544\uADF8\uB9AC\uC624", ' + RAW_DATA_SHEET_NAME + '!$E:$E), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD30C\uC544\uADF8\uB9AC\uC624", ' + RAW_DATA_SHEET_NAME + '!$F:$F), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD30C\uC544\uADF8\uB9AC\uC624", ' + RAW_DATA_SHEET_NAME + '!$G:$G), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD30C\uC544\uADF8\uB9AC\uC624", ' + RAW_DATA_SHEET_NAME + '!$H:$H), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD30C\uC544\uADF8\uB9AC\uC624", ' + RAW_DATA_SHEET_NAME + '!$I:$I), 0)'
  ];
  monthSheet.getRange(5, 3, 1, 6).setFormulas([sumPaagrio]).setNumberFormat('#,##0').setFontColor('#2563EB').setFontWeight('bold');

  const sumHeine = [
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD558\uC774\uB124", ' + RAW_DATA_SHEET_NAME + '!$D:$D), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD558\uC774\uB124", ' + RAW_DATA_SHEET_NAME + '!$E:$E), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD558\uC774\uB124", ' + RAW_DATA_SHEET_NAME + '!$F:$F), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD558\uC774\uB124", ' + RAW_DATA_SHEET_NAME + '!$G:$G), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD558\uC774\uB124", ' + RAW_DATA_SHEET_NAME + '!$H:$H), 0)',
    '=ROUND(SUMIF(' + RAW_DATA_SHEET_NAME + '!$C:$C, "\uD558\uC774\uB124", ' + RAW_DATA_SHEET_NAME + '!$I:$I), 0)'
  ];
  monthSheet.getRange(6, 3, 1, 6).setFormulas([sumHeine]).setNumberFormat('#,##0').setFontColor('#2563EB').setFontWeight('bold');

  monthSheet.getRange(7, 3, 1, 6).setFormulas([
    [
      '=ROUND(SUM(' + RAW_DATA_SHEET_NAME + '!$D:$D), 0)',
      '=ROUND(SUM(' + RAW_DATA_SHEET_NAME + '!$E:$E), 0)',
      '=ROUND(SUM(' + RAW_DATA_SHEET_NAME + '!$F:$F), 0)',
      '=ROUND(SUM(' + RAW_DATA_SHEET_NAME + '!$G:$G), 0)',
      '=ROUND(SUM(' + RAW_DATA_SHEET_NAME + '!$H:$H), 0)',
      '=ROUND(SUM(' + RAW_DATA_SHEET_NAME + '!$I:$I), 0)'
    ]
  ]).setBackground('#ECF0F1').setFontColor('#1D4ED8').setFontWeight('bold').setNumberFormat('#,##0');
}

/** 최근_3일_요약만 Great 실시간. 월간_누적_요약은 Raw_Data 누적 수식 유지. */
function enableLiveThreeDaySummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let daySheet = ss.getSheetByName(RECENT_THREE_DAY_SUMMARY_SHEET);
  const monthSheet = ss.getSheetByName(MONTHLY_SUMMARY_SHEET);
  if (!daySheet || !monthSheet) {
    setupPayrollSummarySheets_(ss);
    return { success: true, mode: 'created-summary-sheets' };
  }
  if (!ss.getSheetByName(PAYROLL_PAAGRIO_TAB)) {
    ensureGreatMirrorSheet_(ss, MIRROR_PAAGRIO_TAB, PAYROLL_PAAGRIO_TAB);
    ensureGreatMirrorSheet_(ss, MIRROR_HEINE_TAB, PAYROLL_HEINE_TAB);
  }
  applyLiveThreeDaySummaryFormulas_(daySheet);
  daySheet.getRange('B3').setValue('\u25B6 \uC11C\uBC84\uBCC4 3\uC77C \uAE09\uC5EC (\uC2E4\uC2DC\uAC04: ' + PAYROLL_PAAGRIO_TAB + ' / ' + PAYROLL_HEINE_TAB + ' \u2190 \uC6CC\uD06C\uB9AC\uC2A4\uD2B8)');
  daySheet.getRange('C8:H8').setFormulas([
    ['=SUM(C5:C6)', '=SUM(D5:D6)', '=SUM(E5:E6)', '=SUM(F5:F6)', '=SUM(G5:G6)', '=SUM(H5:H6)']
  ]).setNumberFormat('#,##0').setFontWeight('bold');
  applyMonthlyRawDataFormulas_(monthSheet);
  monthSheet.getRange('B4').setValue('\uD83D\uDFE2 \uC6D4\uAC04 \uB204\uC801 (Raw_Data \u2014 3\uC77C \uB9C8\uAC10 \uC800\uC7A5 \uD569\uACC4)');
  return {
    success: true,
    mode: 'payroll-summary-formulas-applied',
    recentThreeDaySource: 'great-tabs-live',
    monthlySource: 'raw-data-archive',
    note: 'If #REF!, open sheet once and allow IMPORTRANGE. Run /급여기록 before clearing Great tabs.'
  };
}

// 파아그리오/하이네 3일정산 탭 2개 대신 RECENT_THREE_DAY_SUMMARY_SHEET 한 탭에 두 서버를 행으로 표시.
function setupPayrollSummarySheets_(ss) {
  let daySheet = ss.getSheetByName(RECENT_THREE_DAY_SUMMARY_SHEET);
  if (!daySheet) daySheet = ss.insertSheet(RECENT_THREE_DAY_SUMMARY_SHEET);
  daySheet.clear();
  daySheet.setHiddenGridlines(true);

  daySheet.setColumnWidth(1, 20);
  daySheet.setColumnWidth(2, 140);
  for (let i = 3; i <= 8; i += 1) daySheet.setColumnWidth(i, 120);

  daySheet.getRange('B1:H1').merge().setValue('⏱️ [2회차] 3일 단위 급여 기록 요약')
    .setBackground('#E8F4F8').setFontColor('#2C3E50').setFontWeight('bold').setFontSize(14).setVerticalAlignment('middle');
  daySheet.setRowHeight(1, 40);

  daySheet.getRange('B3:H3').merge()
    .setValue('\u25B6 \uC11C\uBC84\uBCC4 3\uC77C \uAE09\uC5EC (\uC2E4\uC2DC\uAC04: ' + PAYROLL_PAAGRIO_TAB + ' / ' + PAYROLL_HEINE_TAB + ')')
    .setFontColor('#34495E').setFontWeight('bold');

  daySheet.getRange('B4:H4').setValues([['서버명', '총 획득 아데나', '총 급여', '수수료 5%', '직원 65%', '오너 35%', '총 페소']])
    .setBackground('#34495E').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  daySheet.getRange('H4').setFontColor('#FDE047');

  daySheet.getRange('B5').setValue('🔥 파아그리오').setBackground('#FDF2F2').setFontColor('#C53030').setFontWeight('bold').setHorizontalAlignment('center');
  daySheet.getRange('B6').setValue('💧 하이네').setBackground('#EFF6FF').setFontColor('#1D4ED8').setFontWeight('bold').setHorizontalAlignment('center');

  applyLiveThreeDaySummaryFormulas_(daySheet);

  daySheet.getRange('B8').setValue('💰 3일 총합').setBackground('#ECF0F1').setFontWeight('bold').setHorizontalAlignment('center');
  daySheet.getRange('C8:H8').setFormulas([
    ['=SUM(C5:C6)', '=SUM(D5:D6)', '=SUM(E5:E6)', '=SUM(F5:F6)', '=SUM(G5:G6)', '=SUM(H5:H6)']
  ]).setBackground('#ECF0F1').setFontColor('#2563EB').setFontWeight('bold').setNumberFormat('#,##0');

  daySheet.getRange('B4:H6').setBorder(true, true, true, true, true, true, '#BDC3C7', SpreadsheetApp.BorderStyle.SOLID);
  daySheet.getRange('B8:H8').setBorder(true, true, true, true, true, true, '#BDC3C7', SpreadsheetApp.BorderStyle.SOLID);

  let monthSheet = ss.getSheetByName(MONTHLY_SUMMARY_SHEET);
  if (!monthSheet) monthSheet = ss.insertSheet(MONTHLY_SUMMARY_SHEET);
  monthSheet.clear();
  monthSheet.setHiddenGridlines(true);

  monthSheet.setColumnWidth(1, 20);
  monthSheet.setColumnWidth(2, 140);
  for (let i = 3; i <= 8; i += 1) monthSheet.setColumnWidth(i, 120);

  monthSheet.getRange('B1:H1').merge().setValue('📊 월간/연간 누적 급여 기록 (30일 마감)')
    .setBackground('#E0E7FF').setFontColor('#2C3E50').setFontWeight('bold').setFontSize(14).setVerticalAlignment('middle');
  monthSheet.setRowHeight(1, 40);

  monthSheet.getRange('B3:H3').setValues([['마감월 / 서버명', '총 획득 아데나', '총 급여', '수수료 5%', '직원 65%', '오너 35%', '총 페소']])
    .setBackground('#34495E').setFontColor('#FFFFFF').setFontWeight('bold').setHorizontalAlignment('center');
  monthSheet.getRange('H3').setFontColor('#FDE047');

  monthSheet.getRange('B4:H4').merge()
    .setValue('\uD83D\uDFE2 \uC6D4\uAC04 \uB204\uC801 (Raw_Data \u2014 3\uC77C \uB9C8\uAC10 \uC800\uC7A5 \uD569\uACC4)')
    .setBackground('#DCFCE7').setFontColor('#166534').setFontWeight('bold');
  monthSheet.getRange('B5').setValue('🔥 파아그리오').setBackground('#FDF2F2').setFontColor('#C53030').setFontWeight('bold').setHorizontalAlignment('center');
  monthSheet.getRange('B6').setValue('💧 하이네').setBackground('#EFF6FF').setFontColor('#1D4ED8').setFontWeight('bold').setHorizontalAlignment('center');

  applyMonthlyRawDataFormulas_(monthSheet);

  monthSheet.getRange('B7').setValue('🏆 현재 총합계').setBackground('#ECF0F1').setFontWeight('bold').setHorizontalAlignment('center');
  monthSheet.getRange('B9:H9').merge()
    .setValue('\u26A0\uFE0F Great \uD0ED\uC740 3\uC77C \uC9C0\uAE09 \uD6C4 \uC0AD\uC81C\uB429\uB2C8\uB2E4. \uC0AD\uC81C \uC804\uC5D0 Discord /급여\uAE30\uB85D \uB610\uB294 payroll-sync\uB85C Raw_Data\uC5D0 \uB9C8\uAC10\uC744 \uB0A8\uACA8\uC8FC\uC138\uC694.')
    .setFontColor('#92400E').setFontSize(9).setWrap(true);
  monthSheet.setRowHeight(9, 48);

  monthSheet.getRange('B3:H7').setBorder(true, true, true, true, true, true, '#BDC3C7', SpreadsheetApp.BorderStyle.SOLID);
}

/**
 * 기존 Raw_Data 를 보존한 채 새 급여 레이아웃으로 이관합니다 (월간 기록 탭은 삭제).
 * Paagrio Great / Heine Great 탭은 삭제하지 않습니다.
 * Apps Script 편집기에서 migratePayrollToNewLayout 실행 (최초 1회 권장).
 */
function migratePayrollToNewLayout(options) {
  options = options || {};
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const existingRawRows = options.includeExistingRawData === false ? [] : readExistingRawDataRows_();
  const legacy3DayRows = options.includeLegacyThreeDay === false ? [] : readLegacyThreeDaySettlementRows_();

  const deletedSheets = deleteLegacyPayrollSheets_(ss);
  const rawSheet = setupRawDataSheetTemplate_(ss, true);
  let appended = appendRawDataRows_(rawSheet, existingRawRows);
  const legacy3DayCount = appendRawDataRows_(rawSheet, legacy3DayRows);
  appended += legacy3DayCount;
  let greatSnapshotCount = 0;

  if (appended < 1 && options.snapshotGreatTabs !== false) {
    const greatRows = readGreatTabSnapshotRows_(
      clean_(options.periodLabel, '\uD604\uC7AC \uC9C4\uD589\uBD84(\uC774\uAD00)'),
      clean_(options.savedBy, 'migratePayrollToNewLayout')
    );
    greatSnapshotCount = appendRawDataRows_(rawSheet, greatRows);
    appended += greatSnapshotCount;
  } else if (options.appendCurrentGreat === true) {
    const greatRows = readGreatTabSnapshotRows_(
      clean_(options.periodLabel, '\uD604\uC7AC \uC9C4\uD589\uBD84'),
      clean_(options.savedBy, 'migratePayrollToNewLayout')
    );
    greatSnapshotCount = appendRawDataRows_(rawSheet, greatRows);
    appended += greatSnapshotCount;
  }

  setupPayrollSummarySheets_(ss);
  ss.setActiveSheet(rawSheet);

  return {
    success: true,
    mode: 'migrate-payroll-layout',
    deletedSheets: deletedSheets,
    importedExistingRawCount: existingRawRows.length,
    importedLegacy3DayCount: legacy3DayCount,
    greatSnapshotCount: greatSnapshotCount,
    totalRawDataRows: appended,
    rawDataLastRow: rawSheet.getLastRow()
  };
}

/**
 * 빈 Raw_Data 로 새로 시작할 때만 사용 (기존 기록 삭제됨).
 * 기록은 Raw_Data 에만 저장 (/급여기록). migratePayrollToNewLayout 은 레이아웃 이관용.
 */
function importLegacyThreeDayToRawData_(params) {
  params = params || {};
  const legacy3DayRows = readLegacyThreeDaySettlementRows_();
  if (legacy3DayRows.length < 1) {
    return {
      success: false,
      error: 'No legacy 3-day data (파아그리오/하이네 3일정산 or 전체 요약 tabs missing or empty)'
    };
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const rawSheet = ensureRawDataSheet_();
  const count = appendRawDataRows_(rawSheet, legacy3DayRows);
  setupPayrollSummarySheets_(ss);
  if (params.deleteLegacySheets === true) {
    deleteLegacyPayrollSheets_(ss);
  }
  return {
    success: true,
    mode: 'import-legacy-3day',
    importedLegacy3DayCount: count,
    rawDataLastRow: rawSheet.getLastRow()
  };
}

function createPerfectPayrollSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  deleteLegacyPayrollSheets_(ss);
  const rawSheet = setupRawDataSheetTemplate_(ss, true);
  setupPayrollSummarySheets_(ss);
  ss.setActiveSheet(rawSheet);
  Logger.log('createPerfectPayrollSheets finished (empty Raw_Data). Use migratePayrollToNewLayout to import old records.');
}
