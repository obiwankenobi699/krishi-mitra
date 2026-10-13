'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type * as React from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/components/AuthProvider';
import { Button } from '@/components/ui';

export default function LoginPage(): React.JSX.Element {
  const { user, ready, error: authError, refreshSession, signIn } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);

  useEffect(() => {
    if (user) router.replace('/farms');
  }, [router, user]);

  async function login(): Promise<void> {
    try {
      setError('');
      setBusy(true);
      await signIn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function hideImage(event: React.SyntheticEvent<HTMLImageElement>): void {
    event.currentTarget.style.display = 'none';
  }

  return (
    <main className="km-login-page grid min-h-[calc(100vh-68px)] grid-cols-1 bg-cream md:min-h-[calc(100vh-76px)] lg:grid-cols-2">
      <div className="relative min-h-[320px] overflow-hidden bg-deep lg:min-h-full">
        <Image
          src="/images/crop.jpg"
          alt="Golden agricultural field ready for harvest"
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          onError={hideImage}
          className="bg-deep object-cover"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-t from-deep/80 via-deep/25 to-transparent"
        />
        <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[0.7rem] font-bold tracking-[0.22em] text-lime backdrop-blur-md">
            FARMER-FIRST · PRIVATE BY DESIGN
          </p>
          <blockquote className="mt-4 max-w-md font-serif text-2xl leading-snug text-white sm:text-3xl">
            “One calm place for my fields, my harvest, and my plans.”
          </blockquote>
          <p className="mt-3 text-sm text-white/75">Built for growers, buyers, and rural advisors.</p>
        </div>
      </div>

      <section
        aria-label="Sign in to Krishi Mitra"
        className="flex flex-col justify-center px-5 py-12 sm:px-10 md:px-16 lg:px-20 lg:py-16"
      >
        <div className="mx-auto w-full max-w-md">
          <Link
            href="/"
            className="inline-flex items-center gap-2.5 rounded-full font-extrabold tracking-[0.14em] text-ink focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-green"
            aria-label="Back to Krishi Mitra home"
          >
            <Image src="/krishi-mitra-logo.png" alt="" width={38} height={38} className="rounded-full" />
            <span className="text-sm">KRISHI MITRA</span>
          </Link>

          <p className="mt-10 text-[0.7rem] font-extrabold tracking-[0.24em] text-muted">
            WELCOME TO KRISHI MITRA
          </p>
          <h1 className="mt-3 font-serif text-4xl leading-[1.02] tracking-tight text-ink sm:text-5xl">
            Where farm knowledge comes alive.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-muted sm:text-base">
            One secure account for your farms, diagnoses, listings, advice, and Telegram connection.
          </p>

          {error ? (
            <div role="alert" className="mt-6 rounded-2xl border border-amber-200 bg-amber-50 p-4 shadow-sm">
              <p className="text-sm font-medium text-ink">{error}</p>
              <p className="mt-1 text-xs text-ink/70">Nothing was lost — your session simply needs one more attempt.</p>
              <div className="mt-3">
                <Button variant="dark" onClick={() => void login()} disabled={busy}>
                  Try signing in again
                </Button>
              </div>
            </div>
          ) : null}

          <button type="button" onClick={ready ? login : () => void refreshSession()} disabled={busy} className="mt-7 inline-flex w-full items-center justify-center gap-3 rounded-xl border border-line bg-white px-5 py-4 text-sm font-bold text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-ink/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0">
            <span
              aria-hidden="true"
              className="grid h-6 w-6 place-items-center rounded-full bg-ink text-sm font-extrabold text-white"
            >
              G
            </span>
            {busy ? 'Connecting…' : !ready ? 'Checking existing session…' : 'Continue with Google'}
          </button>
          {authError && !error ? <p className="mt-3 text-center text-xs text-danger">{authError}</p> : null}
          {busy ? (
            <p aria-live="polite" className="mt-3 text-center text-xs text-muted">
              Opening secure Google sign-in — this takes a moment…
            </p>
          ) : null}

          <div className="mt-6 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
            <span className="h-px flex-1 bg-line" />
            <span>Secure OAuth · No passwords stored</span>
            <span className="h-px flex-1 bg-line" />
          </div>

          <p className="mt-6 text-xs leading-relaxed text-muted">
            Authentication is securely managed by Supabase. By continuing you agree to use AI guidance
            alongside local agricultural expertise.
          </p>
        </div>
      </section>
    </main>
  );
}
