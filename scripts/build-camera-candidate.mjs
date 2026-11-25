import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// The pinned dataset is licensed for the private trial only. This command
// produces a local rehearsal outside dist and never changes normal builds.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = process.argv[2];
if (!source || !path.isAbsolute(source)) throw Error('Specify the absolute directory of the tested camera engine.');
const pins = JSON.parse(await readFile(new URL('./camera-inputs.json', import.meta.url)));
const entriesPerPart = 400;
const assetLimit = 25 * 1024 * 1024;

await build({
  root,
  mode: 'production',
  define: { 'import.meta.env.CAMERA_BUNDLED': 'true' },
  build: { outDir: 'outputs/camera-candidate', rolldownOptions: {
    input: [path.join(root, 'index.html'), path.join(root, 'camera/index.html')],
  } },
  plugins: [{
    name: 'private-camera-candidate',
    async generateBundle() {
      const emit = (name, bytes) => {
        if (Buffer.byteLength(bytes) > assetLimit) throw Error('Pages file size exceeded: ' + name);
        this.emitFile({ type: 'asset', fileName: 'camera-engine/' + name, source: bytes });
      };
      for (const [name, expected] of Object.entries(pins)) {
        const bytes = await readFile(path.join(source, name));
        if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('Camera source changed: ' + name);
        if (name === 'data/reference-index.json') {
          const { entries, ...header } = JSON.parse(bytes);
          if (entries.length !== header.referenceCount) throw Error('Reference count mismatch');
          const partCount = Math.ceil(entries.length / entriesPerPart);
          emit(name, JSON.stringify({ ...header, partCount }));
          for (let i = 0; i < partCount; i++) {
            emit('data/reference-' + i + '.json', JSON.stringify(entries.slice(i * entriesPerPart, (i + 1) * entriesPerPart)));
          }
        } else if (name === 'src/image-engine.mjs') {
          // Adapt only the storage format. Index construction and matching run
          // the same code that was measured on the SE2.
          const original = bytes.toString('utf8');
          const marker = 'const json = await response.json();';
          if (original.split(marker).length !== 2) throw Error('Cannot identify index reader');
          emit(name, "import { readCameraIndex } from './read-camera-index.mjs';\n" +
            original.replace(marker, 'const json = await readCameraIndex(response, url, controller.signal);'));
        } else {
          emit(name, bytes);
        }
      }
      emit('src/read-camera-index.mjs', await readFile(new URL('./read-camera-index.mjs', import.meta.url)));
    },
  }],
});
