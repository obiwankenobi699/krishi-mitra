'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, EmptyState, ErrorCard, RouteHero } from '@/components/ui';
import { api } from '@/lib/api';

interface Article {
  id: string;
  category?: string | null;
  published_at: string;
  source_url?: string | null;
  source_name?: string | null;
  title: string;
  summary?: string | null;
}

export default function NewsPage(): React.JSX.Element {
  const [articles, setArticles] = useState<Article[]>([]);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);

  async function load(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      setArticles(await api<Article[]>('/news', {}, false));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not load news.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const [lead, ...rest] = articles;

  return (
    <main className="km-route-page bg-paper text-ink">
      <RouteHero
        flip
        eyebrow="FARM BRIEFING"
        title="Agriculture updates without the noise."
        description="A trusted feed organized in one place, with source links and publication dates kept visible."
        imageSrc="/images/farm-rows.jpg"
        imageAlt="Neat green crop rows stretching across a farm at daylight"
        chip="Curated · sourced · dated"
      />

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        {error && !loading ? (
          <div className="mb-6">
            <ErrorCard message={error} onRetry={() => void load()} retryLabel="Reload briefing" />
          </div>
        ) : null}
        {loading ? (
          <div className="space-y-4" aria-label="Loading news">
            <div className="rounded-3xl border border-line bg-white p-6 sm:p-8">
              <div className="h-6 w-28 animate-pulse rounded-full bg-mist" />
              <div className="mt-3 h-8 w-3/4 animate-pulse rounded-xl bg-mist" />
              <div className="mt-3 h-4 w-full animate-pulse rounded bg-mist" />
              <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-mist" />
            </div>
            {[0, 1].map((n) => (
              <div key={n} className="rounded-2xl border border-line bg-white p-5">
                <div className="h-5 w-1/2 animate-pulse rounded bg-mist" />
                <div className="mt-2 h-4 w-full animate-pulse rounded bg-mist" />
              </div>
            ))}
            <p className="text-sm text-muted">Gathering today&apos;s farm briefing…</p>
          </div>
        ) : (
          <div className="space-y-4" aria-live="polite">
            {lead ? (
              <a
                key={lead.id}
                href={lead.source_url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block rounded-3xl bg-deep p-6 text-white shadow-xl shadow-deep/20 transition duration-300 hover:-translate-y-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green sm:p-8"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {lead.category && <Badge tone="warn">{lead.category}</Badge>}
                  <p className="text-xs text-white/70">{new Date(lead.published_at).toLocaleDateString()}</p>
                </div>
                <p className="mt-4 text-xs font-bold uppercase tracking-widest text-lime">{lead.source_name}</p>
                <h2 className="mt-1 font-serif text-2xl font-bold leading-tight sm:text-3xl">{lead.title}</h2>
                {lead.summary && <p className="mt-2 max-w-3xl text-sm text-white/75">{lead.summary}</p>}
                <span className="mt-4 inline-flex items-center rounded-full bg-lime px-4 py-2 text-xs font-bold text-deep">
                  Read the story →
                </span>
              </a>
            ) : null}
            {rest.map((article) => (
              <a
                key={article.id}
                href={article.source_url ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="block rounded-2xl border border-line bg-white p-5 shadow-sm transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-green"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {article.category && <Badge>{article.category}</Badge>}
                  <p className="text-xs text-muted">{new Date(article.published_at).toLocaleDateString()}</p>
                </div>
                <p className="mt-3 text-xs font-bold uppercase tracking-widest text-muted">{article.source_name}</p>
                <h2 className="mt-1 text-lg font-bold">{article.title}</h2>
                {article.summary && <p className="mt-1 text-sm text-muted">{article.summary}</p>}
              </a>
            ))}
          </div>
        )}
        {!loading && !articles.length && !error && (
          <EmptyState
            title="Your briefing is being prepared."
            description="Articles appear after trusted RSS feeds are configured and refreshed by the backend."
            action={
              <Button variant="dark" onClick={() => void load()}>
                Check again
              </Button>
            }
          />
        )}
      </section>
    </main>
  );
}
