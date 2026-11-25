// Local visual retrieval: coarse color + ORB shortlist, then geometric verification.
// Only same-origin runtime/index GETs are made. Query pixels never leave memory.
import {extractFeatures, base64ToBytes, FEATURE_VERSION, COARSE_EDGE} from './visual-features.mjs';

import {readLiveSignals, LIVE_SIGNAL_REGIONS} from './live-signals.mjs';
import {refineLiveCandidates} from './live-candidates.mjs';
import {createLiveAssetLoader} from './live-assets.mjs';

const ROOT = new URL('../', import.meta.url);
export const LIMITS = Object.freeze({pixels: 24_000_000, processingEdge: 1400, shortlist: 72, recognitionMs: 45_000});
const HASH_TABLES = 6, HASH_BITS = 12, BUCKETS = 1 << HASH_BITS;
const HASH_POSITIONS = Array.from({length: HASH_TABLES}, (_, t) =>
  Array.from({length: HASH_BITS}, (_, b) => (t * 41 + b * 17) % 256));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
// Same one timer / one await as tick(). Counts only time waiting for its callback.
export function recognitionYield(onWait) {
  const start = performance.now();
  return new Promise(resolve => setTimeout(() => {onWait(performance.now() - start); resolve();}, 0));
}
const clamp = (n, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const failure = (code, message) => Object.assign(new Error(message), {code});
const cancelled = () => failure('CANCELLED', '読み取りを中止しました。');
let cvLoading;

export async function loadCV() {
  if (cvLoading) return cvLoading;
  cvLoading = (async () => {
    if (!globalThis.cv) await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/opencv/opencv.js', ROOT).href;
      if (new URL(script.src).origin !== location.origin) return reject(failure('EXTERNAL_ASSET', '認識ファイルの取得先が不正です。'));
      script.async = true;
      script.onload = resolve;
      script.onerror = () => reject(failure('ASSET_LOAD_FAILED', '画像認識ファイルを読み込めませんでした。'));
      document.head.append(script);
    });
    // Emscripten's thenable can resolve to itself; resolve a holder, not cv itself.
    return new Promise((resolve, reject) => {
      const module = globalThis.cv;
      const timer = setTimeout(() => reject(failure('CV_INIT_TIMEOUT', '画像認識の初期化が時間内に完了しませんでした。')), 60_000);
      const ready = value => {clearTimeout(timer); resolve({cv: value});};
      if (module?.Mat) ready(module);
      else if (typeof module?.then === 'function') module.then(ready, e => {clearTimeout(timer); reject(e);});
      else if (module) module.onRuntimeInitialized = () => ready(module);
      else {clearTimeout(timer); reject(failure('CV_UNAVAILABLE', '画像認識を開始できませんでした。'));}
    });
  })();
  try {return await cvLoading;} catch (e) {cvLoading = null; throw e;}
}

function canvasOf(width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas;
}
function release(canvas) {if (canvas) canvas.width = canvas.height = 0;}
function ctx(canvas) {return canvas.getContext('2d', {willReadFrequently: true});}
function workingCanvas(input) {
  if (!input || typeof input.getContext !== 'function' || !Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width < 1 || input.height < 1)
    throw failure('INVALID_IMAGE', '読み取る写真を選択してください。');
  if (input.width * input.height > LIMITS.pixels) throw failure('INPUT_TOO_LARGE', '24MP以下の写真を選択してください。');
  const scale = Math.min(1, LIMITS.processingEdge / Math.max(input.width, input.height));
  const canvas = canvasOf(Math.max(1, Math.round(input.width * scale)), Math.max(1, Math.round(input.height * scale)));
  ctx(canvas).drawImage(input, 0, 0, canvas.width, canvas.height); return canvas;
}

