// Local-only LIVE signal reader. No network, DOM, persistent storage, or image cache.
// Port of lighting/signals/probe.py and the frozen adaptive numeric/color reader.
// Input must already be the cropped, upright, standard horizontal LIVE card.
// Outputs remain partial observations; absence MUST NOT be interpreted as zero.
export const LIVE_SIGNAL_REGIONS = Object.freeze({
  score: Object.freeze([.825, .165, .917, .265]),
  hearts: Object.freeze([.50, .39, .98, .68]),
});
const SCORE = LIVE_SIGNAL_REGIONS.score, HEARTS = LIVE_SIGNAL_REGIONS.hearts;
const MAX_EDGE = 1400, MAX_PIXELS = MAX_EDGE * MAX_EDGE;
const f32 = Math.fround;

function pythonRound(value) {
  const low = Math.floor(value), fraction = value - low;
  return fraction < .5 ? low : fraction > .5 ? low + 1 : low % 2 === 0 ? low : low + 1;
}
const round4 = value => pythonRound(value * 10000) / 10000;
function median(values, single = false) {
  if (!values.length) throw new RangeError('EMPTY_SAMPLE');
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid];
  return single ? f32(f32(sorted[mid - 1] + sorted[mid]) * .5) : (sorted[mid - 1] + sorted[mid]) / 2;
}
function quantile(values, q) {
  const sorted = [...values].sort((a, b) => a - b), p = (sorted.length - 1) * q, lo = Math.floor(p);
  return sorted[lo] + (sorted[Math.ceil(p)] - sorted[lo]) * (p - lo);
}
function unknown(reason, elapsedMs = 0) {
  return {score: {value: null, reason}, heartDigitObservations: [], acceptedPartialHearts: [],
    heartVectorComplete: false, diagnosticReason: reason, elapsedMs};
}

function validateModel(model) {
  if (!model || !Array.isArray(model.digitTemplates) || !model.digitTemplates.length || model.digitTemplates.length > 512) throw new RangeError('INVALID_MODEL');
  const grouped = new Map();
  for (const template of model.digitTemplates) {
    const {value, pixels} = template || {};
    if (!Number.isInteger(value) || value < 0 || value > 9 || !pixels || pixels.length !== 1120 ||
        (!Array.isArray(pixels) && !ArrayBuffer.isView(pixels))) throw new RangeError('INVALID_MODEL');
    for (const pixel of pixels) if (!Number.isFinite(pixel) || pixel < 0 || pixel > 1) throw new RangeError('INVALID_MODEL');
    if (!grouped.has(value)) grouped.set(value, []);
    grouped.get(value).push(pixels);
  }
  if (grouped.size !== 10) throw new RangeError('INCOMPLETE_DIGIT_MODEL');
  for (const label of ['red', 'pink']) {
    const c = model.colorModel?.[label];
    if (!c || !Number.isFinite(c.hueMedian) || c.hueMedian < -.5 || c.hueMedian > .5 ||
        !Number.isFinite(c.hueRadius) || c.hueRadius <= 0 || c.hueRadius > .045) throw new RangeError('INVALID_COLOR_MODEL');
  }
  return grouped;
}

