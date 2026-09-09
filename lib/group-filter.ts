import type { Card } from '../app/data/schema';

export const RIVAL_GROUP_IDS = ['a-rise', 'saint-snow', 'sunny-passion'] as const;

export function isRivalGroupId(groupId: string) {
  return RIVAL_GROUP_IDS.includes(groupId as (typeof RIVAL_GROUP_IDS)[number]);
}

export function matchesGroupFilter(card: Pick<Card, 'groupIds'>, groupId: string) {
  if (groupId === 'all') return true;
  if (groupId === 'rivals') return card.groupIds.some((id) => isRivalGroupId(id));
  return card.groupIds.includes(groupId);
}

export function matchesMemberGroupFilter(member: { groupId: string }, groupId: string) {
  if (groupId === 'all') return true;
  if (groupId === 'rivals') return isRivalGroupId(member.groupId);
  return member.groupId === groupId;
}
