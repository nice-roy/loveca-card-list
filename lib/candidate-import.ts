export type CandidateImportParseResult = {
  recognizedIds: string[];
  unrecognizedCardNumbers: string[];
  usedBulkCandidateSection: boolean;
};

function baseCardId(cardNumber: string) {
  return cardNumber.match(/^(.+-[0-9]{3})-([^-]+)$/)?.[1] ?? cardNumber;
}

function sourceForCandidateImport(text: string) {
  const header = text.match(/【\s*候補一括追加用\s*】/u);
  if (!header || header.index === undefined) return { source: text, usedBulkCandidateSection: false };

  const afterHeader = text.slice(header.index + header[0].length);
  const nextSection = afterHeader.search(/\n\s*【[^】]+】/u);
  return {
    source: nextSection === -1 ? afterHeader : afterHeader.slice(0, nextSection),
    usedBulkCandidateSection: true,
  };
}

export function parseCandidateImportText(text: string, knownBaseCardIds: Iterable<string>): CandidateImportParseResult {
  const knownIdsByNormalizedValue = new Map([...knownBaseCardIds].map((id) => [id.toUpperCase(), id]));
  const { source, usedBulkCandidateSection } = sourceForCandidateImport(text);
  const recognized = new Set<string>();
  const unrecognized = new Set<string>();
  const cardNumberPattern = /PL!SP-[A-Z0-9]+-\d{3}(?:-[A-Z0-9＋+]+)?/gi;

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
