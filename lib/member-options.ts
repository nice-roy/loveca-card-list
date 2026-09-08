export type MemberOption = { id: string; label: string; groupId: string };
export type MemberOptionSection = { id: string; label: string; options: MemberOption[] };
export type MemberOptionGroup = { id: string; label: string | null; sections: MemberOptionSection[] };
export type MemberDisplayMode = 'schoolYear' | 'unit';

type MemberDisplayMetadata = {
  name: string;
  group: string;
  schoolYear: 1 | 2 | 3 | null;
  sortOrder: number;
  kind: 'single' | 'multiple';
  units?: string[];
  participantGroups?: string[];
};

type UnitDisplayMetadata = { id: string; label: string; sortOrder: number };

// ユニット名・順序・所属は公式のユニット情報を表示用に明示管理する。
const unitsByGroup: Record<string, UnitDisplayMetadata[]> = {
  liella: [
    { id: 'cat-chu', label: 'CatChu!', sortOrder: 1 },
    { id: 'kaleidoscore', label: 'KALEIDOSCORE', sortOrder: 2 },
    { id: '5yncri5e', label: '5yncri5e!', sortOrder: 3 },
  ],
  aqours: [
    { id: 'cyaron', label: 'CYaRon!', sortOrder: 1 },
    { id: 'azalea', label: 'AZALEA', sortOrder: 2 },
    { id: 'guilty-kiss', label: 'Guilty Kiss', sortOrder: 3 },
  ],
  muse: [
    { id: 'printemps', label: 'Printemps', sortOrder: 1 },
    { id: 'lily-white', label: 'lily white', sortOrder: 2 },
    { id: 'bibi', label: 'BiBi', sortOrder: 3 },
  ],
};

// 学年は各作品の公式プロフィール、順序は公式メンバー掲載順を明示している。
const memberDisplayMetadata: MemberDisplayMetadata[] = [
  { name: '澁谷かのん', group: 'liella', schoolYear: 3, sortOrder: 1, kind: 'single', units: ['cat-chu'] },
  { name: '唐 可可', group: 'liella', schoolYear: 3, sortOrder: 2, kind: 'single', units: ['kaleidoscore'] },
  { name: '嵐 千砂都', group: 'liella', schoolYear: 3, sortOrder: 3, kind: 'single', units: ['5yncri5e'] },
  { name: '平安名すみれ', group: 'liella', schoolYear: 3, sortOrder: 4, kind: 'single', units: ['cat-chu'] },
  { name: '葉月 恋', group: 'liella', schoolYear: 3, sortOrder: 5, kind: 'single', units: ['kaleidoscore'] },
  { name: '桜小路きな子', group: 'liella', schoolYear: 2, sortOrder: 6, kind: 'single', units: ['5yncri5e'] },
  { name: '米女メイ', group: 'liella', schoolYear: 2, sortOrder: 7, kind: 'single', units: ['cat-chu'] },
  { name: '若菜四季', group: 'liella', schoolYear: 2, sortOrder: 8, kind: 'single', units: ['5yncri5e'] },
  { name: '鬼塚夏美', group: 'liella', schoolYear: 2, sortOrder: 9, kind: 'single', units: ['5yncri5e'] },
  { name: 'ウィーン・マルガレーテ', group: 'liella', schoolYear: 1, sortOrder: 10, kind: 'single', units: ['kaleidoscore'] },
  { name: '鬼塚冬毬', group: 'liella', schoolYear: 1, sortOrder: 11, kind: 'single', units: ['5yncri5e'] },
  { name: '嵐 千砂都＆鬼塚夏美', group: 'liella', schoolYear: null, sortOrder: 101, kind: 'multiple', participantGroups: ['liella'] },
  { name: '上原歩夢&澁谷かのん&日野下花帆', group: 'liella', schoolYear: null, sortOrder: 102, kind: 'multiple', participantGroups: ['nijigasaki', 'liella', 'hasunosora'] },
  { name: '国木田花丸&優木せつ菜&嵐 千砂都', group: 'liella', schoolYear: null, sortOrder: 103, kind: 'multiple', participantGroups: ['aqours', 'nijigasaki', 'liella'] },
  { name: '渡辺 曜&鬼塚夏美&大沢瑠璃乃', group: 'liella', schoolYear: null, sortOrder: 104, kind: 'multiple', participantGroups: ['aqours', 'liella', 'hasunosora'] },
  { name: '絢瀬絵里&朝香果林&葉月 恋', group: 'liella', schoolYear: null, sortOrder: 105, kind: 'multiple', participantGroups: ['muse', 'nijigasaki', 'liella'] },

  { name: '高海千歌', group: 'aqours', schoolYear: 2, sortOrder: 1, kind: 'single', units: ['cyaron'] },
  { name: '桜内梨子', group: 'aqours', schoolYear: 2, sortOrder: 2, kind: 'single', units: ['guilty-kiss'] },
  { name: '松浦果南', group: 'aqours', schoolYear: 3, sortOrder: 3, kind: 'single', units: ['azalea'] },
  { name: '黒澤ダイヤ', group: 'aqours', schoolYear: 3, sortOrder: 4, kind: 'single', units: ['azalea'] },
  { name: '渡辺 曜', group: 'aqours', schoolYear: 2, sortOrder: 5, kind: 'single', units: ['cyaron'] },
  { name: '津島善子', group: 'aqours', schoolYear: 1, sortOrder: 6, kind: 'single', units: ['guilty-kiss'] },
  { name: '国木田花丸', group: 'aqours', schoolYear: 1, sortOrder: 7, kind: 'single', units: ['azalea'] },
  { name: '小原鞠莉', group: 'aqours', schoolYear: 3, sortOrder: 8, kind: 'single', units: ['guilty-kiss'] },
  { name: '黒澤ルビィ', group: 'aqours', schoolYear: 1, sortOrder: 9, kind: 'single', units: ['cyaron'] },

  { name: '高坂穂乃果', group: 'muse', schoolYear: 2, sortOrder: 1, kind: 'single', units: ['printemps'] },
  { name: '絢瀬絵里', group: 'muse', schoolYear: 3, sortOrder: 2, kind: 'single', units: ['bibi'] },
  { name: '南ことり', group: 'muse', schoolYear: 2, sortOrder: 3, kind: 'single', units: ['printemps'] },
  { name: '園田海未', group: 'muse', schoolYear: 2, sortOrder: 4, kind: 'single', units: ['lily-white'] },
  { name: '星空凛', group: 'muse', schoolYear: 1, sortOrder: 5, kind: 'single', units: ['lily-white'] },
  { name: '西木野真姫', group: 'muse', schoolYear: 1, sortOrder: 6, kind: 'single', units: ['bibi'] },
  { name: '東條希', group: 'muse', schoolYear: 3, sortOrder: 7, kind: 'single', units: ['lily-white'] },
  { name: '小泉花陽', group: 'muse', schoolYear: 1, sortOrder: 8, kind: 'single', units: ['printemps'] },
  { name: '矢澤にこ', group: 'muse', schoolYear: 3, sortOrder: 9, kind: 'single', units: ['bibi'] },
];

