import assert from 'node:assert/strict';
import test from 'node:test';
import cards from '../app/data/cards.json' with { type: 'json' };
import audit from '../docs/data-audit/GENERAL-FIXES.json' with { type: 'json' };
import { applyAuditedCardCorrections } from '../lib/card-data-corrections.ts';
import { createAiConsultationText, formatEffectTextForAi } from '../lib/deck-builder.ts';
import { splitEffectTextForDisplay } from '../lib/heart-presentation.ts';
import { parseCandidateImportText } from '../lib/candidate-import.ts';

test('audited card corrections preserve IDs, order, the source master and unrelated fields', () => {
  const source = JSON.stringify(cards);
  const corrected = applyAuditedCardCorrections(cards);
  assert.equal(JSON.stringify(cards), source);
  assert.deepEqual(corrected.map(card => card.id), cards.map(card => card.id));
  assert.deepEqual(corrected.filter((card, index) => card !== cards[index]).map(card => card.cardNumber).sort(), [...audit.lineBreakCorrections, audit.heartCorrection.cardNumber].sort());
  assert.deepEqual(applyAuditedCardCorrections(corrected), corrected);
  const eli = corrected.find(card => card.cardNumber === 'PL!-bp4-002-SEC');
  const original = cards.find(card => card.id === eli.id);
  assert.deepEqual(eli, { ...original, member: { ...original.member, bladeHearts: [{ color: 'purple', count: 1 }] } });
  const consultation = createAiConsultationText([{ id: 'PL!-bp4-002', card: eli, quantity: 1 }]);
  assert.match(consultation, /ブレードハート：紫×1/);
});

test('all eight corrected effects keep their text and real line breaks in display and AI copy', () => {
  const corrected = applyAuditedCardCorrections(cards);
  assert.equal(corrected.filter(card => /<br\s*\/?\s*>/i.test(card.effectText ?? '')).length, 0);
  for (const number of audit.lineBreakCorrections) {
    const card = corrected.find(item => item.cardNumber === number);
    const original = cards.find(item => item.id === card.id);
    assert.deepEqual(card, { ...original, effectText: original.effectText.replace('<br>\n', '\n') });
    const display = splitEffectTextForDisplay(card.effectText).filter(fragment => fragment.type === 'text').map(fragment => fragment.value).join('');
    assert.doesNotMatch(display, /<br/i);
    assert.match(display, /\n\(/);
    assert.doesNotMatch(formatEffectTextForAi(card), /<br/i);
    assert.match(formatEffectTextForAi(card), /\n\(/);
  }
});

test('candidate import isolates markdown and plain bulk headings from adopted, reduced and trailing cards', () => {
  const knownIds = ['PL!-bp8-020', 'PL!-bp8-023', 'PL!-bp8-001'];
  for (const header of ['【候補一括追加用】', '候補一括追加用', '**候補一括追加用**', '__候補一括追加用__', '### 候補一括追加用', '## **候補一括追加用**', '### 【候補一括追加用】', '候補一括追加用：']) {
    const answer = ['採用中：PL!-bp8-020', '減らす候補：PL!-bp8-023', header, '', '```text', 'PL!-bp8-001 | 高坂穂乃果 | 4', '```', '補足：PL!-bp8-023は今回は増やしません。'].join('\n');
    assert.deepEqual(parseCandidateImportText(answer, knownIds), { recognizedIds: ['PL!-bp8-001'], unrecognizedCardNumbers: [], usedBulkCandidateSection: true }, header);
  }
  assert.deepEqual(parseCandidateImportText('採用中 PL!-bp8-020\n候補一括追加用\n```\n```\nPL!-bp8-023', knownIds).recognizedIds, []);
  assert.deepEqual(parseCandidateImportText('採用中 PL!-bp8-020\n## 候補一括追加用\nPL!-bp8-001 | 高坂穂乃果 | 4\n## 減らす候補\nPL!-bp8-023', knownIds).recognizedIds, ['PL!-bp8-001']);
});
