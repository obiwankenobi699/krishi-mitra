import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Krishi Mitra',
    short_name: 'Krishi Mitra',
    description: 'A farmer-first AI workspace for crop health, field intelligence, markets, planning, and trusted updates.',
    start_url: '/',
    display: 'standalone',
    background_color: '#f3f0e8',
    theme_color: '#173f2a',
    icons: [{ src: '/krishi-mitra-logo.png', sizes: '384x384', type: 'image/png', purpose: 'maskable' }],
  };
}