const metadataByName = new Map(memberDisplayMetadata.map((item) => [item.name, item]));

function sectionsFor(options: MemberOption[], includeCrossGroup: boolean, displayMode: MemberDisplayMode) {
  const entries = options.map((option) => ({ option, metadata: metadataByName.get(option.label) }))
    .filter(({ metadata }) => includeCrossGroup || !metadata?.participantGroups || new Set(metadata.participantGroups).size <= 1)
    .sort((left, right) => (left.metadata?.sortOrder ?? Number.MAX_SAFE_INTEGER) - (right.metadata?.sortOrder ?? Number.MAX_SAFE_INTEGER));
  const sections: MemberOptionSection[] = [];
  if (displayMode === 'unit') {
    const groupId = entries[0]?.metadata?.group;
    const units = [...(unitsByGroup[groupId ?? ''] ?? [])].sort((left, right) => left.sortOrder - right.sortOrder);
    for (const unit of units) {
      const unitOptions = entries
        .filter(({ metadata }) => metadata?.kind === 'single' && metadata.units?.includes(unit.id))
        .map(({ option }) => option);
      if (unitOptions.length) sections.push({ id: `unit-${unit.id}`, label: unit.label, options: unitOptions });
    }
    const noUnit = entries.filter(({ metadata }) => metadata?.kind === 'single' && !metadata.units?.length).map(({ option }) => option);
    if (noUnit.length) sections.push({ id: 'no-unit', label: 'ユニットなし', options: noUnit });
    const unclassified = entries.filter(({ metadata }) => !metadata).map(({ option }) => option);
    if (unclassified.length) sections.push({ id: 'unclassified', label: 'ユニット未確認', options: unclassified });
    const multiple = entries.filter(({ metadata }) => metadata?.kind === 'multiple').map(({ option }) => option);
    if (multiple.length) sections.push({ id: 'multiple', label: '複数メンバー', options: multiple });
    return sections;
  }
  for (const year of [1, 2, 3] as const) {
    const yearOptions = entries.filter(({ metadata }) => metadata?.kind === 'single' && metadata.schoolYear === year).map(({ option }) => option);
    if (yearOptions.length) sections.push({ id: `year-${year}`, label: `${year}年生`, options: yearOptions });
  }
  const multiple = entries.filter(({ metadata }) => metadata?.kind === 'multiple').map(({ option }) => option);
  if (multiple.length) sections.push({ id: 'multiple', label: '複数メンバー', options: multiple });
  const unclassified = entries.filter(({ metadata }) => !metadata).map(({ option }) => option);
  if (unclassified.length) sections.push({ id: 'unclassified', label: '学年未確認', options: unclassified });
  return sections;
}

export function groupMemberOptions(options: MemberOption[], selectedGroupId: string, groups: { id: string; label: string; enabled: boolean }[], displayMode: MemberDisplayMode = 'schoolYear'): MemberOptionGroup[] {
  if (selectedGroupId !== 'all') {
    return [{ id: selectedGroupId, label: null, sections: sectionsFor(options, true, displayMode) }];
  }

  const result = groups.filter((group) => group.enabled).flatMap((group) => {
    const groupOptions = options.filter((option) => option.groupId === group.id);
    const sections = sectionsFor(groupOptions, false, displayMode);
    return sections.length ? [{ id: group.id, label: group.label, sections }] : [];
  });
  const crossGroupOptions = options.filter((option) => {
    const participantGroups = metadataByName.get(option.label)?.participantGroups;
    return participantGroups && new Set(participantGroups).size > 1;
  }).sort((left, right) => (metadataByName.get(left.label)?.sortOrder ?? 0) - (metadataByName.get(right.label)?.sortOrder ?? 0));
  if (crossGroupOptions.length) {
    result.push({ id: 'cross-group', label: 'グループ横断・複数メンバー', sections: [{ id: 'multiple', label: '複数メンバー', options: crossGroupOptions }] });
  }
  return result;
}

export function missingMemberMetadata(options: MemberOption[]) {
  return options.filter((option) => !metadataByName.has(option.label)).map((option) => option.label);
}