function correctIllumination(image) {
  const {width, height, data} = image, eligible = [], brightness = [];
  // The Python source uses float32 for the illumination stage.
  for (let y = 0; y < height; y += 8) for (let x = 0; x < width; x += 8) {
    const p = (y * width + x) * 4;
    const rgb = [f32(data[p] / 255), f32(data[p + 1] / 255), f32(data[p + 2] / 255)];
    const high = Math.max(...rgb), low = Math.min(...rgb);
    if (f32(f32(high - low) / Math.max(high, f32(.01))) < .25) {
      eligible.push(rgb); brightness.push(f32(f32(f32(rgb[0] + rgb[1]) + rgb[2]) / 3));
    }
  }
  if (eligible.length < 32) return {info: {accepted: false, reason: 'insufficient_low_chroma_paper'}};
  const cutoff = Math.max(.55, quantile(brightness, .75));
  const paper = eligible.filter((_, i) => brightness[i] >= cutoff);
  if (paper.length < 32) return {info: {accepted: false, reason: 'insufficient_bright_paper'}};
  const anchor = [0, 1, 2].map(c => median(paper.map(rgb => rgb[c]), true));
  const chroma = paper.map(rgb => {
    const mean = f32(f32(f32(rgb[0] + rgb[1]) + rgb[2]) / 3);
    return rgb.map(v => f32(v / Math.max(mean, f32(.01))));
  });
  const center = [0, 1, 2].map(c => median(chroma.map(v => v[c]), true));
  const spread = Math.max(...[0, 1, 2].map(c => median(chroma.map(v => Math.abs(f32(v[c] - center[c]))), true)));
  const peak = Math.max(...anchor), gains = anchor.map(a => f32(peak / Math.max(a, f32(.01))));
  if (spread > .035 || gains.some(g => g < .75 || g > 1.40)) return {info: {accepted: false, reason: 'inconsistent_or_excessive_paper_correction', spread}};
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < data.length; i += 4, j += 3) for (let c = 0; c < 3; c++) {
    const value = Math.max(0, Math.min(1, f32(f32(data[i + c] / 255) * gains[c])));
    rgb[j + c] = Math.floor(f32(f32(value * 255) + .5));
  }
  return {image: {width, height, data: rgb}, info: {accepted: true, sampleCount: paper.length, anchor, gains, spread}};
}

function crop(image, box) {
  const {width: sourceWidth, height: sourceHeight, data} = image;
  const [x0, y0, x1, y1] = box.map((n, i) => pythonRound(n * (i % 2 ? sourceHeight : sourceWidth)));
  const width = x1 - x0, height = y1 - y0, out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) out.set(data.subarray(((y0 + y) * sourceWidth + x0) * 3, ((y0 + y) * sourceWidth + x1) * 3), y * width * 3);
  return {width, height, data: out};
}
function isWhite(r, g, b) {
  const high = Math.max(r, g, b), low = Math.min(r, g, b);
  return low > .32 && low / Math.max(high, .01) > .70;
}

function components(image, acceptSize, whitePredicate = isWhite) {
  const {width, height, data} = image, n = width * height, mask = new Uint8Array(n), seen = new Uint8Array(n);
  const queue = new Int32Array(n), out = []; let allocated = 0;
  for (let i = 0; i < n; i++) mask[i] = whitePredicate(data[i * 3] / 255, data[i * 3 + 1] / 255, data[i * 3 + 2] / 255) ? 1 : 0;
  for (let seed = 0; seed < n; seed++) {
    if (!mask[seed] || seen[seed]) continue;
    let head = 0, count = 1, x0 = seed % width, x1 = x0, y0 = Math.floor(seed / width), y1 = y0;
    queue[0] = seed; seen[seed] = 1;
    while (head < count) {
      const i = queue[head++], x = i % width, y = Math.floor(i / width);
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const j = ny * width + nx;
        if (mask[j] && !seen[j]) {seen[j] = 1; queue[count++] = j;}
      }
    }
    x1++; y1++;
    if (x0 === 0 || y0 === 0 || x1 === width || y1 === height || count < 8) continue;
    const w = x1 - x0, h = y1 - y0;
    if (acceptSize && !acceptSize(w, h)) continue;
    // Safety-only bounds for pathological masks; return unknown, never truncate candidates.
    allocated += w * h;
    if (out.length >= 512 || allocated > n * 4) throw new RangeError('GLYPH_WORK_LIMIT');
    const pixels = new Uint8Array(w * h);
    for (let i = 0; i < count; i++) pixels[(Math.floor(queue[i] / width) - y0) * w + queue[i] % width - x0] = 255;
    out.push({box: [x0, y0, x1, y1], pixels, width: w, height: h, count});
  }
  return out;
}

