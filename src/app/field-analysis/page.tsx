'use client';

import { useEffect, useRef, useState } from 'react';
import type * as React from 'react';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import VigorMap, { type VigorStats } from '@/components/VigorMap';
import ZoneOverlay, { type PlanRegion, type PlanZone } from '@/components/ZoneOverlay';
import { Badge, Button, EmptyState, ErrorCard, Field, Notice, Panel, RouteHero, Skeleton, controlClassName } from '@/components/ui';
import { api } from '@/lib/api';

interface DiagnoseInsight {
  regions?: PlanRegion[] | null;
  result?: { regions?: PlanRegion[] | null } | null;
}

type Season = 'kharif' | 'rabi' | 'zaid';
type Goal = 'yield' | 'money';

/** Optional per-zone market fields the backend may attach when goal=money. All optional by design. */
interface MarketZone extends PlanZone {
  price_min?: number | null;
  price_max?: number | null;
  modal_price?: number | null;
  price_unit?: string | null;
  price_range?: string | null;
  revenue?: string | null;
  revenue_estimate?: number | string | null;
}

interface FieldPlanResult {
  zones: MarketZone[];
  summary: string;
  enriched: boolean;
  market_snapshot?: Record<string, unknown> | null;
}

interface FieldMapResult {
  vigor_map: string;
  surface_3d: string;
  grid?: unknown;
  stats: { mean_vigor: number; stressed_pct: number; vigorous_pct: number };
}

function validGrid(value: unknown): number[][] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 160) return null;
  const rows: number[][] = [];
  for (const row of value) {
    if (!Array.isArray(row) || row.length === 0 || row.length > 160) return null;
    const nums: number[] = [];
    for (const cell of row) {
      if (typeof cell !== 'number' || !Number.isFinite(cell)) return null;
      nums.push(Math.min(1, Math.max(0, cell)));
    }
    rows.push(nums);
  }
  return rows;
}

interface StoredPlan extends FieldPlanResult {
  regions: PlanRegion[];
  season: Season;
  goal: Goal;
  photoKey: string | null;
}

const STORAGE_KEY = 'km:field-plan:last';
const PHOTO_PREFIX = 'km:field-plan:photo:';
const PHOTO_POINTER = 'km:field-plan:photo:current';
type Phase = 'idle' | 'detecting' | 'planning';

const SEASONS: Array<{ value: Season; label: string }> = [
  { value: 'kharif', label: 'Kharif' },
  { value: 'rabi', label: 'Rabi' },
  { value: 'zaid', label: 'Zaid' },
];

const GOALS: Array<{ value: Goal; label: string }> = [
  { value: 'yield', label: 'Max yield' },
  { value: 'money', label: 'Max income' },
];

function isSeason(value: unknown): value is Season {
  return value === 'kharif' || value === 'rabi' || value === 'zaid';
}

function isGoal(value: unknown): value is Goal {
  return value === 'yield' || value === 'money';
}

function loadStoredPlan(): StoredPlan | null {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredPlan;
    if (!Array.isArray(parsed?.zones) || !Array.isArray(parsed?.regions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function listPhotoKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key && key.startsWith(PHOTO_PREFIX)) keys.push(key);
    }
  } catch {
    // Enumeration failed — treat as no keys.
  }
  keys.sort();
  return keys;
}

/** Newest persisted photo data URL, via the pointer first, then newest prefixed key. SSR-safe, never throws. */
function loadPersistedPhoto(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const pointer = window.localStorage.getItem(PHOTO_POINTER);
    if (pointer) {
      const direct = window.localStorage.getItem(pointer);
      if (direct && direct.startsWith('data:image')) return direct;
    }
    const keys = listPhotoKeys();
    for (let i = keys.length - 1; i >= 0; i -= 1) {
      const data = window.localStorage.getItem(keys[i]);
      if (data && data.startsWith('data:image')) return data;
    }
    return null;
  } catch {
    return null;
  }
}

function loadPersistedPhotoKey(): string | null {
  try {
    if (typeof window === 'undefined') return null;
    const pointer = window.localStorage.getItem(PHOTO_POINTER);
    if (pointer && pointer.startsWith(PHOTO_PREFIX)) return pointer;
    return null;
  } catch {
    return null;
  }
}

/** Best-effort save: on quota error drop the oldest photo key and retry once. Returns true on success. */
function savePhotoDataUrl(key: string, dataUrl: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(key, dataUrl);
    return true;
  } catch {
    try {
      const oldest = listPhotoKeys()[0];
      if (oldest) window.localStorage.removeItem(oldest);
      window.localStorage.setItem(key, dataUrl);
      return true;
    } catch {
      return false;
    }
  }
}

