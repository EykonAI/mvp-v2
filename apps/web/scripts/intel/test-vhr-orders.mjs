#!/usr/bin/env node
// ─── IMAGERY IMG-11: VHR look requests — the client never sets the price ──
//
// Every gate (founder look first, Desk/Enterprise, licence, list price,
// monthly caps) is in the database and proven by supabase/tests/img11_guards.sql.
// This file proves the request body the API accepts: a point, a listed-looking
// product, 1–20 looks — and NEVER a price.
//
// node apps/web/scripts/intel/test-vhr-orders.mjs

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

const O = load(join(WEB, 'lib/imagery/orders.ts'));
let pass = 0;
const fails = [];
function check(name, ok, detail) {
  if (ok) pass += 1;
  else fails.push(`${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
}
const ok = O.parseOrderBody({ resolution_m: 1.0, looks: 1, lat: 26.5, lon: 56.4, note: 'Hormuz' });
check('P1 a point + resolution parses, provider defaults to umbra spotlight', ok.ok && ok.input.provider === 'umbra' && ok.input.product === 'spotlight' && ok.input.looks === 1, ok);
check('P2 a client price is refused', O.parseOrderBody({ resolution_m: 1, lat: 1, lon: 1, price_usd: 1 }).error === 'price_is_not_client_supplied');
check('P3 "price" is refused too', O.parseOrderBody({ resolution_m: 1, lat: 1, lon: 1, price: 0 }).error === 'price_is_not_client_supplied');
check('P4 no point → refused', O.parseOrderBody({ resolution_m: 1 }).error === 'invalid_point');
check('P5 lat out of range → refused', O.parseOrderBody({ resolution_m: 1, lat: 91, lon: 0 }).error === 'invalid_point');
check('P6 0 looks → refused', O.parseOrderBody({ resolution_m: 1, looks: 0, lat: 1, lon: 1 }).error === 'invalid_looks');
check('P7 fractional looks → refused', O.parseOrderBody({ resolution_m: 1, looks: 1.5, lat: 1, lon: 1 }).error === 'invalid_looks');
check('P8 bad provider id → refused', O.parseOrderBody({ provider: 'Umbra; DROP', resolution_m: 1, lat: 1, lon: 1 }).error === 'invalid_product');
check('P9 note capped at 500', O.parseOrderBody({ resolution_m: 1, lat: 1, lon: 1, note: 'x'.repeat(900) }).input.note.length === 500);
check('P10 not an object → refused', O.parseOrderBody(null).error === 'invalid_body');
if (fails.length) {
  console.error(`test-vhr-orders: ${fails.length} FAILED, ${pass} passed`);
  for (const f of fails) console.error('  ✗ ' + f);
  process.exit(1);
}
console.log(`test-vhr-orders: OK — ${pass} checks (a point and a product, never a price).`);
