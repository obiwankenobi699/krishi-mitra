'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import { Skeleton } from '@/components/ui';
import { findHotspots, type Hotspot, type VigorGrid } from '@/lib/canopy';
import type { HoverPoint } from '@/components/Canopy3D';

const Canopy3D = dynamic(() => import('@/components/Canopy3D'), {
  ssr: false,
  loading: () => <Skeleton className="aspect-[16/10] w-full rounded-3xl" />,
});

export interface VigorStats {
  mean_vigor: number;
  stressed_pct: number;
  vigorous_pct: number;
}

interface VigorMapProps {
  photoUrl: string | null;
  vigorMapUrl: string | null;
  surface3dUrl: string | null;
  stats: VigorStats | null;
  loading?: boolean;
  grid?: VigorGrid | null;
  hoverPoint?: HoverPoint | null;
  onHoverPoint?: (point: HoverPoint | null) => void;
  selectedHotspot?: number | null;
  onHotspotSelect?: (hotspot: Hotspot | null, index: number | null) => void;
}

type ViewMode = 'photo' | 'vigor' | 'split';
type TextureMode = 'vigor' | 'photo';

const MODES: Array<{ value: ViewMode; label: string }> = [
  { value: 'photo', label: 'Photo' },
  { value: 'vigor', label: 'Vigor' },
  { value: 'split', label: 'Split' },
];

