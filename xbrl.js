// Pure functions for turning SEC XBRL companyfacts JSON into quarterly series.
// No network calls in this file - keeps it unit-testable (see xbrl.test.js).

const DAY = 86400000;

function daysBetween(a, b) {
return Math.round((new Date(b) - new Date(a)) / DAY);
}

// Pick the first tag in `tags` that has a non-empty unit series in `facts[taxonomy]`.
// Returns { tag, raw: [{start?,end,val,fy,fp,form,filed}] } or null.
function pickConcept(facts, taxonomy, tags, unitKeys) {
const node = facts && facts[taxonomy];
if (!node) return null;
for (const tag of tags) {
const concept = node[tag];
if (!concept || !concept.units) continue;
for (const uk of unitKeys) {
const arr = concept.units[uk];
if (arr && arr.length) return { tag, unit: uk, raw: arr };
}
}
return null;
}

// Dedupe instant (point-in-time) facts by `end` date, keeping the most recently filed value.
function dedupeInstant(raw) {
const byEnd = new Map();
for (const f of raw) {
if (f.val === undefined || f.val === null || !f.end) continue;
const prev = byEnd.get(f.end);
if (!prev || (f.filed || '') > (prev.filed || '')) byEnd.set(f.end, f);
}
return [...byEnd.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
}

// Turn duration facts (which may be discrete-quarter or YTD-cumulative, mixed) into
// discrete quarterly values by grouping on `start` date and diffing successive `end`s.
// This works whether a company tags true discrete quarters (each group has 1 entry)
// or cumulative YTD figures (cash-flow statements almost always do).
function deriveQuarterly(raw) {
if (!raw || !raw.length) return [];

const byStart = new Map();
for (const f of raw) {
if (f.val === undefined || f.val === null || !f.start || !f.end) continue;
if (f.end <= f.start) continue;
const key = f.start;
if (!byStart.has(key)) byStart.set(key, []);
byStart.get(key).push(f);
}

const discrete = []; // {start, end, val, filed, durationDays}
for (const group of byStart.values()) {
// same start date, keep the most-recently-filed value per distinct end date
const byEnd = new Map();
for (const f of group) {
const prev = byEnd.get(f.end);
if (!prev || (f.filed || '') > (prev.filed || '')) byEnd.set(f.end, f);
}
const sorted = [...byEnd.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
let prevVal = 0;
let prevEnd = sorted.length ? sorted[0].start : null;
for (const f of sorted) {
const val = f.val - prevVal;
discrete.push({
start: prevEnd,
end: f.end,
val,
filed: f.filed,
durationDays: daysBetween(prevEnd, f.end),
});
prevVal = f.val;
prevEnd = f.end;
}
}

// Dedupe by end date: several fiscal-year groupings can produce a value for the
// same end date (e.g. restatements). Prefer the one closest to a true ~91-day
// quarter, then the most recently filed.
const byEndDate = new Map();
for (const d of discrete) {
if (d.durationDays < 60 || d.durationDays > 100) continue; // keep only quarter-length
const prev = byEndDate.get(d.end);
if (!prev) {
byEndDate.set(d.end, d);
continue;
}
const prevScore = Math.abs(prev.durationDays - 91);
const curScore = Math.abs(d.durationDays - 91);
if (curScore < prevScore || (curScore === prevScore && (d.filed || '') > (prev.filed || ''))) {
byEndDate.set(d.end, d);
}
}

return [...byEndDate.values()].sort((a, b) => (a.end < b.end ? -1 : 1));
}

// Rolling trailing-4-quarter sum over a discrete quarterly series.
function trailingSum(quarterly) {
const out = [];
for (let i = 3; i < quarterly.length; i++) {
const window = quarterly.slice(i - 3, i + 1);
out.push({ end: quarterly[i].end, val: window.reduce((s, q) => s + q.val, 0) });
}
return out;
}

// Nearest instant/series value on or before `date`, within `maxDays` gap. Falls back
// to nearest after if nothing before exists within range.
function nearestOnOrBefore(series, date, maxDays = 20) {
let best = null;
for (const p of series) {
if (p.end > date) continue;
if (!best || p.end > best.end) best = p;
}
if (best && daysBetween(best.end, date) <= maxDays) return best;
// fall back to nearest after, small tolerance
let after = null;
for (const p of series) {
if (p.end < date) continue;
if (!after || p.end < after.end) after = p;
}
if (after && daysBetween(date, after.end) <= maxDays) return after;
return null;
}

// Sum multiple instant series by date (union of dates that appear in ANY component,
// missing components treated as 0). Used for combining debt tags into one "total debt".
function sumInstantSeries(seriesList) {
const dates = new Set();
for (const s of seriesList) for (const p of s) dates.add(p.end);
const out = [];
for (const end of dates) {
let sum = 0;
let any = false;
for (const s of seriesList) {
const hit = s.find((p) => p.end === end);
if (hit) {
sum += hit.val;
any = true;
}
}
if (any) out.push({ end, val: sum });
}
return out.sort((a, b) => (a.end < b.end ? -1 : 1));
}

const REVENUE_TAGS = [
'Revenues',
'RevenueFromContractWithCustomerExcludingAssessedTax',
'RevenueFromContractWithCustomerIncludingAssessedTax',
'SalesRevenueNet',
'SalesRevenueGoodsNet',
];
const NET_INCOME_TAGS = ['NetIncomeLoss', 'ProfitLoss'];
const OCF_TAGS = [
'NetCashProvidedByUsedInOperatingActivities',
'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations',
];
const CAPEX_TAGS = [
'PaymentsToAcquirePropertyPlantAndEquipment',
'PaymentsForCapitalImprovements',
'PaymentsToAcquireProductiveAssets',
];
const EQUITY_TAGS = [
'StockholdersEquity',
'StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest',
];
const SHARES_TAGS_USGAAP = ['CommonStockSharesOutstanding'];
const SHARES_TAGS_DEI = ['EntityCommonStockSharesOutstanding'];

const DEBT_COMBOS = [
['LongTermDebt'],
['LongTermDebtNoncurrent', 'LongTermDebtCurrent', 'ShortTermBorrowings'],
['DebtLongtermAndShorttermCombinedAmount'],
['Liabilities'], // last-resort fallback (total liabilities, flagged to caller)
];

// Build every chart series from a raw SEC companyfacts payload.
// Returns null pieces for anything the filer never tagged.
function buildFundamentals(companyFacts) {
const facts = companyFacts.facts || {};

const rev = pickConcept(facts, 'us-gaap', REVENUE_TAGS, ['USD']);
const ni = pickConcept(facts, 'us-gaap', NET_INCOME_TAGS, ['USD']);
const ocf = pickConcept(facts, 'us-gaap', OCF_TAGS, ['USD']);
const capex = pickConcept(facts, 'us-gaap', CAPEX_TAGS, ['USD']);
const equity = pickConcept(facts, 'us-gaap', EQUITY_TAGS, ['USD']);

let sharesRaw = pickConcept(facts, 'dei', SHARES_TAGS_DEI, ['shares']);
if (!sharesRaw) sharesRaw = pickConcept(facts, 'us-gaap', SHARES_TAGS_USGAAP, ['shares']);

let debtTag = null;
let debtSeries = [];
let debtIsFallbackLiabilities = false;
for (const combo of DEBT_COMBOS) {
const parts = combo
.map((tag) => pickConcept(facts, 'us-gaap', [tag], ['USD']))
.filter(Boolean);
if (!parts.length) continue;
const series = sumInstantSeries(parts.map((p) => dedupeInstant(p.raw)));
if (series.length) {
debtTag = combo.join('+');
debtSeries = series;
debtIsFallbackLiabilities = combo[0] === 'Liabilities';
break;
}
}

const revenueQ = rev ? deriveQuarterly(rev.raw) : [];
const niQ = ni ? deriveQuarterly(ni.raw) : [];
const ocfQ = ocf ? deriveQuarterly(ocf.raw) : [];
const capexQ = capex ? deriveQuarterly(capex.raw) : [];
const equitySeries = equity ? dedupeInstant(equity.raw) : [];
const sharesSeries = sharesRaw ? dedupeInstant(sharesRaw.raw) : [];

// FCF per quarter = OCF - capex (capex is reported as a positive outflow amount).
const capexByEnd = new Map(capexQ.map((q) => [q.end, q.val]));
const fcfQ = ocfQ.map((q) => ({ end: q.end, val: q.val - (capexByEnd.get(q.end) || 0) }));

const revenueTTM = trailingSum(revenueQ);
const niTTM = trailingSum(niQ);
const fcfTTM = trailingSum(fcfQ);

return {
tags: {
revenue: rev && rev.tag,
netIncome: ni && ni.tag,
operatingCashFlow: ocf && ocf.tag,
capex: capex && capex.tag,
equity: equity && equity.tag,
debt: debtTag,
debtIsFallbackLiabilities,
shares: sharesRaw && sharesRaw.tag,
},
revenueTTM,
niTTM,
fcfTTM,
equitySeries,
debtSeries,
sharesSeries,
};
}

module.exports = {
pickConcept,
dedupeInstant,
deriveQuarterly,
trailingSum,
nearestOnOrBefore,
sumInstantSeries,
buildFundamentals,
};
