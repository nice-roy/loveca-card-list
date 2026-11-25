export async function readCameraIndex(response, url, signal) {
  const { partCount, ...header } = await response.json();
  if (!Number.isSafeInteger(partCount) || partCount < 1 || partCount > header.referenceCount) {
    throw Error('照合データの分割数を確認できません。');
  }
  const entries = [];
  for (let i = 0; i < partCount; i++) {
    const part = await fetch(new URL('reference-' + i + '.json', url), {
      signal, credentials: 'same-origin', redirect: 'error', cache: 'no-store',
    });
    if (!part.ok) throw Error('照合データの一部を読み込めませんでした。');
    const rows = await part.json();
    if (!Array.isArray(rows) || !rows.length || entries.length + rows.length > header.referenceCount) {
      throw Error('照合データの件数が一致しません。');
    }
    for (const row of rows) entries.push(row);
  }
  if (entries.length !== header.referenceCount) throw Error('照合データがそろいませんでした。');
  return { ...header, entries };
}
