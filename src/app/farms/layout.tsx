import type { Metadata } from 'next';
import type * as React from 'react';

export const metadata: Metadata = {
  title: 'My Farm',
  description: 'Manage fields, crop cycles, diagnoses, and Telegram access in one farm desk.',
  alternates: { canonical: '/farms' },
  robots: { index: false, follow: false },
};

export default function FarmsLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
