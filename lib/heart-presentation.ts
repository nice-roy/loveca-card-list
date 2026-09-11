export type HeartColor = 'pink' | 'red' | 'yellow' | 'green' | 'blue' | 'purple' | 'any';

export const HEART_COLOR_LABELS: Record<HeartColor, string> = {
  pink: '桃',
  red: '赤',
  yellow: '黄',
  green: '緑',
  blue: '青',
  purple: '紫',
  any: '無色',
};

const tokenColors: Record<string, HeartColor> = {
  heart01: 'pink',
  heart02: 'red',
  heart03: 'yellow',
  heart04: 'green',
  heart05: 'blue',
  heart06: 'purple',
  heart0: 'any',
};

export type EffectIcon =
  | { type: 'heart'; color: HeartColor }
  | { type: 'blade'; color: HeartColor | null; all: boolean };
export type EffectFragment = { type: 'text'; value: string } | { type: 'icon'; icon: EffectIcon };

function heartIcon(token: string): EffectIcon {
  return { type: 'heart', color: tokenColors[token] };
}

function bladeIcon(color: HeartColor | null = null, all = false): EffectIcon {
  return { type: 'blade', color, all };
}

export function splitEffectTextForDisplay(text: string): EffectFragment[] {
  const fragments: EffectFragment[] = [];
  const pattern = /\[(heart0[1-6]|heart0)\]ブレード|(heart0[1-6]|heart0)ブレード|\[(heart0[1-6]|heart0)\]|heart0[1-6]|heart0|\[(ALL|全)ブレード\]|\[ブレード\]|◇|♥/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > cursor) fragments.push({ type: 'text', value: text.slice(cursor, index) });
    const value = match[0];
    const bracketBladeToken = match[1];
    const bladeToken = match[2];
    const bracketHeartToken = match[3];
    if (bracketBladeToken) fragments.push({ type: 'icon', icon: bladeIcon(tokenColors[bracketBladeToken]) });
    else if (bladeToken) fragments.push({ type: 'icon', icon: bladeIcon(tokenColors[bladeToken]) });
    else if (bracketHeartToken) fragments.push({ type: 'icon', icon: heartIcon(bracketHeartToken) });
    else if (/^heart/.test(value)) fragments.push({ type: 'icon', icon: heartIcon(value) });
    else if (/^\[(ALL|全)ブレード\]$/.test(value)) fragments.push({ type: 'icon', icon: bladeIcon('any', true) });
    else if (value === '[ブレード]') fragments.push({ type: 'icon', icon: bladeIcon() });
    else if (value === '◇') fragments.push({ type: 'icon', icon: heartIcon('heart0') });
    else fragments.push({ type: 'icon', icon: { type: 'heart', color: 'any' } });
    cursor = index + value.length;
  }
  if (cursor < text.length) fragments.push({ type: 'text', value: text.slice(cursor) });
  return fragments.length ? fragments : [{ type: 'text', value: text }];
}

export function heartDisplayLabel(color: HeartColor, blade = false) {
  if (blade && color === 'any') return 'ALLブレード';
  return `${HEART_COLOR_LABELS[color]}${blade ? 'ブレード' : 'ハート'}`;
}
