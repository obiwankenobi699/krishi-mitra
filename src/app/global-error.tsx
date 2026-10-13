'use client';

import { useEffect } from 'react';
import Link from 'next/link';

interface ErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: ErrorProps): React.JSX.Element {
  useEffect(() => {
    console.error('Krishi Mitra error:', error);
  }, [error]);
  return (
    <html lang="en">
      <body>
        <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 text-center">
          <p className="rounded-full border border-line bg-cream px-4 py-1.5 text-xs font-bold tracking-[0.2em] text-muted">
            SOMETHING DIDN&apos;T SPROUT
          </p>
          <h1 className="mt-4 font-serif text-4xl">The field hit a rough patch.</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            This usually passes in a moment. Your farms and history are safe — try again, or head back home.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <button
              type="button"
              onClick={reset}
              className="rounded-full bg-green px-6 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5"
            >
              Try again
            </button>
            <Link
              href="/"
              className="rounded-full border border-line bg-white px-6 py-3 text-sm font-semibold transition hover:-translate-y-0.5"
            >
              Back home
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}
