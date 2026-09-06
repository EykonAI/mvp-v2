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
 *
 * COVERAGE IS NOT OPTIONAL. This check used to `continue` past any route
 * that 5xx'd or was unreachable, and to follow redirects silently. Both
 * turned "we did not look" into a pass:
 *
 *   - /pricing 307s to /#pricing by design (it is a checkout router, not
 *     a page). Playwright follows the hop, so the gate audited the HOME
 *     PAGE twice and reported it as two routes. /pricing has never once
 *     been audited, and its identical duplicate findings read as
 *     corroboration from a second surface.
 *   - /start 500s under CI's placeholder Supabase, so it was skipped —
 *     silently, on every run, forever. It is fine in production.
 *
 * So: every route now ends in exactly one of AUDITED / SKIPPED (declared)
 * / FAILED, the run prints what it did NOT look at, and anything
 * undeclared that 5xx's, redirects away or is unreachable is a HARD
 * FAILURE. A gate that goes green because it saw nothing is worse than
 * no gate — it launders absence into evidence.
 */
import { chromium } from 'playwright';

const BASE = process.env.A11Y_BASE_URL || 'http://localhost:3000';
// /pricing is deliberately absent: with no ?plan= it 307s to /#pricing,
// so it is the homepage wearing a different URL. The pricing SURFACE is
// covered by '/'. Adding it back would double-count '/' — see header.
const PUBLIC_ROUTES = ['/', '/start', '/terms', '/privacy'];
const APP_ROUTES = ['/app', '/intel', '/analyst', '/intel/cascade', '/intel/sanctions', '/intel/shadow-fleet'];
const routes = process.argv.includes('--app') ? [...PUBLIC_ROUTES, ...APP_ROUTES] : PUBLIC_ROUTES;

// Routes that cannot render without a database. CI builds with a
// placeholder Supabase URL, so these 500 there and are SKIPPED — loudly,
// and listed at the end. Against a real local stack they return 200 and
// are audited like anything else. Undeclared routes get no such grace.
const NEEDS_DATA = new Set(['/start', ...APP_ROUTES]);

// Authenticated routes bounce to /auth/* without a session. Declared for
// the same reason: a redirect is not an audit of the route asked for.
const NEEDS_SESSION = new Set(APP_ROUTES);

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

  // A finding that does not say WHERE costs the next reader a grep. The
  // contrast failure this replaced reported only `"·" rgb(58, 66, 86)`,
  // which matched nothing in source (the colour is a var()) — so it sat
  // red through six merges because nobody could act on it.
  const pathOf = el => { const p = []; let e = el;
    while (e && e.tagName !== 'BODY' && p.length < 5) {
      let t = e.tagName.toLowerCase();
      const c = ((e.getAttribute && e.getAttribute('class')) || '').trim().split(/\s+/).filter(Boolean).slice(0, 2);
      if (c.length) t += '.' + c.join('.');
      p.unshift(t); e = e.parentElement; }
    return p.join(' > '); };

  const SKIP = new Set(['TITLE', 'STYLE', 'SCRIPT', 'META', 'LINK', 'HEAD', 'NOSCRIPT']);
  const contrast = [], seen = new Set();
  document.querySelectorAll('body *').forEach(el => {
    if (SKIP.has(el.tagName) || el.children.length) return;
    if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return;
    const t = (el.textContent || '').trim(); if (!t) return;
    const st = getComputedStyle(el), fg = parse(st.color); if (!fg || fg.a === 0) return;
    const size = parseFloat(st.fontSize), w = parseInt(st.fontWeight) || 400;
    const bg = bgOf(el);
    const ratio = cr(fg.rgb, bg);
    const req = ((size >= 24) || (size >= 18.66 && w >= 700)) ? 3 : 4.5;
    if (ratio < req) { const k = st.color + '|' + Math.round(size) + '|' + t.slice(0, 20);
      if (seen.has(k)) return; seen.add(k);
      contrast.push({ text: t.slice(0, 30), color: st.color, px: +size.toFixed(1), ratio: +ratio.toFixed(2),
                      req, bg: 'rgb(' + bg.map(Math.round).join(', ') + ')', path: pathOf(el) }); }
  });

  // An svg is fine if it names itself, or is inside something that does,
  // or declares itself decorative.
  const svgs = [...document.querySelectorAll('svg')];
  const unnamed = svgs.filter(s =>
    !s.closest('[role="img"]') && !s.hasAttribute('aria-hidden') &&
    !s.getAttribute('role') && !s.getAttribute('aria-label') && !s.querySelector('title')
  ).map(s => ({ cls: (s.getAttribute('class') || '(none)').slice(0, 44),
                path: pathOf(s),
                inControl: (s.closest('a,button')?.textContent || '').trim().slice(0, 24) || null }));

  return { contrast, svgTotal: svgs.length, unnamed,
           overflow: document.documentElement.scrollWidth - window.innerWidth };
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
let failed = 0;
const audited = [], skipped = [];

