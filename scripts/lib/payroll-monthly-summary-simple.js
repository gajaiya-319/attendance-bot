const MONTHLY_SHEET = '\uC6D4\uAC04_\uB204\uC801_\uC694\uC57D';
const RAW_DATA = 'Raw_Data';
const PAAGRIO = '\uD30C\uC544\uADF8\uB9AC\uC624';
const VALACAS = '\uBC1C\uB77C\uCE74\uC2A4';

function rawSumif(serverName, column) {
  return `=ROUND(SUMIF(${RAW_DATA}!$C:$C, "${serverName}", ${RAW_DATA}!$${column}:$${column}), 0)`;
}

function monthlyRawSumifFormulas(serverName) {
  return [
    rawSumif(serverName, 'D'),
    rawSumif(serverName, 'E'),
    rawSumif(serverName, 'F'),
    rawSumif(serverName, 'G'),
    rawSumif(serverName, 'H'),
    rawSumif(serverName, 'I'),
  ];
}

function sumAll(column) {
  return `=ROUND(SUM(${RAW_DATA}!$${column}:$${column}), 0)`;
}

function buildSimpleMonthlySheetBatch(spreadsheetId) {
  const title = MONTHLY_SHEET;

  return {
    spreadsheetId,
    requests: [
      {
        updateCells: {
          range: { sheetId: 0 },
          fields: 'userEnteredValue',
          rows: [],
        },
      },
    ],
    valueUpdates: [
      {
        range: `${title}!B1:H1`,
        values: [[
          '\uC6D4\uAC04/\uC5F0\uAC04 \uB204\uC801 \uAE09\uC5EC \uAE30\uB85D (30\uC77C \uB9C8\uAC10)',
          '',
          '',
          '',
          '',
          '',
          '',
        ]],
      },
      {
        range: `${title}!B3:H3`,
        values: [[
          '\uB9C8\uAC10\uC6D4 / \uC11C\uBC84\uBA85',
          '\uCD1D \uD68D\uB4DD \uC544\uB370\uB098',
          '\uCD1D \uAE09\uC5EC',
          '\uC218\uC218\uB8CC 5%',
          '\uC9C1\uC6D0 70%',
          '\uC624\uB108 30%',
          '\uCD1D \uD398\uC18C',
        ]],
      },
      {
        range: `${title}!B4:H4`,
        values: [[
          '\uC6D4\uAC04 \uB204\uC801 (Raw_Data - /\uAE09\uC5EC\uAE30\uB85D \uD569\uACC4)',
          '',
          '',
          '',
          '',
          '',
          '',
        ]],
      },
      {
        range: `${title}!B5:H7`,
        values: [
          [PAAGRIO, ...monthlyRawSumifFormulas(PAAGRIO)],
          [VALACAS, ...monthlyRawSumifFormulas(VALACAS)],
          [
            '\uD604\uC7AC \uCD1D\uD569\uACC4',
            sumAll('D'),
            sumAll('E'),
            sumAll('F'),
            sumAll('G'),
            sumAll('H'),
            sumAll('I'),
          ],
        ],
      },
      {
        range: `${title}!B9:H9`,
        values: [[
          'Great \uD0ED\uC740 3\uC77C \uC9C0\uAE09 \uD6C4 \uC0AD\uC81C\uB429\uB2C8\uB2E4. \uC0AD\uC81C \uC804 /\uAE09\uC5EC\uAE30\uB85D\uC73C\uB85C Raw_Data\uC5D0 \uB9C8\uAC10\uD558\uC138\uC694.',
          '',
          '',
          '',
          '',
          '',
          '',
        ]],
      },
    ],
  };
}

module.exports = {
  MONTHLY_SHEET,
  RAW_DATA,
  monthlyRawSumifFormulas,
  buildSimpleMonthlySheetBatch,
};
