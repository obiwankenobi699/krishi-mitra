/**
 * Shared canopy helpers (client side).
 *
 * COLOR RAMP — must match services/fieldscout_ai/app/services/vigor_service.py::_rdylgn
 * exactly so the 3D terrain agrees with the 2D heatmap pixel-for-pixel:
 *   0.0 red    rgb(200, 40, 30)  stressed
 *   0.5 yellow rgb(240, 210, 60) moderate
 *   1.0 green  rgb(45, 140, 60)  vigorous
 */

export type VigorGrid = number[][];

export interface Hotspot {
  /** Normalized 0-1 centroid of the stressed cluster. */
  x: number;
  y: number;
  /** Share of map cells in this cluster (0-1). */
  size: number;
}

export function vigorColor(v: number): [number, number, number] {
  const x = Math.min(1, Math.max(0, v));
  let r: number;
  let g: number;
  let b: number;
  if (x < 0.5) {
    const t = x * 2;
    r = 200 + (240 - 200) * t;
    g = 40 + (210 - 40) * t;
    b = 30 + (60 - 30) * t;
  } else {
    const t = (x - 0.5) * 2;
    r = 240 + (45 - 240) * t;
    g = 210 + (140 - 210) * t;
    b = 60 + (60 - 60) * t;
  }
  return [r / 255, g / 255, b / 255];
}

export function vigorLabel(v: number): 'Stressed' | 'Moderate' | 'Vigorous' {
  if (v < 0.33) return 'Stressed';
  if (v > 0.66) return 'Vigorous';
  return 'Moderate';
}

/**
 * Top stressed clusters: 4-connected components of cells below `threshold`.
 * Returns up to `limit` hotspots sorted by cluster size (largest first).
 */
export function findHotspots(
  grid: VigorGrid,
  threshold = 0.3,
  limit = 3,
): Hotspot[] {
  const h = grid.length;
  if (h === 0) return [];
  const w = grid[0].length;
  const seen = new Uint8Array(h * w);
  const clusters: Array<{ sumX: number; sumY: number; n: number }> = [];
  const stack: Array<[number, number]> = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (seen[idx] || grid[y][x] >= threshold) continue;
      let sumX = 0;
      let sumY = 0;
      let n = 0;
      stack.push([x, y]);
      seen[idx] = 1;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop() as [number, number];
        sumX += cx + 0.5;
        sumY += cy + 0.5;
        n += 1;
        const neighbours: Array<[number, number]> = [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ];
        for (const [nx, ny] of neighbours) {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const ni = ny * w + nx;
          if (!seen[ni] && grid[ny][nx] < threshold) {
            seen[ni] = 1;
            stack.push([nx, ny]);
          }
        }
      }
      if (n >= 4) clusters.push({ sumX, sumY, n });
    }
  }
  return clusters
    .sort((a, b) => b.n - a.n)
    .slice(0, limit)
    .map((c) => ({
      x: c.sumX / c.n / w,
      y: c.sumY / c.n / h,
      size: c.n / (w * h),
    }));
}