/** Did we land somewhere other than the route we asked for? */
const landedElsewhere = (want, got) => {
  try { const u = new URL(got); return u.pathname.replace(/\/$/, '') !== want.replace(/\/$/, ''); }
  catch { return false; }
};

console.log(`a11y/dom — ${routes.length} route(s) against ${BASE}`);
for (const r of routes) {
  let res;
  try {
    const resp = await page.goto(BASE + r, { waitUntil: 'networkidle', timeout: 30000 });
    const code = resp ? resp.status() : 0;

    // A 5xx is only forgivable where we have declared that the route
    // cannot render without data CI does not have. Anywhere else it is
    // a failure: the alternative is a gate that goes green during an
    // outage because every route was "skipped".
    if (code >= 400) {
      if (NEEDS_DATA.has(r)) {
        console.log(`  ${r.padEnd(22)} HTTP ${code} — SKIPPED (declared: needs a database)`);
        skipped.push(`${r} — HTTP ${code}, declared NEEDS_DATA`); continue;
      }
      console.log(`  ${r.padEnd(22)} HTTP ${code}  FAIL — a public route must render`);
      failed++; continue;
    }

    // Playwright follows redirects, so a route that 307s away is audited
    // as its TARGET while being reported under its own name. That is how
    // /pricing spent months masquerading as a second sample of /.
    const final = page.url();
    if (landedElsewhere(r, final)) {
      const where = new URL(final).pathname + new URL(final).hash;
      if (NEEDS_SESSION.has(r)) {
        console.log(`  ${r.padEnd(22)} -> ${where} — SKIPPED (declared: needs a session)`);
        skipped.push(`${r} — redirected to ${where}, declared NEEDS_SESSION`); continue;
      }
      console.log(`  ${r.padEnd(22)} -> ${where}  FAIL — redirected, so this route was never audited`);
      failed++; continue;
    }

    res = await page.evaluate(AUDIT);
  } catch (e) {
    const why = e.message.split('\n')[0].slice(0, 44);
    if (NEEDS_DATA.has(r)) {
      console.log(`  ${r.padEnd(22)} unreachable (${why}) — SKIPPED (declared)`);
      skipped.push(`${r} — unreachable, declared NEEDS_DATA`); continue;
    }
    console.log(`  ${r.padEnd(22)} unreachable (${why})  FAIL`);
    failed++; continue;
  }
  audited.push(r);
  const bad = res.contrast.length || res.unnamed.length;   // blocking
  const warn = res.overflow > 0;                          // WCAG 1.4.10, tracked as F-05
  console.log(`  ${r.padEnd(22)} svg ${String(res.svgTotal).padStart(3)} · unnamed ${String(res.unnamed.length).padStart(3)} · contrast-fail ${String(res.contrast.length).padStart(3)} · overflow ${res.overflow}px  ${bad ? 'FAIL' : warn ? 'warn' : 'ok'}`);
  if (warn && !bad) console.log(`      horizontal overflow ${res.overflow}px — WCAG 1.4.10 Reflow, tracked as F-05 (min-width:1440px)`);
  if (bad) {
    failed++;
    res.contrast.slice(0, 4).forEach(c => {
      console.log(`      contrast ${c.ratio}:1 (need ${c.req})  ${c.px}px  ${c.color} on ${c.bg}  "${c.text}"`);
      console.log(`        at  ${c.path}`); });
    if (res.contrast.length > 4) console.log(`      … and ${res.contrast.length - 4} more contrast failure(s)`);
    res.unnamed.slice(0, 6).forEach(u => {
      console.log(`      unnamed svg  ${u.cls}${u.inControl ? `  (inside "${u.inControl}")` : ''}`);
      console.log(`        at  ${u.path}`); });
    if (res.overflow > 0) console.log(`      horizontal overflow ${res.overflow}px — tracked as F-05`);
  }
}
await browser.close();

// Always state the coverage, pass or fail. A green run that looked at
// two of five routes is not the same result as one that looked at five,
// and the old output made them indistinguishable.
console.log(`\n  audited ${audited.length}/${routes.length}: ${audited.join(' ') || '(none)'}`);
if (skipped.length) {
  console.log(`  NOT audited (${skipped.length}) — declared, so not a failure, but not coverage either:`);
  skipped.forEach(x => console.log(`    · ${x}`));
}

if (failed) {
  console.error(`\n  FAILED on ${failed} route(s).`);
  console.error('  Unnamed svg -> wrap in ChartFigure, or add aria-hidden if decorative.');
  console.error('  Contrast    -> raise the colour at the path printed above. Note that');
  console.error('                 --ink-faint (#8791A4) is already the darkest token safe');
  console.error('                 on all five surfaces; anything dimmer must be scoped to');
  console.error('                 a known background and commented with its measured ratio.');
  console.error('  Redirect    -> the route was never audited. Drop it, or declare it.');
  console.error('  HTTP 5xx    -> fix the route, or add it to NEEDS_DATA with a reason.');
  process.exit(1);
}
if (!audited.length) {
  console.error('\n  FAILED: nothing was audited. A gate that looks at no routes cannot pass.');
  process.exit(1);
}
console.log('  OK\n');
