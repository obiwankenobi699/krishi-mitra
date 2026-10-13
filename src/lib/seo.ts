import type { Metadata } from 'next';

export function publicPageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      locale: 'en_IN',
      siteName: 'Krishi Mitra',
      title: `${title} · Krishi Mitra`,
      description,
      url: path,
      images: [{ url: '/images/drone-crop-rows.jpg', width: 1600, height: 1199, alt: 'Aerial view of healthy crop rows' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: `${title} · Krishi Mitra`,
      description,
      images: ['/images/drone-crop-rows.jpg'],
    },
  };
}