// Pillow L-mode BILINEAR resize: widened triangle for downsampling, 22-bit
// normalized coefficients, and one rounded 8-bit horizontal then vertical pass.
function coefficients(input, output) {
  const scale = input / output, filterScale = Math.max(1, scale), out = [], precision = 2 ** 22;
  for (let i = 0; i < output; i++) {
    const center = (i + .5) * scale;
    const start = Math.max(0, Math.trunc(center - filterScale + .5));
    const end = Math.min(input, Math.trunc(center + filterScale + .5));
    const weights = []; let total = 0;
    for (let j = start; j < end; j++) {const weight = Math.max(0, 1 - Math.abs((j - center + .5) / filterScale)); weights.push(weight); total += weight;}
    out.push({start, weights: weights.map(w => Math.trunc(w / total * precision + .5))});
  }
  return out;
}
function bilinear(pixels, width, height, newWidth, newHeight) {
  const precision = 2 ** 22, bias = 2 ** 21;
  let horizontal = pixels;
  if (width !== newWidth) {
    const coeff = coefficients(width, newWidth); horizontal = new Uint8Array(newWidth * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < newWidth; x++) {
      const {start, weights} = coeff[x]; let sum = bias;
      for (let k = 0; k < weights.length; k++) sum += pixels[y * width + start + k] * weights[k];
      horizontal[y * newWidth + x] = Math.max(0, Math.min(255, Math.floor(sum / precision)));
    }
  }
  if (height === newHeight) return horizontal;
  const coeff = coefficients(height, newHeight), out = new Uint8Array(newWidth * newHeight);
  for (let y = 0; y < newHeight; y++) for (let x = 0; x < newWidth; x++) {
    const {start, weights} = coeff[y]; let sum = bias;
    for (let k = 0; k < weights.length; k++) sum += horizontal[(start + k) * newWidth + x] * weights[k];
    out[y * newWidth + x] = Math.max(0, Math.min(255, Math.floor(sum / precision)));
  }
  return out;
}
function normalizeGlyph(component) {
  const {width, height, pixels} = component, factor = Math.min(22 / width, 34 / height);
  const w = Math.max(1, pythonRound(width * factor)), h = Math.max(1, pythonRound(height * factor));
  const resized = bilinear(pixels, width, height, w, h), out = new Float64Array(1120);
  const x = Math.floor((28 - w) / 2), y = Math.floor((40 - h) / 2);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) out[(y + yy) * 28 + x + xx] = resized[yy * w + xx] / 255;
  return out;
}
function classify(component, grouped) {
  const query = normalizeGlyph(component), scores = [];
  for (const [value, templates] of grouped) {
    let best = Infinity;
    for (const template of templates) {
      let total = 0; for (let i = 0; i < 1120; i++) total += Math.abs(query[i] - template[i]);
      best = Math.min(best, total / 1120);
    }
    scores.push({value, difference: best});
  }
  scores.sort((a, b) => a.difference - b.difference || a.value - b.value);
  const top = scores[0], margin = scores[1].difference - top.difference;
  return {value: top.difference < .11 && margin > .025 ? top.value : null, bestPrototype: top.value,
    difference: round4(top.difference), margin: round4(margin),
    alternatives: scores.slice(0, 3).map(s => ({value: s.value, difference: round4(s.difference)}))};
}
function rgbToHsv(rgb) {
  const [r, g, b] = rgb, max = Math.max(...rgb), min = Math.min(...rgb), delta = max - min;
  if (!delta) return {h: 0, s: 0, v: max};
  const rc = (max - r) / delta, gc = (max - g) / delta, bc = (max - b) / delta;
  let h = r === max ? bc - gc : g === max ? 2 + rc - bc : 4 + gc - rc;
  h = ((h / 6) % 1 + 1) % 1;
  return {h: h <= .5 ? h : h - 1, s: delta / max, v: max};
}
function localBackground(image, component, whitePredicate = isWhite) {
  const {width, height, data} = image, [x0, y0, x1, y1] = component.box;
  const pad = Math.max(3, pythonRound((y1 - y0) * .25)), values = [];
  for (let y = Math.max(0, y0 - pad); y < Math.min(height, y1 + pad); y++) for (let x = Math.max(0, x0 - pad); x < Math.min(width, x1 + pad); x++) {
    const p = (y * width + x) * 3, rgb = [data[p] / 255, data[p + 1] / 255, data[p + 2] / 255];
    if (!whitePredicate(...rgb)) values.push(rgb);
  }
  if (values.length < 8) return null;
  const rgb = [0, 1, 2].map(c => median(values.map(v => v[c])));
  const uniform = values.filter(v => Math.max(...v.map((n, c) => Math.abs(n - rgb[c]))) < .16).length / values.length;
  return {...rgbToHsv(rgb), uniform};
}
function classifyColor(background, model) {
  if (!background || background.uniform < .70) return 'unknown';
  const {h, s, v} = background;
  if (s < .25) return v < .65 ? 'any' : 'unknown';
  const unsigned = h >= 0 ? h : h + 1;
  if (unsigned > .09 && unsigned < .20) return 'yellow';
  if (unsigned > .27 && unsigned < .47) return 'green';
  if (unsigned > .49 && unsigned < .70) return 'blue';
  if (unsigned > .70 && unsigned < .85) return 'purple';
  if (h > -.15 && h < .08) {
    const ranked = ['red', 'pink'].map(label => ({label, difference: Math.abs(h - model[label].hueMedian), radius: model[label].hueRadius}));
    ranked.sort((a, b) => a.difference - b.difference || a.label.localeCompare(b.label));
    if (ranked[0].difference <= ranked[0].radius && ranked[1].difference - ranked[0].difference > .025) return ranked[0].label;
  }
  return 'unknown';
}
function guardCounts(hearts) {
  const ambiguous = new Set();
  for (let i = 0; i < hearts.length; i++) {
    const a = hearts[i]; if (a.value === null) continue;
    const [ax0, ay0, ax1, ay1] = a.relativeBox;
    for (let j = i + 1; j < hearts.length; j++) {
      const b = hearts[j]; if (b.value === null) continue;
      const [bx0, by0, bx1, by1] = b.relativeBox;
      const overlap = Math.min(ay1, by1) - Math.max(ay0, by0), gap = Math.max(ax0, bx0) - Math.min(ax1, bx1);
      if (overlap > .5 * Math.min(ay1 - ay0, by1 - by0) && gap < .8 * Math.max(ax1 - ax0, bx1 - bx0)) {ambiguous.add(i); ambiguous.add(j);}
    }
  }
  for (const i of ambiguous) {hearts[i].value = null; hearts[i].reason = 'adjacent_glyphs_may_be_multi_digit';}
  for (const h of hearts) if (h.value !== null && !(h.value >= 1 && h.value <= 9)) {h.value = null; h.reason = 'heart_count_outside_supported_single_digit_range';}
  return hearts;
}

