'use client';

import { useId } from 'react';

export interface PlanRegion {
  x: number;
  y: number;
  width: number;
  height: number;
  label: string;
  confidence: number;
}

export type ZoneColor = 'grow' | 'consider' | 'rest';

export interface PlanZone {
  region_label: string;
  crop: string;
  color: ZoneColor;
  reason: string;
}

interface ZoneOverlayProps {
  imageUrl: string;
  imageAlt: string;
  regions: PlanRegion[];
  zones: PlanZone[];
}

const ZONE_STYLE: Record<ZoneColor, { fill: string; stroke: string }> = {
  grow: { fill: 'rgba(34, 197, 94, 0.25)', stroke: '#16a34a' },
  consider: { fill: 'rgba(245, 158, 11, 0.25)', stroke: '#d97706' },
  rest: { fill: 'rgba(100, 116, 139, 0.25)', stroke: '#475569' },
};

const COLOR_LABEL: Record<ZoneColor, string> = {
  grow: 'Grow',
  consider: 'Consider',
  rest: 'Rest',
};

function zoneColorOf(zone: PlanZone | null): ZoneColor {
  if (zone?.color === 'grow' || zone?.color === 'consider' || zone?.color === 'rest') return zone.color;
  return 'rest';
}

/** SVG heatmap overlay + HTML label chips: each zone box keeps its crop color; chips read crop + confidence. */
export default function ZoneOverlay({ imageUrl, imageAlt, regions, zones }: ZoneOverlayProps): React.JSX.Element {
  const titleId = useId();
  const legendId = useId();
  const boxes = (regions ?? []).filter(
    (r) => r.width > 0 && r.height > 0 && Number.isFinite(r.x + r.y + r.width + r.height),
  );
  function zoneFor(index: number, label: string): PlanZone | null {
    const byIndex = zones?.[index];
    if (byIndex) return byIndex;
    return zones?.find((z) => z.region_label === label) ?? null;
  }

  // Dynamic legend: color -> unique crop names from the actual plan zones.
  const cropsByColor = new Map<ZoneColor, string[]>();
  for (const zone of zones ?? []) {
    const color = zoneColorOf(zone);
    const list = cropsByColor.get(color) ?? [];
    const name = (zone.crop ?? '').trim();
    if (name && !list.includes(name)) list.push(name);
    cropsByColor.set(color, list);
  }
  const legendColors = (['grow', 'consider', 'rest'] as const).filter(
    (color) => (cropsByColor.get(color) ?? []).length > 0,
  );
  const showStaticLegend = legendColors.length === 0;

  return (
    <figure aria-labelledby={titleId} className="overflow-hidden rounded-2xl border border-line bg-deep">
      <div className="relative w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={imageUrl} alt={imageAlt} className="block max-h-[420px] w-full bg-deep object-contain" />
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={`${boxes.length} planned ${boxes.length === 1 ? 'zone' : 'zones'} marked`}
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {boxes.map((region, index) => {
            const zone = zoneFor(index, region.label);
            const color = zoneColorOf(zone);
            const style = ZONE_STYLE[color];
            return (
              <rect
                key={`${region.label}-${index}`}
                x={region.x * 100}
                y={region.y * 100}
                width={Math.max(region.width * 100, 1.5)}
                height={Math.max(region.height * 100, 1.5)}
                fill={style.fill}
                stroke={style.stroke}
                strokeWidth={0.8}
                vectorEffect="non-scaling-stroke"
                rx={1}
              />
            );
          })}
        </svg>
        {/* HTML chips (aria-hidden; the SVG + figcaption already describe the zones). */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          {boxes.map((region, index) => {
            const zone = zoneFor(index, region.label);
            const color = zoneColorOf(zone);
            const style = ZONE_STYLE[color];
            const pct = Number.isFinite(region.confidence) ? Math.round(region.confidence * 100) : null;
            const label = zone?.crop?.trim() ? zone.crop.trim() : region.label;
            return (
              <span
                key={`chip-${region.label}-${index}`}
                className="absolute inline-flex max-w-[70%] items-center gap-1 truncate rounded-full px-2.5 py-1 text-xs font-bold text-white shadow-md backdrop-blur-sm"
                style={{
                  left: `${Math.min(Math.max(region.x * 100, 1), 72)}%`,
                  top: `${Math.max(region.y * 100, 1)}%`,
                  transform: 'translateY(-100%) translateY(-4px)',
                  backgroundColor: 'rgba(10, 20, 8, 0.78)',
                  border: `2px solid ${style.stroke}`,
                }}
              >
                <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: style.stroke }} />
                <span className="truncate">
                  {label}
                  {pct !== null ? ` · ${pct}%` : ''}
                </span>
              </span>
            );
          })}
        </div>
      </div>
      <figcaption id={titleId} className="px-4 py-2 text-xs text-white/80">
        {boxes.length === 0
          ? 'No zones detected yet.'
          : `${boxes.length} planned ${boxes.length === 1 ? 'zone' : 'zones'} marked on your photo.`}
      </figcaption>
      <div aria-labelledby={legendId} className="flex flex-wrap gap-2 border-t border-white/10 px-4 py-2">
        <span id={legendId} className="sr-only">Zone legend: color to crop</span>
        {showStaticLegend ? (
          <>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: ZONE_STYLE.grow.fill, border: `2px solid ${ZONE_STYLE.grow.stroke}` }} />
              Grow this
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: ZONE_STYLE.consider.fill, border: `2px solid ${ZONE_STYLE.consider.stroke}` }} />
              Consider
            </span>
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
              <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: ZONE_STYLE.rest.fill, border: `2px solid ${ZONE_STYLE.rest.stroke}` }} />
              Leave fallow / expert
            </span>
          </>
        ) : (
          legendColors.map((color) => (
            <span key={color} className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-white/85">
              <span
                aria-hidden="true"
                className="inline-block h-3 w-3 rounded-sm"
                style={{ backgroundColor: ZONE_STYLE[color].fill, border: `2px solid ${ZONE_STYLE[color].stroke}` }}
              />
              {COLOR_LABEL[color]}: {(cropsByColor.get(color) ?? []).join(', ')}
            </span>
          ))
        )}
      </div>
    </figure>
  );
}
