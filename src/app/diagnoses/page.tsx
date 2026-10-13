'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { Badge, EmptyState, ErrorCard, RouteHero, severityTone } from '@/components/ui';
import { api } from '@/lib/api';

interface DiagnosisItem {
  id: string;
  severity?: string | null;
  created_at: string;
  condition?: string | null;
  crop?: string | null;
  result?: { summary?: string | null } | null;
  source?: string | null;
}

export default function DiagnosesPage(): React.JSX.Element {
  const [items, setItems] = useState<DiagnosisItem[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  async function load(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      setItems(await api<DiagnosisItem[]>('/ai/diagnoses'));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load analyses.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <main className="km-route-page bg-paper text-ink">
      <RouteHero
        flip
        eyebrow="CROP MEMORY"
        title="Every analysis, kept with your farm."
        description="Review past crop and field observations, compare severity, and know when expert review was recommended."
        imageSrc="/images/leaf-macro.jpg"
        imageAlt="Macro view of a vivid green leaf showing fine veins"
        chip="Web uploads · Telegram captures"
      >
        <Link
          href="/crop-doctor"
          className="inline-flex items-center justify-center rounded-full bg-lime px-7 py-3.5 text-sm font-bold text-deep shadow-lg shadow-deep/20 transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
        >
          Analyze another image
        </Link>
      </RouteHero>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        <RequireAuth>
          {error && !loading ? (
            <div className="mb-6">
              <ErrorCard message={error} onRetry={() => void load()} retryLabel="Reload history" />
            </div>
          ) : null}
          {loading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading analyses">
              {[0, 1, 2, 3, 4, 5].map((n) => (
                <div key={n} className="rounded-2xl border border-line bg-white p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="h-6 w-24 animate-pulse rounded-full bg-mist" />
                    <div className="h-4 w-16 animate-pulse rounded bg-mist" />
                  </div>
                  <div className="mt-3 h-6 w-2/3 animate-pulse rounded bg-mist" />
                  <div className="mt-2 h-4 w-full animate-pulse rounded bg-mist" />
                  <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-mist" />
                  <p className="sr-only">Loading past analyses…</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
              {items.map((item) => (
                <article key={item.id} className="rounded-2xl border border-line bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-deep/10">
                  <div className="flex items-center justify-between gap-2">
                    <Badge tone={severityTone(item.severity)}>{item.severity || 'analysis'}</Badge>
                    <span className="text-xs text-muted">{new Date(item.created_at).toLocaleDateString()}</span>
                  </div>
                  <h3 className="mt-3 font-serif text-xl font-bold">{item.condition || item.crop || 'Field analysis'}</h3>
                  {item.result?.summary && <p className="mt-1 text-sm text-muted">{item.result.summary}</p>}
                  <p className="mt-2 text-xs text-muted">
                    {item.source === 'telegram' ? 'Received through Telegram' : 'Uploaded in Krishi Mitra'}
                  </p>
                </article>
              ))}
            </div>
          )}
          {!loading && !items.length && !error && (
            <EmptyState
              title="No analyses yet."
              description="Your crop doctor results will collect here — start with one clear photo."
              action={
                <Link href="/crop-doctor" className="inline-flex items-center justify-center rounded-full bg-lime px-5 py-3 text-sm font-bold text-deep transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                  Analyze an image
                </Link>
              }
            />
          )}
          {!loading && items.length > 0 && (
            <div className="mt-6">
              <Link href="/crop-doctor" className="inline-flex items-center justify-center rounded-full bg-green px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                Analyze another image
              </Link>
            </div>
          )}
          {items.length > 0 && !loading && <span className="sr-only">{items.length} past analyses loaded.</span>}
        </RequireAuth>
      </section>
    </main>
  );
}
