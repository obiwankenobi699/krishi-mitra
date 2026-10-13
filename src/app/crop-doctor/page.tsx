'use client';

import { useEffect, useState } from 'react';
import type * as React from 'react';
import Link from 'next/link';
import RequireAuth from '@/components/RequireAuth';
import { usePersistentState } from '@/components/usePersistentState';
import DiseaseOverlay, { type DiseaseRegion } from '@/components/DiseaseOverlay';
import { Badge, Button, EmptyState, ErrorCard, Field, Notice, Panel, RouteHero, controlClassName, severityTone } from '@/components/ui';
import { api } from '@/lib/api';

interface CropInsight {
  severity?: string | null;
  severity_score?: number | null;
  condition?: string | null;
  crop?: string | null;
  confidence?: number | null;
  summary?: string | null;
  insight?: string | null;
  observations?: string[] | null;
  recommended_actions?: string[] | null;
  regions?: DiseaseRegion[] | null;
}

interface DiagnoseResponse extends CropInsight {
  result?: CropInsight | null;
}

const PHOTO_PREFIX = 'km:crop-doctor:photo:';
const PHOTO_POINTER = 'km:crop-doctor:photo:current';

/** Matches the un-enriched detector placeholder line, e.g. "Detector diagnosis: X. LLM enrichment pending." */
const ROBOTIC_PATTERN = /detector diagnosis|llm enrichment pending/i;

function isRoboticLine(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim() !== '' && ROBOTIC_PATTERN.test(value);
}

function cleanText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
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

const photoTips = [
  { n: '01', title: 'Get close, stay sharp', body: 'Fill the frame with the affected leaf in natural daylight.' },
  { n: '02', title: 'Add a second angle', body: 'One close-up plus one wider field view improves accuracy.' },
  { n: '03', title: 'Saved privately', body: 'Every result lands in your diagnoses history automatically.' },
];