function hash(bytes, offset, table) {
  let value = 0;
  for (let i = 0; i < HASH_BITS; i++) {
    const bit = HASH_POSITIONS[table][i];
    value |= ((bytes[offset + (bit >> 3)] >> (bit & 7)) & 1) << i;
  }
  return value;
}
function popcount(value) {
  value -= (value >>> 1) & 0x55555555;
  value = (value & 0x33333333) + ((value >>> 2) & 0x33333333);
  return (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
function hamming(a, aOffset, b, bOffset, limit = 256) {
  let distance = 0;
  for (let n = 0; n < 8; n++) {distance += popcount(a[aOffset + n] ^ b[bOffset + n]); if (distance > limit) break;}
  return distance;
}

async function buildIndex(json, check, progress) {
  if (json?.schemaVersion !== 1 || !Array.isArray(json.entries) || !json.entries.length || json.entries.length > 20_000)
    throw failure('INDEX_INVALID', '画像索引の形式が正しくありません。');
  const seen = new Set();
  let total = 0;
  for (const entry of json.entries) {
    const f = entry.features;
    if (typeof entry.cardId !== 'string' || !entry.cardId || seen.has(entry.cardId) || typeof entry.cardNumber !== 'string' ||
        f?.version !== FEATURE_VERSION || !Number.isInteger(f.count) || f.count < 0 || f.count > 450 ||
        !Number.isInteger(f.width) || !Number.isInteger(f.height) || f.width < 1 || f.height < 1 || f.width > 1400 || f.height > 1400 ||
        !Array.isArray(f.keypoints) || f.keypoints.length !== f.count * 2 || !Array.isArray(f.coarse) || f.coarse.length !== 768 || typeof f.descriptors !== 'string')
      throw failure('INDEX_INVALID', '画像索引の内容を確認できませんでした。');
    if (f.keypoints.some((v, n) => !Number.isFinite(v) || v < 0 || v > (n % 2 ? f.height : f.width)) || f.coarse.some(v => !Number.isInteger(v) || v < 0 || v > 255))
      throw failure('INDEX_INVALID', '画像索引の特徴量が正しくありません。');
    seen.add(entry.cardId); total += f.count;
  }
  const bytes = new Uint8Array(total * 32), cards = new Uint16Array(total), entries = [];
  let offset = 0;
  for (let i = 0; i < json.entries.length; i++) {
    const entry = json.entries[i], f = entry.features, decoded = base64ToBytes(f.descriptors);
    if (decoded.length !== f.count * 32) throw failure('INDEX_INVALID', '画像索引の特徴量が不足しています。');
    bytes.set(decoded, offset * 32); cards.fill(i, offset, offset + f.count);
    entries.push({cardId: entry.cardId, cardNumber: entry.cardNumber, count: f.count, width: f.width, height: f.height,
      keypoints: new Uint16Array(f.keypoints), coarse: new Uint8Array(f.coarse), offset});
    offset += f.count;
    // Release JSON arrays and strings after copying to bounded typed arrays.
    json.entries[i] = null;
    if (i % 100 === 0) {await tick(); check();}
  }
  const offsets = Array.from({length: HASH_TABLES}, () => new Uint32Array(BUCKETS + 1));
  for (let row = 0; row < total; row++) {
    for (let t = 0; t < HASH_TABLES; t++) offsets[t][hash(bytes, row * 32, t) + 1]++;
    if (row % 30_000 === 0) {progress(0.4 + 0.2 * row / total); await tick(); check();}
  }
  for (const table of offsets) for (let i = 1; i <= BUCKETS; i++) table[i] += table[i - 1];
  const cursors = offsets.map(table => table.slice()), postings = Array.from({length: HASH_TABLES}, () => new Uint32Array(total));
  for (let row = 0; row < total; row++) {
    for (let t = 0; t < HASH_TABLES; t++) postings[t][cursors[t][hash(bytes, row * 32, t)]++] = row;
    if (row % 30_000 === 0) {progress(0.6 + 0.35 * row / total); await tick(); check();}
  }
  return {entries, bytes, words: new Uint32Array(bytes.buffer), cards, offsets, postings, total};
}

function coarseSimilarity(a, b, rotation = 0) {
  let aSum = 0, bSum = 0, aa = 0, bb = 0, ab = 0, color = 0;
  for (let y = 0; y < COARSE_EDGE; y++) for (let x = 0; x < COARSE_EDGE; x++) {
    const ax = rotation === 1 ? y : rotation === 2 ? 15 - x : rotation === 3 ? 15 - y : x;
    const ay = rotation === 1 ? 15 - x : rotation === 2 ? 15 - y : rotation === 3 ? x : y;
    const ai = (ay * COARSE_EDGE + ax) * 3, bi = (y * COARSE_EDGE + x) * 3;
    const av = (a[ai] + a[ai + 1] + a[ai + 2]) / 3, bv = (b[bi] + b[bi + 1] + b[bi + 2]) / 3;
    aSum += av; bSum += bv; aa += av * av; bb += bv * bv; ab += av * bv;
    color += Math.abs((a[ai] - a[ai + 1]) - (b[bi] - b[bi + 1])) + Math.abs((a[ai + 2] - a[ai + 1]) - (b[bi + 2] - b[bi + 1]));
  }
  const corr = (ab - aSum * bSum / 256) / Math.sqrt(Math.max(1, (aa - aSum * aSum / 256) * (bb - bSum * bSum / 256)));
  return 0.76 * clamp(corr) + 0.24 * clamp(1 - color / (256 * 160));
}

async function retrieve(index, queries, check, yieldStep) {
  const count = index.entries.length, votes = queries.map(() => new Float32Array(count));
  const coarse = queries.map(() => new Float32Array(count));
  const stamp = new Uint32Array(index.total), cardStamp = new Uint32Array(count), cardDistance = new Uint16Array(count);
  let serial = 0;
  for (let qi = 0; qi < queries.length; qi++) {
    const query = queries[qi], qWords = new Uint32Array(query.bytes.buffer);
    for (let i = 0; i < count; i++) {
      for (let angle = 0; angle < 4; angle++) coarse[qi][i] = Math.max(coarse[qi][i], coarseSimilarity(index.entries[i].coarse, query.features.coarse, angle));
      if (i % 200 === 0) {await yieldStep(); check();}
    }
    for (let row = 0; row < query.features.count; row++) {
      serial++; const touched = [];
      let best = 81;
      for (let t = 0; t < HASH_TABLES; t++) {
        const bucket = hash(query.bytes, row * 32, t), begin = index.offsets[t][bucket], end = index.offsets[t][bucket + 1];
        // Extremely common descriptors (blank borders / repeated text) do not help retrieval.
        if (end - begin > 3500) continue;
        for (let p = begin; p < end; p++) {
          const referenceRow = index.postings[t][p];
          if (stamp[referenceRow] === serial) continue;
          stamp[referenceRow] = serial;
          const distance = hamming(qWords, row * 8, index.words, referenceRow * 8, 80);
          if (distance > 80) continue;
          const card = index.cards[referenceRow];
          if (cardStamp[card] !== serial) {cardStamp[card] = serial; cardDistance[card] = distance; touched.push(card);}
          else cardDistance[card] = Math.min(cardDistance[card], distance);
          best = Math.min(best, distance);
        }
      }
      const near = touched.filter(card => cardDistance[card] <= Math.min(72, best + 10));
      const rarity = 1 / Math.sqrt(Math.max(1, near.length / 3));
      for (const card of near) votes[qi][card] += rarity * (1 - cardDistance[card] / 100);
      if (row % 50 === 0) {await yieldStep(); check();}
    }
  }
  const ranked = index.entries.map((entry, card) => {
    let bestQuery = 0, strength = -1, bestCoarse = 0, bestVotes = 0;
    for (let qi = 0; qi < queries.length; qi++) {
      const value = votes[qi][card] + coarse[qi][card] * 6;
      if (value > strength) {strength = value; bestQuery = qi;}
      bestCoarse = Math.max(bestCoarse, coarse[qi][card]); bestVotes = Math.max(bestVotes, votes[qi][card]);
    }
    return {card, bestQuery, strength, coarse: bestCoarse, votes: bestVotes};
  });
  const selected = new Map();
  for (const item of [...ranked].sort((a, b) => b.votes - a.votes).slice(0, 48)) selected.set(item.card, item);
  for (const item of [...ranked].sort((a, b) => b.coarse - a.coarse).slice(0, 24)) selected.set(item.card, item);
  return [...selected.values()].sort((a, b) => b.strength - a.strength).slice(0, LIMITS.shortlist);
}

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function orderQuad(points) {
  const cx = points.reduce((s, p) => s + p.x, 0) / 4, cy = points.reduce((s, p) => s + p.y, 0) / 4;
  const sorted = [...points].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx));
  let start = 0; for (let i = 1; i < 4; i++) if (sorted[i].x + sorted[i].y < sorted[start].x + sorted[start].y) start = i;
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}
async function cardCrops(cv, source, check, yieldStep) {
  const owned = [], own = value => {owned.push(value); return value;};
  const regions = [];
  try {
    const src = own(cv.imread(source)), gray = own(new cv.Mat()), edges = own(new cv.Mat());
    const contours = own(new cv.MatVector()), hierarchy = own(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY); cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    cv.Canny(gray, edges, 45, 130); cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
    const n = Math.min(contours.size(), 10_000);
    for (let i = 0; i < n; i++) {
      if (i % 250 === 0) {await yieldStep(); check();}
      const contour = contours.get(i), poly = new cv.Mat();
      try {
        const area = Math.abs(cv.contourArea(contour));
        if (area < source.width * source.height * 0.04) continue;
        cv.approxPolyDP(contour, poly, cv.arcLength(contour, true) * 0.025, true);
        if (poly.rows !== 4 || !cv.isContourConvex(poly)) continue;
        const points = orderQuad(Array.from({length: 4}, (_, p) => ({x: poly.data32S[p * 2], y: poly.data32S[p * 2 + 1]})));
        const width = (distance(points[0], points[1]) + distance(points[2], points[3])) / 2;
        const height = (distance(points[1], points[2]) + distance(points[3], points[0])) / 2;
        const ratio = Math.min(width, height) / Math.max(width, height);
        if (ratio >= 0.48 && ratio <= 0.85 && Math.min(width, height) >= 100) regions.push({points, area, landscape: width > height});
      } finally {poly.delete(); contour.delete();}
    }
    const kept = [];
    for (const region of regions.sort((a, b) => b.area - a.area)) {
      const center = region.points.reduce((p, a) => ({x: p.x + a.x / 4, y: p.y + a.y / 4}), {x: 0, y: 0});
      if (kept.some(p => distance(center, p.center) < Math.sqrt(p.area) * 0.3)) continue;
      kept.push({...region, center}); if (kept.length === 2) break;
    }
    const crops = [];
    try {
      for (const region of kept) {
        const width = region.landscape ? 720 : 514, height = region.landscape ? 514 : 720;
        const crop = canvasOf(width, height), from = cv.matFromArray(4, 1, cv.CV_32FC2, region.points.flatMap(p => [p.x, p.y]));
        const to = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width - 1, 0, width - 1, height - 1, 0, height - 1]);
        let transform, dest;
        try {
          transform = cv.getPerspectiveTransform(from, to); dest = new cv.Mat();
          cv.warpPerspective(src, dest, transform, new cv.Size(width, height), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar(255, 255, 255, 255));
          cv.imshow(crop, dest); crops.push(crop);
        } catch (e) {release(crop); throw e;}
        finally {dest?.delete(); transform?.delete(); to.delete(); from.delete();}
      }
      return crops;
    } catch (e) {crops.forEach(release); throw e;}
  } finally {for (let i = owned.length - 1; i >= 0; i--) owned[i].delete();}
}

