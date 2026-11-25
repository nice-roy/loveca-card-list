import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { craftInvokerFunction, __emval_get_method_caller } from './opencv-static-bindings.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const release = process.argv[2] === '--release';
const source = release ? path.join(root, 'camera/engine-inputs') : process.argv[2];
if (!source || !path.isAbsolute(source)) throw Error('Specify the absolute directory of the tested camera engine.');
const pins = JSON.parse(await readFile(new URL('./camera-inputs.json', import.meta.url)));
const entriesPerPart = 400;
const assetLimit = 25 * 1024 * 1024;

function allowSameOriginSession(bytes) {
  const code = bytes.toString('utf8');
  const marker = "credentials: 'omit'";
  if (code.split(marker).length !== 2) throw Error('Unexpected camera asset request');
  return code.replace(marker, "credentials: 'same-origin'");
}

await build({
  root,
  mode: 'production',
  define: { 'import.meta.env.CAMERA_BUNDLED': 'true' },
  build: { outDir: release ? 'dist' : 'outputs/camera-candidate', rolldownOptions: {
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
          const original = allowSameOriginSession(bytes);
          const marker = 'const json = await response.json();';
          if (original.split(marker).length !== 2) throw Error('Cannot identify index reader');
          emit(name, "import { readCameraIndex } from './read-camera-index.mjs';\n" +
            original.replace(marker, 'const json = await readCameraIndex(response, url, controller.signal);'));
        } else if (name === 'src/live-assets.mjs') {
          emit(name, allowSameOriginSession(bytes));
        } else if (name === 'vendor/opencv/opencv.js') {
          // The pinned Embind build constructs forwarding functions
          // from strings. Static closures keep the same receiver/arguments
          // while allowing the page to prohibit JS evaluation.
          const code = bytes.toString('utf8');
          const replaceFunction = (text, from, until, replacement) => {
            const start = text.indexOf(from), end = text.indexOf(until, start);
            if (start < 0 || end < start || text.indexOf(from, start + 1) >= 0) throw Error('Unexpected Embind wrapper');
            return text.slice(0, start) + replacement + text.slice(end);
          };
          const named = replaceFunction(code, 'function createNamedFunction(name,body){', 'function extendError(',
            'function createNamedFunction(name,body){function forward(){"use strict";return body.apply(this,arguments)}Object.defineProperty(forward,"name",{value:makeLegalFunctionName(name),configurable:true});return forward}');
          const staticCode = replaceFunction(named, 'function makeDynCaller(dynCall){', 'var fp;',
            'function makeDynCaller(dynCall){var count=signature.length-1;function forward(){var args=[rawFunction];for(var i=0;i<count;i++)args.push(arguments[i]);return dynCall.apply(undefined,args)}Object.defineProperty(forward,"length",{value:count});return forward}');
          const invoke = replaceFunction(staticCode, 'function craftInvokerFunction(', 'function heap32VectorTo', craftInvokerFunction.toString());
          const method = replaceFunction(invoke, 'function __emval_get_method_caller(', 'function __emval_get_property(', __emval_get_method_caller.toString());
          emit(name, method.replace('function getBinaryPromise(){if(!wasmBinary&&', 'function getBinaryPromise(){if(!wasmBinary&&!isDataURI(wasmBinaryFile)&&'));
        } else {
          emit(name, bytes);
        }
      }
      emit('src/read-camera-index.mjs', await readFile(new URL('./read-camera-index.mjs', import.meta.url)));
    },
  }],
});
