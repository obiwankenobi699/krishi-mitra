import type * as React from 'react';
import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('Farm News', 'Trusted agricultural updates, schemes, and market news for your farm.', '/news');

export default function NewsLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