/** Downscale to a JPEG data URL (max 1280px, quality 0.82) so it fits localStorage. Never throws. */
function downscaleToDataUrl(file: File, maxDim = 1280, quality = 0.82): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      if (typeof window === 'undefined' || typeof document === 'undefined') {
        resolve(null);
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        try {
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
          const width = Math.max(1, Math.round((img.naturalWidth || maxDim) * scale));
          const height = Math.max(1, Math.round((img.naturalHeight || maxDim) * scale));
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(null);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function inr(value: number): string {
  try {
    return `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value)}`;
  } catch {
    return `₹${Math.round(value)}`;
  }
}

/** Pull a market entry for a crop out of an unknown-shaped snapshot (map, {prices}, or {quotes}). */
function snapshotEntryFor(snapshot: Record<string, unknown> | null | undefined, crop: string): Record<string, unknown> | null {
  if (!snapshot || typeof snapshot !== 'object') return null;
  const want = crop.trim().toLowerCase();
  if (!want) return null;
  const candidates: Array<Record<string, unknown>> = [];
  const prices = snapshot.prices;
  if (prices && typeof prices === 'object' && !Array.isArray(prices)) candidates.push(prices as Record<string, unknown>);
  candidates.push(snapshot);
  for (const table of candidates) {
    for (const key of Object.keys(table)) {
      if (key.toLowerCase() === want) {
        const entry = table[key];
        if (entry && typeof entry === 'object' && !Array.isArray(entry)) return entry as Record<string, unknown>;
        const direct = num(entry);
        if (direct !== null) return { modal_price: direct };
      }
    }
  }
  const quotes = (snapshot as { quotes?: unknown }).quotes;
  if (Array.isArray(quotes)) {
    for (const quote of quotes) {
      if (!quote || typeof quote !== 'object') continue;
      const row = quote as Record<string, unknown>;
      const name = text(row.crop ?? row.commodity ?? row.name);
      if (name && name.toLowerCase() === want) return row;
    }
  }
  return null;
}

interface ZoneMarket {
  priceLine: string | null;
  revenueLine: string | null;
}

function marketForZone(zone: MarketZone, snapshot: Record<string, unknown> | null | undefined): ZoneMarket {
  const entry = snapshotEntryFor(snapshot, zone.crop ?? '');
  const pick = (keys: string[]): unknown => {
    for (const key of keys) {
      const fromZone = (zone as unknown as Record<string, unknown>)[key];
      if (fromZone !== undefined && fromZone !== null && fromZone !== '') return fromZone;
    }
    if (entry) {
      for (const key of keys) {
        const fromEntry = entry[key];
        if (fromEntry !== undefined && fromEntry !== null && fromEntry !== '') return fromEntry;
      }
    }
    return undefined;
  };

  let priceLine: string | null = text(pick(['price_range']));
  if (!priceLine) {
    const min = num(pick(['price_min', 'min_price', 'min']));
    const max = num(pick(['price_max', 'max_price', 'max']));
    const modal = num(pick(['modal_price', 'price', 'modal']));
    const unit = text(pick(['price_unit', 'unit'])) ?? '₹/quintal';
    const suffix = unit.startsWith('₹') ? ` ${unit}` : ` ${unit}`;
    if (min !== null && max !== null) priceLine = `${inr(min)}–${inr(max)}${suffix}`;
    else if (min !== null) priceLine = `from ${inr(min)}${suffix}`;
    else if (max !== null) priceLine = `up to ${inr(max)}${suffix}`;
    else if (modal !== null) priceLine = `${inr(modal)}${suffix}`;
  }

  let revenueLine: string | null = text(pick(['revenue', 'revenue_line']));
  if (!revenueLine) {
    const estimate = pick(['revenue_estimate', 'revenue_min', 'estimated_revenue']);
    const estimateNum = num(estimate);
    if (estimateNum !== null) revenueLine = `Est. revenue ${inr(estimateNum)}`;
    else if (typeof estimate === 'string' && estimate.trim()) revenueLine = estimate.trim();
  }
  return { priceLine, revenueLine };
}

const ZONE_BADGE: Record<string, 'success' | 'warn' | 'default'> = {
  grow: 'success',
  consider: 'warn',
  rest: 'default',
};

export default function FieldAnalysisPage(): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [landSize, setLandSize] = useState<string>('');
  const [stateName, setStateName] = useState<string>('');
  const [district, setDistrict] = useState<string>('');
  const [plan, setPlan] = useState<StoredPlan | null>(loadStoredPlan);
  const [season, setSeason] = useState<Season>(() => {
    const stored = loadStoredPlan();
    return stored && isSeason(stored.season) ? stored.season : 'kharif';
  });
  const [goal, setGoal] = useState<Goal>(() => {
    const stored = loadStoredPlan();
    return stored && isGoal(stored.goal) ? stored.goal : 'yield';
  });
  const [error, setError] = useState<string>('');
  const [phase, setPhase] = useState<Phase>('idle');
  // Client-side photo: the file never leaves the browser except in the
  // ephemeral analysis POST body (never stored server-side). A downscaled
  // copy persists in localStorage so the overlay survives route changes
  // and hard reloads.
  const [previewUrl, setPreviewUrl] = useState<string | null>(loadPersistedPhoto);
  const [photoKey, setPhotoKey] = useState<string | null>(loadPersistedPhotoKey);
  const [vigorMapUrl, setVigorMapUrl] = useState<string | null>(null);
  const [surface3dUrl, setSurface3dUrl] = useState<string | null>(null);
  const [vigorStats, setVigorStats] = useState<VigorStats | null>(null);
  const [vigorGrid, setVigorGrid] = useState<number[][] | null>(null);
  const [vigorLoading, setVigorLoading] = useState<boolean>(false);
  const [vigorError, setVigorError] = useState<string>('');
  const [hoverPoint, setHoverPoint] = useState<{ x: number; y: number; v: number } | null>(null);
  const [selectedHotspot, setSelectedHotspot] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** Presentation-only: clear the file picker and revert the thumbnail to the persisted photo (if any). */
  function handleRemovePhoto(): void {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    setPreviewUrl(loadPersistedPhoto());
  }

  useEffect(() => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    let cancelled = false;
    void downscaleToDataUrl(file).then((dataUrl) => {
      if (cancelled || !dataUrl) return;
      try {
        const id = `${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        const key = `${PHOTO_PREFIX}${id}`;
        if (savePhotoDataUrl(key, dataUrl)) {
          try {
            window.localStorage.setItem(PHOTO_POINTER, key);
          } catch {
            // Pointer is best-effort; the keyed photo still restores via scan.
          }
          if (!cancelled) {
            setPhotoKey(key);
            setPreviewUrl(dataUrl);
          }
        }
      } catch {
        // Persistence is best-effort; the object-URL preview still renders.
      }
    });
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [file]);

  const loading = phase !== 'idle';
  const statusText = phase === 'detecting' ? 'Detecting zones…' : phase === 'planning' ? 'Planning crops…' : '';

  /** Fetch POST /ai/field-map with the selected photo. Never throws; failures surface as an amber notice. */
  async function runVigorMap(source: File | null, fallbackPreview: string | null): Promise<void> {
    let imageFile: File | null = source;
    if (!imageFile && fallbackPreview && fallbackPreview.startsWith('data:image')) {
      try {
        const response = await fetch(fallbackPreview);
        const blob = await response.blob();
        if (blob.size > 0) imageFile = new File([blob], 'field.jpg', { type: blob.type || 'image/jpeg' });
      } catch {
        imageFile = null;
      }
    }
    if (!imageFile) return;
    setVigorLoading(true);
    setVigorError('');
    try {
      const body = new FormData();
      body.append('image', imageFile);
      const mapped = await api<FieldMapResult>('/ai/field-map', { method: 'POST', body });
      if (typeof mapped?.vigor_map === 'string' && mapped.vigor_map) setVigorMapUrl(mapped.vigor_map);
      if (typeof mapped?.surface_3d === 'string' && mapped.surface_3d) setSurface3dUrl(mapped.surface_3d);
      setVigorGrid(validGrid(mapped?.grid));
      if (mapped?.stats && typeof mapped.stats === 'object') {
        setVigorStats({
          mean_vigor: typeof mapped.stats.mean_vigor === 'number' ? mapped.stats.mean_vigor : 0,
          stressed_pct: typeof mapped.stats.stressed_pct === 'number' ? mapped.stats.stressed_pct : 0,
          vigorous_pct: typeof mapped.stats.vigorous_pct === 'number' ? mapped.stats.vigorous_pct : 0,
        });
      }
    } catch (err: unknown) {
      setVigorError(err instanceof Error ? err.message : 'Vigor map is unavailable right now.');
    } finally {
      setVigorLoading(false);
    }
  }

  async function runPlan(): Promise<void> {
    if (!file || loading) return;
    setPhase('detecting');
    setError('');
    // Fire the vigor map in parallel — it never blocks the zone result.
    setVigorMapUrl(null);
    setSurface3dUrl(null);
    setVigorStats(null);
    setVigorGrid(null);
    setHoverPoint(null);
    setSelectedHotspot(null);
    void runVigorMap(file, null);
    try {
      const body = new FormData();
      body.append('image', file);
      body.append('analysis_mode', 'field_health_analysis');
      const diagnosed = await api<DiagnoseInsight>('/ai/diagnose', { method: 'POST', body });
      const regions = diagnosed?.result?.regions ?? diagnosed?.regions ?? [];
      if (!regions.length) throw new Error('No field zones were detected in this photo. Try a wider, well-lit view.');
      setPhase('planning');
      const payload: Record<string, unknown> = {
        regions: regions.map((r) => ({ label: r.label, confidence: r.confidence })),
        season,
        goal,
      };
      const acres = Number.parseFloat(landSize);
      if (Number.isFinite(acres) && acres > 0) payload.land_size = acres;
      if (stateName.trim()) payload.state = stateName.trim();
      if (district.trim()) payload.district = district.trim();
      const planned = await api<FieldPlanResult>('/ai/field-plan', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const stored: StoredPlan = {
        regions,
        zones: planned.zones,
        summary: planned.summary,
        enriched: planned.enriched,
        market_snapshot: planned.market_snapshot ?? null,
        season,
        goal,
        photoKey,
      };
      setPlan(stored);
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
      } catch {
        // Storage is best-effort; the result still renders this session.
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Field planning failed. Please try again.');
    } finally {
      setPhase('idle');
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void runPlan();
  }

  const planGoal: Goal = plan && isGoal(plan.goal) ? plan.goal : goal;
  const zoneMarkets: ZoneMarket[] = (plan?.zones ?? []).map((zone) => marketForZone(zone, plan?.market_snapshot));
  const hasAnyMarket =
    zoneMarkets.some((m) => m.priceLine !== null || m.revenueLine !== null) ||
    text((plan?.market_snapshot as { note?: unknown } | null)?.note) !== null;

  return (
    <main className="km-route-page bg-paper text-ink">
      <RouteHero
        eyebrow="FIELD INTELLIGENCE"
        title="One photo. A crop plan for every zone."
        description="Upload a single wide field photo. We detect zones, then map each one to a crop — grow this, consider that, or leave it fallow."
        imageSrc="/images/drone-crop-rows.jpg"
        imageAlt="Aerial view of organized crop rows"
        chip="Zone detection + per-zone crop plan"
        flip
      >
        <a href="#plan-form" className="inline-flex items-center rounded-full bg-lime px-6 py-3 text-sm font-bold text-deep">
          Plan this field →
        </a>
        <Link href="/farms" className="inline-flex items-center rounded-full border border-line bg-white px-6 py-3 text-sm font-bold text-ink">
          Open farm desk ↗
        </Link>
      </RouteHero>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        <RequireAuth>
          <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <Panel className="bg-cream/60">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">New field plan</p>
              <h2 className="mt-2 font-serif text-3xl font-bold tracking-tight">Add the wider view.</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">One wide, well-lit photo is enough — we handle zones and crops.</p>
              <form id="plan-form" className="mt-6 space-y-5" onSubmit={handleSubmit}>
                <div className="overflow-hidden rounded-2xl border border-line bg-cream">
                  {previewUrl ? (
                    <div>
                      <div className="relative">
                        {/* Object/data-URL preview is not optimizable via next/image. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={previewUrl} alt="Selected field photo preview" className="h-40 w-full object-cover" />
                        <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-deep px-3 py-1 text-[11px] font-bold uppercase tracking-wide text-lime">
                          Preview
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3 px-4 py-3">
                        <p className="min-w-0 truncate text-xs font-semibold text-ink">{file ? file.name : 'Saved field photo'}</p>
                        <div className="flex shrink-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-ink transition hover:bg-mist focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                          >
                            Change
                          </button>
                          <button
                            type="button"
                            onClick={handleRemovePhoto}
                            className="rounded-full border border-line bg-white px-3 py-1.5 text-xs font-bold text-muted transition hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="px-4 py-6 text-center">
                      <span aria-hidden="true" className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-deep text-lg text-lime">
                        ✳
                      </span>
                      <strong className="mt-3 block text-sm font-bold">Choose a wide field image</strong>
                      <p className="mt-1 text-xs text-muted">Use a clear landscape or drone view · JPEG, PNG or WebP</p>
                    </div>
                  )}
                  <div className="border-t border-line bg-white/70 px-4 py-3">
                    <input
                      ref={fileInputRef}
                      required
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                      className="w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-deep file:px-4 file:py-2 file:text-xs file:font-bold file:text-lime focus-visible:outline-2 focus-visible:outline-green"
                      aria-label="Choose a field image"
                    />
                    {file ? <p className="mt-2 text-xs text-ink">Selected: {file.name}</p> : null}
                  </div>
                </div>
                <fieldset>
                  <legend className="text-sm font-semibold text-ink">Season</legend>
                  <div role="radiogroup" aria-label="Season" className="mt-1.5 grid grid-cols-3 gap-1 rounded-2xl border border-line bg-mist p-1">
                    {SEASONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={season === option.value}
                        onClick={() => setSeason(option.value)}
                        className={`rounded-xl px-3 py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green ${
                          season === option.value ? 'bg-deep text-lime shadow' : 'text-muted hover:bg-white hover:text-ink'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset>
                  <legend className="text-sm font-semibold text-ink">Goal</legend>
                  <div role="radiogroup" aria-label="Planning goal" className="mt-1.5 grid grid-cols-2 gap-1 rounded-2xl border border-line bg-mist p-1">
                    {GOALS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={goal === option.value}
                        onClick={() => setGoal(option.value)}
                        className={`rounded-xl px-3 py-2 text-sm font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green ${
                          goal === option.value ? 'bg-deep text-lime shadow' : 'text-muted hover:bg-white hover:text-ink'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Acres" htmlFor="field-plan-acres">
                    <input id="field-plan-acres" inputMode="decimal" value={landSize} onChange={(e) => setLandSize(e.target.value)} placeholder="2.5" className={controlClassName} />
                  </Field>
                  <Field label="State" htmlFor="field-plan-state">
                    <input id="field-plan-state" value={stateName} onChange={(e) => setStateName(e.target.value)} placeholder="Punjab" className={controlClassName} />
                  </Field>
                  <Field label="District" htmlFor="field-plan-district">
                    <input id="field-plan-district" value={district} onChange={(e) => setDistrict(e.target.value)} placeholder="Ludhiana" className={controlClassName} />
                  </Field>
                </div>
                <Button
                  type="submit"
                  variant="dark"
                  disabled={!file || loading}
                  aria-busy={loading}
                  className="w-full bg-deep py-3.5 text-[15px] shadow-lg shadow-deep/20 transition hover:-translate-y-px"
                >
                  {loading ? (
                    <span className="inline-flex items-center gap-2">
                      <span aria-hidden="true" className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-lime border-t-transparent" />
                      Scanning field…
                    </span>
                  ) : (
                    'Detect zones & plan crops'
                  )}
                </Button>
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
                  <span aria-hidden="true">🔒</span>
                  <span>Photos stay on this device only — analysed in memory, never stored on our servers.</span>
                </p>
              </form>
            </Panel>

            <div aria-live="polite">
              {loading ? (
                <Panel>
                  <Badge tone="info">{statusText || 'Working…'}</Badge>
                  <h2 className="mt-3 font-serif text-2xl font-bold">{statusText || 'Working…'}</h2>
                  <Skeleton className="mt-4 h-48 w-full" />
                  <div className="mt-3 h-4 w-full animate-pulse rounded bg-mist" />
                  <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-mist" />
                </Panel>
              ) : error ? (
                <ErrorCard message={error} onRetry={() => void runPlan()} retryLabel="Retry plan" />
              ) : plan ? (
                <div className="space-y-6">
                  <Panel>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={plan.enriched ? 'success' : 'warn'}>{plan.enriched ? 'crop plan' : 'LLM enrichment pending'}</Badge>
                      <Badge tone="info">{plan.zones.length} {plan.zones.length === 1 ? 'zone' : 'zones'}</Badge>
                      {isSeason(plan.season) ? <Badge tone="default">{plan.season}</Badge> : null}
                      {isGoal(plan.goal) ? <Badge tone="default">{plan.goal === 'money' ? 'max income' : 'max yield'}</Badge> : null}
                    </div>
                    <h2 className="mt-3 font-serif text-2xl font-bold">Your zone-by-zone crop plan</h2>
                    <p className="mt-2 text-sm leading-relaxed text-ink">{plan.summary}</p>
                    {!plan.enriched ? (
                      <div className="mt-3">
                        <Notice tone="info">LLM enrichment pending — zones render with neutral colors. Confirm with a local agronomist before sowing.</Notice>
                      </div>
                    ) : null}
                    {planGoal === 'money' && !hasAnyMarket ? (
                      <div className="mt-3">
                        <Notice tone="info">Live prices unavailable — showing the agronomic ranking for now. Try again later for per-zone rates.</Notice>
                      </div>
                    ) : null}
                    {previewUrl ? (
                      <div className="mt-4">
                        <ZoneOverlay
                          imageUrl={previewUrl}
                          imageAlt="Uploaded field photo with planned crop zones"
                          regions={plan.regions}
                          zones={plan.zones}
                        />
                      </div>
                    ) : (
                      <div className="mt-4">
                        <Notice tone="info">Choose the same photo again to repaint the zone overlay.</Notice>
                      </div>
                    )}
                  </Panel>
                  <div className="grid gap-4 md:grid-cols-2">
                    {plan.zones.map((zone, index) => (
                      <Panel key={`${zone.region_label}-${index}`}>
                        <Badge tone={ZONE_BADGE[zone.color] ?? 'default'}>{zone.color}</Badge>
                        <h3 className="mt-2 text-lg font-bold">{zone.crop}</h3>
                        <p className="text-xs text-muted">Zone: {zone.region_label}{typeof plan.regions[index]?.confidence === 'number' ? ` · ${Math.round(plan.regions[index].confidence * 100)}% confidence` : ''}</p>
                        <p className="mt-2 text-sm leading-relaxed text-ink/85">{zone.reason}</p>
                        {planGoal === 'money' ? (
                          zoneMarkets[index]?.priceLine || zoneMarkets[index]?.revenueLine ? (
                            <div className="mt-3 rounded-xl border border-line bg-cream px-3 py-2 text-sm">
                              {zoneMarkets[index]?.priceLine ? (
                                <p className="font-bold text-ink">{zoneMarkets[index]?.priceLine}</p>
                              ) : null}
                              {zoneMarkets[index]?.revenueLine ? (
                                <p className="mt-0.5 text-ink/80">{zoneMarkets[index]?.revenueLine}</p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="mt-3 text-xs text-muted">Live prices unavailable for this crop.</p>
                          )
                        ) : null}
                      </Panel>
                    ))}
                  </div>
                  <VigorMap
                    photoUrl={previewUrl}
                    vigorMapUrl={vigorMapUrl}
                    surface3dUrl={surface3dUrl}
                    stats={vigorStats}
                    loading={vigorLoading}
                    grid={vigorGrid}
                    hoverPoint={hoverPoint}
                    onHoverPoint={setHoverPoint}
                    selectedHotspot={selectedHotspot}
                    onHotspotSelect={(_, index) => setSelectedHotspot(index)}
                  />
                  {vigorError && !vigorMapUrl && !surface3dUrl && !vigorLoading ? (
                    <Notice tone="error">
                      Vigor map needs another moment — {vigorError}{' '}
                      <button
                        type="button"
                        onClick={() => void runVigorMap(file, previewUrl)}
                        className="font-bold underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                      >
                        Retry vigor map
                      </button>
                    </Notice>
                  ) : null}
                  {!vigorMapUrl && !surface3dUrl && !vigorLoading && !vigorError && (file || previewUrl) ? (
                    <Button variant="secondary" onClick={() => void runVigorMap(file, previewUrl)} disabled={vigorLoading}>
                      Generate vigor map
                    </Button>
                  ) : null}
                  <div className="flex flex-wrap gap-3">
                    <Button variant="secondary" onClick={() => void runPlan()} disabled={!file || loading}>
                      Retry plan
                    </Button>
                    <Link href="/crop-doctor" className="inline-flex items-center justify-center rounded-full border border-line bg-white px-5 py-3 text-sm font-bold text-ink">
                      Need a leaf close-up? Try the crop doctor →
                    </Link>
                    <Link href="/advisor" className="inline-flex items-center justify-center rounded-full border border-line bg-white px-5 py-3 text-sm font-bold text-ink">
                      Cost it out in the advisor →
                    </Link>
                  </div>
                </div>
              ) : (
                <EmptyState
                  title="Your crop plan will appear here."
                  description="Upload one wide field photo — we detect zones first, then plan a crop for each."
                />
              )}
            </div>
          </div>
        </RequireAuth>
      </section>
    </main>
  );
}
