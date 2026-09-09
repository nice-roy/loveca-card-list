import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.md', '.mjs', '.ts', '.tsx', '.yaml', '.yml']);
const ignoredDirectories = new Set(['.git', 'dist', 'node_modules']);

function isTextFile(path) {
  const extension = path.slice(path.lastIndexOf('.'));
  return textExtensions.has(extension);
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : walk(path);
    return entry.isFile() && isTextFile(path) ? [path] : [];
  });
}

export function validateUtf8Files() {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const files = walk(root).sort();
  const validated = [];

  for (const path of files) {
    let text;
    try {
      text = decoder.decode(readFileSync(path));
    } catch (error) {
      throw new Error(`Invalid UTF-8: ${relative(root, path)} (${error.message})`);
    }

    if (path.endsWith('.json')) {
      try {
        JSON.parse(text);
      } catch (error) {
        throw new Error(`Invalid JSON: ${relative(root, path)} (${error.message})`);
      }
    }
    validated.push(relative(root, path));
  }
  return validated;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const validated = validateUtf8Files();
  console.log(`UTF-8 and JSON validation passed for ${validated.length} text files.`);
}
