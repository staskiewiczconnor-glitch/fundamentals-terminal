// Quick sanity checks against synthetic XBRL fixtures (no network needed).
// Run: node xbrl.test.js
const assert = require('assert');
const { deriveQuarterly, trailingSum, dedupeInstant, nearestOnOrBefore, sumInstantSeries } = require('./xbrl');

// --- Case 1: cumulative YTD tagging (typical for cash-flow-statement items) ---
// FY2024 starts 2024-01-01. OCF reported as 3mo, 6mo, 9mo, 12mo cumulative.
const ocfCumulative = [
  { start: '2024-01-01', end: '2024-03-31', val: 100, filed: '2024-05-01' },
  { start: '2024-01-01', end: '2024-06-30', val: 230, filed: '2024-08-01' },
  { start: '2024-01-01', end: '2024-09-30', val: 300, filed: '2024-11-01' },
  { start: '2024-01-01', end: '2024-12-31', val: 460, filed: '2025-02-01' },
];
const q1 = deriveQuarterly(ocfCumulative);
assert.strictEqual(q1.length, 4, 'should derive 4 discrete quarters from cumulative data');
assert.deepStrictEqual(
  q1.map((q) => q.val),
  [100, 130, 70, 160],
  'discrete quarters should be successive diffs of the cumulative series'
);
console.log('OK: cumulative-YTD -> discrete quarters', q1.map((q) => q.val));

// --- Case 2: already-discrete tagging (typical for income-statement items) ---
const revDiscrete = [
  { start: '2024-01-01', end: '2024-03-31', val: 1000, filed: '2024-05-01' },
  { start: '2024-04-01', end: '2024-06-30', val: 1100, filed: '2024-08-01' },
  { start: '2024-07-01', end: '2024-09-30', val: 1200, filed: '2024-11-01' },
  { start: '2024-10-01', end: '2024-12-31', val: 1300, filed: '2025-02-01' },
];
const q2 = deriveQuarterly(revDiscrete);
assert.deepStrictEqual(
  q2.map((q) => q.val),
  [1000, 1100, 1200, 1300],
  'already-discrete quarters should pass through unchanged'
);
console.log('OK: discrete tagging passes through', q2.map((q) => q.val));

// --- Case 3: trailing 4-quarter sum needs >= 4 quarters, rolls forward ---
const eightQuarters = [100, 110, 120, 130, 140, 150, 160, 170].map((val, i) => ({
  start: `2023-${String((i % 4) * 3 + 1).padStart(2, '0')}-01`,
  end: `2023-${String((i % 4) * 3 + 3).padStart(2, '0')}-28`,
  val,
  filed: '2099-01-01',
}));
const ttm = trailingSum(eightQuarters);
assert.strictEqual(ttm.length, 5); // 8 quarters -> 5 trailing-4 windows
assert.strictEqual(ttm[0].val, 100 + 110 + 120 + 130);
assert.strictEqual(ttm[4].val, 140 + 150 + 160 + 170);
console.log('OK: trailing 4-quarter sum', ttm.map((t) => t.val));

// --- Case 4: restatement dedupe keeps the most-recently-filed value per end date ---
const restated = [
  { start: '2024-01-01', end: '2024-03-31', val: 100, filed: '2024-05-01' },
  { start: '2024-01-01', end: '2024-03-31', val: 105, filed: '2024-08-01' }, // restated later
];
const q4 = deriveQuarterly(restated);
assert.strictEqual(q4.length, 1);
assert.strictEqual(q4[0].val, 105, 'should keep the later-filed restated value');
console.log('OK: restatement dedupe');

// --- Case 5: nearestOnOrBefore + sumInstantSeries ---
const debtA = [{ end: '2024-03-31', val: 50 }, { end: '2024-06-30', val: 55 }];
const debtB = [{ end: '2024-03-31', val: 20 }];
const totalDebt = sumInstantSeries([debtA, debtB]);
assert.strictEqual(totalDebt.find((d) => d.end === '2024-03-31').val, 70);
assert.strictEqual(totalDebt.find((d) => d.end === '2024-06-30').val, 55);
console.log('OK: sumInstantSeries unions dates and sums present components');

const near = nearestOnOrBefore(
  [{ end: '2024-01-05', val: 1 }, { end: '2024-03-29', val: 2 }, { end: '2024-07-01', val: 3 }],
  '2024-03-31'
);
assert.strictEqual(near.val, 2, 'should pick nearest price on/before the target date');
console.log('OK: nearestOnOrBefore');

console.log('\nAll xbrl.js sanity checks passed.');
