"""Visible-band vegetation vigor maps + 3D canopy surface (fully local).

True NDVI needs a near-infrared band that phone/drone RGB photos lack, so
this module computes VARI (Visible Atmospherically Resistant Index) from
plain RGB: VARI = (G - R) / (G + R - B). It tracks canopy vigor well
enough for stress scouting: red = stressed/bare, yellow = moderate,
green = vigorous.

Outputs (all in-memory, ephemeral like the rest of the vision path):
- vigor overlay PNG (heatmap blended over the photo),
- 3D surface PNG (matplotlib, terrain colormap),
- stats {mean_vigor 0-1, stressed_pct, vigorous_pct}.

numpy + Pillow + matplotlib only. No torch, no network.
"""

from __future__ import annotations

import base64
import io
import logging

import matplotlib

matplotlib.use("Agg")  # headless: never touch a display server

import matplotlib.pyplot as plt
import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

OVERLAY_MAX_SIDE = 800
SURFACE_GRID = 90


def _open_rgb(image_bytes: bytes, max_side: int) -> np.ndarray:
    with Image.open(io.BytesIO(image_bytes)) as img:
        rgb = img.convert("RGB")
        w, h = rgb.size
        scale = min(1.0, max_side / max(w, h))
        if scale < 1.0:
            rgb = rgb.resize((int(w * scale), int(h * scale)), Image.BILINEAR)
        return np.asarray(rgb, dtype=np.float32)


def _vari(rgb: np.ndarray) -> np.ndarray:
    """VARI in [-1, 1] per pixel."""
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    denom = g + r - b
    with np.errstate(divide="ignore", invalid="ignore"):
        v = np.where(np.abs(denom) < 1e-6, 0.0, (g - r) / denom)
    return np.clip(v, -1.0, 1.0).astype(np.float32)


def _rdylgn(vigor01: np.ndarray) -> np.ndarray:
    """Map 0-1 vigor to red-yellow-green RGB uint8 (matches the legend)."""
    x = np.clip(vigor01, 0.0, 1.0)
    # 0.0 red (200,40,30) -> 0.5 yellow (240,210,60) -> 1.0 green (45,140,60)
    r = np.where(x < 0.5, 200 + (240 - 200) * (x * 2), 240 + (45 - 240) * ((x - 0.5) * 2))
    g = np.where(x < 0.5, 40 + (210 - 40) * (x * 2), 210 + (140 - 210) * ((x - 0.5) * 2))
    b = np.where(x < 0.5, 30 + (60 - 30) * (x * 2), 60 + (60 - 60) * ((x - 0.5) * 2))
    return np.stack([r, g, b], axis=-1).astype(np.uint8)


def _to_data_url(png_bytes: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(png_bytes).decode("ascii")


def _stretch(vigor01: np.ndarray) -> np.ndarray:
    """Percentile stretch (2-98): spreads clustered field values across the
    full red-yellow-green range, like commercial vigor maps."""
    lo, hi = np.percentile(vigor01, [2.0, 98.0])
    if hi - lo < 1e-6:
        return np.full_like(vigor01, 0.5)
    return np.clip((vigor01 - lo) / (hi - lo), 0.0, 1.0).astype(np.float32)


def compute_vigor_map(image_bytes: bytes) -> dict:
    """Full pipeline: overlay + 3D surface + stats. Never raises fatally."""
    from scipy.ndimage import gaussian_filter

    rgb = _open_rgb(image_bytes, OVERLAY_MAX_SIDE)
    vigor = (_vari(rgb) + 1.0) / 2.0  # 0-1
    stretched = _stretch(vigor)

    heat = _rdylgn(stretched)
    blended = (0.45 * rgb + 0.55 * heat).astype(np.uint8)
    overlay_buf = io.BytesIO()
    Image.fromarray(blended).save(overlay_buf, format="PNG", optimize=True)

    # Downsampled + smoothed grid for the 3D surface.
    h, w = stretched.shape
    sy, sx = max(1, h // SURFACE_GRID), max(1, w // SURFACE_GRID)
    grid = stretched[: (h // sy) * sy, : (w // sx) * sx].reshape(
        h // sy, sy, w // sx, sx
    ).mean(axis=(1, 3))
    grid = gaussian_filter(grid, sigma=2.0)
    yy, xx = np.mgrid[0 : grid.shape[0], 0 : grid.shape[1]]
    fig = plt.figure(figsize=(7, 4.5), dpi=110, facecolor="white")
    ax = fig.add_subplot(111, projection="3d")
    ax.plot_surface(xx, yy, grid, cmap="gist_earth", linewidth=0, antialiased=True)
    ax.view_init(elev=22, azim=-55)
    ax.grid(True, color="#d9ddd4", linewidth=0.4)
    ax.set_axis_off()
    fig.tight_layout(pad=0.5)
    surf_buf = io.BytesIO()
    fig.savefig(surf_buf, format="PNG", bbox_inches="tight", pad_inches=0)
    plt.close(fig)

    mean_vigor = float(vigor.mean())
    stressed = float((stretched < 0.33).mean() * 100.0)
    vigorous = float((stretched > 0.66).mean() * 100.0)
    # 128x128 analysis grid for the interactive 3D client (rounded to keep
    # the payload small; same stretched values the heatmap and stats use).
    gh, gw = stretched.shape
    gy, gx = max(1, gh // 128), max(1, gw // 128)
    small = stretched[: (gh // gy) * gy, : (gw // gx) * gx].reshape(
        gh // gy, gy, gw // gx, gx
    ).mean(axis=(1, 3))
    small = gaussian_filter(small, sigma=2.0)
    smin, smax = float(small.min()), float(small.max())
    if smax - smin < 1e-6:
        grid = [[0.5] * 128 for _ in range(128)]
    else:
        grid = (np.clip((small - smin) / (smax - smin), 0.0, 1.0)).round(3).tolist()
        # Pad/trim to exactly 128x128.
        grid = [row[:128] + [row[-1]] * max(0, 128 - len(row)) for row in grid[:128]]
        while len(grid) < 128:
            grid.append(list(grid[-1]))
    logger.info(
        "vigor: mean=%.3f stressed=%.1f%% vigorous=%.1f%%",
        mean_vigor, stressed, vigorous,
    )
    return {
        "vigor_map": _to_data_url(overlay_buf.getvalue()),
        "surface_3d": _to_data_url(surf_buf.getvalue()),
        "grid": grid,
        "stats": {
            "mean_vigor": round(mean_vigor, 3),
            "stressed_pct": round(stressed, 1),
            "vigorous_pct": round(vigorous, 1),
        },
    }
