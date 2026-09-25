// Scrapes stockanalysis.com's quarterly financial-statement pages for a ticker.
// No API key, no formal rate limit - robots.txt explicitly allows /stocks/ paths
// for general crawlers (only dotbot/BLEXBot/mj12bot are blocked site-wide).
// Two page fetches per ticker:
//   /stocks/{T}/financials/income-statement/?p=quarterly  -> Revenue, Free Cash Flow, Shares Outstanding
//   /stocks/{T}/financials/ratios/?p=quarterly             -> P/E, Debt/Equity, ROE
const cheerio = require('cheerio');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchHTML(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
  return res.text();
}

// Turn a table id like "main-table-main" into { rowLabel: { "Q1 2024": "1,234", ... } },
// keyed only by columns whose header matches a fiscal-quarter label (drops "Current",
// "Fiscal Quarter", TTM, and any other non-quarter column stockanalysis.com adds).
function parseTable($, tableEl) {
  if (!tableEl || !tableEl.length) return {};
  const headers = [];
  tableEl
    .find('thead tr')
    .first()
    .find('th, td')
    .each((i, el) => headers.push($(el).text().trim()));

  const rows = {};
  tableEl.find('tbody tr').each((i, tr) => {
    const cells = [];
    $(tr)
      .find('td, th')
      .each((j, el) => cells.push($(el).text().trim()));
    if (!cells.length) return;
    const label = cells[0];
    const byQuarter = {};
    for (let k = 1; k < cells.length && k < headers.length; k++) {
      const h = headers[k];
      if (h && /^Q[1-4]\s\d{4}$/.test(h)) byQuarter[h] = cells[k];
    }
    rows[label] = byQuarter;
  });
  return rows;
}

function parseNum(raw) {
  if (raw == null) return null;
  const t = String(raw).replace(/[,%$]/g, '').trim();
  if (t === '' || t === '-' || t === 'N/A' || t === 'n/a' || t === 'NM') return null;
  const v = parseFloat(t);
  return Number.isFinite(v) ? v : null;
}

// Rolling trailing-4-quarter sum over an oldest-first [{end, val}] series (val already
// numeric, non-null gaps allowed - a gap just resets the window it falls inside).
function trailingSum(series) {
  const out = [];
  for (let i = 3; i < series.length; i++) {
    const window = series.slice(i - 3, i + 1);
    if (window.some((q) => q.val == null)) continue;
    out.push({ end: series[i].end, val: window.reduce((s, q) => s + q.val, 0) });
  }
  return out;
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

async function scrapeTicker(ticker) {
  const slug = ticker.toLowerCase();
  const incomeURL = `https://stockanalysis.com/stocks/${slug}/financials/income-statement/?p=quarterly`;
  const ratiosURL = `https://stockanalysis.com/stocks/${slug}/financials/ratios/?p=quarterly`;

  const [incomeHTML, ratiosHTML] = await Promise.all([fetchHTML(incomeURL), fetchHTML(ratiosURL)]);

  const $i = cheerio.load(incomeHTML);
  const $r = cheerio.load(ratiosHTML);

  const titleText = $i('title').text();
  const mainTableEl = $i('#main-table-main');
  if (/page not found/i.test(titleText) || !mainTableEl.length) {
    const err = new Error(`"${ticker}" isn't a ticker stockanalysis.com has data for.`);
    err.status = 404;
    throw err;
  }
  const nameMatch = titleText.match(/^(.*?)\s*\(/);
  const name = nameMatch ? nameMatch[1].trim() : ticker.toUpperCase();

  const mainTable = parseTable($i, mainTableEl);
  const addlTable = parseTable($i, $i('#main-table-additional-metrics'));
  const priceTable = parseTable($r, $r('#main-table-price-ratios'));
  const effTable = parseTable($r, $r('#main-table-financial-efficiency'));

  const revenueByQ = mainTable['Revenue'] || {};
  const sharesByQ = mainTable['Shares Outstanding (Diluted)'] || mainTable['Shares Outstanding (Basic)'] || {};
  const fcfByQ = addlTable['Free Cash Flow'] || {};
  const peByQ = priceTable['PE Ratio'] || {};
  const deByQ = effTable['Debt / Equity Ratio'] || {};
  const roeByQ = effTable['Return on Equity (ROE)'] || {};

  // Master quarter order comes from the income-statement header row (Revenue is the
  // one metric every filer has), oldest -> newest so trailingSum can walk forward.
  const headers = [];
  mainTableEl
    .find('thead tr')
    .first()
    .find('th, td')
    .each((i, el) => headers.push($i(el).text().trim()));
  const quarterLabels = headers.filter((h) => /^Q[1-4]\s\d{4}$/.test(h)).reverse();

  const revenueQ = quarterLabels.map((label) => ({ end: label, val: parseNum(revenueByQ[label]) }));
  const fcfQ = quarterLabels.map((label) => ({ end: label, val: parseNum(fcfByQ[label]) }));

  // Figures on the page are in billions (e.g. "109.42"); charts display millions.
  const revenueTTM = trailingSum(revenueQ).map((q) => ({ end: q.end, val: round2(q.val * 1000) }));
  const fcfTTM = trailingSum(fcfQ).map((q) => ({ end: q.end, val: round2(q.val * 1000) }));

  const revenueTTMByQ = new Map(revenueTTM.map((q) => [q.end, q.val]));
  const fcfTTMByQ = new Map(fcfTTM.map((q) => [q.end, q.val]));

  // Only emit quarters where at least revenue TTM is computable (needs 4 quarters of
  // history) - mirrors the old SEC-based app's anchor, and keeps the chart's leading
  // edge from showing a run of empty bars.
  const anchorQuarters = quarterLabels.filter((label) => revenueTTMByQ.has(label));

  const quarters = anchorQuarters.map((label) => {
    const shares = parseNum(sharesByQ[label]); // billions, rounded by the source site
    const roePct = parseNum(roeByQ[label]); // e.g. 111.36 meaning 111.36%
    return {
      end: label,
      revenueTTM: revenueTTMByQ.get(label) ?? null,
      fcfTTM: fcfTTMByQ.get(label) ?? null,
      debtEquity: parseNum(deByQ[label]),
      peRatio: parseNum(peByQ[label]),
      roeTTM: roePct == null ? null : Math.round((roePct / 100) * 1000) / 1000,
      sharesOutstanding: shares == null ? null : round2(shares * 1000),
    };
  });

  return { ticker: ticker.toUpperCase(), name, quarters };
}

module.exports = { scrapeTicker, parseTable, parseNum, trailingSum };
