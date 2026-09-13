// Read-only external audit. Results and fetched pages are written under ignored work/.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const cards = JSON.parse(fs.readFileSync('app/data/cards.json', 'utf8'));
const liveCards = cards.filter((card) => card.cardType === 'live');
const workDir = 'work/live-purchase-links';
const cacheDir = `${workDir}/cache`;
fs.mkdirSync(cacheDir, { recursive: true });

const normalize = (value) => value.normalize('NFKC').replace(/\s/g, '').toLowerCase();
const decode = (value) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
const text = (html) => decode(html.replace(/<[^>]+>/g, '')).trim();

async function fetchPage(url) {
  const key = createHash('sha256').update(url).digest('hex');
  const metaPath = `${cacheDir}/${key}.json`;
  const htmlPath = `${cacheDir}/${key}.html`;
  if (fs.existsSync(metaPath) && fs.existsSync(htmlPath)) {
    return { ...JSON.parse(fs.readFileSync(metaPath, 'utf8')), html: fs.readFileSync(htmlPath, 'utf8') };
  }
  const response = await fetch(url, {
    signal: AbortSignal.timeout(45000),
    headers: { 'user-agent': 'loveca-card-list-read-only-audit/1.0' },
  });
  const html = await response.text();
  const meta = { requestUrl: url, url: response.url, status: response.status };
  fs.writeFileSync(metaPath, JSON.stringify(meta));
  fs.writeFileSync(htmlPath, html);
  return { ...meta, html };
}

async function collectPrefix(prefix) {
  const candidates = [];
  const encodedPrefix = encodeURIComponent(prefix).replaceAll('!', '%21');
  let url = `https://www.c-labo-online.jp/product-list/0/0/normal?keyword=${encodedPrefix}&num=120`;
  const seen = new Set();
  while (url && !seen.has(url)) {
    seen.add(url);
    const page = await fetchPage(url);
    if (page.status !== 200) throw new Error(`listing ${page.status}: ${url}`);
    for (const anchor of page.html.matchAll(/<a\b[^>]*href="(https:\/\/www\.c-labo-online\.jp\/product\/\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const titleHtml = anchor[2].match(/<p class="item_name">([\s\S]*?)<\/p>/)?.[1];
      if (!titleHtml) continue;
      const title = text(titleHtml);
      if (!title.startsWith('【ラブカ】')) continue;
      const number = title.match(/(?:PL![A-Z]*|PL!|LL)-[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9＋+]+/g)?.at(-1);
      if (number) candidates.push({ cardNumber: number, url: anchor[1], title, listing: url });
    }
    const next = page.html.match(/<link rel="next" href="([^"]+)"/);
    url = next ? decode(next[1]) : null;
  }
  console.log(`listing ${prefix}: ${seen.size} pages, ${candidates.length} candidates`);
  return { prefix, pages: seen.size, candidates };
}

const missingCards = liveCards.filter((card) => !(card.purchaseLinks ?? []).some((link) => link.shopId === 'cardlabo'));
const prefixes = [...new Set(missingCards.map((card) => `${card.cardNumber.split('-').slice(0, 2).join('-')}-`))];
const prefixQueue = [...prefixes];
const listings = [];
async function listingWorker() {
  while (prefixQueue.length) listings.push(await collectPrefix(prefixQueue.shift()));
}
await Promise.all(Array.from({ length: 6 }, listingWorker));
const candidatesByNumber = new Map();
for (const listing of listings) {
  for (const candidate of listing.candidates) {
    const key = normalize(candidate.cardNumber);
    const values = candidatesByNumber.get(key) ?? [];
    if (!values.some((value) => value.url === candidate.url)) values.push(candidate);
    candidatesByNumber.set(key, values);
  }
}

function candidateMatchesCard(card, candidate) {
  if (candidate.title.includes('※') || candidate.title.includes('特価') || candidate.title.includes('状態')) return false;
  const match = candidate.title.match(/^【ラブカ】(.+?)【([^】]+)】(.+)$/);
  if (!match) return false;
  const rarity = card.cardNumber.split('-').at(-1);
  const shopName = ['SEC', 'PP'].includes(rarity) ? match[1].replace(/[（(]サイン[）)]$/, '') : match[1];
  const shopRarity = match[2].replace(/\/再録$/, '');
  return normalize(shopName) === normalize(card.name)
    && normalize(match[3]) === normalize(card.cardNumber)
    && normalize(shopRarity) === normalize(rarity);
}

async function verifyCandidate(card, candidate) {
  const page = await fetchPage(candidate.url);
  const headings = [...page.html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((match) => text(match[1]));
  const detailTitle = headings.find((heading) => normalize(heading).includes(normalize(card.cardNumber)) && normalize(heading).includes(normalize(card.name)));
  return page.status === 200
    && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(page.url)
    && detailTitle ? detailTitle : null;
}

const queue = missingCards.map((card) => ({ card }));
const auditedMissing = [];
let completed = 0;
async function worker() {
  while (queue.length) {
    const { card } = queue.shift();
    const options = (candidatesByNumber.get(normalize(card.cardNumber)) ?? []).filter((candidate) => candidateMatchesCard(card, candidate));
    const verified = [];
    const errors = [];
    for (const option of options) {
      try {
        const detailTitle = await verifyCandidate(card, option);
        if (detailTitle) verified.push({ ...option, detailTitle });
      } catch (error) {
        errors.push({ url: option.url, error: String(error) });
      }
    }
    auditedMissing.push({
      id: card.id,
      cardNumber: card.cardNumber,
      name: card.name,
      groupIds: card.groupIds,
      classification: verified.length === 1 ? 'B' : 'C',
      verified,
      candidates: options,
      errors,
      reason: verified.length === 1 ? 'verified-single-product-page'
        : verified.length > 1 ? 'ambiguous-multiple-verified-pages'
          : errors.length ? 'detail-page-unavailable'
            : options.length ? 'identity-or-page-not-confirmed'
              : 'no-matching-product-page',
    });
    completed += 1;
    if (completed % 10 === 0 || completed === missingCards.length) console.log(`verified ${completed}/${missingCards.length}`);
  }
}
await Promise.all(Array.from({ length: 10 }, worker));
auditedMissing.sort((left, right) => missingCards.findIndex((card) => card.id === left.id) - missingCards.findIndex((card) => card.id === right.id));

const existing = liveCards.filter((card) => (card.purchaseLinks ?? []).some((link) => link.shopId === 'cardlabo')).map((card) => ({
  id: card.id,
  cardNumber: card.cardNumber,
  name: card.name,
  groupIds: card.groupIds,
  classification: 'existing',
  links: card.purchaseLinks.filter((link) => link.shopId === 'cardlabo'),
}));
const resultsById = new Map([...existing, ...auditedMissing].map((entry) => [entry.id, entry]));
const results = liveCards.map((card) => resultsById.get(card.id));
const report = {
  checkedAt: new Date().toISOString(),
  method: 'Read-only Card Labo listing and direct product-page verification by exact card number, name, and rarity.',
  listingSummary: listings.map(({ prefix, pages, candidates }) => ({ prefix, pages, candidates: candidates.length })),
  counts: {
    live: results.length,
    existing: existing.length,
    B: auditedMissing.filter((entry) => entry.classification === 'B').length,
    C: auditedMissing.filter((entry) => entry.classification === 'C').length,
    errors: auditedMissing.reduce((sum, entry) => sum + entry.errors.length, 0),
  },
  results,
};
fs.writeFileSync(`${workDir}/report.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.counts, null, 2));