function heartObservations(image, grouped, colorModel, whitePredicate = isWhite) {
  return components(image, (w, h) => h >= .10 * image.height && h <= .45 * image.height && w <= h * 1.05, whitePredicate).map(component => {
    const result = classify(component, grouped), background = localBackground(image, component, whitePredicate);
    return {...result, background, color: classifyColor(background, colorModel),
      relativeBox: component.box.map((n, i) => round4(n / (i % 2 ? image.height : image.width)))};
  });
}
function boxOverlap(a, b) {
  const intersection = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) *
    Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection;
  return union > 0 ? intersection / union : 0;
}
function neutralConsensus(passes, existing) {
  if (existing.some(h => h.color === 'any' && h.value !== null)) return null;
  const candidates = passes.map(pass => pass.filter(h => h.value !== null && h.color === 'any'));
  // Two distinct shapes, adjacent digits, or disagreement stay unknown. Never pick
  // a count from card metadata or whichever mask happened to score best.
  if (candidates.length !== 2 || candidates.some(list => list.length !== 1)) return null;
  const [a, b] = candidates.map(list => list[0]);
  if (a.value !== b.value || boxOverlap(a.relativeBox, b.relativeBox) < .75 ||
      existing.some(h => h.value !== null && boxOverlap(h.relativeBox, b.relativeBox) > 0)) return null;
  return {...b, source: 'neutral_white_consensus'};
}
function recoverNeutralHeart(image, grouped, colorModel, existing) {
  if (existing.some(h => h.color === 'any' && h.value !== null)) return null;
  // Under brighter illumination the neutral heart itself can pass the ordinary
  // white threshold (.32), joining its numeral to the background. Use two
  // STRICTER white masks only for unresolved neutral hearts. Both retain the
  // original digit/color confidence rules and use their own background mask.
  const passes = [.55, .65].map(threshold => {
    const white = (r, g, b) => Math.min(r, g, b) > threshold && isWhite(r, g, b);
    return guardCounts(heartObservations(image, grouped, colorModel, white));
  });
  return neutralConsensus(passes, existing);
}