function project(matrix, x, y) {
  const denominator = matrix[6] * x + matrix[7] * y + matrix[8];
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-8) return {x: NaN, y: NaN};
  return {x: (matrix[0] * x + matrix[1] * y + matrix[2]) / denominator,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / denominator};
}
function polygonArea(points) {
  let area = 0;
  for (let i = 0; i < points.length; i++) {const a = points[i], b = points[(i + 1) % points.length]; area += a.x * b.y - a.y * b.x;}
  return Math.abs(area) / 2;
}
// Use the photographed card's verified coordinates, not the user's outer box,
// for fixed numeric fields. The plan has no reference pixels or card values.
export function liveAlignmentPlan(transform, width, height, {allowMargins = false} = {}) {
  if (!transform || !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || height < 1 || Math.max(width,height) > LIMITS.processingEdge) return null;
  const {matrix, referenceWidth:rw, referenceHeight:rh} = transform;
  if (!Array.isArray(matrix) || matrix.length !== 9 || matrix.some(n=>!Number.isFinite(n)) ||
      !Number.isInteger(rw) || !Number.isInteger(rh) || rw < 1 || rh < 1 ||
      Math.max(rw,rh)>LIMITS.processingEdge || rw/rh<1.2 || rw/rh>1.65) return null;
  const refs=[[0,0],[rw,0],[rw,rh],[0,rh]];
  const denominators=refs.map(([x,y])=>matrix[6]*x+matrix[7]*y+matrix[8]);
  if (denominators.some(d=>!Number.isFinite(d)||Math.abs(d)<1e-8||Math.sign(d)!==Math.sign(denominators[0]))) return null;
  const corners=refs.map(([x,y])=>project(matrix,x,y)), [tl,tr,br,bl]=corners;
  if (corners.some(p=>!Number.isFinite(p.x+p.y)) ||
      !(tr.x>tl.x && bl.y>tl.y && br.x>bl.x && br.y>tr.y)) return null;
  const closeCrop = Math.abs(tr.y-tl.y)<height*.12 && Math.abs(bl.x-tl.x)<width*.12 &&
    corners.every((p,i)=>Math.abs(p.x-([0,width,width,0][i]))<width*.12 &&
      Math.abs(p.y-([0,0,height,height][i]))<height*.12);
  // Existing close crops retain their gate. A larger selection is allowed only
  // when the verified upright card dominates it and all four corners are real
  // source pixels. This excludes a small match in a photograph or either half
  // of a two-card selection; no expected digit or reference pixels are used.
  if (!closeCrop || (allowMargins && (width/height<1.2 || width/height>1.65))) {
    if (!allowMargins || corners.some(p=>p.x<0||p.y<0||p.x>width||p.y>height)) return null;
    const topWidth=distance(tl,tr),bottomWidth=distance(bl,br);
    const leftHeight=distance(tl,bl),rightHeight=distance(tr,br);
    const cardWidth=(topWidth+bottomWidth)/2,cardHeight=(leftHeight+rightHeight)/2;
    if (cardWidth<width*.70 || cardHeight<height*.55 ||
        polygonArea(corners)<width*height*.50 ||
        Math.abs(tr.y-tl.y)>=cardHeight*.12 || Math.abs(br.y-bl.y)>=cardHeight*.12 ||
        Math.abs(bl.x-tl.x)>=cardWidth*.12 || Math.abs(br.x-tr.x)>=cardWidth*.12 ||
        Math.min(topWidth,bottomWidth)<Math.max(topWidth,bottomWidth)*.75 ||
        Math.min(leftHeight,rightHeight)<Math.max(leftHeight,rightHeight)*.75 ||
        cardWidth/cardHeight<(rw/rh)*.80 || cardWidth/cardHeight>(rw/rh)*1.20) return null;
  }
  for (let i=0;i<4;i++) {
    const a=corners[i],b=corners[(i+1)%4],c=corners[(i+2)%4];
    if ((b.x-a.x)*(c.y-b.y)-(b.y-a.y)*(c.x-b.x)<=0) return null;
  }
  for (const [x0,y0,x1,y1] of Object.values(LIVE_SIGNAL_REGIONS)) {
    const field=[[x0,y0],[x1,y0],[x1,y1],[x0,y1]].map(([x,y])=>project(matrix,x*rw,y*rh));
    // Interpolation must use real source pixels throughout each field.
    if(field.some(p=>!Number.isFinite(p.x+p.y)||p.x<1||p.y<1||p.x>width-2||p.y>height-2)) return null;
  }
  const observedWidth=(distance(tl,tr)+distance(bl,br))/2;
  const outWidth=Math.max(1,Math.min(LIMITS.processingEdge,Math.round(observedWidth)));
  const outHeight=Math.max(1,Math.round(outWidth*rh/rw));
  if(Math.min(outWidth,outHeight)<100) return null;
  return {corners,width:outWidth,height:outHeight};
}
function readAlignedLiveSignals(cv, source, transform, model) {
  const plan=liveAlignmentPlan(transform,source.width,source.height,{allowMargins:true});
  if(!plan)return null;
  const owned=[],own=value=>{owned.push(value);return value;};
  const canvas=canvasOf(plan.width,plan.height);
  try {
    const src=own(cv.imread(source));
    const from=own(cv.matFromArray(4,1,cv.CV_32FC2,plan.corners.flatMap(p=>[p.x,p.y])));
    const to=own(cv.matFromArray(4,1,cv.CV_32FC2,[0,0,plan.width,0,plan.width,plan.height,0,plan.height]));
    const matrix=own(cv.getPerspectiveTransform(from,to)), dest=own(new cv.Mat());
    cv.warpPerspective(src,dest,matrix,new cv.Size(plan.width,plan.height),cv.INTER_LINEAR,cv.BORDER_CONSTANT,new cv.Scalar(0,0,0,255));
    cv.imshow(canvas,dest);
    return readLiveSignals(ctx(canvas).getImageData(0,0,plan.width,plan.height),model);
  } finally {
    for(let i=owned.length-1;i>=0;i--)owned[i].delete();
    release(canvas);
  }
}
function plausibleQuad(matrix, reference, query) {
  const corners = [[0, 0], [reference.width, 0], [reference.width, reference.height], [0, reference.height]].map(([x, y]) => project(matrix, x, y));
  if (corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < -query.width * 0.35 || p.x > query.width * 1.35 || p.y < -query.height * 0.35 || p.y > query.height * 1.35)) return false;
  const area = polygonArea(corners), fraction = area / (query.width * query.height);
  if (fraction < 0.012 || fraction > 1.7) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i + 1) % 4], c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (!sign) sign = Math.sign(cross); else if (Math.sign(cross) !== sign) return false;
  }
  const edges = corners.map((p, i) => distance(p, corners[(i + 1) % 4]));
  return Math.min(...edges) > 28 && Math.max(...edges) / Math.min(...edges) < 6;
}
function alignedSimilarity(reference, query, matrix) {
  const width = query.canvas.width, height = query.canvas.height;
  query.pixels ||= ctx(query.canvas).getImageData(0, 0, width, height).data;
  const result = new Uint8Array(768);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    let r = 0, g = 0, b = 0, samples = 0;
    for (const dy of [0.2, 0.5, 0.8]) for (const dx of [0.2, 0.5, 0.8]) {
      const p = project(matrix, (x + dx) * reference.width / 16, (y + dy) * reference.height / 16);
      const px = Math.round(p.x), py = Math.round(p.y);
      if (px < 0 || py < 0 || px >= width || py >= height || !Number.isFinite(px + py)) continue;
      const pos = (py * width + px) * 4;
      r += query.pixels[pos]; g += query.pixels[pos + 1]; b += query.pixels[pos + 2]; samples++;
    }
    const pos = (y * 16 + x) * 3;
    if (samples) {result[pos] = Math.round(r / samples); result[pos + 1] = Math.round(g / samples); result[pos + 2] = Math.round(b / samples);}
  }
  return coarseSimilarity(reference.coarse, result);
}

