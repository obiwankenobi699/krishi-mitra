import type { Metadata } from 'next';
import type * as React from 'react';

export const metadata: Metadata = {
  title: 'Sign In',
  description: 'Sign in securely to your Krishi Mitra farm workspace with Google.',
  alternates: { canonical: '/login' },
  robots: { index: false, follow: false },
};

export default function LoginLayout({ children }: { children: React.ReactNode }): React.ReactNode {
  return children;
}
