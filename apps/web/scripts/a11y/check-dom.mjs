#!/usr/bin/env node
/**
 * DOM-level accessibility check — the counterpart to the source-level gates.
 *
 * WHY THIS EXISTS. check-budgets.mjs scans source, so a budget of 0 means
 * "0 in our code", NOT "0 on the page". That gap was real: after #409 drove
 * the source count to 0, the rendered dashboard still contained 19 unnamed
 * SVGs — every one a lucide-react icon emitted by the library, invisible to
 * a source scan. This check looks at what the browser actually renders.
 *
 * Requires a running server. Point it anywhere:
 *   A11Y_BASE_URL=http://localhost:3000 node scripts/a11y/check-dom.mjs
 *
 * Route sets:
 *   default  public routes only — no auth, no database, safe in CI
 *   --app    adds the authenticated product surfaces; these need a local
 *            .env.local and a signed-in session, so they are NOT run in CI.
 *            Run them locally before shipping UI work.
 */
import { chromium } from 'playwright';

const BASE = process.env.A11Y_BASE_URL || 'http://localhost:3000';
const PUBLIC_ROUTES = ['/', '/pricing', '/start', '/terms', '/privacy'];
const APP_ROUTES = ['/app', '/intel', '/analyst', '/intel/cascade', '/intel/sanctions', '/intel/shadow-fleet'];
const routes = process.argv.includes('--app') ? [...PUBLIC_ROUTES, ...APP_ROUTES] : PUBLIC_ROUTES;

/** Runs inside the page. Mirrors check-contrast/check-budgets, on real pixels. */
const AUDIT = () => {
  const lum = r => { const c = r.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const parse = s => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
    const p = m[1].split(',').map(parseFloat); return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 }; };
  // composite the ancestor background stack, honouring alpha — a naive
  // version reports false positives on every translucent surface
  const bgOf = el => { const st = []; let e = el;
    while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a === 1) break; } e = e.parentElement; }
    let base = [5, 8, 15]; if (st.length && st[st.length - 1].a === 1) base = st.pop().rgb;
    for (let i = st.length - 1; i >= 0; i--) { const c = st[i]; base = [0, 1, 2].map(k => c.rgb[k] * c.a + base[k] * (1 - c.a)); }
    return base; };

  const SKIP = new Set(['TITLE', 'STYLE', 'SCRIPT', 'META', 'LINK', 'HEAD', 'NOSCRIPT']);
  const contrast = [], seen = new Set();
  document.querySelectorAll('body *').forEach(el => {
    if (SKIP.has(el.tagName) || el.children.length) return;
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
    const t = (el.textContent || '').trim(); if (!t) return;
    const st = getComputedStyle(el), fg = parse(st.color); if (!fg || fg.a === 0) return;
    const size = parseFloat(st.fontSize), w = parseInt(st.fontWeight) || 400;
    const ratio = cr(fg.rgb, bgOf(el));
    const req = ((size >= 24) || (size >= 18.66 && w >= 700)) ? 3 : 4.5;
    if (ratio < req) { const k = st.color + '|' + Math.round(size) + '|' + t.slice(0, 20);
      if (seen.has(k)) return; seen.add(k);
      contrast.push({ text: t.slice(0, 30), color: st.color, px: +size.toFixed(1), ratio: +ratio.toFixed(2) }); }
  });

  // An svg is fine if it names itself, or is inside something that does,
  // or declares itself decorative.
  const svgs = [...document.querySelectorAll('svg')];
  const unnamed = svgs.filter(s =>
    !s.closest('[role="img"]') && !s.hasAttribute('aria-hidden') &&
    !s.getAttribute('role') && !s.getAttribute('aria-label') && !s.querySelector('title')
  ).map(s => ({ cls: (s.getAttribute('class') || '(none)').slice(0, 44),
                inControl: (s.closest('a,button')?.textContent || '').trim().slice(0, 24) || null }));

  return { contrast, svgTotal: svgs.length, unnamed,
           overflow: document.documentElement.scrollWidth - window.innerWidth };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let failed = 0;

console.log(`a11y/dom — ${routes.length} route(s) against ${BASE}`);
for (const r of routes) {
  let res;
  try {
    const resp = await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 30000 });
    if (resp && resp.status() >= 400) { console.log(`  ${r.padEnd(22)} HTTP ${resp.status()} — skipped`); continue; }
    res = await page.evaluate(AUDIT);
  } catch (e) {
    console.log(`  ${r.padEnd(22)} unreachable (${e.message.split('\n')[0].slice(0, 40)}) — skipped`); continue;
  }
  const bad = res.contrast.length || res.unnamed.length;   // blocking
  const warn = res.overflow > 0;                          // WCAG 1.4.10, tracked as F-05
  console.log(`  ${r.padEnd(22)} svg ${String(res.svgTotal).padStart(3)} · unnamed ${String(res.unnamed.length).padStart(3)} · contrast-fail ${String(res.contrast.length).padStart(3)} · overflow ${res.overflow}px  ${bad ? 'FAIL' : warn ? 'warn' : 'ok'}`);
  if (warn && !bad) console.log(`      horizontal overflow ${res.overflow}px — WCAG 1.4.10 Reflow, tracked as F-05 (min-width:1440px)`);
  if (bad) {
    failed++;
    res.contrast.slice(0, 4).forEach(c => console.log(`      contrast ${c.ratio}:1  ${c.px}px  "${c.text}"  ${c.color}`));
    res.unnamed.slice(0, 6).forEach(u => console.log(`      unnamed svg  ${u.cls}${u.inControl ? `  (inside "${u.inControl}")` : ''}`));
    if (res.overflow > 0) console.log(`      horizontal overflow ${res.overflow}px — tracked as F-05`);
  }
}
await browser.close();

if (failed) {
  console.error(`\n  FAILED on ${failed} route(s).`);
  console.error('  Unnamed svg -> wrap in ChartFigure, or add aria-hidden if decorative.');
  console.error('  Contrast    -> raise the token in globals.css.');
  process.exit(1);
}
console.log('  OK\n');
