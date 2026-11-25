// Conservative, pure refinement of existing LIVE visual matches. No image or I/O.
// Printed values corroborate the existing top match; they never invent a match,
// select a physical version, or infer zero from an unobserved heart color.
const COLORS = new Set(['red', 'pink', 'yellow', 'green', 'blue', 'purple', 'any']);
const validId = value => typeof value === 'string' && value.length > 0;
const integerIn = (value, low, high) => Number.isInteger(value) && value >= low && value <= high;
const confidentDigit = digit => digit && integerIn(digit.value, 0, 9) &&
  Number.isFinite(digit.difference) && digit.difference >= 0 && digit.difference < .11 &&
  Number.isFinite(digit.margin) && digit.margin > .025 && !digit.reason;

function observedValues(signals) {
  if (!signals || signals.diagnosticReason || signals.illumination?.accepted !== true ||
      !confidentDigit(signals.score) || signals.heartVectorComplete !== false) return null;
  const pairs = signals.acceptedPartialHearts, glyphs = signals.heartDigitObservations;
  if (!Array.isArray(pairs) || pairs.length < 2 || pairs.length > COLORS.size ||
      !Array.isArray(glyphs)) return null;
  const hearts = new Map();
  for (const pair of pairs) {
    if (!pair || !COLORS.has(pair.color) || !integerIn(pair.count, 1, 9) || hearts.has(pair.color)) return null;
    hearts.set(pair.color, pair.count);
  }
  // White outlines/noise and rejected/unknown-color glyphs are not observations.
  // Cross-check the accepted subset only: this reader intentionally reports a
  // partial vector, and unknown fields must not become presumed zero counts.
  const acceptedGlyphs = glyphs.filter(glyph => confidentDigit(glyph) &&
    integerIn(glyph.value, 1, 9) && COLORS.has(glyph.color));
  if (acceptedGlyphs.length !== pairs.length) return null;
  const seen = new Set();
  for (const glyph of acceptedGlyphs) {
    if (seen.has(glyph.color) || hearts.get(glyph.color) !== glyph.value) return null;
    seen.add(glyph.color);
  }
  return {score: signals.score.value, hearts};
}

function cardValues(card) {
  if (!card || card.cardType !== 'live' || card.standardLayout !== true ||
      typeof card.name !== 'string' || !card.name.trim() || !integerIn(card.score, 0, 100) ||
      !Array.isArray(card.requiredHearts) || !card.requiredHearts.length || card.requiredHearts.length > COLORS.size) return null;
  const hearts = new Map();
  for (const pair of card.requiredHearts) {
    if (!pair || !COLORS.has(pair.color) || !integerIn(pair.count, 1, 100) || hearts.has(pair.color)) return null;
    hearts.set(pair.color, pair.count);
  }
  return {score: card.score, hearts};
}

function contradicts(values, observed) {
  if (values.score !== observed.score) return true;
  // The metadata is a complete requirement list; the observation is partial.
  // Additional unobserved requirements in metadata do NOT contradict a read.
  for (const [color, count] of observed.hearts) if (values.hearts.get(color) !== count) return true;
  return false;
}

/**
 * liveCards: Map(cardId -> {cardId,cardType,name,score,requiredHearts,standardLayout}).
 * signals: unchanged readLiveSignals() result, from this same cropped card.
 * visualTop: geometric evidence for candidates[0], including illustration-only
 * inliers (not the generic card artwork region) and upright orientation.
 * Unknown/missing values preserve the original arrays and order. On refinement,
 * demoted normal candidates remain available as unconfirmed alternatives.
 */
export function refineLiveCandidates({candidates, additionalCandidates = [], liveCards, signals, visualTop} = {}) {
  const unchanged = reason => ({candidates, additionalCandidates,
    refinement: {applied: false, reason, demotedCardIds: []}});
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 3 ||
      !Array.isArray(additionalCandidates) || additionalCandidates.length > 6 || !(liveCards instanceof Map)) return unchanged('invalid_inputs');
  const normalIds = new Set();
  for (const candidate of candidates) {
    const card = candidate && liveCards.get(candidate.cardId);
    if (!candidate || !validId(candidate.cardId) || normalIds.has(candidate.cardId) ||
        candidate.evidence !== 'visual_similarity' || card?.cardType !== 'live' || card.cardId !== candidate.cardId) return unchanged('not_all_verified_live');
    normalIds.add(candidate.cardId);
  }
  if (additionalCandidates.some(candidate => !candidate || !validId(candidate.cardId))) return unchanged('invalid_alternatives');
  const top = candidates[0], topCard = liveCards.get(top.cardId);
  if (!visualTop || visualTop.cardId !== top.cardId || visualTop.upright !== true ||
      !integerIn(visualTop.illustrationInliers, 6, Number.MAX_SAFE_INTEGER)) return unchanged('insufficient_illustration_or_orientation');
  const observed = observedValues(signals), topValues = cardValues(topCard);
  if (!observed || !topValues) return unchanged('uncertain_signals_or_top_metadata');
  if (contradicts(topValues, observed)) return unchanged('top_not_corroborated');

  const retained = [], demoted = [];
  for (const candidate of candidates) {
    const card = liveCards.get(candidate.cardId), values = cardValues(card);
    // Same-title editions stay together, even if metadata is inconsistent.
    // Missing/unsupported metadata must not be used to remove a candidate.
    if (candidate.cardId === top.cardId || card.name === topCard.name || !values || !contradicts(values, observed)) retained.push(candidate);
    else demoted.push(candidate);
  }
  if (!demoted.length) return unchanged('no_contradictions');
  const seen = new Set(retained.map(candidate => candidate.cardId)), alternatives = [];
  for (const candidate of [...demoted, ...additionalCandidates]) {
    if (seen.has(candidate.cardId)) continue;
    seen.add(candidate.cardId);
    alternatives.push({...candidate, evidence: 'visual_fallback', similarityScore: null,
      ambiguity: 'physical_version_unconfirmed', rank: alternatives.length + 1});
  }
  // Do not silently discard previously accessible alternatives to meet a cap.
  if (alternatives.length > 6) return unchanged('alternative_capacity');
  return {candidates: retained.map((candidate, index) => ({...candidate, rank: index + 1})),
    additionalCandidates: alternatives,
    refinement: {applied: true, reason: 'printed_values_corroborate_top', demotedCardIds: demoted.map(candidate => candidate.cardId)}};
}