/**
 * @param {{width:number,height:number,data:Uint8Array|Uint8ClampedArray}} input Cropped card RGBA.
 * @param {{digitTemplates:Array<{value:number,pixels:ArrayLike<number>}>,colorModel:Object}} model Locally loaded, immutable reference model.
 * @returns Partial observed values only; no card IDs or candidate catalog values enter this function.
 */
export function readLiveSignals(input, model) {
  const start = performance.now();
  try {
    if (!input || !Number.isInteger(input.width) || !Number.isInteger(input.height) || input.width <= 0 || input.height <= 0 ||
        input.width > MAX_EDGE || input.height > MAX_EDGE || input.width * input.height > MAX_PIXELS ||
        !ArrayBuffer.isView(input.data) || input.data.BYTES_PER_ELEMENT !== 1 || input.data.length !== input.width * input.height * 4) return unknown('invalid_or_oversized_image', performance.now() - start);
    const grouped = validateModel(model), corrected = correctIllumination(input);
    if (!corrected.image) return {...unknown('illumination_anchor_unknown', performance.now() - start), illumination: corrected.info};
    const sp = crop(corrected.image, SCORE);
    const scoreGlyphs = components(sp, (w, h) => h > .3 * sp.height && h < .95 * sp.height && w < .8 * sp.width);
    let best = null; for (const component of scoreGlyphs) if (!best || component.count > best.count) best = component;
    const score = best ? classify(best, grouped) : {value: null, reason: 'no_isolated_glyph'};
    const hp = crop(corrected.image, HEARTS), hearts = heartObservations(hp, grouped, model.colorModel);
    guardCounts(hearts);
    const neutral = recoverNeutralHeart(hp, grouped, model.colorModel, hearts);
    if (neutral) {hearts.push(neutral); guardCounts(hearts);}
    return {score, heartDigitObservations: hearts,
      acceptedPartialHearts: hearts.filter(h => h.value !== null && h.color !== 'unknown').map(h => ({color: h.color, count: h.value})),
      heartVectorComplete: false, illumination: corrected.info, diagnosticReason: null, elapsedMs: performance.now() - start};
  } catch (error) {
    const allowed = new Set(['INVALID_MODEL', 'INCOMPLETE_DIGIT_MODEL', 'INVALID_COLOR_MODEL', 'GLYPH_WORK_LIMIT']);
    return unknown(allowed.has(error?.message) ? error.message.toLowerCase() : 'signal_read_failed', performance.now() - start);
  }
}

// Pure internals exposed solely for local differential/guard tests; no state or I/O.
export const liveSignalTestHooks = Object.freeze({pythonRound, bilinear, normalizeGlyph, classifyColor, guardCounts, correctIllumination,
  neutralConsensus, recoverNeutralHeart});
