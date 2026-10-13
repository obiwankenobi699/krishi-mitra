'use client';

import Link from 'next/link';
import Image from 'next/image';
import type * as React from 'react';
import { useAuth } from './AuthProvider';

interface FooterGroup {
  heading: string;
  links: Array<{ label: string; href: string }>;
}

const groups: FooterGroup[] = [
  {
    heading: 'Products',
    links: [
      { label: 'Crop doctor', href: '/crop-doctor' },
      { label: 'Marketplace', href: '/marketplace' },
      { label: 'Advisor', href: '/advisor' },
      { label: 'Farm desk', href: '/farms' },
    ],
  },
  {
    heading: 'Stay close',
    links: [
      { label: 'Farm news', href: '/news' },
      { label: 'Telegram access', href: '/telegram' },
      { label: 'Past analyses', href: '/diagnoses' },
    ],
  },
];

export default function SiteFooter(): React.JSX.Element {
  const { isAuthenticated, ready } = useAuth();

  return (
    <footer className="km-video-footer bg-deep text-white">
      <video className="km-footer-video" autoPlay muted loop playsInline preload="metadata" aria-hidden="true">
        <source src="/media/ocean-footer.mp4" type="video/mp4" />
      </video>
      <div className="km-footer-overlay" />
      <div className="km-footer-content mx-auto max-w-7xl px-4 py-14 sm:px-6 md:py-16 lg:px-8">
        <div className="grid gap-12 md:grid-cols-[1.2fr_2fr]">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-2.5 rounded-full font-extrabold tracking-[0.14em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
              aria-label="Krishi Mitra home"
            >
              <Image src="/krishi-mitra-logo.png" alt="" width={38} height={38} />
              <span className="text-sm">KRISHI MITRA</span>
            </Link>
            <p className="mt-5 max-w-xs text-sm leading-relaxed text-white/70">
              A practical AI companion for stronger farms — vision, markets, planning, and memory in one calm
              workspace.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-lime">
                Private by design
              </span>
              <span className="inline-flex items-center rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs font-semibold text-white/80">
                Local-first AI
              </span>
            </div>
          </div>

          <div className="grid gap-10 sm:grid-cols-2">
            {groups.map((group) => (
              <nav key={group.heading} aria-label={`Footer — ${group.heading}`}>
                <h2 className="text-xs font-bold uppercase tracking-[0.22em] text-lime">
                  {group.heading}
                </h2>
                <ul className="mt-5 space-y-3">
                  {group.links.map((link) => (
                    <li key={link.href + link.label}>
                      <Link
                        href={link.href}
                        className="rounded text-sm text-white/75 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                  {group.heading === 'Stay close' ? (
                    <li>
                      <Link
                        href={isAuthenticated ? '/farms' : '/login'}
                        aria-disabled={!ready}
                        onClick={(event) => { if (!ready) event.preventDefault(); }}
                        className="rounded text-sm text-white/75 transition hover:text-white focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-lime"
                      >
                        {!ready ? 'Checking session…' : isAuthenticated ? 'My farm' : 'Sign in'}
                      </Link>
                    </li>
                  ) : null}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-white/10 pt-6 text-xs leading-relaxed text-white/55 md:flex-row md:items-center md:justify-between">
          <p>AI guidance supports — not replaces — local agricultural experts.</p>
          <p>© {new Date().getFullYear()} Krishi Mitra. Grown with care for the field.</p>
        </div>
      </div>
    </footer>
  );
}