// Disjoint elapsed spans inside the verify phase. Browser waits here are also
// included in the top-level yieldWait, so do not add that cross-phase total.
export function emptyVerifyDetail() {
  return {reference: 0, match: 0, filter: 0, geometry: 0, appearance: 0, cleanup: 0, yieldWait: 0, other: 0};
}
// Isolate the embedded matcher; it does not receive a canvas or use the network.
const instantiateExactMatcher = (() => {
// Embedded modules generated from generate.py (Core i64.popcnt / optional SIMD).
// Synchronous, no URLs, no compilation service, no external or shared memory.
const SCALAR = 'AGFzbQEAAAABCAFgBH9/f38AAwIBAAUEAQEBAQcQAgZtZW1vcnkCAANrbm4AAArOAQHLAQIHfwR+AkAgAEUNAANAIAQpAwAhCyAEKQMIIQwgBCkDECENIAQpAxghDkGBAiIHIQhBACEJQQAhBiACIQUDQCALIAUpAwCFeyAMIAUpAwiFe3wgDSAFKQMQhXt8IA4gBSkDGIV7fKciCiAISQRAIAogB0kEQCAHIQggCiEHIAYhCQUgCiEICwsgBUEgaiEFIAZBAWoiBiABSQ0ACyADIAk2AgAgAyAHNgIEIAMgCDYCCCADQQxqIQMgBEEgaiEEIABBAWsiAA0ACwsL';
const SIMD = 'AGFzbQEAAAABCAFgBH9/f38AAwIBAAUEAQEBAQcQAgZtZW1vcnkCAANrbm4AAArRAQHOAQIHfwN7AkAgAEUNAANAIAT9AAQAIQsgBP0ABBAhDEGBAiIHIQhBACEJQQAhBiACIQUDQCALIAX9AAQA/VH9YiAMIAX9AAQQ/VH9Yv1u/X39fyENIA39GwAgDf0bAWogDf0bAmogDf0bA2oiCiAISQRAIAogB0kEQCAHIQggCiEHIAYhCQUgCiEICwsgBUEgaiEFIAZBAWoiBiABSQ0ACyADIAk2AgAgAyAHNgIEIAMgCDYCCCADQQxqIQMgBEEgaiEEIABBAWsiAA0ACwsL';

// Only executable code is shared. No photo bytes, feature data, Wasm instances,
// output, or memory are stored in the module cache.
const compiledExactModules = new Map();
// One instance per engine is sufficient. An instance owns just one 64 KiB page.
// Flat triplets from match() share that page and expire on the next call.
// Pass {mode:'scalar'} or {mode:'simd'} for explicit A/B testing.
function createExactMatcher({mode='auto'}={}) {
  if (!['auto','scalar','simd'].includes(mode)) throw new RangeError('Invalid matcher mode');
  for (const kind of mode==='auto'?['simd','scalar']:[mode]) {
    try {
      let module = compiledExactModules.get(kind);
      if (!module) {
        const code = Uint8Array.from(atob(kind==='simd'?SIMD:SCALAR), c=>c.charCodeAt(0));
        module = new WebAssembly.Module(code);
        compiledExactModules.set(kind,module);
      }
      const {memory,knn} = new WebAssembly.Instance(module).exports;
      const bytes = new Uint8Array(memory.buffer);
      function match(ref, query) {
        if (!(ref instanceof Uint8Array) || !(query instanceof Uint8Array) ||
            (ref.length%32) || (query.length%32) || query.length < 64) throw new RangeError('Invalid descriptor table');
        const n = ref.length/32, m = query.length/32, out = ref.length + query.length;
        if (out + n*12 > bytes.length) throw new RangeError('Descriptor tables exceed fixed scratch memory');
        bytes.set(ref,0); bytes.set(query,ref.length);
        knn(n,m,ref.length,out);
        return new Uint32Array(memory.buffer,out,n*3);
      }
      function acceptedPairs(ref, query) {
        const out=[];
        if(query.length<64 || ref.length===0) return out;
        const rows = match(ref,query);
        for(let i=0;i<rows.length;i+=3) if(rows[i+1]<=76 && rows[i+1]<rows[i+2]*0.79)
          out.push({r:i/3,q:rows[i],d:rows[i+1]});
        return out;
      }
      return {kind,match,acceptedPairs};
    } catch { /* unsupported features or restricted WebAssembly; try next */ }
  }
  return null;
}

// Convenience for a single comparison. Reuse a factory instance for a batch.
function acceptedPairsWasm(ref, query) {
  const exact = createExactMatcher();
  if(!exact) throw new Error('Exact Wasm matcher unavailable');
  return exact.acceptedPairs(ref,query);
}

return createExactMatcher;
})();

