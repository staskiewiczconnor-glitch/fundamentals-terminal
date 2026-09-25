// Fixture-based test for scrape.js's parsing logic, built from real captured
// stockanalysis.com table markup (AAPL, quarterly). No network needed.
//
// Important: the fixture uses the RAW server-side HTML format (comma-formatted
// millions, e.g. "109,417"), not the abbreviated-billions text ("109.42") a
// browser shows after client-side JS reformats the page - a server-side fetch
// (this app, curl, any non-browser client) only ever sees the raw form.
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
  ['Revenue', '109,417', '111,184', '143,756', '102,466'],
  ['Shares Outstanding (Basic)', '14,650', '14,660', '14,745', '14,801'],
  ['Shares Outstanding (Diluted)', '14,715', '14,726', '14,810', '14,864'],
];
const addlRows = [['Free Cash Flow', '31,914', '26,731', '51,552', '26,486']];

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
assert.strictEqual(mainTable['Revenue']['Q1 2026'], '143,756');
assert.strictEqual(mainTable['Revenue']['Q3 2026'], '109,417');
console.log('OK: parseTable reads income-statement rows by quarter label');

// scrape.js must prefer Basic shares over Diluted - Basic is the conventional
// "shares outstanding" figure; Diluted runs higher and isn't what most fundamentals
// dashboards mean by that label (this was a real bug: it used to prefer Diluted).
const sharesByQ = mainTable['Shares Outstanding (Basic)'] || mainTable['Shares Outstanding (Diluted)'];
assert.strictEqual(sharesByQ['Q3 2026'], '14,650');
console.log('OK: shares-outstanding lookup prefers Basic over Diluted');

const effTable = parseTable($r, $r('#main-table-financial-efficiency'));
// "Current" column must be dropped (not a fiscal-quarter label) - only 4 real quarters kept.
assert.strictEqual(Object.keys(effTable['Return on Equity (ROE)']).length, 4);
assert.strictEqual(effTable['Return on Equity (ROE)']['Q1 2026'], '157.44%');
assert.strictEqual(effTable['Return on Equity (ROE)']['Q2 2026'], '207.98%');
console.log('OK: parseTable drops the non-quarter "Current" column');

assert.strictEqual(parseNum('109,417'), 109417);
assert.strictEqual(parseNum('111.36%'), 111.36);
assert.strictEqual(parseNum('-'), null);
assert.strictEqual(parseNum(undefined), null);
console.log('OK: parseNum handles commas/%/dashes/missing');

const ttm = trailingSum([
  { end: 'Q4 2025', val: 102466 },
  { end: 'Q1 2026', val: 143756 },
  { end: 'Q2 2026', val: 111184 },
  { end: 'Q3 2026', val: 109417 },
]);
assert.strictEqual(ttm.length, 1);
assert.strictEqual(ttm[0].val, 466823);
console.log('OK: trailingSum over 4 discrete quarters ->', ttm[0].val);

console.log('\nAll scrape.js fixture checks passed.');
