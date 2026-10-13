'use client';

import Link from 'next/link';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type * as React from 'react';
import { useAuth } from './AuthProvider';

interface NavLink {
  label: string;
  href: string;
}

const links: NavLink[] = [
  { label: 'Crop care', href: '/crop-doctor' },
  { label: 'Field analysis', href: '/field-analysis' },
  { label: 'Marketplace', href: '/marketplace' },
  { label: 'AI advisor', href: '/advisor' },
  { label: 'Farm desk', href: '/farms' },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function SiteHeader(): React.JSX.Element {
  const pathname = usePathname();
  const [open, setOpen] = useState<boolean>(false);
  const { user, ready, signOut } = useAuth();
  const displayName = String(user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email || 'My farm').split(' ')[0];

  function closeMenu(): void {
    setOpen(false);
  }

  async function handleSignOut(): Promise<void> {
    closeMenu();
    await signOut();
  }

  return (
    <header className="km-site-header">
      <div className="km-nav-shell">
        <Link
          href="/"
          onClick={closeMenu}
          className="km-brand"
          aria-label="Krishi Mitra home"
        >
          <Image src="/krishi-mitra-logo.png" alt="" width={42} height={42} priority />
          <span><strong>KRISHI</strong><small>MITRA</small></span>
        </Link>

        <nav aria-label="Primary" className="km-desktop-nav">
          {links.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={active ? 'active' : ''}
              >
                {link.label}
                <span
                  aria-hidden="true"
                  className="km-nav-dot"
                />
              </Link>
            );
          })}
        </nav>

        <div className="km-header-action">
          {!ready ? (
            <span className="km-header-button km-header-loading" role="status">Checking session…</span>
          ) : user ? (
            <div className="km-account-actions">
              <Link href="/farms" className="km-account-link" title={user.email}>Hi, {displayName}</Link>
              <button type="button" onClick={handleSignOut} className="km-signout-button" aria-label="Sign out">↗</button>
            </div>
          ) : (
            <Link
              href="/login"
              className="km-header-button"
            >
              Sign in <span aria-hidden="true">↗</span>
            </Link>
          )}
        </div>

        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="site-mobile-nav"
          aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
          className="km-menu-button"
        >
          <span aria-hidden="true">{open ? '✕' : '☰'}</span>
        </button>
      </div>

      <div
        id="site-mobile-nav"
        className={`km-mobile-wrap ${open ? 'open' : ''}`}
      >
        <nav aria-label="Mobile" className="km-mobile-nav">
          {links.map((link) => {
            const active = isActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={closeMenu}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center justify-between rounded-xl px-4 py-3 text-[0.95rem] font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green ${
                  active ? 'bg-deep text-lime' : 'text-ink hover:bg-mist'
                }`}
              >
                {link.label}
                <span aria-hidden="true" className="text-sm">
                  →
                </span>
              </Link>
            );
          })}
          <div className="pt-2">
            {!ready ? (
              <p className="px-4 py-3 text-sm text-muted" role="status">Checking your session…</p>
            ) : user ? (
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <Link href="/farms" onClick={closeMenu} className="inline-flex items-center rounded-full bg-deep px-5 py-3 text-sm font-bold text-lime">My farm · {displayName}</Link>
                <button type="button" onClick={handleSignOut} className="grid h-11 w-11 place-items-center rounded-full border border-line" aria-label="Sign out">↗</button>
              </div>
            ) : (
              <Link
                href="/login"
                onClick={closeMenu}
                className="inline-flex w-full items-center justify-center rounded-full bg-ink px-5 py-3 text-sm font-bold text-white transition hover:bg-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
              >
                Sign in
              </Link>
            )}
          </div>
        </nav>
      </div>
    </header>
  );
}
