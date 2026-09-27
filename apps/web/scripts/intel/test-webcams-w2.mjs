#!/usr/bin/env node
// ─── IMAGERY IMG-9: webcam wave-2 fetchers, tested offline ────────────────
//
// The database half (migration 192) is proven by supabase/tests/img9_guards.sql:
// a camera renders only under an 'ok' licence row, clearance records who and
// why, a downgrade takes cameras down, excluded is final. This file proves the
// fetchers with fetch() stubbed:
//
//   1. 511NY — rows read live from getcameras on 2026-09-27: enabled cameras
//      map to rows (id, name, position, the feed's own image Url); Disabled
//      cameras are dropped; the key is sent and required;
//   2. OHGO — one row per camera VIEW from the published model, key sent in
//      the Authorization header;
//   3. a provider with no key is a MissingKeyError (a skip), not a failure;
//   4. the 511NY "camera unavailable" placeholder PNG is a decode_error,
//      never a live frame.
//
// node apps/web/scripts/intel/test-webcams-w2.mjs

import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const WEB = resolve(here, '../..');
const require = createRequire(join(WEB, 'package.json'));
const ts = require('typescript');

const cache = new Map();
function resolveTs(base) {
  for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(base + ext)) return base + ext;
  return null;
}
function load(file) {
  if (cache.has(file)) return cache.get(file).exports;
  const out = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  const m = { exports: {} };
  cache.set(file, m);
  const req = (id) => {
    if (id.startsWith('@/')) { const f = resolveTs(join(WEB, id.slice(2))); if (f) return load(f); }
    if (id.startsWith('.')) { const f = resolveTs(resolve(dirname(file), id)); if (f) return load(f); }
    return require(id);
  };
  new Function('module', 'exports', 'require', out)(m, m.exports, req);
  return m.exports;
}

const P = load(join(WEB, 'lib/webcams/providers.ts'));
const F = load(join(WEB, 'lib/webcams/fetch-image.ts'));

