import type { MetadataRoute } from 'next';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://mvp.eykon.ai';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/', '/pricing', '/terms', '/privacy', '/cookies', '/dpa', '/refund'],
        // The (app) surface is gated behind auth and the auth surface
        // itself isn't useful in search results. Crawlers waste budget
        // there and risk surfacing private user pages from misconfigured
        // share links.
        disallow: ['/app', '/intel', '/dashboard', '/settings', '/billing', '/auth/', '/api/'],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
    host: baseUrl,
  };
}
