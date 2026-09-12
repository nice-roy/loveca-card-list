import assert from 'node:assert/strict';
import test from 'node:test';
import { GROUP_STORAGE_KEY, normalizeGroupPreference } from '../lib/group-preference.ts';

const selectableGroups = new Set(['all', 'liella', 'aqours', 'muse', 'nijigasaki', 'hasunosora', 'other-live', 'other', 'a-rise', 'saint-snow', 'sunny-passion']);

test('group preference uses a dedicated key and safely restores every selectable group', () => {
  assert.equal(GROUP_STORAGE_KEY, 'loveca-card-list:group:v1');
  for (const groupId of selectableGroups) assert.equal(normalizeGroupPreference(groupId, selectableGroups), groupId);
  assert.equal(normalizeGroupPreference(null, selectableGroups), 'all');
  assert.equal(normalizeGroupPreference('unknown-group', selectableGroups), 'all');
  assert.equal(normalizeGroupPreference({ groupId: 'liella' }, selectableGroups), 'all');
});

test('legacy rival parent preference safely migrates to the other category', () => {
  assert.equal(normalizeGroupPreference('rivals', selectableGroups), 'other');
});