// Small known-answer check for this runtime, including exact ties and distance 256.
// Allocate per recognition: no engine-level reference to the last photographed card.
function checkedMatcher() {
  try {
    const fast = instantiateExactMatcher({mode:'scalar'});
    if (!fast) return null;
    const ref = new Uint8Array(64), query = new Uint8Array(96);
    ref.fill(255,32); query[32] = 1; query[64] = 1;
    const got = fast.match(ref,query), expected = [0,0,1,1,255,255];
    if (!(got instanceof Uint32Array) || got.length !== expected.length || expected.some((v,i)=>got[i] !== v)) return null;
    const opposite = fast.match(ref.subarray(32), new Uint8Array(64));
    if (opposite[0] !== 0 || opposite[1] !== 256 || opposite[2] !== 256) return null;
    return fast;
  } catch { return null; }
}

// Necessary conditions only. Every eventual inlier is a member of `matches`.
// Keep these bounds in step with verify's post-homography acceptance gates.
function hasPotentialGeometry(reference, matches) {
  if (matches.length < 10) return false;
  const bins = new Set();
  let artwork = 0, near = 0, minX = 1, maxX = 0, minY = 1, maxY = 0;
  for (const match of matches) {
    const x = reference.keypoints[match.r * 2] / reference.width;
    const y = reference.keypoints[match.r * 2 + 1] / reference.height;
    bins.add(Math.min(3, Math.floor(x * 4)) + Math.min(3, Math.floor(y * 4)) * 4);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    if (x > 0.1 && x < 0.9 && y > 0.12 && y < 0.78) artwork++;
    if (match.d <= 64) near++;
  }
  if (bins.size < 4 || artwork < 6 || (maxX - minX) * (maxY - minY) < 0.075) return false;
  // Use the same division as the final ratio gate, including floating boundaries.
  let requiredInliers = 10;
  while (requiredInliers / matches.length < 0.38) requiredInliers++;
  // The upper median must be <=64; even the smallest permitted subset needs
  // this many close matches. A larger subset cannot need fewer.
  return near >= Math.floor(requiredInliers / 2) + 1;
}

