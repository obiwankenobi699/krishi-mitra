'use client';

import Link from 'next/link';
import type * as React from 'react';
import { useAuth } from './AuthProvider';

interface AuthActionLinkProps {
  className: string;
  signedInLabel: string;
  signedOutLabel: string;
}

export default function AuthActionLink({
  className,
  signedInLabel,
  signedOutLabel,
}: AuthActionLinkProps): React.JSX.Element {
  const { isAuthenticated, ready } = useAuth();

  return (
    <Link
      href={isAuthenticated ? '/farms' : '/login'}
      className={className}
      aria-disabled={!ready}
      onClick={(event) => { if (!ready) event.preventDefault(); }}
    >
      {!ready ? 'Checking session…' : isAuthenticated ? signedInLabel : signedOutLabel} <span aria-hidden="true">↗</span>
    </Link>
  );
}