export default function CropDoctorPage(): React.JSX.Element {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<string>('disease_diagnosis');
  // Persisted across route changes; the photo File itself cannot persist.
  const [result, setResult] = usePersistentState<DiagnoseResponse | null>('km:crop-doctor-result', null);
  const [error, setError] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  // Client-side photo: the file never leaves the browser except in the
  // analysis POST body (ephemeral — never stored server-side). A downscaled
  // copy persists in localStorage so the overlay survives route changes
  // and hard reloads.
  const [previewUrl, setPreviewUrl] = useState<string | null>(loadPersistedPhoto);

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
          if (!cancelled) setPreviewUrl(dataUrl);
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

  async function analyze(): Promise<void> {
    if (!file || loading) return;
    setLoading(true);
    setError('');
    try {
      const body = new FormData();
      body.append('image', file);
      body.append('analysis_mode', mode);
      setResult(await api<DiagnoseResponse>('/ai/diagnose', { method: 'POST', body }));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void analyze();
  }

  const insight: CropInsight | null | undefined = result?.result || result;

  // Severity: a 0/missing score with no severity label is "unknown" — show
  // "Needs review" instead of a broken-looking "severity 0%".
  const severityLabel = cleanText(insight?.severity);
  const severityScore = typeof insight?.severity_score === 'number' && Number.isFinite(insight.severity_score) ? insight.severity_score : null;
  const hasKnownSeverity = severityLabel !== null;
  const hasScore = severityScore !== null && severityScore > 0;
  const needsReview = !hasKnownSeverity && !hasScore;

  // Hide the robotic detector placeholder whenever a real insight/summary
  // exists, so the panel never shows duplicate text blocks.
  const insightText = isRoboticLine(insight?.insight) ? null : cleanText(insight?.insight);
  const summaryText = isRoboticLine(insight?.summary) ? null : cleanText(insight?.summary);
  const hasRealInsight = insightText !== null || summaryText !== null;
  const observations = (insight?.observations ?? []).filter((item) =>
    hasRealInsight ? !isRoboticLine(item) : true,
  );
  const recommendedActions = insight?.recommended_actions ?? [];

  return (
    <main className="km-route-page bg-paper text-ink">
      <RouteHero
        eyebrow="LOCAL VISION"
        title="A crop doctor that starts with what you see."
        description="Upload a clear crop or field image. Krishi Mitra runs local vision analysis and saves the result to your private history."
        imageSrc="/images/hands-seedling-closeup.jpg"
        imageAlt="Farmer hands holding a young seedling in rich soil"
        chip="On-device vision · private history"
      >
        <Link
          href="/diagnoses"
          className="inline-flex items-center justify-center rounded-full bg-lime px-7 py-3.5 text-sm font-bold text-deep shadow-lg shadow-deep/20 transition hover:-translate-y-0.5 hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
        >
          View past analyses
        </Link>
      </RouteHero>

      <section className="mx-auto w-full max-w-6xl px-4 pb-16 pt-10 sm:px-6">
        <RequireAuth>
          <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
            <Panel>
              <h2 className="text-lg font-bold">New analysis</h2>
              <form onSubmit={handleSubmit} className="mt-4 space-y-4">
                <Field label="Analysis type" htmlFor="crop-doctor-mode">
                  <select
                    id="crop-doctor-mode"
                    value={mode}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setMode(e.target.value)}
                    className={controlClassName}
                  >
                    <option value="disease_diagnosis">Disease diagnosis</option>
                    <option value="crop_identification">Crop identification</option>
                    <option value="field_health_analysis">Field health analysis</option>
                  </select>
                </Field>
                <div className="rounded-xl border border-dashed border-line bg-cream px-4 py-5 text-center">
                  <strong className="block text-sm">Choose a clear image</strong>
                  <p className="mt-1 text-xs text-muted">JPEG, PNG or WebP · up to 10 MB</p>
                  <input
                    id="crop-doctor-image"
                    required
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFile(e.target.files?.[0] ?? null)}
                    className="mt-3 w-full text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-deep file:px-4 file:py-2 file:text-xs file:font-bold file:text-lime focus-visible:outline-2 focus-visible:outline-green"
                    aria-label="Choose a clear crop image"
                  />
                  {file && <p className="mt-2 text-xs text-ink">Selected: {file.name}</p>}
                </div>
                <Button type="submit" loading={loading} disabled={loading || !file} className="w-full">
                  Analyze image
                </Button>
                {error && !loading ? (
                  <Notice tone="info">Your photo stays on this device until the retry succeeds.</Notice>
                ) : null}
              </form>
            </Panel>
            <div aria-live="polite">
              {loading ? (
                <Panel>
                  <div className="h-6 w-32 animate-pulse rounded-full bg-mist" />
                  <div className="mt-3 h-8 w-2/3 animate-pulse rounded-xl bg-mist" />
                  <div className="mt-3 h-4 w-full animate-pulse rounded bg-mist" />
                  <div className="mt-2 h-4 w-5/6 animate-pulse rounded bg-mist" />
                  <div className="mt-2 h-4 w-4/6 animate-pulse rounded bg-mist" />
                  <p className="mt-4 text-sm text-muted">Reading the field with local vision models…</p>
                </Panel>
              ) : error ? (
                <ErrorCard message={error} onRetry={() => void analyze()} retryLabel="Retry analysis" />
              ) : result ? (
                <Panel>
                  <div className="flex flex-wrap items-center gap-2">
                    {needsReview ? (
                      <Badge tone="warn">Needs review</Badge>
                    ) : (
                      <Badge tone={severityTone(severityLabel ?? undefined)}>{severityLabel ?? 'severity'}</Badge>
                    )}
                    {hasScore && (
                      <Badge tone="info">severity {Math.round((severityScore ?? 0) * 100)}%</Badge>
                    )}
                    {typeof insight?.confidence === 'number' && (
                      <Badge tone="default">confidence {Math.round(insight.confidence * 100)}%</Badge>
                    )}
                  </div>
                  <h2 className="mt-3 font-serif text-2xl font-bold">{insight?.condition || insight?.crop || 'Crop analysis'}</h2>
                  {insight?.crop && insight?.condition && insight.crop !== insight.condition && (
                    <p className="mt-1 text-sm text-muted">Crop: {insight.crop}</p>
                  )}
                  {previewUrl ? (
                    <div className="mt-4">
                      <DiseaseOverlay
                        imageUrl={previewUrl}
                        imageAlt={`Uploaded photo analyzed as ${insight?.condition || 'crop'}`}
                        regions={insight?.regions ?? []}
                      />
                    </div>
                  ) : (
                    <Notice tone="info">Photo from previous session — re-upload photo to see overlay.</Notice>
                  )}
                  {insightText && (
                    <div className="mt-4 rounded-xl border border-green/30 bg-green/10 px-4 py-3">
                      <h3 className="text-sm font-bold text-green">Field insight</h3>
                      <p className="mt-1 text-sm leading-relaxed text-ink">{insightText}</p>
                    </div>
                  )}
                  {summaryText && <p className="mt-2 text-sm text-ink">{summaryText}</p>}
                  {observations.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-sm font-bold">What we observed</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                        {observations.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                  {recommendedActions.length > 0 && (
                    <div className="mt-4">
                      <h3 className="text-sm font-bold">Recommended next steps</h3>
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                        {recommendedActions.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </Panel>
              ) : (
                <EmptyState
                  title="Your result will appear here."
                  description="Use close, well-lit photos and include more than one angle when possible."
                  action={
                    <Link
                      href="/diagnoses"
                      className="inline-flex items-center justify-center rounded-full bg-deep px-5 py-3 text-sm font-bold text-lime transition hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    >
                      Browse past analyses
                    </Link>
                  }
                />
              )}
            </div>
          </div>
        </RequireAuth>
      </section>

      <section aria-label="Photography tips" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
        <div className="grid gap-4 rounded-3xl bg-deep p-6 text-white sm:p-10 md:grid-cols-3">
          {photoTips.map((tip) => (
            <div key={tip.n} className="rounded-2xl border border-white/15 bg-white/5 p-5">
              <p className="text-xs font-extrabold tracking-[0.22em] text-lime">{tip.n}</p>
              <h2 className="mt-2 font-serif text-xl font-bold">{tip.title}</h2>
              <p className="mt-1 text-sm text-white/75">{tip.body}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
