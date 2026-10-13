'use client';

import { useEffect, useState } from 'react';
import type * as React from 'react';
import { Badge, Button, EmptyState, ErrorCard, Field, Notice, Panel, RouteHero, controlClassName } from '@/components/ui';
import { api } from '@/lib/api';
import { marketplaceImage } from '@/lib/supabase';
import { useAuth } from '@/components/AuthProvider';

interface ListingForm {
  title: string;
  crop: string;
  variety: string;
  description: string;
  quantity: string;
  unit: string;
  price: string;
  state: string;
  district: string;
  contact_phone: string;
}

interface Listing {
  id: string;
  title: string;
  crop: string;
  variety?: string | null;
  description?: string | null;
  quantity: number;
  unit: string;
  price: number;
  state: string;
  district: string;
  seller_name?: string | null;
  contact_phone?: string | null;
  image_paths?: string[] | null;
}

const empty: ListingForm = { title: '', crop: '', variety: '', description: '', quantity: '', unit: 'kg', price: '', state: '', district: '', contact_phone: '' };

const textFields: Array<[keyof ListingForm, string, string]> = [
  ['title', 'Listing title', 'text'],
  ['crop', 'Crop', 'text'],
  ['variety', 'Variety', 'text'],
  ['quantity', 'Quantity', 'number'],
  ['price', 'Price ₹', 'number'],
  ['state', 'State', 'text'],
  ['district', 'District', 'text'],
  ['contact_phone', 'Contact phone', 'text'],
];

