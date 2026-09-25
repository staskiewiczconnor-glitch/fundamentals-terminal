// Ticker -> 6 fundamentals charts. Data sources: SEC EDGAR XBRL (company facts, free,
// no key) for financial-statement data, and Stooq (free, no key) for daily close prices.
// Both are fetched server-side (neither sets browser CORS headers, so this can't be a
// pure static page) and cached in memory.
const express = require('express');
const path = require('path');
const { buildFundamentals, nearestOnOrBefore } = require('./xbrl');

const PORT = process.env.PORT || 3000;
// SEC asks every client to identify itself: https://www.sec.gov/os/webmaster-faq#developers
// Set SEC_USER_AGENT in your environment to "Your Name your@email.com" before deploying.
const SEC_UA = process.env.SEC_USER_AGENT || 'ticker-fundamentals-app connor.dev@example.com';

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ---------- tiny in-memory cache ----------
const cache = new Map(); // key -> { at, ttl, data }
function cacheGet(key) {
const hit = cache.get(key);
if (!hit) return undefined;
if (Date.now() - hit.at > hit.ttl) {
cache.delete(key);
return undefined;
}
return hit.data;
}
function cacheSet(key, data, ttl) {
cache.set(key, { at: Date.now(), ttl, data });
}

const HOUR = 3600 * 1000;

async function fetchJSON(url, headers) {
const res = await fetch(url, { headers });
if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
return res.json();
}
async function fetchText(url, headers) {
const res = await fetch(url, { headers });
if (!res.ok) throw new Error(`${res.status} ${res.statusText} fetching ${url}`);
return res.text();
}

// ---------- ticker -> CIK ----------
async function loadTickerMap() {
const cached = cacheGet('tickerMap');
if (cached) return cached;
const json = await fetchJSON('https://www.sec.gov/files/company_tickers.json', {
'User-Agent': SEC_UA,
});
const map = new Map();
for (const row of Object.values(json)) {
map.set(String(row.ticker).toUpperCase(), {
cik: String(row.cik_str).padStart(10, '0'),
name: row.title,
});
}
cacheSet('tickerMap', map, 24 * HOUR);
return map;
}

async function loadCompanyFacts(cik) {
const key = `facts:${cik}`;
const cached = cacheGet(key);
if (cached) return cached;
const json = await fetchJSON(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
'User-Agent': SEC_UA,
});
cacheSet(key, json, 12 * HOUR);
return json;
}

// ---------- price history (Stooq, free daily CSV) ----------
function parseStooqCSV(csv) {
const lines = csv.trim().split('\n');
const out = [];
for (let i = 1; i < lines.length; i++) {
const [date, , , , close] = lines[i].split(',');
const c = parseFloat(close);
if (date && Number.isFinite(c)) out.push({ end: date, val: c });
}
return out;
}
async function loadPriceHistory(ticker) {
const key = `price:${ticker}`;
const cached = cacheGet(key);
if (cached) return cached;
const csv = await fetchText(`https://stooq.com/q/d/l/?s=${ticker.toLowerCase()}.us&i=d`, {
'User-Agent': 'Mozilla/5.0 (compatible; ticker-fundamentals-app/1.0)',
});
if (/not found|exceeded/i.test(csv) || csv.trim().split('\n').length < 5) {
cacheSet(key, [], HOUR); // remember the miss briefly so repeated requests don't hammer stooq
return [];
}
const series = parseStooqCSV(csv);
cacheSet(key, series, 6 * HOUR);
return series;
}

// ---------- helpers ----------
const M = 1e6; // display everything in millions, like the reference charts
function toMillions(v) {
return v == null ? null : Math.round((v / M) * 100) / 100;
}
function pctChange(cur, prev) {
if (cur == null || prev == null || prev === 0) return null;
return Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;
}
function pointAt(series, date) {
const hit = nearestOnOrBefore(series, date, 20);
return hit ? hit.val : null;
}

async function buildResponse(ticker, years) {
const [tickerMap] = await Promise.all([loadTickerMap()]);
const entry = tickerMap.get(ticker.toUpperCase());
if (!entry) {
const err = new Error(`"${ticker}" isn't a ticker SEC has on file (US-listed filers only).`);
err.status = 404;
throw err;
}

const [facts, priceSeries] = await Promise.all([
loadCompanyFacts(entry.cik),
loadPriceHistory(ticker).catch(() => []),
]);

const f = buildFundamentals(facts);

// Quarter-end dates come from whichever instant series is populated (equity, else
// debt, else shares) - these track the filer's actual fiscal quarter ends.
const anchorDates = (f.equitySeries.length ? f.equitySeries : f.debtSeries.length ? f.debtSeries : f.sharesSeries)
.map((p) => p.end)
.sort();
const cutoff = new Date();
cutoff.setFullYear(cutoff.getFullYear() - years);
const cutoffISO = cutoff.toISOString().slice(0, 10);
const dates = anchorDates.filter((d) => d >= cutoffISO);

const quarters = dates.map((end) => {
const equity = pointAt(f.equitySeries, end);
const debt = pointAt(f.debtSeries, end);
const shares = pointAt(f.sharesSeries, end);
const revenueTTM = pointAt(f.revenueTTM, end);
const fcfTTM = pointAt(f.fcfTTM, end);
const niTTM = pointAt(f.niTTM, end);
const price = priceSeries.length ? pointAt(priceSeries, end) : null;

const debtEquity = debt != null && equity ? Math.round((debt / equity) * 1000) / 1000 : null;
const roeTTM = niTTM != null && equity ? Math.round((niTTM / equity) * 1000) / 1000 : null;
const marketCap = price != null && shares != null ? price * shares : null;
const peRatio = marketCap != null && niTTM ? Math.round((marketCap / niTTM) * 100) / 100 : null;

return {
end,
revenueTTM: toMillions(revenueTTM),
fcfTTM: toMillions(fcfTTM),
debtEquity,
peRatio,
roeTTM,
sharesOutstanding: toMillions(shares),
};
});

const latest = quarters[quarters.length - 1] || null;
const prevYear = quarters[quarters.length - 5] || null; // 4 quarters back

return {
ticker: ticker.toUpperCase(),
name: entry.name,
cik: entry.cik,
priceDataAvailable: priceSeries.length > 0,
tags: f.tags,
quarters,
summary: latest && {
asOf: latest.end,
revenueTTM: { value: latest.revenueTTM, yoyPct: pctChange(latest.revenueTTM, prevYear && prevYear.revenueTTM) },
fcfTTM: { value: latest.fcfTTM, yoyPct: pctChange(latest.fcfTTM, prevYear && prevYear.fcfTTM) },
debtEquity: { value: latest.debtEquity, yoyPct: pctChange(latest.debtEquity, prevYear && prevYear.debtEquity) },
peRatio: { value: latest.peRatio, yoyPct: pctChange(latest.peRatio, prevYear && prevYear.peRatio) },
roeTTM: { value: latest.roeTTM, yoyPct: pctChange(latest.roeTTM, prevYear && prevYear.roeTTM) },
sharesOutstanding: {
value: latest.sharesOutstanding,
yoyPct: pctChange(latest.sharesOutstanding, prevYear && prevYear.sharesOutstanding),
},
},
};
}

app.get('/api/fundamentals/:ticker', async (req, res) => {
const years = Math.min(Math.max(parseInt(req.query.years, 10) || 5, 1), 15);
try {
const data = await buildResponse(req.params.ticker, years);
res.json(data);
} catch (err) {
res.status(err.status || 500).json({ error: err.message });
}
});

app.listen(PORT, () => console.log(`ticker-fundamentals listening on http://localhost:${PORT}`));
