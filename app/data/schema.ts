export type CardType = 'member' | 'live';
export type SortKey = 'cardNumber' | 'name' | 'cost' | 'score' | 'product';

export type HeartValue = { color: string | null; count: number };

export type Card = {
  id: string;
  cardNumber: string;
  name: string;
  cardType: CardType;
  groupIds: string[];
  memberIds: string[];
  productId: string;
  rarity: string | null;
  image: { url: string | null; alt: string | null };
  officialUrl: string | null;
  effectText: string | null;
  tags: string[];
  member: {
    cost: number | null;
    hearts: HeartValue[];
    bladeHearts: HeartValue[];
    yell: { count: number | null };
  } | null;
  live: { requiredHearts: HeartValue[]; score: number | null } | null;
};

type ReferenceItem = { id: string; label: string };
export type ReferenceData = {
  schemaVersion: number;
  cardTypes: ReferenceItem[];
  groups: (ReferenceItem & { enabled: boolean })[];
  heartColors: ReferenceItem[];
  members: (ReferenceItem & { groupId: string })[];
  products: ReferenceItem[];
};