function verify(cv, index, reference, query, matcher, detail) {
  if (reference.count < 10 || query.features.count < 10) return null;
  // Mark only whole blocks: no clock reads per point, match or pixel.
  let section = 'reference', since = performance.now();
  const mark = next => {const now = performance.now(); detail[section] += now - since; since = now; section = next;};
  const owned = [], own = value => {owned.push(value); return value;};
  try {
    const bytes = index.bytes.subarray(reference.offset * 32, (reference.offset + reference.count) * 32);
    const accepted = [], used = new Set();
    let matched = false;
    if (matcher.fast) {
      mark('match');
      try {
        const triples = matcher.fast.match(bytes, query.bytes);
        if (!(triples instanceof Uint32Array) || triples.length !== reference.count * 3) throw Error('INVALID_MATCH_ROWS');
        mark('filter');
        for (let r = 0, p = 0; r < reference.count; r++, p += 3) {
          const q = triples[p], d = triples[p+1], second = triples[p+2];
          if (q >= query.features.count || d > second || second > 256) throw Error('INVALID_MATCH_PAIR');
          if (d <= 76 && d < second * 0.79) accepted.push({r, q, d});
        }
        matcher.usedFast = matched = true;
      } catch {
        // Redo the entire failed candidate through the original matcher; discard partial results.
        accepted.length = 0; matcher.fast = null; mark('reference');
      }
    }
    if (!matched) {
      const ref = own(cv.matFromArray(reference.count, 32, cv.CV_8UC1,
        bytes));
      const matches = own(new cv.DMatchVectorVector());
      mark('match');
      matcher.classic.knnMatch(ref, query.mat, matches, 2);
      mark('filter');
      for (let i = 0; i < matches.size(); i++) {
        const pair = matches.get(i);
        try {
          if (pair.size() < 2) continue;
          const first = pair.get(0), second = pair.get(1);
          if (first.distance <= 76 && first.distance < second.distance * 0.79) accepted.push({r: first.queryIdx, q: first.trainIdx, d: first.distance});
          first.delete?.(); second.delete?.();
        } finally {pair.delete();}
      }
      matcher.usedClassic = true;
    }
    const unique = accepted.sort((a, b) => a.d - b.d).filter(match => {if (used.has(match.q)) return false; used.add(match.q); return true;});
    if (!hasPotentialGeometry(reference, unique)) return null;
    mark('geometry');
    const from = own(cv.matFromArray(unique.length, 1, cv.CV_32FC2, unique.flatMap(m => [reference.keypoints[m.r * 2], reference.keypoints[m.r * 2 + 1]])));
    const to = own(cv.matFromArray(unique.length, 1, cv.CV_32FC2, unique.flatMap(m => [query.features.keypoints[m.q * 2], query.features.keypoints[m.q * 2 + 1]])));
    const mask = own(new cv.Mat());
    const homography = own(cv.findHomography(from, to, cv.RANSAC, Math.max(4, Math.max(query.features.width, query.features.height) * 0.004), mask));
    if (homography.empty()) return null;
    const matrix = homography.data64F.length ? homography.data64F : homography.data32F;
    if (!plausibleQuad(matrix, reference, query.features)) return null;
    const inliers = unique.filter((_, i) => mask.data[i]);
    const ratio = inliers.length / unique.length;
    if (inliers.length < 10 || ratio < 0.38) return null;
    const bins = new Set(); let artwork = 0, illustrationInliers = 0, minX = 1, maxX = 0, minY = 1, maxY = 0;
    // Standard Live illustration interior shared by the wide and square layouts.
    // Keep this separate from the broad existing artwork test, which includes hearts.
    const inspectLive = matcher.liveCardIds.has(reference.cardId) && reference.width > reference.height;
    for (const match of inliers) {
      const x = reference.keypoints[match.r * 2] / reference.width, y = reference.keypoints[match.r * 2 + 1] / reference.height;
      bins.add(Math.min(3, Math.floor(x * 4)) + Math.min(3, Math.floor(y * 4)) * 4);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (x > 0.1 && x < 0.9 && y > 0.12 && y < 0.78) artwork++;
      if (inspectLive && x > 0.06 && x < 0.46 && y > 0.22 && y < 0.62) illustrationInliers++;
    }
    const coverage = (maxX - minX) * (maxY - minY);
    if (bins.size < 4 || artwork < 6 || coverage < 0.075) return null;
    const medianDistance = inliers.map(m => m.d).sort((a, b) => a - b)[Math.floor(inliers.length / 2)];
    if (medianDistance > 64) return null;
    mark('appearance');
    const visual = alignedSimilarity(reference, query, matrix);
    if (visual < (inliers.length >= 28 ? 0.22 : 0.40)) return null;
    const score = Math.round(100 * (0.34 * clamp(inliers.length / 65) + 0.20 * clamp(ratio) + 0.14 * clamp(coverage / 0.55) + 0.24 * visual + 0.08 * clamp(1 - medianDistance / 80)));
    let upright = false;
    if (inspectLive && illustrationInliers >= 6) {
      const corners = [[0,0],[reference.width,0],[reference.width,reference.height],[0,reference.height]]
        .map(([x,y]) => project(matrix,x,y));
      const [tl,tr,br,bl] = corners, w = query.features.width, h = query.features.height;
      // Preserve the legacy close-crop diagnostic without changing visual scores.
      // Optional numeric alignment separately validates the actual card geometry.
      upright = tr.x > tl.x && bl.y > tl.y && br.x > bl.x && br.y > tr.y &&
        Math.abs(tr.y-tl.y) < h*.12 && Math.abs(bl.x-tl.x) < w*.12 &&
        corners.every((p,i) => Number.isFinite(p.x+p.y) &&
          Math.abs(p.x-([0,w,w,0][i])) < w*.12 && Math.abs(p.y-([0,0,h,h][i])) < h*.12);
    }
    return {score: clamp(score, 0, 100), inliers: inliers.length, ratio, artwork, coverage, visual,
      illustrationInliers, upright,
      liveTransform:inspectLive&&illustrationInliers>=6?{matrix:Array.from(matrix),referenceWidth:reference.width,referenceHeight:reference.height}:null};
  } finally {
    // Includes early rejects; per-pair wrappers were released in 'filter'.
    mark('cleanup');
    for (let i = owned.length - 1; i >= 0; i--) owned[i].delete();
    detail.cleanup += performance.now() - since;
  }
}

// Fallback suggestions are retrieval results, NOT geometrically verified matches.
// Preserve retrieval's combined local-pattern votes + coarse layout ranking.
// A coarse-only rerank can discard a strong pattern match merely because a
// watermark or lighting changes the whole-card appearance.
export function selectVisualCandidates(verified, shortlist, entries) {
  const sorted = [...verified].sort((a, b) => b.score - a.score || b.inliers - a.inliers);
  const top = sorted[0];
  const accepted = top ? sorted.filter(v => v.score >= Math.max(38, top.score - 24)).slice(0, 3) : [];
  if (accepted.length) return accepted.map((v, i) => ({cardId: v.reference.cardId, cardNumber: v.reference.cardNumber,
    evidence: 'visual_similarity', rank: i + 1, similarityScore: v.score, ambiguity: 'physical_version_unconfirmed'}));
  return [...shortlist].sort((a, b) => b.strength - a.strength || b.votes - a.votes || b.coarse - a.coarse || a.card - b.card).slice(0, 3)
    .map((item, i) => ({cardId: entries[item.card].cardId, cardNumber: entries[item.card].cardNumber,
      evidence: 'visual_fallback', rank: i + 1, similarityScore: null, ambiguity: 'physical_version_unconfirmed'}));
}

