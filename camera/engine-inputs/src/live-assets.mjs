// Private, same-origin trained-data loader. Never accepts or stores query photographs.
const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEMPLATES = 512; // Same bound as the frozen signal reader.
const PIXELS_PER_TEMPLATE = 28 * 40;
const COLORS = new Set(['red', 'pink', 'yellow', 'green', 'blue', 'purple', 'any']);

function invalid(reason) { throw new TypeError(`LIVE_ASSETS_${reason}`); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function integer(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
function boundedString(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max &&
    value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
}
function abortError() { return new DOMException('Live asset loading was cancelled.', 'AbortError'); }
function checkAbort(signal) { if (signal?.aborted) throw signal.reason ?? abortError(); }

/** Parse a bounded JSON string into fresh, validated trained data; no I/O or globals changed. */
export function parseLiveAssets(text) {
  if (typeof text !== 'string' || text.length > MAX_BYTES || new TextEncoder().encode(text).length > MAX_BYTES) invalid('SIZE');
  let source;
  try { source = JSON.parse(text); } catch { invalid('JSON'); }
  if (!record(source) || source.version !== 1) invalid('VERSION');
  if (!Array.isArray(source.digitTemplates) || !integer(source.digitTemplates.length, 1, MAX_TEMPLATES)) invalid('TEMPLATES');
  const digits = new Set();
  const digitTemplates = source.digitTemplates.map(template => {
    if (!record(template) || !integer(template.value, 0, 9) ||
        typeof template.pixelsBase64 !== 'string' || template.pixelsBase64.length !== 1496 ||
        !/^[A-Za-z0-9+/]{1494}==$/u.test(template.pixelsBase64)) invalid('TEMPLATE');
    let bytes;
    try { bytes = atob(template.pixelsBase64); } catch { invalid('TEMPLATE_BASE64'); }
    if (bytes.length !== PIXELS_PER_TEMPLATE || btoa(bytes) !== template.pixelsBase64) invalid('TEMPLATE_BASE64');
    const pixels = new Float64Array(PIXELS_PER_TEMPLATE);
    for (let i = 0; i < pixels.length; i++) pixels[i] = bytes.charCodeAt(i) / 255;
    digits.add(template.value);
    return Object.freeze({value: template.value, pixels});
  });
  if (digits.size !== 10) invalid('MISSING_DIGITS');
  if (!record(source.colorModel)) invalid('COLOR_MODEL');
  const colorModel = {};
  for (const color of ['red', 'pink']) {
    const sample = source.colorModel[color];
    if (!record(sample) || !Number.isFinite(sample.hueMedian) || sample.hueMedian < -.5 || sample.hueMedian > .5 ||
        !Number.isFinite(sample.hueRadius) || sample.hueRadius <= 0 || sample.hueRadius > .045) invalid('COLOR_MODEL');
    colorModel[color] = Object.freeze({hueMedian: sample.hueMedian, hueRadius: sample.hueRadius});
  }
  if (!Array.isArray(source.cards) || !integer(source.cards.length, 1, 4096)) invalid('CARDS');
  const liveCards = new Map();
  for (const card of source.cards) {
    if (!record(card) || !boundedString(card.cardId, 200) || !boundedString(card.cardNumber, 100) ||
        !boundedString(card.name, 512) || card.cardType !== 'live' || !integer(card.score, 0, 100) ||
        typeof card.standardLayout !== 'boolean' || !Array.isArray(card.requiredHearts) || card.requiredHearts.length > 7) invalid('CARD');
    if (liveCards.has(card.cardId)) invalid('DUPLICATE_CARD_ID');
    const seenColors = new Set();
    const requiredHearts = card.requiredHearts.map(heart => {
      if (!record(heart) || !COLORS.has(heart.color) || !integer(heart.count, 1, 100) || seenColors.has(heart.color)) invalid('HEART');
      seenColors.add(heart.color);
      return Object.freeze({color: heart.color, count: heart.count});
    });
    liveCards.set(card.cardId, Object.freeze({cardId: card.cardId, cardNumber: card.cardNumber,
      cardType: 'live', name: card.name, score: card.score,
      requiredHearts: Object.freeze(requiredHearts), standardLayout: card.standardLayout}));
  }
  return Object.freeze({model: Object.freeze({digitTemplates: Object.freeze(digitTemplates),
    colorModel: Object.freeze(colorModel)}), liveCards});
}

function assetURL(root) {
  const base = new URL(String(root), globalThis.location?.href);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  base.search = ''; base.hash = '';
  const url = new URL('data/live-signals-model.json', base);
  const origin = globalThis.location?.origin ?? base.origin;
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin || url.username || url.password) invalid('ORIGIN');
  return url.href;
}

async function fetchAssets(url, signal) {
  checkAbort(signal);
  const response = await fetch(url, {method: 'GET', credentials: 'omit', redirect: 'error', cache: 'no-store', signal});
  checkAbort(signal);
  if (!response.ok || response.redirected || (response.url && response.url !== url)) invalid('RESPONSE');
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/u.test(declared) || Number(declared) > MAX_BYTES)) {
    await response.body?.cancel(); invalid('SIZE');
  }
  if (!response.body?.getReader) invalid('BODY');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  const cancel = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', cancel, {once: true});
  try {
    while (true) {
      checkAbort(signal);
      const next = await reader.read();
      checkAbort(signal);
      if (next.done) break;
      if (!(next.value instanceof Uint8Array) || next.value.length > MAX_BYTES - length) {
        await reader.cancel(); invalid('SIZE');
      }
      length += next.value.length; chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener('abort', cancel);
    reader.releaseLock();
  }
  checkAbort(signal);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let text;
  try { text = new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { invalid('UTF8'); }
  checkAbort(signal);
  return parseLiveAssets(text);
}

/** Cache only one validated trained-data object. clear() cancels work and allows later retry. */
export function createLiveAssetLoader(root) {
  const url = assetURL(root);
  let cached = null, pending = null;
  function clear() {
    cached = null;
    const old = pending; pending = null;
    old?.controller.abort(abortError());
  }
  function load({signal} = {}) {
    try { checkAbort(signal); } catch (error) { return Promise.reject(error); }
    if (cached) return Promise.resolve(cached);
    if (!pending) {
      const request = {controller: new AbortController(), users: 0, settled: false, promise: null};
      pending = request;
      request.promise = fetchAssets(url, request.controller.signal).then(data => {
        checkAbort(request.controller.signal);
        if (pending !== request || request.users === 0) throw abortError();
        cached = data;
        return data;
      }).finally(() => {
        request.settled = true;
        if (pending === request) pending = null;
      });
    }
    const request = pending;
    request.users++;
    return new Promise((resolve, reject) => {
      let finished = false;
      function finish(error, data) {
        if (finished) return;
        finished = true;
        signal?.removeEventListener('abort', callerAbort);
        request.controller.signal.removeEventListener('abort', sharedAbort);
        request.users--;
        if (error) reject(error); else resolve(data);
        if (request.users === 0 && !request.settled) {
          if (pending === request) pending = null;
          request.controller.abort(abortError());
        }
      }
      const callerAbort = () => finish(signal.reason ?? abortError());
      const sharedAbort = () => finish(request.controller.signal.reason ?? abortError());
      signal?.addEventListener('abort', callerAbort, {once: true});
      request.controller.signal.addEventListener('abort', sharedAbort, {once: true});
      request.promise.then(data => finish(null, data), error => finish(error));
      if (signal?.aborted) callerAbort();
      else if (request.controller.signal.aborted) sharedAbort();
    });
  }
  return Object.freeze({load, clear});
}
