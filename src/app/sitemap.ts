import type { MetadataRoute } from 'next';

export default function sitemap(): MetadataRoute.Sitemap {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const now = new Date();
  return [
    { url: siteUrl, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${siteUrl}/crop-doctor`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/field-analysis`, lastModified: now, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${siteUrl}/marketplace`, lastModified: now, changeFrequency: 'daily', priority: 0.9 },
    { url: `${siteUrl}/advisor`, lastModified: now, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${siteUrl}/news`, lastModified: now, changeFrequency: 'daily', priority: 0.8 },
    { url: `${siteUrl}/telegram`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ];
}
