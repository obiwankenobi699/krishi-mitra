import type { Metadata, Viewport } from 'next';
import { Fraunces, Inter } from 'next/font/google';
import type * as React from 'react';
import './globals.css';
import { AuthProvider } from '@/components/AuthProvider';
import SiteHeader from '@/components/SiteHeader';
import SiteFooter from '@/components/SiteFooter';

const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const sans = Inter({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000'),
  title: {
    default: 'Krishi Mitra — AI farming companion for every field',
    template: '%s · Krishi Mitra',
  },
  description: 'Farmer-first crop diagnosis, field intelligence, direct marketplace listings, farm planning, agricultural news, and Telegram support powered by local AI.',
  applicationName: 'Krishi Mitra',
  keywords: ['agriculture AI', 'crop disease detection', 'field analysis', 'farmer marketplace', 'farm advisor', 'Indian agriculture', 'Krishi Mitra'],
  authors: [{ name: 'Krishi Mitra' }],
  creator: 'Krishi Mitra',
  publisher: 'Krishi Mitra',
  category: 'Agriculture technology',
  alternates: { canonical: '/' },
  manifest: '/manifest.webmanifest',
  icons: { icon: '/krishi-mitra-logo.png', apple: '/krishi-mitra-logo.png' },
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: '/',
    siteName: 'Krishi Mitra',
    title: 'Krishi Mitra — AI farming companion for every field',
    description: 'Crop health, field intelligence, markets, planning, and trusted agricultural updates in one farmer-first platform.',
    images: [{ url: '/images/drone-crop-rows.jpg', width: 1600, height: 1199, alt: 'Aerial view of healthy crop rows' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Krishi Mitra — AI farming companion for every field',
    description: 'Crop health, field intelligence, markets, planning, and trusted agricultural updates.',
    images: ['/images/drone-crop-rows.jpg'],
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 } },
};

export const viewport: Viewport = { themeColor: '#173f2a', colorScheme: 'light' };

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${siteUrl}/#organization`,
        name: 'Krishi Mitra',
        url: siteUrl,
        logo: `${siteUrl}/krishi-mitra-logo.png`,
      },
      {
        '@type': 'WebSite',
        '@id': `${siteUrl}/#website`,
        name: 'Krishi Mitra',
        url: siteUrl,
        publisher: { '@id': `${siteUrl}/#organization` },
        inLanguage: 'en-IN',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'Krishi Mitra',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: siteUrl,
        description: 'AI-assisted crop diagnosis, field analysis, farm planning, news, marketplace, and Telegram workflows for farmers.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'INR' },
      },
    ],
  };
  return (
    <html lang="en-IN" className={`${display.variable} ${sans.variable}`}><body><script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} /><AuthProvider><SiteHeader /><div className="page-shell">{children}</div><SiteFooter /></AuthProvider></body></html>
  );
}
