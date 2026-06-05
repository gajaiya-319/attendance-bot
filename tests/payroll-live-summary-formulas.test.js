const assert = require('assert');
const { buildGreatTabPayrollFormulaRow, MIRROR_PAAGRIO } = require('../scripts/lib/payroll-live-summary-formulas');

const mirrorRow = buildGreatTabPayrollFormulaRow('id', 'Paagrio Great', ['C', 'F', 'I', 'L'], true);
assert(mirrorRow[0].includes(MIRROR_PAAGRIO));
assert(mirrorRow[0].includes('ARRAYFORMULA'));
assert(mirrorRow[0].includes('!C2:C120'));

const directRow = buildGreatTabPayrollFormulaRow('id', 'Paagrio Great', ['C', 'F', 'I', 'L'], false);
assert(directRow[0].includes("'Paagrio Great'"));
assert(directRow[0].includes('!C2:C120'));
assert(directRow[0].includes('!F2:F120'));
assert(!directRow[0].includes('!D2:D120'));
assert(!directRow[0].includes('!C2:C120)),0)'), 'IFERROR must close before ,0');

console.log('payroll-live-summary-formulas tests passed');
