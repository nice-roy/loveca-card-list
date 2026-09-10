import assert from 'node:assert/strict';
import { test } from 'node:test';
import references from '../app/data/reference-data.json' with { type: 'json' };
import { groupMemberOptions, missingMemberMetadata } from '../lib/member-options.ts';

test('all current member options have explicit display metadata', () => {
  assert.deepEqual(missingMemberMetadata(references.members), []);
});

for (const [groupId, expectedYears] of [['liella', ['1年生', '2年生', '3年生', '複数メンバー']], ['aqours', ['1年生', '2年生', '3年生']], ['muse', ['1年生', '2年生', '3年生']]]) {
  test(`${groupId} options are grouped by school year in ascending order`, () => {
    const options = references.members.filter((member) => member.groupId === groupId);
    const groups = groupMemberOptions(options, groupId, references.groups);
    assert.deepEqual(groups[0].sections.map((section) => section.label), expectedYears);
  });
}

test('all-groups view follows group order and separates cross-group combinations last', () => {
  const groups = groupMemberOptions(references.members, 'all', references.groups);
  assert.deepEqual(groups.map((group) => group.label), ['Liella!', 'Aqours', "μ's", 'A-RISE', 'Saint Snow', 'Sunny Passion', '虹ヶ咲', '蓮ノ空', 'グループ横断・複数メンバー']);
  assert.equal(groups[0].sections.at(-1)?.label, '複数メンバー');
  assert.deepEqual(groups[0].sections.at(-1)?.options.map((option) => option.label), ['嵐 千砂都＆鬼塚夏美']);
  assert.equal(groups.at(-1)?.sections[0].options.length, 6);
});

test('official member order is retained inside each school year', () => {
  const aqours = groupMemberOptions(references.members.filter((member) => member.groupId === 'aqours'), 'aqours', references.groups)[0];
  assert.deepEqual(aqours.sections[0].options.map((option) => option.label), ['津島善子', '国木田花丸', '黒澤ルビィ']);
  const muse = groupMemberOptions(references.members.filter((member) => member.groupId === 'muse'), 'muse', references.groups)[0];
  assert.deepEqual(muse.sections[1].options.map((option) => option.label), ['高坂穂乃果', '南ことり', '園田海未']);
});

for (const [groupId, expectedUnits] of [
  ['liella', ['CatChu!', 'KALEIDOSCORE', '5yncri5e!', '複数メンバー']],
  ['aqours', ['CYaRon!', 'AZALEA', 'Guilty Kiss']],
  ['muse', ['Printemps', 'lily white', 'BiBi']],
]) {
  test(`${groupId} options use explicit official unit order`, () => {
    const options = references.members.filter((member) => member.groupId === groupId);
    const groups = groupMemberOptions(options, groupId, references.groups, 'unit');
    assert.deepEqual(groups[0].sections.map((section) => section.label), expectedUnits);
  });
}

test('unit mode retains member ids and separates cross-group combinations in all-groups view', () => {
  const groups = groupMemberOptions(references.members, 'all', references.groups, 'unit');
  assert.deepEqual(groups.map((group) => group.label), ['Liella!', 'Aqours', "μ's", 'A-RISE', 'Saint Snow', 'Sunny Passion', '虹ヶ咲', '蓮ノ空', 'グループ横断・複数メンバー']);
  assert.deepEqual(groups[0].sections[0].options.map((option) => option.label), ['澁谷かのん', '平安名すみれ', '米女メイ']);
  assert.equal(groups[0].sections.at(-1)?.label, '複数メンバー');
  assert.equal(groups.at(-1)?.sections[0].options.length, 6);
});

test('rival members use safe school-year and unit fallbacks without invented classifications', () => {
  for (const [groupId, labels] of [
    ['a-rise', ['綺羅ツバサ', '優木あんじゅ', '統堂英玲奈']],
    ['saint-snow', ['鹿角聖良', '鹿角理亞']],
    ['sunny-passion', ['柊摩央', '聖澤悠奈']],
  ]) {
    const options = references.members.filter((member) => member.groupId === groupId);
    const school = groupMemberOptions(options, groupId, references.groups, 'schoolYear')[0];
    const unit = groupMemberOptions(options, groupId, references.groups, 'unit')[0];
    assert.deepEqual(school.sections.map((section) => section.label), ['学年なし']);
    assert.deepEqual(unit.sections.map((section) => section.label), ['ユニットなし']);
    assert.deepEqual(school.sections[0].options.map((option) => option.label), labels);
  }
});

test('Liella unit memberships exactly match the official eleven-member structure', () => {
  const liella = groupMemberOptions(references.members.filter((member) => member.groupId === 'liella'), 'liella', references.groups, 'unit')[0];
  assert.deepEqual(Object.fromEntries(liella.sections.filter((section) => section.label !== '複数メンバー').map((section) => [section.label, section.options.map((option) => option.label)])), {
    'CatChu!': ['澁谷かのん', '平安名すみれ', '米女メイ'],
    KALEIDOSCORE: ['唐 可可', '葉月 恋', 'ウィーン・マルガレーテ'],
    '5yncri5e!': ['嵐 千砂都', '桜小路きな子', '若菜四季', '鬼塚夏美', '鬼塚冬毬'],
  });
  const singles = liella.sections.filter((section) => section.label !== '複数メンバー').flatMap((section) => section.options.map((option) => option.id));
  assert.equal(new Set(singles).size, 11);
  assert.equal(singles.length, 11);
});
