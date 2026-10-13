'use client';

import { useEffect, useState } from 'react';
import RequireAuth from '@/components/RequireAuth';
import { Button, ErrorCard, Notice, Panel, RouteHero, Skeleton } from '@/components/ui';
import { api } from '@/lib/api';

interface TelegramAccount {
  username?: string | null;
}

const steps = [
  { n: '01', title: 'Take a clear photo', body: 'Capture the affected leaf or field area in good light.' },
  { n: '02', title: 'Send it to the bot', body: 'The secure webhook passes it to local Ollama vision.' },
  { n: '03', title: 'Keep the result', body: 'The reply arrives in chat and is saved in your Krishi Mitra history.' },
];

interface TelegramLink {
  url: string;
  code: string;
  expiresAt: string;
}

const LINK_KEY = 'km:telegram-link';

function loadStoredLink(): TelegramLink | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(LINK_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TelegramLink;
    if (!parsed.url || !parsed.code || !parsed.expiresAt) return null;
    return parsed;
  } catch {
    return null;
  }
}

function isExpired(link: TelegramLink): boolean {
  return Date.now() >= new Date(link.expiresAt).getTime();
}

function countdown(link: TelegramLink): string {
  const ms = new Date(link.expiresAt).getTime() - Date.now();
  if (ms <= 0) return 'expired';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}:${String(s).padStart(2, '0')} left`;
}

export default function TelegramPage(): React.JSX.Element {
  const [account, setAccount] = useState<TelegramAccount | null>(null);
  const [link, setLink] = useState<TelegramLink | null>(null);
  const [message, setMessage] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [copied, setCopied] = useState<boolean>(false);
  const [, setNowTick] = useState<number>(0);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      setAccount(await api<TelegramAccount>('/telegram/account'));
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not load the Telegram account.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    setLink(loadStoredLink());
    const timer = window.setInterval(() => setNowTick((n) => n + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);

  async function connect(): Promise<void> {
    setBusy(true);
    try {
      const data = await api<{ url: string; code: string; expires_at: string }>('/telegram/link', { method: 'POST' });
      const fresh: TelegramLink = { url: data.url, code: data.code, expiresAt: data.expires_at };
      setLink(fresh);
      setMessage('');
      try {
        window.localStorage.setItem(LINK_KEY, JSON.stringify(fresh));
      } catch {
        /* storage full — link still shown for this session */
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not generate a connection link.');
    } finally {
      setBusy(false);
    }
  }

  async function copyCode(): Promise<void> {
    if (!link) return;
    try {
      await window.navigator.clipboard.writeText(link.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage('Copy failed — long-press the code to copy it manually.');
    }
  }

  async function unlink(): Promise<void> {
    try {
      await api('/telegram/account', { method: 'DELETE' });
      setAccount(null);
      setLink(null);
      setMessage('');
      try {
        window.localStorage.removeItem(LINK_KEY);
      } catch {
        /* ignore */
      }
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not disconnect the account.');
    }
  }

  function retry(): void {
    if (account) {
      void load();
    } else {
      void connect();
    }
  }

  return (
    <main className="km-route-page bg-paper text-ink">
      <RouteHero
        tone="deep"
        eyebrow="FIELD ACCESS"
        title="Send a crop photo. Receive the analysis in Telegram."
        description="Link your private Krishi Mitra account once, then use the familiar Telegram camera flow from the field."
        imageSrc="/images/farmer.jpg"
        imageAlt="A farmer standing in the field at golden hour"
        chip="15-minute secure link"
      />

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        <RequireAuth>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel>
              <h2 className="font-serif text-2xl font-bold">{account ? 'Telegram is connected' : 'Connect your bot'}</h2>
              {loading ? (
                <div className="mt-4 space-y-2" aria-label="Loading Telegram status">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-11 w-56 rounded-full" />
                  <p className="pt-1 text-sm text-muted">Checking your Telegram link…</p>
                </div>
              ) : account ? (
                <div className="mt-3 space-y-3">
                  <p className="text-sm">
                    Linked as <strong>@{account.username || 'Telegram farmer'}</strong>.
                  </p>
                  <Button variant="secondary" onClick={() => void unlink()}>
                    Disconnect account
                  </Button>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  <p className="text-sm text-muted">Generate a secure, 15-minute connection link. Open it in Telegram and press Start.</p>
                  <Button variant="lime" onClick={() => void connect()} loading={busy}>
                    Generate connection link
                  </Button>
                  {link && !isExpired(link) && (
                    <div className="space-y-3">
                      <Notice tone="success">
                        <a href={link.url} target="_blank" rel="noreferrer" className="font-bold underline">
                          Open Krishi Mitra in Telegram →
                        </a>
                      </Notice>
                      <div className="rounded-2xl border border-line bg-white p-4">
                        <p className="text-xs font-bold tracking-widest text-muted">YOUR CODE · {countdown(link)}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <code className="flex-1 truncate rounded-lg bg-cream px-3 py-2 font-mono text-sm font-bold">
                            {link.code}
                          </code>
                          <Button variant="secondary" onClick={() => void copyCode()}>
                            {copied ? 'Copied ✓' : 'Copy'}
                          </Button>
                        </div>
                        <p className="mt-2 text-xs text-muted">
                          Bot chat not opening? Send <code className="font-mono font-bold">/link {link.code}</code> to @farmers123bot manually.
                        </p>
                      </div>
                    </div>
                  )}
                  {link && isExpired(link) && (
                    <Notice tone="info">
                      That code expired. Generate a fresh one — codes live 15 minutes.
                    </Notice>
                  )}
                </div>
              )}
              {message && !loading ? (
                <div className="mt-4">
                  <ErrorCard message={message} onRetry={retry} retryLabel={account ? 'Recheck connection' : 'Retry connection'} />
                </div>
              ) : null}
            </Panel>
            <div className="rounded-3xl bg-deep p-6 text-white sm:p-8">
              <p className="text-xs font-extrabold tracking-[0.22em] text-lime">FROM CAMERA TO ACTION</p>
              <h2 className="mt-2 font-serif text-2xl font-bold">Three steps from the field</h2>
              <ol className="mt-5 space-y-3">
                {steps.map((step) => (
                  <li key={step.n} className="flex gap-4 rounded-2xl border border-white/15 bg-white/5 p-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lime text-sm font-bold text-deep">
                      {step.n}
                    </span>
                    <div>
                      <h3 className="font-bold">{step.title}</h3>
                      <p className="mt-1 text-sm text-white/75">{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </RequireAuth>
      </section>
    </main>
  );
}
