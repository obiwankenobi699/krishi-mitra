'use client';

import { useState } from 'react';
import type * as React from 'react';
import ReactMarkdown from 'react-markdown';
import RequireAuth from '@/components/RequireAuth';
import { usePersistentState } from '@/components/usePersistentState';
import VoiceRecorder from '@/components/VoiceRecorder';
import { Button, ErrorCard, Field, Panel, RouteHero, controlClassName } from '@/components/ui';
import { api, apiBlob } from '@/lib/api';

interface ChatMessage {
  sender: 'ai' | 'user';
  text: string;
}

interface PlanForm {
  land_size: string;
  crop: string;
  state: string;
  district: string;
}

const planFields: Array<[keyof PlanForm, string, string]> = [
  ['land_size', 'Land size (acres)', 'advisor-plan-land_size'],
  ['crop', 'Crop', 'advisor-plan-crop'],
  ['state', 'State', 'advisor-plan-state'],
  ['district', 'District', 'advisor-plan-district'],
];

export default function AdvisorPage(): React.JSX.Element {
  const [messages, setMessagesState] = usePersistentState<ChatMessage[]>( 'km:advisor-messages', [
    { sender: 'ai', text: 'Ask me about soil, crops, schemes, pests, or farm practices.' },
  ]);
  // Cap persisted chat history so localStorage never grows unbounded.
  const setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>> = (action) => {
    setMessagesState((prev) => {
      const next = typeof action === 'function' ? (action as (p: ChatMessage[]) => ChatMessage[])(prev) : action;
      return next.length > 50 ? next.slice(next.length - 50) : next;
    });
  };
  const [query, setQuery] = useState<string>('');
  const [busy, setBusy] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string>('');
  const [failedQuery, setFailedQuery] = useState<string>('');
  const [failedVoice, setFailedVoice] = useState<File | null>(null);
  const [plan, setPlan] = usePersistentState<string | null>('km:advisor-plan', null);
  const [planForm, setPlanForm] = usePersistentState<PlanForm>('km:advisor-plan-form', { land_size: '', crop: '', state: '', district: '' });
  const [error, setError] = useState<string>('');
  const [planBusy, setPlanBusy] = useState<boolean>(false);

  async function send(text: string): Promise<void> {
    setBusy(true);
    try {
      const data = await api<{ answer: string }>('/ai/query', { method: 'POST', body: JSON.stringify({ query: text }) });
      setMessages((items) => [...items, { sender: 'ai', text: data.answer }]);
      setChatError('');
      setFailedQuery('');
      setFailedVoice(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'The assistant is unavailable right now.';
      setMessages((items) => [...items, { sender: 'ai', text: message }]);
      setChatError(message);
      setFailedQuery(text);
      setFailedVoice(null);
    } finally {
      setBusy(false);
    }
  }

  async function ask(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!query.trim()) return;
    const text = query;
    setQuery('');
    setMessages((items) => [...items, { sender: 'user', text }]);
    await send(text);
  }

  function retryChat(): void {
    if (failedVoice) {
      void voice(failedVoice);
      return;
    }
    if (failedQuery) {
      void send(failedQuery);
    }
  }

  async function voice(file: File): Promise<void> {
    setBusy(true);
    try {
      const body = new FormData();
      body.append('audio_file', file);
      const blob = await apiBlob('/ai/voice', { method: 'POST', body });
      new Audio(URL.createObjectURL(blob)).play();
      setChatError('');
      setFailedVoice(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'The voice assistant is unavailable right now.';
      setMessages((items) => [...items, { sender: 'ai', text: message }]);
      setChatError(message);
      setFailedVoice(file);
      setFailedQuery('');
    } finally {
      setBusy(false);
    }
  }

  async function generatePlan(): Promise<void> {
    setError('');
    setPlanBusy(true);
    try {
      const data = await api<{ plan: string }>('/ai/plan', { method: 'POST', body: JSON.stringify({ ...planForm, land_size: Number(planForm.land_size) }) });
      setPlan(data.plan);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Could not generate a plan.');
    } finally {
      setPlanBusy(false);
    }
  }

  function createPlan(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void generatePlan();
  }

  return (
    <main className="km-route-page bg-paper text-ink">
      <RouteHero
        tone="deep"
        eyebrow="GROUNDTRUTH + YIELDWISE"
        title="Advice grounded in your farm context."
        description="Ask agricultural questions in natural language or build a focused financial plan from your acreage, crop, and location."
        imageSrc="/images/wheat-field-sunset.jpg"
        imageAlt="Golden wheat field glowing at sunset"
        chip="Local models · grounded answers"
      />

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        <RequireAuth>
          <div className="grid gap-6 lg:grid-cols-2">
            <Panel className="flex flex-col">
              <h2 className="font-serif text-2xl font-bold">Ask the advisor</h2>
              <p className="mt-1 text-sm text-muted">Soil, crops, schemes, pests, and farm practices.</p>
              <div aria-live="polite" className="mt-4 flex max-h-[420px] min-h-[280px] flex-1 flex-col gap-3 overflow-y-auto rounded-xl bg-cream p-4">
                {messages.map((item, index) => (
                  <div
                    key={index}
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                      item.sender === 'user' ? 'self-end bg-deep text-white' : 'self-start border border-line bg-white text-ink'
                    }`}
                  >
                    <ReactMarkdown>{item.text}</ReactMarkdown>
                  </div>
                ))}
                {busy && <div className="self-start rounded-2xl border border-line bg-white px-4 py-2.5 text-sm text-muted">Thinking with local models…</div>}
              </div>
              {chatError && !busy ? (
                <div className="mt-3">
                  <ErrorCard message={chatError} onRetry={retryChat} retryLabel="Retry question" title="The advisor missed that" />
                </div>
              ) : null}
              <form className="mt-4 flex flex-wrap items-center gap-2" onSubmit={ask}>
                <label htmlFor="advisor-query" className="sr-only">
                  Ask an agricultural question
                </label>
                <input
                  id="advisor-query"
                  value={query}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setQuery(e.target.value)}
                  placeholder="Ask an agricultural question"
                  className={`${controlClassName} flex-1`}
                />
                <Button type="submit" variant="dark" disabled={busy || !query.trim()}>
                  Send
                </Button>
                <VoiceRecorder onStop={voice} />
              </form>
            </Panel>
            <Panel>
              <h2 className="font-serif text-2xl font-bold">Build a crop plan</h2>
              <p className="mt-1 text-sm text-muted">A focused financial plan from your acreage and location.</p>
              <form className="mt-4" onSubmit={createPlan}>
                <div className="grid gap-4 sm:grid-cols-2">
                  {planFields.map(([name, label, id]) => (
                    <Field key={name} label={label} htmlFor={id}>
                      <input
                        id={id}
                        required
                        type={name === 'land_size' ? 'number' : 'text'}
                        value={planForm[name]}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPlanForm({ ...planForm, [name]: e.target.value })}
                        className={controlClassName}
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-4">
                  <Button type="submit" variant="lime" loading={planBusy}>
                    Generate plan
                  </Button>
                </div>
              </form>
              {planBusy && !plan ? (
                <div className="mt-4 space-y-2" aria-label="Generating plan">
                  <div className="h-6 w-1/2 animate-pulse rounded-full bg-mist" />
                  <div className="h-4 w-full animate-pulse rounded bg-mist" />
                  <div className="h-4 w-5/6 animate-pulse rounded bg-mist" />
                  <div className="h-4 w-4/6 animate-pulse rounded bg-mist" />
                  <p className="pt-1 text-sm text-muted">Crunching acres, costs, and seasons…</p>
                </div>
              ) : null}
              {error && !planBusy ? (
                <div className="mt-4">
                  <ErrorCard message={error} onRetry={() => void generatePlan()} retryLabel="Retry plan" />
                </div>
              ) : null}
              {plan && (
                <div aria-live="polite" className="prose prose-sm mt-4 max-w-none rounded-xl border border-line bg-cream p-4">
                  <ReactMarkdown>{plan}</ReactMarkdown>
                </div>
              )}
            </Panel>
          </div>
        </RequireAuth>
      </section>
    </main>
  );
}
