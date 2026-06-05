'use strict';

const assert = require('assert');
const { parseGreatTabPayrollRows } = require('../src/utils/payrollGreatTabParser');

const sampleRows = [];
for (let i = 0; i < 60; i += 1) sampleRows.push(new Array(20).fill(''));

sampleRows[6][0] = 'Day';
sampleRows[6][12] = 'P1';
sampleRows[13][0] = 'Total Gain Adena';
sampleRows[13][12] = 1000;
sampleRows[39][0] = 'Total Gain Adena';
sampleRows[39][12] = 500;

sampleRows[21][0] = 'TOTAL';
sampleRows[21][12] = 200;
sampleRows[47][0] = 'TOTAL';
sampleRows[47][12] = 80;

sampleRows[22][0] = '5%';
sampleRows[22][12] = 14;
sampleRows[48][0] = '5%';
sampleRows[48][12] = 7;

sampleRows[23][0] = '0.65';
sampleRows[23][12] = 130;
sampleRows[49][0] = '0.65';
sampleRows[49][12] = 52;

sampleRows[24][0] = '0.35';
sampleRows[24][12] = 70;
sampleRows[50][0] = '0.35';
sampleRows[50][12] = 28;

sampleRows[27][0] = 'Expected Peso(Player\'s Salary)';
sampleRows[27][12] = 8;
sampleRows[53][0] = 'Expected Peso(Player\'s Salary)';
sampleRows[53][12] = 3;

const parsed = parseGreatTabPayrollRows(sampleRows, '파아그리오');
assert.strictEqual(parsed.ok, true);
assert.strictEqual(parsed.row.totalAdena, 1500);
assert.strictEqual(parsed.row.grossSalary, 280);
assert.strictEqual(parsed.row.txFee, 21);
assert.strictEqual(parsed.row.playerShare, 182);
assert.strictEqual(parsed.row.ownerShare, 98);
assert.strictEqual(parsed.row.totalPeso, 11);

const compactRows = [];
for (let i = 0; i < 30; i += 1) compactRows.push(new Array(6).fill(''));
compactRows[6][0] = 'Day';
compactRows[6][2] = 'Solo';
compactRows[13][0] = 'Total Gain Adena';
compactRows[13][2] = '260,000';
compactRows[21][0] = 'TOTAL';
compactRows[21][2] = 31200;
compactRows[22][0] = '5%';
compactRows[22][1] = 'TX Fee';
compactRows[22][2] = 29640;
compactRows[23][0] = '0.65';
compactRows[23][1] = 'Player';
compactRows[23][2] = 19266;
compactRows[24][0] = '0.35';
compactRows[24][1] = 'Owner';
compactRows[24][2] = 10374;
compactRows[27][0] = 'Expected Peso(Player\'s Salary)';
compactRows[27][2] = 771;

const compact = parseGreatTabPayrollRows(compactRows, '파아그리오');
assert.strictEqual(compact.ok, true);
assert.strictEqual(compact.row.totalAdena, 260000);
assert.strictEqual(compact.row.grossSalary, 31200);
assert.strictEqual(compact.row.totalPeso, 771);

const horizontalRows = [];
for (let i = 0; i < 60; i += 1) horizontalRows.push(new Array(20).fill(''));
horizontalRows[6][0] = 'Day';
horizontalRows[6][2] = 'P1';
horizontalRows[6][5] = 'P2';
horizontalRows[6][8] = 'P3';
horizontalRows[6][11] = 'P4';
horizontalRows[6][14] = 'P5';
horizontalRows[6][17] = 'P6';
horizontalRows[13][0] = 'Total Gain Adena';
horizontalRows[13][3] = 260000;
horizontalRows[13][6] = 202000;
horizontalRows[13][9] = 163000;
horizontalRows[13][12] = 156000;
horizontalRows[13][15] = 195000;
horizontalRows[13][18] = 207000;
horizontalRows[21][0] = 'TOTAL';
horizontalRows[21][3] = 31200;
horizontalRows[21][6] = 24240;
horizontalRows[21][9] = 19560;
horizontalRows[21][12] = 18720;
horizontalRows[21][15] = 23400;
horizontalRows[21][18] = 24840;
horizontalRows[22][0] = '5%';
horizontalRows[22][3] = 100;
horizontalRows[22][6] = 80;
horizontalRows[23][0] = '0.65';
horizontalRows[23][3] = 200;
horizontalRows[24][0] = '0.35';
horizontalRows[24][3] = 100;
horizontalRows[27][0] = 'Expected Peso(Player\'s Salary)';
horizontalRows[27][3] = 10;
horizontalRows[27][6] = 8;

const horizontal = parseGreatTabPayrollRows(horizontalRows, '파아그리오');
assert.strictEqual(horizontal.ok, true);
assert.strictEqual(horizontal.row.totalAdena, 1183000);
assert.strictEqual(horizontal.row.grossSalary, 141960);
assert.strictEqual(horizontal.row.txFee, 180);
assert.strictEqual(horizontal.row.playerShare, 200);
assert.strictEqual(horizontal.row.ownerShare, 100);
assert.strictEqual(horizontal.row.totalPeso, 18);

console.log('payroll-great-tab-parser tests passed');
