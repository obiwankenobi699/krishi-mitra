import Link from 'next/link';
import type * as React from 'react';

export default function NotFound(): React.JSX.Element {
  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <p className="rounded-full border border-line bg-cream px-4 py-1.5 text-xs font-bold tracking-[0.2em] text-muted">
        OFF THE MAP
      </p>
      <h1 className="mt-4 font-serif text-5xl">This row isn&apos;t planted.</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        The page you&apos;re looking for moved or never existed. Let&apos;s get you back to familiar ground.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href="/"
          className="rounded-full bg-green px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5"
        >
          Back home
        </Link>
        <Link
          href="/crop-doctor"
          className="rounded-full border border-line bg-white px-6 py-3 text-sm font-semibold transition hover:-translate-y-0.5"
        >
          Check a crop
        </Link>
      </div>
    </main>
  );
}
