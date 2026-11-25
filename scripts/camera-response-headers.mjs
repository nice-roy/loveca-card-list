import { readFile } from 'node:fs/promises';

// The local trial serves the same header rules that the trusted packager emits.
const rules = (await readFile(new URL('../outputs/camera-candidate-headers.txt', import.meta.url), 'utf8')).trimEnd().split(/\r?\n/);
export function headersFor(pathname) {
  let matched = false;
  const headers = {};
  for (const line of rules) {
    if (!line.startsWith('  ')) {
      matched = line === '/*' || line === pathname;
    } else if (matched) {
      if (line.startsWith('  ! ')) delete headers[line.slice(4)];
      else {
        const split = line.indexOf(': ');
        if (split < 3) throw Error('Invalid generated header');
        const name = line.slice(2, split), value = line.slice(split + 2);
        headers[name] = headers[name] ? headers[name] + ', ' + value : value;
      }
    }
  }
  return headers;
}
