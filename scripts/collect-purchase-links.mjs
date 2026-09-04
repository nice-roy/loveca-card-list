// Read-only public-page collection. No images, carts, or account actions are fetched.
import fs from 'node:fs';
import { createHash } from 'node:crypto';

const work = 'work/purchase-links';
fs.mkdirSync(work, { recursive: true });
const cards = JSON.parse(fs.readFileSync('app/data/cards.json', 'utf8'));
const normalize = (s) => s.normalize('NFKC').replace(/\s/g, '').toLowerCase();
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
const text = (s) => decode(s.replace(/<[^>]+>/g, '')).trim();
const cache = new Map();
async function page(url) {
  if (cache.has(url)) return cache.get(url);
  const file = `${work}/${createHash('sha256').update(url).digest('hex')}.json`;
  if (fs.existsSync(file)) { const data = JSON.parse(fs.readFileSync(file)); cache.set(url, data); return data; }
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  const data = { url: res.url, status: res.status, html: await res.text() };
  fs.writeFileSync(file, JSON.stringify(data)); cache.set(url, data); return data;
}
const existing = [];
for (const kind of ['members', 'live']) {
  const url = `https://liella-card-list.pages.dev/${kind}/`;
  const data = await page(url);
  if (data.status !== 200) throw Error(`Source failed ${url}`);
  for (const row of data.html.matchAll(/<tr\b[^>]*data-cardno="([^"]+)"[^>]*>[\s\S]*?<\/tr>/g)) {
    const links = [...row[0].matchAll(/href="(https:\/\/www\.c-labo-online\.jp\/[^"\s]+)"/g)];
    if (links.length) existing.push({ cardNumber: decode(row[1]), url: decode(links[0][1]), source: url });
  }
}
fs.writeFileSync(`${work}/existing.json`, JSON.stringify(existing, null, 2));
console.log('Existing Liella links', existing.length, 'direct', existing.filter(x=>/\/product\/\d+$/.test(x.url)).length);

const candidates = new Map();
const seeds = [
  'https://www.c-labo-online.jp/product-list/0/0/normal?keyword=PL%21SP-&num=120',
  'https://www.c-labo-online.jp/product-list/0/0/normal?keyword=PL%21S-&num=120',
  ...existing.filter(x => !x.cardNumber.startsWith('PL!SP-')).map(x=>x.url),
];
const seen = new Set();
for (const seed of seeds) {
  let url = seed;
  while (url && !seen.has(url)) {
    seen.add(url);
    const data = await page(url);
    if (data.status !== 200) throw Error(`Listing failed ${url}: ${data.status}`);
    for (const anchor of data.html.matchAll(/<a\b[^>]*href="(https:\/\/www\.c-labo-online\.jp\/product\/\d+)"[^>]*>([\s\S]*?)<\/a>/g)) {
      const title = anchor[2].match(/<p class="item_name">([\s\S]*?)<\/p>/)?.[1];
      if (!title) continue;
      const titleText = text(title);
      if (!titleText.startsWith('【ラブカ】')) continue;
      const number = titleText.match(/(?:PL![A-Z]*|LL)-[A-Za-z0-9]+-[A-Za-z0-9]+-[A-Za-z0-9＋+]+/g)?.at(-1);
      if (!number) continue;
      const key = normalize(number);
      const list = candidates.get(key) || [];
      if (!list.some(x=>x.url===anchor[1])) list.push({url:anchor[1],title:titleText,listing:url});
      candidates.set(key,list);
    }
    console.log('Listing', seen.size, 'card variants', candidates.size);
    const next = data.html.match(/<link rel="next" href="([^"]+)"/);
    url = next ? decode(next[1]) : null;
  }
}
fs.writeFileSync(`${work}/candidates.json`, JSON.stringify(Object.fromEntries(candidates), null, 2));
const sourceByNumber = new Map(existing.map(x=>[normalize(x.cardNumber),x]));
const targets = cards.filter(c=>c.groupIds.includes('liella')||c.groupIds.includes('aqours'));
const report = { checkedAt: new Date().toISOString(), sourceLinks: existing.length, sourceDirectLinks: existing.filter(x=>/\/product\/\d+$/.test(x.url)).length, registered: [], unregistered: [] };
for (let index=0; index<targets.length; index++) {
  const card = targets[index];
  const key = normalize(card.cardNumber);
  const source = sourceByNumber.get(key);
  const options = candidates.get(key) || [];
  if (card.groupIds.includes('liella') && !source) { report.unregistered.push({cardNumber:card.cardNumber,reason:'no-existing-source-link'}); continue; }
  const verified = [];
  for (const option of options) {
    // Exclude discounted/damaged and alternate physical versions rather than choosing by price.
    if (option.title.includes('※') || option.title.includes('特価') || option.title.includes('状態')) continue;
    const match = option.title.match(/^【ラブカ】(.+?)【([^】]+)】(.+)$/);
    if (!match) continue;
    const rarity = card.cardNumber.split('-').at(-1);
    // Shop-only annotations, with the full printed card number still required to match.
    const shopName = ['SEC', 'PP'].includes(rarity) ? match[1].replace(/[（(]サイン[）)]$/, '') : match[1];
    const shopRarity = match[2].replace(/\/再録$/, '');
    if (normalize(shopName) !== normalize(card.name) || normalize(match[3]) !== key || normalize(shopRarity) !== normalize(rarity)) continue;
    try {
      const detail = await page(option.url);
      const headings = [...detail.html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map(m=>text(m[1]));
      if (detail.status===200 && /^https:\/\/www\.c-labo-online\.jp\/product\/\d+$/.test(detail.url) && headings.some(h=>normalize(h)===normalize(option.title))) verified.push({...option,detailTitle:headings.find(h=>normalize(h)===normalize(option.title))});
    } catch (error) { console.log('Detail check unavailable', option.url, error.message); }
  }
  if (verified.length===1) report.registered.push({cardNumber:card.cardNumber,cardId:card.id,group:card.groupIds.includes('liella')?'liella':'aqours',...verified[0],source:source?.url||null});
  else report.unregistered.push({cardNumber:card.cardNumber,reason:verified.length>1?'ambiguous-multiple-pages':options.length?'identity-or-page-not-confirmed':'no-individual-page-found',candidates:options});
  if(index%25===0) console.log('Checked',index+1,'/',targets.length,'registered',report.registered.length);
}
fs.writeFileSync(`${work}/report.json`, JSON.stringify(report,null,2)+'\n');
console.log('RESULT',JSON.stringify({registered:report.registered.length,liella:report.registered.filter(x=>x.group==='liella').length,aqours:report.registered.filter(x=>x.group==='aqours').length,unregistered:report.unregistered.length}));
