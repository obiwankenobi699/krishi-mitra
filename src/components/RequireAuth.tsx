'use client';

import Link from 'next/link';
import type * as React from 'react';
import { useAuth } from './AuthProvider';

export default function RequireAuth({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, ready, error, refreshSession } = useAuth();
  if (!ready) return <div className="state-card km-auth-state" role="status">Loading your workspace…</div>;
  if (error && !user) return <div className="state-card km-auth-state"><span>SESSION CHECK</span><h2>We could not confirm your session.</h2><p>{error}</p><button className="button button-primary" type="button" onClick={() => void refreshSession()}>Check again</button></div>;
  if (!user) return <div className="state-card km-auth-state"><span>PRIVATE WORKSPACE</span><h2>Your farm, kept private.</h2><p>Sign in to save records and use AI tools.</p><Link className="button button-primary" href="/login">Continue with Google</Link></div>;
  return <>{children}</>;
}