function pct(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function hasWebGL(): boolean {
  try {
    if (typeof document === 'undefined') return false;
    const canvas = document.createElement('canvas');
    return !!(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Vegetation vigor overlay + interactive 3D canopy surface. */
export default function VigorMap({
  photoUrl,
  vigorMapUrl,
  surface3dUrl,
  stats,
  loading = false,
  grid = null,
  hoverPoint = null,
  onHoverPoint,
  selectedHotspot = null,
  onHotspotSelect,
}: VigorMapProps): React.JSX.Element | null {
  const [mode, setMode] = useState<ViewMode>('vigor');
  const [textureMode, setTextureMode] = useState<TextureMode>('vigor');
  const [heightScale, setHeightScale] = useState<number>(1);
  const [webGL] = useState<boolean>(hasWebGL);

  const hotspots = useMemo(() => (grid ? findHotspots(grid) : []), [grid]);
  const selectedSpot = selectedHotspot != null ? hotspots[selectedHotspot] ?? null : null;

  if (loading && !vigorMapUrl && !surface3dUrl) {
    return (
      <section aria-label="Field pulse vigor map" aria-busy="true" className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
        <div className="p-5">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Field pulse</p>
          <p className="mt-1 font-serif text-2xl font-bold text-ink" role="status">
            Reading variation…
          </p>
          <Skeleton className="mt-4 h-64 w-full" />
          <div className="mt-3 h-4 w-2/3 animate-pulse rounded bg-mist" />
        </div>
      </section>
    );
  }

  if (!vigorMapUrl && !surface3dUrl) return null;

  const stressed = pct(stats?.stressed_pct);
  const vigorous = pct(stats?.vigorous_pct);
  const mean = pct(stats?.mean_vigor);
  const moderate = stressed !== null && vigorous !== null ? Math.max(0, 100 - stressed - vigorous) : null;
  const baseSrc = photoUrl ?? vigorMapUrl ?? '';

  function handleFigureHover(event: React.MouseEvent<HTMLDivElement>): void {
    if (!onHoverPoint) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    onHoverPoint({
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
      v: 0.5,
    });
  }

  return (
    <section aria-label="Field pulse vigor map" className="space-y-4">
      {vigorMapUrl ? (
        <figure className="relative overflow-hidden rounded-2xl border border-line bg-deep shadow-sm">
          <div role="radiogroup" aria-label="Vigor map view" className="absolute left-3 top-3 z-10 flex gap-1 rounded-full bg-ink/70 p-1 backdrop-blur-sm">
            {MODES.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={mode === option.value}
                onClick={() => setMode(option.value)}
                className={`rounded-full px-3 py-1 text-xs font-bold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                  mode === option.value ? 'bg-lime text-deep' : 'text-white/80 hover:text-white'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === 'split' ? (
            <div className="grid grid-cols-2">
              <div className="relative overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={baseSrc} alt="Original field photo, left half of split vigor comparison" className="block h-72 w-full object-cover sm:h-96" />
                <span aria-hidden="true" className="absolute left-2 top-12 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-bold text-white">
                  Photo
                </span>
              </div>
              <div className="relative overflow-hidden border-l border-white/20">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={vigorMapUrl} alt="Vegetation vigor heatmap overlay, right half of split comparison" className="block h-72 w-full object-cover sm:h-96" />
                <span aria-hidden="true" className="absolute right-2 top-12 rounded-full bg-ink/70 px-2 py-0.5 text-[11px] font-bold text-white">
                  Vigor
                </span>
              </div>
            </div>
          ) : mode === 'photo' ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={baseSrc} alt="Original field photo without vigor overlay" className="block h-72 w-full object-cover sm:h-96" />
          ) : (
            <div
              className="relative"
              onMouseMove={handleFigureHover}
              onMouseLeave={() => onHoverPoint?.(null)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={baseSrc} alt="Field photo with vegetation vigor heatmap overlay" className="block h-72 w-full object-cover sm:h-96" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={vigorMapUrl}
                alt=""
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 h-full w-full object-cover"
                style={{ opacity: 0.85 }}
              />
              {hoverPoint ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-lime shadow-[0_0_0_3px_rgba(0,0,0,0.45)]"
                  style={{ left: `${hoverPoint.x * 100}%`, top: `${hoverPoint.y * 100}%` }}
                />
              ) : null}
              {selectedSpot ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-lime bg-deep/70 text-sm font-bold text-lime"
                  style={{ left: `${selectedSpot.x * 100}%`, top: `${selectedSpot.y * 100}%` }}
                >
                  !
                </span>
              ) : null}
            </div>
          )}

          <div className="absolute bottom-4 left-4 max-w-xs rounded-2xl border border-line bg-white/95 p-4 shadow-lg backdrop-blur-sm">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-muted">Field pulse</p>
            <p className="mt-1 font-serif text-2xl font-bold leading-tight text-ink">See variation early.</p>
            {mean !== null ? <p className="mt-1 text-xs text-muted">Mean vigor {(mean * 100).toFixed(0)} / 100</p> : null}
          </div>
          {loading ? (
            <p role="status" className="absolute bottom-4 right-4 rounded-full bg-ink/70 px-3 py-1 text-xs font-bold text-white">
              Refreshing…
            </p>
          ) : null}
        </figure>
      ) : null}

      {vigorMapUrl ? (
        <div aria-label="Vigor legend" className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-ink">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-red-500" />
            Stressed{stressed !== null ? ` · ${stressed.toFixed(0)}%` : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-ink">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-yellow-400" />
            Moderate{moderate !== null ? ` · ${moderate.toFixed(0)}%` : ''}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1 text-xs font-bold text-ink">
            <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-green-500" />
            Vigorous{vigorous !== null ? ` · ${vigorous.toFixed(0)}%` : ''}
          </span>
        </div>
      ) : null}

      {grid && webGL ? (
        <figure className="overflow-hidden rounded-3xl border border-deep/40 bg-deep text-white shadow-lg">
          <div className="flex flex-wrap items-center gap-3 px-5 pt-4">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-[0.2em] text-lime">Canopy surface</p>
              <p className="font-serif text-xl font-bold">Walk the terrain.</p>
            </div>
            <div role="radiogroup" aria-label="3D texture" className="ml-auto flex gap-1 rounded-full bg-white/10 p-1">
              {(['vigor', 'photo'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={textureMode === option}
                  onClick={() => setTextureMode(option)}
                  className={`rounded-full px-3 py-1 text-xs font-bold capitalize transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-lime ${
                    textureMode === option ? 'bg-lime text-deep' : 'text-white/70 hover:text-white'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-white/70">
              Height
              <input
                type="range"
                min={0.3}
                max={2.5}
                step={0.1}
                value={heightScale}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setHeightScale(Number(event.target.value))}
                aria-label="Terrain height exaggeration"
                className="h-1 w-24 accent-lime"
              />
              <span className="w-8 tabular-nums">{heightScale.toFixed(1)}×</span>
            </label>
          </div>
          <div className="p-3 sm:p-4">
            <Canopy3D
              grid={grid}
              photoUrl={photoUrl}
              mode={textureMode}
              heightScale={heightScale}
              onHoverPoint={onHoverPoint}
              onHotspotSelect={(hotspot) => {
                if (!hotspot || !grid) {
                  onHotspotSelect?.(null, null);
                  return;
                }
                const idx = findHotspots(grid).findIndex(
                  (h) => Math.abs(h.x - hotspot.x) < 1e-9 && Math.abs(h.y - hotspot.y) < 1e-9,
                );
                onHotspotSelect?.(hotspot, idx >= 0 ? idx : null);
              }}
              selectedHotspot={selectedSpot ? hotspotsIndex(grid, selectedSpot) : null}
            />
          </div>
          <figcaption className="px-5 pb-4 text-sm text-white/70">
            Canopy surface — peaks flag vigorous growth, valleys need a look. Drag to orbit, scroll to zoom.
          </figcaption>
        </figure>
      ) : surface3dUrl ? (
        <figure className="overflow-hidden rounded-2xl border border-line bg-white shadow-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={surface3dUrl} alt="3D canopy surface render of the field showing growth peaks and valleys" className="block h-64 w-full object-cover sm:h-80" />
          <figcaption className="px-4 py-3 text-sm text-muted">Canopy surface — peaks flag vigorous growth, valleys need a look.</figcaption>
        </figure>
      ) : null}
    </section>
  );
}

function hotspotsIndex(grid: VigorGrid, spot: { x: number; y: number }): number | null {
  const list = findHotspots(grid);
  const idx = list.findIndex((h) => Math.abs(h.x - spot.x) < 1e-9 && Math.abs(h.y - spot.y) < 1e-9);
  return idx >= 0 ? idx : null;
}