let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`);
}

// Real rows from https://511ny.org/api/getcameras (2026-09-27): two enabled, one Disabled.
const NY = [{"Latitude": 42.9223627, "Longitude": -78.8435134, "ID": "Skyline-10213", "Name": "NY 33 at NY 198 Interchange (1)", "DirectionOfTravel": "Unknown", "RoadwayName": "NY 33", "Url": "https://511ny.org/map/Cctv/4436", "VideoUrl": "https://s52.nysdot.skyvdn.com/rtplive/R5_013/playlist.m3u8", "Disabled": false, "Blocked": false}, {"Latitude": 43.237344, "Longitude": -73.690416, "ID": "Skyline-10338", "Name": "US 9 SB @ I-87 Exit 17", "DirectionOfTravel": "Southbound", "RoadwayName": "US 9", "Url": "https://511ny.org/map/Cctv/4438", "VideoUrl": "https://s51.nysdot.skyvdn.com/rtplive/R1_033/playlist.m3u8", "Disabled": false, "Blocked": false}, {"Latitude": 40.937133, "Longitude": -73.807318, "ID": "NYSDOT-01o3upkjrwu", "Name": "Hutchinson River Parkway North of the Cross County Parkway at MM 8.46", "DirectionOfTravel": "Unknown", "RoadwayName": "Hutchinson River Parkway [Westchester]", "Url": "https://511ny.org/map/Cctv/1", "VideoUrl": null, "Disabled": true, "Blocked": false}];
const seen = [];
const realFetch = globalThis.fetch;
function stub(handler) {
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), init }); return handler(String(url), init); };
}
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// ── 3 · no key → skip ────────────────────────────────────────────────────
delete process.env.NY511_API_KEY; delete process.env.OHGO_API_KEY;
stub(() => json([]));
let err = null;
try { await P.PROVIDERS.ny_511(); } catch (e) { err = e; }
check('K1 511NY without a key is a MissingKeyError', err instanceof P.MissingKeyError && err.envVar === 'NY511_API_KEY', String(err));
check('K2 nothing was requested without the key', seen.length === 0, seen.map(s => s.url));
err = null;
try { await P.PROVIDERS.ohio_ohgo(); } catch (e) { err = e; }
check('K3 OHGO without a key is a MissingKeyError', err instanceof P.MissingKeyError && err.envVar === 'OHGO_API_KEY', String(err));

// ── 1 · 511NY ────────────────────────────────────────────────────────────
process.env.NY511_API_KEY = 'test-key';
seen.length = 0;
stub(() => json(NY));
const ny = await P.PROVIDERS.ny_511();
check('N1 the key is sent', seen[0] && seen[0].url.includes('key=test-key') && seen[0].url.includes('format=json'), seen[0] && seen[0].url);
check('N2 Disabled cameras dropped (2 of 3 kept)', ny.length === 2, ny.length);
check('N3 row = feed id, name, position, the feed image Url',
  ny[0] && ny[0].provider_cam_id === NY[0].ID && ny[0].name === NY[0].Name && ny[0].latitude === NY[0].Latitude
  && ny[0].longitude === NY[0].Longitude && ny[0].upstream_url === NY[0].Url && ny[0].category === 'traffic', ny[0]);

// ── 2 · OHGO ─────────────────────────────────────────────────────────────
process.env.OHGO_API_KEY = 'oh-key';
seen.length = 0;
stub(() => json({ results: [
  { id: '00000000000011', latitude: 39.96, longitude: -82.99, location: 'I-70 at I-71', description: 'Columbus',
    cameraViews: [
      { direction: 'Eastbound', smallUrl: 'https://itscameras.dot.state.oh.us/images/a-s.jpg', largeUrl: 'https://itscameras.dot.state.oh.us/images/a-l.jpg', mainRoute: 'I-70' },
      { direction: 'PTZ', smallUrl: 'https://itscameras.dot.state.oh.us/images/b-s.jpg', largeUrl: null, mainRoute: 'I-71' },
      { direction: 'West', smallUrl: null, largeUrl: null } ] },
] }));
const oh = await P.PROVIDERS.ohio_ohgo();
const auth = seen[0] && (seen[0].init?.headers?.Authorization ?? seen[0].init?.headers?.authorization);
check('O1 key in the Authorization header, page-all', auth === 'APIKEY oh-key' && seen[0].url.includes('page-all=true'), seen[0]);
check('O2 one row per view with an image (2 of 3)', oh.length === 2, oh.length);
check('O3 view id, large image preferred, heading from direction',
  oh[0] && oh[0].provider_cam_id === '00000000000011-0' && oh[0].upstream_url.endsWith('a-l.jpg') && oh[0].heading_deg === 90, oh[0]);
check('O4 small image when no large one', oh[1] && oh[1].upstream_url.endsWith('b-s.jpg') && oh[1].heading_deg === null, oh[1]);

// ── 4 · the placeholder PNG is not a frame ───────────────────────────────
// Build bytes whose sha256 is NOT the placeholder, and check the set is consulted.
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
stub(() => new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }));
const ok = await F.fetchCameraImage('https://511ny.org/map/Cctv/4436');
check('I1 a real PNG is ok', ok.outcome === 'ok' && ok.contentType === 'image/png', ok.outcome);
F.PLACEHOLDER_SHA256.add(ok.sha256);
const ph = await F.fetchCameraImage('https://511ny.org/map/Cctv/1');
check('I2 a known placeholder is a decode_error with no bytes', ph.outcome === 'decode_error' && ph.bytes === null, ph.outcome);
check('I3 the 511NY placeholder read live is listed',
  F.PLACEHOLDER_SHA256.has('e608c39b77e5480ce13682b571638e4246ff519dd6c79402c393db5e273aab19'));

globalThis.fetch = realFetch;
if (fails.length) {
  console.error(`test-webcams-w2: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`test-webcams-w2: OK — ${pass} checks (511NY + OHGO rows, key required, placeholder is not a frame).`);