export default function MarketplacePage(): React.JSX.Element {
  const { user } = useAuth();
  const [listings, setListings] = useState<Listing[]>([]);
  const [search, setSearch] = useState<string>('');
  const [form, setForm] = useState<ListingForm>(empty);
  const [image, setImage] = useState<File | null>(null);
  const [showForm, setShowForm] = useState<boolean>(false);
  const [message, setMessage] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [publishing, setPublishing] = useState<boolean>(false);

  async function load(query: string = ''): Promise<void> {
    setLoading(true);
    try {
      setListings(await api<Listing[]>(`/marketplace${query ? `?search=${encodeURIComponent(query)}` : ''}`, {}, false));
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not load listings.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setPublishing(true);
    try {
      setMessage('Publishing your listing…');
      const listing = await api<{ id: string }>('/marketplace', {
        method: 'POST',
        body: JSON.stringify({ ...form, contact_phone: form.contact_phone || null, quantity: Number(form.quantity), price: Number(form.price) }),
      });
      if (image) {
        const body = new FormData();
        body.append('image', image);
        await api(`/marketplace/${listing.id}/images`, { method: 'POST', body });
      }
      setForm(empty);
      setImage(null);
      setShowForm(false);
      setMessage('Listing published.');
      load();
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Could not publish the listing.');
    } finally {
      setPublishing(false);
    }
  }

  function hideImage(event: React.SyntheticEvent<HTMLImageElement>): void {
    event.currentTarget.style.display = 'none';
  }

  const isError = message !== '' && !message.toLowerCase().includes('publish');

  return (
    <main className="km-route-page bg-paper text-ink">
      <RouteHero
        eyebrow="FARMER MARKET"
        title="Good produce deserves a direct path to buyers."
        description="Discover active farmer listings or publish your own harvest with transparent quantity, location, and price."
        imageSrc="/images/mandi-vegetables.jpg"
        imageAlt="Fresh vegetables piled high at an Indian mandi market"
        chip="Direct farmer-to-buyer trade"
      >
        <Button variant="lime" onClick={() => setShowForm((value) => !value)} aria-expanded={showForm}>
          {showForm ? 'Close form' : 'List your produce'}
        </Button>
      </RouteHero>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        {showForm && (
          <Panel className="mb-6">
            <h2 className="font-serif text-2xl font-bold">Create a listing</h2>
            {!user && (
              <div className="mt-3">
                <Notice tone="info">Sign in before publishing.</Notice>
              </div>
            )}
            <form className="mt-4 grid gap-4 sm:grid-cols-2" onSubmit={submit}>
              {textFields.map(([name, label, type]) => (
                <Field key={name} label={label} htmlFor={`marketplace-${name}`}>
                  <input
                    id={`marketplace-${name}`}
                    required={!['variety', 'contact_phone'].includes(name)}
                    type={type}
                    value={form[name]}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [name]: e.target.value })}
                    className={controlClassName}
                  />
                </Field>
              ))}
              <Field label="Unit" htmlFor="marketplace-unit">
                <select
                  id="marketplace-unit"
                  value={form.unit}
                  onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({ ...form, unit: e.target.value })}
                  className={controlClassName}
                >
                  <option>kg</option>
                  <option>quintal</option>
                  <option>tonne</option>
                  <option>crate</option>
                  <option>piece</option>
                </select>
              </Field>
              <Field label="Description" htmlFor="marketplace-description" className="sm:col-span-2">
                <textarea
                  id="marketplace-description"
                  value={form.description}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({ ...form, description: e.target.value })}
                  className={`${controlClassName} min-h-24`}
                />
              </Field>
              <div className="sm:col-span-2">
                <span className="mb-1.5 block text-sm font-semibold">Product image</span>
                <div className="rounded-xl border border-dashed border-line bg-cream px-4 py-4">
                  <input
                    id="marketplace-image"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setImage(e.target.files?.[0] ?? null)}
                    className="w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-deep file:px-4 file:py-2 file:text-xs file:font-bold file:text-lime focus-visible:outline-2 focus-visible:outline-green"
                    aria-label="Product image"
                  />
                  {image && <p className="mt-2 text-xs">Selected: {image.name}</p>}
                </div>
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" variant="lime" loading={publishing}>
                  Publish listing
                </Button>
              </div>
            </form>
          </Panel>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <label htmlFor="marketplace-search" className="sr-only">
            Search crop or listing
          </label>
          <input
            id="marketplace-search"
            placeholder="Search crop or listing"
            value={search}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
            className={`${controlClassName} flex-1`}
          />
          <Button variant="dark" onClick={() => load(search)} loading={loading}>
            Search
          </Button>
        </div>
        {message && !isError && (
          <div className="mt-4" aria-live="polite">
            <Notice tone={message.includes('published') ? 'success' : 'info'}>{message}</Notice>
          </div>
        )}
        {isError && !loading ? (
          <div className="mt-4">
            <ErrorCard message={message} onRetry={() => void load(search)} retryLabel="Reload listings" />
          </div>
        ) : null}
        {loading ? (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading listings">
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <div key={n} className="overflow-hidden rounded-2xl border border-line bg-white">
                <div className="h-40 animate-pulse bg-mist" />
                <div className="space-y-2 p-5">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-mist" />
                  <div className="h-4 w-full animate-pulse rounded bg-mist" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-mist" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-live="polite">
            {listings.map((item) => {
              const imageUrl = marketplaceImage(item.image_paths?.[0]);
              return (
                <article key={item.id} className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm transition duration-300 hover:-translate-y-1 hover:shadow-lg hover:shadow-deep/10">
                  <div className="h-40 bg-mist">
                    {imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- user-uploaded Supabase images have unknown dimensions; static optimization would need remotePatterns config
                      <img src={imageUrl} alt={item.crop} onError={hideImage} className="h-full w-full object-cover" />
                    ) : (
                      <div className="grid h-full place-items-center font-serif text-5xl font-bold text-muted">{item.crop?.[0]}</div>
                    )}
                  </div>
                  <div className="p-5">
                    <div className="flex items-center justify-between text-xs text-muted">
                      <span>
                        {item.district}, {item.state}
                      </span>
                      <span className="font-bold text-green">
                        ₹{item.price}/{item.unit}
                      </span>
                    </div>
                    <h3 className="mt-2 font-bold">{item.title}</h3>
                    <p className="mt-1 text-sm text-muted">{item.description || `${item.quantity} ${item.unit} of ${item.crop} available.`}</p>
                    <div className="mt-3 flex items-center justify-between text-sm">
                      <Badge>{item.crop}</Badge>
                      <span className="text-muted">
                        By {item.seller_name} · <strong className="text-ink">{item.quantity} {item.unit}</strong>
                      </span>
                    </div>
                    {item.contact_phone ? (
                      <a
                        href={`tel:${item.contact_phone.replace(/[^+\d]/g, '')}`}
                        aria-label={`Call ${item.seller_name} about ${item.title}`}
                        className="mt-4 flex items-center justify-center gap-2 rounded-full bg-deep px-4 py-2.5 text-sm font-bold text-lime transition hover:-translate-y-px hover:bg-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                      >
                        <span aria-hidden="true">☎</span> Call farmer · {item.contact_phone}
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
        {!loading && !listings.length && !isError && (
          <div className="mt-6">
            <EmptyState
              title="No active listings yet."
              description="Be the first farmer to publish — your harvest could be on a buyer's table this week."
              action={
                <Button variant="lime" onClick={() => setShowForm(true)}>
                  List your produce
                </Button>
              }
            />
          </div>
        )}
      </section>
    </main>
  );
}
