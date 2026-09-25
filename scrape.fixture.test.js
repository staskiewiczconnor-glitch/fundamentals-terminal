// Fixture-based test for scrape.js's parsing logic, built from real captured
// stockanalysis.com table markup (AAPL, quarterly). No network needed.
const assert = require('assert');
const cheerio = require('cheerio');
const { parseTable, parseNum, trailingSum } = require('./scrape');

function tableHTML(id, headers, rows) {
  const thead = `<thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>`;
  const tbody = `<tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')}</tbody>`;
  return `<table id="${id}">${thead}${tbody}</table>`;
}

const incomeHeaders = ['Fiscal Quarter', 'Q3 2026', 'Q2 2026', 'Q1 2026', 'Q4 2025'];
const mainRows = [
  ['Revenue', '109.42', '111.18', '143.76', '102.47'],
  ['Shares Outstanding (Diluted)', '15', '15', '15', '15'],
];
const addlRows = [['Free Cash Flow', '31.91', '26.73', '51.55', '26.49']];

const ratiosHeaders = ['Fiscal Quarter', 'Current', 'Q3 2026', 'Q2 2026', 'Q1 2026', 'Q4 2025'];
const priceRows = [['PE Ratio', '38.54', '32.33', '29.80', '34.30', '33.85']];
const effRows = [
  ['Debt / Equity Ratio', '0.78', '0.78', '0.80', '1.03', '1.52'],
  ['Return on Equity (ROE)', '111.36%', '121.54%', '207.98%', '157.44%', '141.35%'],
];

const $i = cheerio.load(
  tableHTML('main-table-main', incomeHeaders, mainRows) +
    tableHTML('main-table-additional-metrics', incomeHeaders, addlRows)
);
const $r = cheerio.load(
  tableHTML('main-table-price-ratios', ratiosHeaders, priceRows) +
    tableHTML('main-table-financial-efficiency', ratiosHeaders, effRows)
);

const mainTable = parseTable($i, $i('#main-table-main'));
assert.strictEqual(mainTable['Revenue']['Q1 2026'], '143.76');
assert.strictEqual(mainTable['Revenue']['Q3 2026'], '109.42');
console.log('OK: parseTable reads income-statement rows by quarter label');

const effTable = parseTable($r, $r('#main-table-financial-efficiency'));
// "Current" column must be dropped (not a fiscal-quarter label) - only 4 real quarters kept.
assert.strictEqual(Object.keys(effTable['Return on Equity (ROE)']).length, 4);
assert.strictEqual(effTable['Return on Equity (ROE)']['Q1 2026'], '157.44%');
assert.strictEqual(effTable['Return on Equity (ROE)']['Q2 2026'], '207.98%');
console.log('OK: parseTable drops the non-quarter "Current" column');

assert.strictEqual(parseNum('109.42'), 109.42);
assert.strictEqual(parseNum('111.36%'), 111.36);
assert.strictEqual(parseNum('-'), null);
assert.strictEqual(parseNum(undefined), null);
console.log('OK: parseNum handles commas/%/dashes/missing');

const ttm = trailingSum([
  { end: 'Q4 2025', val: 102.47 },
  { end: 'Q1 2026', val: 143.76 },
  { end: 'Q2 2026', val: 111.18 },
  { end: 'Q3 2026', val: 109.42 },
]);
assert.strictEqual(ttm.length, 1);
assert.strictEqual(Math.round(ttm[0].val * 100) / 100, 466.83);
console.log('OK: trailingSum over 4 discrete quarters ->', ttm[0].val);

console.log('\nAll scrape.js fixture checks passed.');
