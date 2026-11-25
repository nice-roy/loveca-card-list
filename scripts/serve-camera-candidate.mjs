import { execFileSync } from 'node:child_process';
import { randomBytes, createHash, X509Certificate } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIPv4 } from 'node:net';
import { networkInterfaces } from 'node:os';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor } from './camera-response-headers.mjs';

const [ip, python, certificateScript] = process.argv.slice(2);
const nic = Object.values(networkInterfaces()).flat().find(n => n.address === ip && n.cidr);
if (!nic || !isIPv4(ip) || !/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) throw Error('Specify the home LAN IPv4 address.');
const subnet = new BlockList();
subnet.addSubnet(ip, Number(nic.cidr.split('/')[1]), 'ipv4');
const root = fileURLToPath(new URL('../outputs/', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'camera-candidate-manifest.json')));
const files = new Map();
for (const [name, hash] of Object.entries(manifest.asset_sha256)) {
  const bytes = await readFile(join(root, 'camera-candidate', name));
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error('Candidate changed: ' + name);
  files.set('/' + name, bytes);
}
const mime = { '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.html':'text/html; charset=utf-8', '.svg':'image/svg+xml', '.png':'image/png', '.json':'application/json', '.txt':'text/plain' };
const label = 'LoveCa SE2 Index Test';
const tls = JSON.parse(execFileSync(python, [certificateScript, ip, label], { encoding: 'utf8', windowsHide: true }));
const ca = Buffer.from(tls.ca, 'base64');
const entry = '/' + randomBytes(20).toString('hex') + '/';
const cookie = 'trial=' + randomBytes(32).toString('hex');
const plainPort = 4187, securePort = 4446;
const plainHost = ip + ':' + plainPort, secureHost = ip + ':' + securePort;
const setup = '<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SE2 最終試験</title><main><h1>SE2 最終試験</h1><p>試験用証明書「' + label + '」を設定してください。</p><p><a href="test.cer">試験用証明書をダウンロード</a></p><p><a href="https://' + secureHost + entry + '">HTTPSでカード一覧を開く</a></p></main></html>';
function handle(req, res) {
  const secure = Boolean(req.socket.encrypted);
  const peer = req.socket.remoteAddress;
  const end = (code, body) => { res.writeHead(code); res.end(req.method === 'HEAD' ? undefined : body); };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!peer || !isIPv4(peer) || !subnet.check(peer) || req.headers.host !== (secure ? secureHost : plainHost)) return end(403);
  if (req.method !== 'GET' && req.method !== 'HEAD') return end(405);
  const route = req.url;
  if (!secure) {
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    if (route === entry) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return end(200, setup); }
    if (route === entry + 'test.cer') { res.setHeader('Content-Type', 'application/x-x509-ca-cert'); return end(200, ca); }
    return end(404);
  }
  if (route === entry) {
    res.setHeader('Set-Cookie', cookie + '; Path=/; Secure; HttpOnly; SameSite=Lax');
    res.setHeader('Location', '/'); return end(303);
  }
  if (!(req.headers.cookie || '').split(/;\s*/).includes(cookie)) return end(403);
  const name = route === '/' ? '/index.html' : ['/camera','/camera/'].includes(route) ? '/camera/index.html' : route;
  const bytes = files.get(name);
  if (!bytes) return end(404);
  for (const [key, value] of Object.entries(headersFor(route))) res.setHeader(key, value);
  res.setHeader('Content-Type', mime[extname(name)] ?? 'application/octet-stream');
  res.setHeader('Content-Length', bytes.length);
  end(200, bytes);
}
const servers = [http.createServer(handle), https.createServer({ key: tls.key, cert: tls.cert, minVersion: 'TLSv1.2' }, handle)];
try {
  for (const [i, server] of servers.entries()) {
    await new Promise((ok, fail) => { server.once('error', fail); server.listen(i ? securePort : plainPort, ip, ok); });
  }
  console.log(JSON.stringify({ setup: 'http://' + plainHost + entry, fingerprint: new X509Certificate(ca).fingerprint256 }));
  setTimeout(() => servers.forEach(s => s.close()), 2 * 60 * 60 * 1000).unref();
} catch (error) { servers.forEach(s => s.close()); throw error; }