// Optional alternatives use the existing retrieval results, without another
// recognition pass. They never replace or inherit scores from normal matches.
export function selectAdditionalCandidates(candidates, shortlist, entries) {
  if (!candidates.length || candidates.some(c => c.evidence !== 'visual_similarity')) return [];
  const seen = new Set(candidates.map(c => c.cardId));
  return [...shortlist]
    .sort((a, b) => b.strength - a.strength || b.votes - a.votes || b.coarse - a.coarse || a.card - b.card)
    .filter(item => {
      const id = entries[item.card]?.cardId;
      if (!id || seen.has(id)) return false;
      seen.add(id); return true;
    }).slice(0, 3)
    .map((item, i) => ({cardId: entries[item.card].cardId, cardNumber: entries[item.card].cardNumber,
      evidence: 'visual_fallback', rank: i + 1, similarityScore: null, ambiguity: 'physical_version_unconfirmed'}));
}

export function createEngine({onProgress = () => {}, liveCardIds = []} = {}) {
  let cv, index, ready = false, disposed = false, generation = 0, initialization = null, abort = null, busy = null;
  const liveIds = new Set(liveCardIds), liveAssets = createLiveAssetLoader(ROOT);
  let liveAbort = null;
  const report = (status, progress) => {try {onProgress({status, progress});} catch { /* UI callbacks cannot alter recognition. */ }};
  const check = token => {if (disposed || token !== generation) throw cancelled();};
  async function initialize() {
    if (disposed) throw failure('DISPOSED', '認識画面を開き直してください。');
    if (ready) return;
    if (initialization) return initialization;
    const token = generation, controller = new AbortController(); abort = controller;
    let initializationTimedOut = false;
    const timeout = setTimeout(() => {initializationTimedOut = true; controller.abort();}, 90_000);
    const deadline = performance.now() + 90_000;
    const valid = () => {check(token); if (performance.now() > deadline) throw failure('INIT_TIMEOUT', '画像索引の準備が時間内に完了しませんでした。');};
    const task = (async () => {
      report('ローカルの画像索引を読み込んでいます', 0.05);
      const url = new URL('data/reference-index.json', ROOT);
      if (url.origin !== location.origin) throw failure('EXTERNAL_ASSET', '画像索引の取得先が不正です。');
      const [response, holder] = await Promise.all([fetch(url, {signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store'}), loadCV()]);
      valid();
      if (!response.ok) throw failure('INDEX_UNAVAILABLE', '画像索引を読み込めませんでした。ローカル配布フォルダーを確認してください。');
      const json = await response.json(); valid(); cv = holder.cv;
      if (!cv.ORB || !cv.BFMatcher || !cv.findHomography) throw failure('CV_UNAVAILABLE', '画像照合に必要な機能を読み込めませんでした。');
      const built = await buildIndex(json, valid, progress => report('画像照合の準備をしています', progress));
      valid(); index = built; ready = true; report('画像照合の準備ができました', 1);
    })();
    const interrupted = new Promise((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(cancelled()), {once: true});
    });
    const current = Promise.race([task, interrupted]);
    initialization = current;
    try {await current;} catch (e) {
      if (initializationTimedOut) throw failure('INIT_TIMEOUT', '画像索引の準備が時間内に完了しませんでした。');
      if (e?.name === 'AbortError') throw cancelled(); throw e;
    } finally {clearTimeout(timeout); if (initialization === current) initialization = null; if (abort === controller) abort = null;}
  }
  async function recognize(input, {wholeCard = false} = {}) {
    if (!ready || !index) throw failure('NOT_READY', '先に認識の準備をしてください。');
    if (busy) throw failure('BUSY', '読み取り中です。少し待つか中止してください。');
    const token = generation, operation = {}; busy = operation;
    const started = performance.now(), queries = [], canvases = [];
    let matcher, regions = 0;
    // Elapsed wall time, including existing yields and progress callbacks.
    // Sample at stage boundaries, never inside descriptor/match hot loops.
    let phase = 'prepare', phaseStart = started, yieldWait = 0;
    const verifyDetail = emptyVerifyDetail();
    const addWait = ms => {yieldWait += ms; if (phase === 'verify') verifyDetail.yieldWait += ms;};
    const yieldStep = () => recognitionYield(addWait);
    const spans = {prepare: 0, retrieve: 0, verify: 0};
    const enter = next => {const now = performance.now(); spans[phase] = now - phaseStart; phaseStart = now; phase = next;};
    const snapshot = now => {
      const total = now - started, t = {...spans};
      if (phase !== 'other') t[phase] = now - phaseStart;
      const tracked = Object.values(verifyDetail).reduce((a, b) => a + b, 0);
      return {total, ...t, other: Math.max(0, total - t.prepare - t.retrieve - t.verify), yieldWait,
        verifyDetail: {...verifyDetail, other: Math.max(0, t.verify - tracked)}};
    };
    const valid = () => {
      check(token);
      const now = performance.now();
      if (now - started > LIMITS.recognitionMs)
        throw Object.assign(failure('VISUAL_TIMEOUT', '画像照合に時間がかかっています。カードを大きく切り抜いて再度お試しください。'), {timingsMs: snapshot(now), timeoutPhase: phase});
    };
    const makeQuery = canvas => {
      const features = extractFeatures(cv, canvas, {maxFeatures: canvas === canvases[0] && !wholeCard ? 1000 : 600, maxEdge: LIMITS.processingEdge});
      const bytes = base64ToBytes(features.descriptors);
      const query = {canvas, features, bytes, mat: cv.matFromArray(features.count, 32, cv.CV_8UC1, bytes)};
      queries.push(query); return query;
    };
    try {
      const source = workingCanvas(input); canvases.push(source); valid();
      report('写真の図柄を調べています', 0.06);
      makeQuery(source); await yieldStep(); valid();
      if (!wholeCard) {
        // Contours improve scale; their absence never blocks full-frame matching.
        let crops = [];
        try {crops = await cardCrops(cv, source, valid, yieldStep);} catch (e) {if (e?.code === 'CANCELLED' || e?.code === 'VISUAL_TIMEOUT') throw e;}
        regions = crops.length; canvases.push(...crops);
        for (const crop of crops) {makeQuery(crop); await yieldStep(); valid();}
        if (!crops.length && source.width > 300 && source.height > 300) {
          const crop = canvasOf(Math.round(source.width * 0.72), Math.round(source.height * 0.72));
          ctx(crop).drawImage(source, source.width * 0.14, source.height * 0.14, crop.width, crop.height, 0, 0, crop.width, crop.height);
          canvases.push(crop); makeQuery(crop); await yieldStep(); valid();
        }
      } else regions = 1;
      enter('retrieve');
      report('保存済みのカード画像と照合しています', 0.22);
      const shortlist = await retrieve(index, queries, valid, yieldStep);
      enter('verify');
      matcher = {classic: new cv.BFMatcher(cv.NORM_HAMMING, false), fast: checkedMatcher(), usedFast: false, usedClassic: false, liveCardIds: liveIds};
      const verified = [];
      for (let i = 0; i < shortlist.length; i++) {
        valid();
        const item = shortlist[i], reference = index.entries[item.card];
        let best = verify(cv, index, reference, queries[item.bestQuery], matcher, verifyDetail);
        // The strongest retrieved cards also get the other scale/crop attempts.
        if (i < 10 || best) for (let qi = 0; qi < queries.length; qi++) {
          if (qi === item.bestQuery) continue;
          const alternate = verify(cv, index, reference, queries[qi], matcher, verifyDetail);
          if (alternate && (!best || alternate.score > best.score)) best = alternate;
          await yieldStep(); valid();
        }
        if (best) verified.push({reference, ...best});
        report('図柄の位置関係を確認しています', 0.5 + 0.44 * (i + 1) / shortlist.length);
        await yieldStep(); valid();
      }
      enter('other');
      verified.sort((a, b) => b.score - a.score || b.inliers - a.inliers);
      const top = verified[0];
      let candidates = selectVisualCandidates(verified, shortlist, index.entries);
      let additionalCandidates = selectAdditionalCandidates(candidates, shortlist, index.entries);
      let liveSignals = {applied:false, reason:'not_eligible'};
      const liveAligned = wholeCard && top?.liveTransform
        ? liveAlignmentPlan(top.liveTransform,source.width,source.height,{allowMargins:true}) : null;
      valid(); // The ordinary visual result must finish within its existing deadline.
      const signalBudgetMs = Math.min(8000, LIMITS.recognitionMs-(performance.now()-started)-2000);
      if (signalBudgetMs > 0 && wholeCard && liveAligned && top.illustrationInliers >= 6 &&
          candidates.length && candidates.every(c => c.evidence === 'visual_similarity' && liveIds.has(c.cardId))) {
        const liveStarted = performance.now(), controller = new AbortController(); liveAbort = controller;
        const timer = setTimeout(() => controller.abort(), signalBudgetMs);
        try {
          const {model,liveCards} = await liveAssets.load({signal:controller.signal}); check(token);
          if (performance.now()-started > LIMITS.recognitionMs-2000) throw Error('LIVE_TIME_BUDGET');
          if (liveCards.get(candidates[0].cardId)?.standardLayout === true) {
            const signals = readAlignedLiveSignals(cv,source,top.liveTransform,model); check(token);
            if (performance.now()-started > LIMITS.recognitionMs) throw Error('LIVE_TIME_BUDGET');
            if (!signals) throw Error('LIVE_ALIGNMENT_UNAVAILABLE');
            const refined = refineLiveCandidates({candidates,additionalCandidates,liveCards,signals,
              visualTop:{cardId:top.reference.cardId,illustrationInliers:top.illustrationInliers,upright:Boolean(liveAligned)}});
            candidates = refined.candidates; additionalCandidates = refined.additionalCandidates;
            liveSignals = {...refined.refinement, score:signals.score?.value ?? null,
              hearts:signals.acceptedPartialHearts, heartVectorComplete:false, alignment:'verified_card'};
          } else liveSignals = {applied:false,reason:'unsupported_layout'};
        } catch (error) { liveSignals = {applied:false,reason:error.message==='LIVE_TIME_BUDGET'?'time_budget':error.message==='LIVE_ALIGNMENT_UNAVAILABLE'?'alignment_unknown':'unavailable'}; }
        finally {clearTimeout(timer); if(liveAbort===controller)liveAbort=null;}
        check(token); liveSignals.elapsedMs = performance.now()-liveStarted;
      }
      const fallback = candidates.some(candidate => candidate.evidence === 'visual_fallback');
      const warnings = fallback
        ? ['通常の照合では一致を確認できませんでした。細かな模様の一致と色・明暗の配置から上位候補を表示しています。正解が含まれない場合もあります。実物と一致しなければ手動検索してください。']
        : candidates.length
        ? ['画像の似かたから候補を表示しています。スコアは正解の確率ではありません。現物のカード番号・レアリティ・箔や加工を確認してください。']
        : ['十分な図柄の一致を確認できませんでした。カード1枚を大きく写すか、手動検索を使ってください。'];
      if (candidates.length > 1) warnings.push('似た図柄や別仕様のカードは画像だけでは確定できません。');
      if (!wholeCard && !regions) warnings.push('輪郭を確定できなかったため、写真全体と中央部分から照合しました。');
      // An optional read must not discard an already valid visual result when late.
      check(token); report(candidates.length ? '候補を確認してください' : '手動検索または撮り直しをお願いします', 1);
      return {status: fallback ? 'fallback_requires_confirmation' : candidates.length > 1 ? 'version_unresolved' : candidates.length ? 'candidate_requires_confirmation' : 'manual_or_retake',
        candidates, additionalCandidates, regions, requiresUserConfirmation: true, registrationEnabled: false, warnings,
        timingsMs: snapshot(performance.now()),
        diagnostics: {liveSignals, topIllustrationInliers:top?.illustrationInliers || 0, topUpright:top?.upright || false, topLiveAligned:Boolean(liveAligned), matchBackend: matcher.usedFast ? (matcher.usedClassic ? 'mixed' : 'fast') : (matcher.usedClassic ? 'classic' : 'none'),
          referenceCount: index.entries.length, referenceFeatureCount: index.total,
          queryFeatureCount: queries.reduce((sum, q) => sum + q.features.count, 0), queryViews: queries.length,
          shortlistCount: shortlist.length, verifiedCandidateCount: verified.length,
          fallbackCandidateCount: fallback ? candidates.length : 0,
          additionalCandidateCount: additionalCandidates.length,
          topInlierCount: top?.inliers || 0, topArtworkInlierCount: top?.artwork || 0}};
    } finally {
      matcher?.classic.delete();
      for (const query of queries) {query.mat.delete(); query.pixels = null; query.bytes = null; query.features = null;}
      canvases.forEach(release);
      if (busy === operation) busy = null;
    }
  }
  async function cancel() {generation++; abort?.abort(); liveAbort?.abort(); ready = Boolean(index) && !disposed; await tick();}
  async function dispose() {disposed = true; liveAssets.clear(); await cancel(); index = null; cv = null; liveIds.clear();}
  return {initialize, recognize, cancel, dispose};
}
