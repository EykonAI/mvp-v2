/** @type {import('next').NextConfig} */

const { withSentryConfig } = require('@sentry/nextjs');

// ──────────────────────────────────────────────────────────────────────
// Security headers (PR-S1, see docs/SECURITY_HARDENING_PLAN.md)
// ──────────────────────────────────────────────────────────────────────
// CSP ships in Report-Only first so legitimate scripts (Turnstile,
// Rewardful, PostHog, MapLibre, deck.gl) are not blocked while we
// observe violations. Flip to enforce by changing the header key from
// `Content-Security-Policy-Report-Only` to `Content-Security-Policy`
// once the report endpoint shows clean traffic for a week.
//
// All other headers ship enforcing on day one — they are non-breaking.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const POSTHOG_HOST = process.env.NEXT_PUBLIC_POSTHOG_HOST || 'https://eu.i.posthog.com';
const CSP_REPORT_URI = process.env.CSP_REPORT_URI || '';

const supabaseHttp = SUPABASE_URL ? SUPABASE_URL.replace(/\/$/, '') : 'https://*.supabase.co';
const supabaseWs = supabaseHttp.replace(/^https:/, 'wss:');
const posthogAssets = POSTHOG_HOST.replace('://eu.i.', '://eu-assets.i.').replace('://us.i.', '://us-assets.i.');

const cspDirectives = {
  'default-src': ["'self'"],
  // 'unsafe-inline' supports the Rewardful queue bootstrap (intentional inline
  // script in components/referral/RewardfulScript.tsx) and Next.js inline
  // runtime. 'unsafe-eval' is required by deck.gl/maplibre-gl shader compile
  // paths and PostHog. Tracked in §3 of the plan as candidates for nonce-based
  // tightening post-launch.
  'script-src': [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    'https://challenges.cloudflare.com',
    'https://r.wdfl.co',
    POSTHOG_HOST,
    posthogAssets,
  ],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'data:', 'https://fonts.gstatic.com'],
  'img-src': [
    "'self'",
    'data:',
    'blob:',
    'https://basemaps.cartocdn.com',
    'https://*.basemaps.cartocdn.com',
    'https://tiles.sentinel-hub.com',
    'https://gibs.earthdata.nasa.gov',
  ],
  'connect-src': [
    "'self'",
    supabaseHttp,
    supabaseWs,
    POSTHOG_HOST,
    posthogAssets,
    'https://r.wdfl.co',
    'https://challenges.cloudflare.com',
    // Sentry error/perf ingest (client SDK). Required once CSP is enforced.
    'https://*.sentry.io',
  ],
  'frame-src': ["'self'", 'https://challenges.cloudflare.com'],
  'worker-src': ["'self'", 'blob:'],
  'object-src': ["'none'"],
  'base-uri': ["'self'"],
  'form-action': ["'self'"],
  'frame-ancestors': ["'none'"],
  'upgrade-insecure-requests': [],
};

const csp = Object.entries(cspDirectives)
  .map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k))
  .concat(CSP_REPORT_URI ? [`report-uri ${CSP_REPORT_URI}`] : [])
  .join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy-Report-Only', value: csp },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: [
      'accelerometer=()',
      'autoplay=()',
      'camera=()',
      'display-capture=()',
      'encrypted-media=()',
      'fullscreen=(self)',
      'geolocation=()',
      'gyroscope=()',
      'magnetometer=()',
      'microphone=()',
      'midi=()',
      'payment=()',
      'picture-in-picture=()',
      'usb=()',
    ].join(', '),
  },
];

const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'tiles.sentinel-hub.com' },
      { protocol: 'https', hostname: 'gibs.earthdata.nasa.gov' },
    ],
  },
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
    // Required on Next.js 14 for instrumentation.ts to run (stable in Next 15).
    instrumentationHook: true,
  },
  // Transpile deck.gl ESM packages
  transpilePackages: [
    '@deck.gl/core',
    '@deck.gl/layers',
    '@deck.gl/geo-layers',
    '@deck.gl/react',
  ],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  webpack: (config) => {
    // Fix maplibre-gl worker — alias only the JS entry, not the CSS
    config.resolve.alias = {
      ...config.resolve.alias,
      'maplibre-gl$': 'maplibre-gl/dist/maplibre-gl.js',
    };
    return config;
  },
};

// Wrap with Sentry. Source maps upload only when SENTRY_AUTH_TOKEN is set in the
// build env (Railway) — without it the build still succeeds, maps just aren't
// uploaded. org/project match the Sentry project (eykon / javascript-nextjs).
module.exports = withSentryConfig(nextConfig, {
  org: 'eykon',
  project: 'javascript-nextjs',
  silent: !process.env.CI,
  widenClientFileUpload: true,
  disableLogger: true,
});
