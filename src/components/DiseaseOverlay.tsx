'use client';

import { useId } from 'react';

export interface DiseaseRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
}

interface DiseaseOverlayProps {
  imageUrl: string;
  imageAlt: string;
  regions: DiseaseRegion[];
}

/** SVG overlay: normalized 0-1 region boxes drawn over the uploaded photo, with large label chips. */
export default function DiseaseOverlay({ imageUrl, imageAlt, regions }: DiseaseOverlayProps): React.JSX.Element {
  const titleId = useId();
  const boxes = (regions ?? []).filter(
    (r) => r.width > 0 && r.height > 0 && Number.isFinite(r.x + r.y + r.width + r.height),
  );
  return (
    <figure aria-labelledby={titleId} className="overflow-hidden rounded-2xl border border-line bg-deep">
      <div className="relative w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={imageAlt} className="block max-h-[420px] w-full object-contain bg-deep" />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${boxes.length} affected ${boxes.length === 1 ? 'area' : 'areas'} marked`}
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {boxes.map((region, index) => (
            <rect
              key={`${region.label}-${index}`}
              x={region.x * 100}
              y={region.y * 100}
              width={Math.max(region.width * 100, 1.5)}
              height={Math.max(region.height * 100, 1.5)}
              fill="rgba(190, 242, 100, 0.12)"
              stroke="#bef264"
              strokeWidth={0.8}
              vectorEffect="non-scaling-stroke"
              rx={1}
            />
          ))}
        </svg>
        {/* HTML chips sized to match ZoneOverlay (aria-hidden; SVG + figcaption describe the regions). */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {boxes.map((region, index) => {
            const pct = Number.isFinite(region.confidence) ? Math.round(region.confidence * 100) : null;
            return (
              <span
                key={`chip-${region.label}-${index}`}
                className="absolute inline-flex max-w-[70%] items-center gap-1 truncate rounded-full px-2.5 py-1 text-xs font-bold text-white shadow-md backdrop-blur-sm"
                style={{
                  left: `${Math.min(Math.max(region.x * 100, 1), 72)}%`,
                  top: `${Math.max(region.y * 100, 1)}%`,
                  transform: 'translateY(-100%) translateY(-4px)',
                  backgroundColor: 'rgba(10, 20, 8, 0.78)',
                  border: '2px solid #bef264',
                }}
              >
                <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: '#bef264' }} />
                <span className="truncate">
                  {region.label}
                  {pct !== null ? ` · ${pct}%` : ''}
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <figcaption id={titleId} className="px-4 py-2 text-xs text-white/80">
        {boxes.length === 0
          ? 'No affected areas marked.'
          : `${boxes.length} affected ${boxes.length === 1 ? 'area' : 'areas'} marked on your photo.`}
      </figcaption>
    </figure>
  );
}
