import type * as React from 'react';
import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('Farmer Market', 'List produce, discover nearby supply, and trade directly with growers.', '/marketplace');

export default function MarketplaceLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
