import type { MetadataRoute } from 'next';
import { APP_URL as baseUrl } from '@/lib/url';

// Static sitemap covering the public marketing + legal surface. The
// (app)/* and /auth/* routes are intentionally excluded — they're
// disallow'd in robots.ts and shouldn't appear in search anyway.
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();
  return [
    {
      url: `${baseUrl}/`,
      lastModified,
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${baseUrl}/privacy`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
    {
      url: `${baseUrl}/cookies`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/dpa`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.3,
    },
    {
      url: `${baseUrl}/refund`,
      lastModified,
      changeFrequency: 'monthly',
      priority: 0.4,
    },
  ];
}
