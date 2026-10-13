'use client';

import { useEffect, useState } from 'react';
import type * as React from 'react';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { Badge, Button, EmptyState, ErrorCard, Field, Notice, Panel, RouteHero, controlClassName } from '@/components/ui';
import { api } from '@/lib/api';

interface Farm {
  id: string;
  name: string;
  state: string;
  district: string;
  village?: string | null;
  acreage?: number | null;
  soil_type?: string | null;
  irrigation_type?: string | null;
  current_crop?: string | null;
  sowing_date?: string | null;
}

const initial: Record<string, string> = { name: '', state: '', district: '', village: '', acreage: '', soil_type: '', irrigation_type: '', current_crop: '', sowing_date: '' };

const fieldLabels: Record<string, string> = { name: 'Farm name', state: 'State', district: 'District', village: 'Village', acreage: 'Acreage', soil_type: 'Soil type', irrigation_type: 'Irrigation', current_crop: 'Current crop', sowing_date: 'Sowing date' };

export default function FarmsPage(): React.JSX.Element {
  const [farms, setFarms] = useState<Farm[]>([]);
  const [form, setForm] = useState<Record<string, string>>(initial);
  const [message, setMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  async function load(): Promise<void> {
    setLoading(true);
    try {
      setFarms(await api<Farm[]>('/farms'));
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not load farms.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    try {
      await api('/farms', { method: 'POST', body: JSON.stringify({ ...form, acreage: form.acreage ? Number(form.acreage) : null, sowing_date: form.sowing_date || null }) });
      setForm(initial);
      setMessage('Farm added.');
      load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not save the farm.');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await api(`/farms/${id}`, { method: 'DELETE' });
      load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not remove the farm.');
    }
  }

  const isError = message.toLowerCase().includes('could not');

  return (
    <main className="km-route-page bg-paper text-ink">
      <RouteHero
        flip
        eyebrow="FARM DESK"
        title="A living record for every field."
        description="Keep location, acreage, soil, irrigation, current crop, and sowing cycle together—ready for analysis and planning."
        imageSrc="/images/india-terraced-fields.jpg"
        imageAlt="Terraced farm fields carved into green Indian hillsides"
        chip="Soil · water · crop · season"
      >
        <a
          href="#add-farm"
          className="inline-flex items-center justify-center rounded-full bg-lime px-7 py-3.5 text-sm font-bold text-deep shadow-lg shadow-deep/20 transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
        >
          Add your first farm
        </a>
      </RouteHero>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        <RequireAuth>
          <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <Panel>
              <h2 id="add-farm" className="font-serif text-2xl font-bold scroll-mt-24">Add a farm</h2>
              <form className="mt-4" onSubmit={create}>
                <div className="grid gap-4 sm:grid-cols-2">
                  {Object.entries(fieldLabels).map(([name, label]) => (
                    <Field key={name} label={label} htmlFor={`farm-${name}`}>
                      <input
                        id={`farm-${name}`}
                        required={['name', 'state', 'district'].includes(name)}
                        type={name === 'acreage' ? 'number' : name === 'sowing_date' ? 'date' : 'text'}
                        value={form[name]}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [name]: e.target.value })}
                        className={controlClassName}
                      />
                    </Field>
                  ))}
                </div>
                <div className="mt-4">
                  <Button type="submit" variant="lime" loading={saving} className="w-full">
                    Save farm
                  </Button>
                </div>
              </form>
              {message && !isError && (
                <div className="mt-4" aria-live="polite">
                  <Notice tone="success">{message}</Notice>
                </div>
              )}
            </Panel>
            <div>
              {isError && !loading ? (
                <div className="mb-4">
                  <ErrorCard message={message} onRetry={() => void load()} retryLabel="Reload farms" />
                </div>
              ) : null}
              {loading ? (
                <div className="grid gap-4 sm:grid-cols-2" aria-label="Loading farms">
                  {[0, 1, 2, 3].map((n) => (
                    <div key={n} className="rounded-2xl border border-line bg-white p-5">
                      <div className="h-6 w-24 animate-pulse rounded-full bg-mist" />
                      <div className="mt-3 h-5 w-2/3 animate-pulse rounded bg-mist" />
                      <div className="mt-2 h-4 w-full animate-pulse rounded bg-mist" />
                      <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-mist" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2" aria-live="polite">
                  {farms.map((farm) => (
                    <article key={farm.id} className="rounded-2xl border border-line bg-white p-5 shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-deep/10">
                      <Badge>{farm.acreage ? `${farm.acreage} acres` : 'Farm'}</Badge>
                      <h3 className="mt-2 font-serif text-xl font-bold">{farm.name}</h3>
                      <p className="mt-1 text-sm text-muted">
                        {farm.village ? `${farm.village}, ` : ''}{farm.district}, {farm.state}
                      </p>
                      <p className="mt-1 text-sm text-muted">
                        {farm.current_crop || 'No active crop'} · {farm.irrigation_type || 'Irrigation not set'}
                      </p>
                      <div className="mt-3">
                        <Button variant="secondary" onClick={() => remove(farm.id)}>
                          Remove
                        </Button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
              {!loading && !farms.length && !isError && (
                <EmptyState
                  title="No farms yet."
                  description="Add your first farm to connect diagnoses and crop plans."
                  action={
                    <a
                      href="#add-farm"
                      className="inline-flex items-center justify-center rounded-full bg-lime px-5 py-3 text-sm font-bold text-deep transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    >
                      Add a farm
                    </a>
                  }
                />
              )}
              <Panel className="mt-6">
                <h2 className="font-serif text-xl font-bold">Connected tools</h2>
                <p className="mt-1 text-sm text-muted">Your farm record powers vision analysis and Telegram diagnoses.</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Link href="/crop-doctor" className="inline-flex items-center justify-center gap-2 rounded-full bg-green px-5 py-3 text-sm font-bold text-white transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                    Analyze a crop
                  </Link>
                  <Link href="/telegram" className="inline-flex items-center justify-center gap-2 rounded-full border border-line bg-white px-5 py-3 text-sm font-bold text-ink transition hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green">
                    Connect Telegram
                  </Link>
                </div>
              </Panel>
            </div>
          </div>
        </RequireAuth>
      </section>
    </main>
  );
}
