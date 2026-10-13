import type { Metadata } from 'next';
import type * as React from 'react';

export const metadata: Metadata = {
  title: 'Diagnoses',
  description: 'Your private history of crop and field vision analyses.',
  alternates: { canonical: '/diagnoses' },
  robots: { index: false, follow: false },
};

export default function DiagnosesLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
