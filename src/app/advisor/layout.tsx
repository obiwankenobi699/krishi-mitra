import type * as React from 'react';
import { publicPageMetadata } from '@/lib/seo';

export const metadata = publicPageMetadata('Yield Advisor', 'Build a crop plan with current market context and trusted schemes.', '/advisor');

export default function AdvisorLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
