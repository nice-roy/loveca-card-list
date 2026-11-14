import { baseCardId } from './card-grouping.ts';

export type CandidateImportParseResult = {
  recognizedIds: string[];
  unrecognizedCardNumbers: string[];
  usedBulkCandidateSection: boolean;
};

function sourceForCandidateImport(text: string) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const headerIndex = lines.findIndex((line) => line.trim()
    .replace(/^#{1,6}\s*/, '').replace(/\s+#+$/, '')
    .replace(/\*\*|__/g, '').replace(/[:：]\s*$/, '').trim()
    .replace(/^[【「]\s*/, '').replace(/\s*[】」]$/, '').trim() === '候補一括追加用');
  if (headerIndex === -1) return { source: text, usedBulkCandidateSection: false };

  const section: string[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const fence = line.match(/^\s*(`{3,}|~{3,})[^`~]*$/);
    if (fence) {
      const block: string[] = [];
      const closingFence = new RegExp(`^\\s*${fence[1][0]}{${fence[1].length},}\\s*$`);
      for (let next = index + 1; next < lines.length && !closingFence.test(lines[next]); next += 1) block.push(lines[next]);
      // 閉じたコードブロックの後にある採用済み・減らす候補を含めない。
      return { source: block.join('\n'), usedBulkCandidateSection: true };
    }
    if (/^\s*(?:#{1,6}\s+\S|【[^】]+】\s*$|\*\*[^*]+\*\*\s*$|__[^_]+__\s*$)/u.test(line)) break;
    section.push(line);
  }
  return { source: section.join('\n'), usedBulkCandidateSection: true };
}

export function parseCandidateImportText(text: string, knownBaseCardIds: Iterable<string>): CandidateImportParseResult {
  const knownIdsByNormalizedValue = new Map([...knownBaseCardIds].map((id) => [id.toUpperCase(), id]));
  const { source, usedBulkCandidateSection } = sourceForCandidateImport(text);
  const recognized = new Set<string>();
  const unrecognized = new Set<string>();
  const cardNumberPattern = /(?:PL!(?:SP|S|N|HS)?|LL)-[A-Z0-9]+-\d{3}(?:-[A-Z0-9＋+]+)?/gi;

  for (const match of source.matchAll(cardNumberPattern)) {
    const enteredNumber = match[0];
    const normalizedBaseId = baseCardId(enteredNumber).toUpperCase();
    const knownId = knownIdsByNormalizedValue.get(normalizedBaseId);
    if (knownId) recognized.add(knownId);
    else unrecognized.add(enteredNumber);
  }

  return {
    recognizedIds: [...recognized],
    unrecognizedCardNumbers: [...unrecognized],
    usedBulkCandidateSection,
  };
}
