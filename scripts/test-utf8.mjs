import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateUtf8Files } from './validate-utf8.mjs';

test('build text files are strictly UTF-8 and JSON files parse', () => {
  const validated = validateUtf8Files();
  assert.ok(validated.includes('app/data/cards.json'));
  assert.ok(validated.includes('app/data/reference-data.json'));
});
