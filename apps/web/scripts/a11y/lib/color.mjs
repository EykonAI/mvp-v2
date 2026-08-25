/**
 * Colour maths for the accessibility gates. No dependencies — these run
 * in CI on a bare Node, and a guardrail that needs an install step is a
 * guardrail that gets skipped.
 */

export function hexToRgb(hex) {
  const h = hex.trim().replace('#', '');
  const f = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16));
}

const srgbToLinear = v => (v /= 255) <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);

/** WCAG 2.x relative luminance. */
export function luminance(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1..21. */
export function contrast(a, b) {
  const l1 = luminance(a), l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/* ── OKLab, for perceptual distance ─────────────────────────────── */
export function oklab(rgb) {
  const [r, g, b] = rgb.map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}

/** Perceptual distance, OKLab scaled x100 so the numbers read like ΔE. */
export function deltaE(rgbA, rgbB) {
  const a = oklab(rgbA), b = oklab(rgbB);
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) * 100;
}

/* ── Colour-vision simulation (Viénot–Brettel–Mollon 1999) ───────── */
const LMS_FROM_LIN = [
  [0.31399022, 0.63951294, 0.04649755],
  [0.15537241, 0.75789446, 0.08670142],
  [0.01775239, 0.10944209, 0.87256922],
];
const LIN_FROM_LMS = [
  [ 5.47221206, -4.6419601,  0.16963708],
  [-1.1252419,   2.29317094, -0.1678952],
  [ 0.02980165, -0.19318073, 1.16364789],
];
const mul = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const linToSrgb = v => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

/** type: 'protan' | 'deutan' | 'tritan' */
export function simulateCvd(rgb, type) {
  const lin = rgb.map(srgbToLinear);
  let [L, M, S] = mul(LMS_FROM_LIN, lin);
  if (type === 'protan')      L = 2.02344 * M - 2.52581 * S;
  else if (type === 'deutan') M = 0.494207 * L + 1.24827 * S;
  else if (type === 'tritan') S = -0.395913 * L + 0.801109 * M;
  return mul(LIN_FROM_LMS, [L, M, S]).map(linToSrgb);
}

/** Worst perceptual separation of a pair across normal + CVD vision. */
export function worstSeparation(a, b) {
  return {
    normal: deltaE(a, b),
    protan: deltaE(simulateCvd(a, 'protan'), simulateCvd(b, 'protan')),
    deutan: deltaE(simulateCvd(a, 'deutan'), simulateCvd(b, 'deutan')),
    tritan: deltaE(simulateCvd(a, 'tritan'), simulateCvd(b, 'tritan')),
  };
}

/** Parse `--name: #hex;` custom properties out of a CSS file. */
export function parseTokens(css) {
  const out = {};
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) out[m[1]] = m[2];
  return out;
}
