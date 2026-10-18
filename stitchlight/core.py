from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter, ImageOps
from scipy import ndimage

MM = 10  # embroidery units are 0.1 mm


def _load(img, size):
    im = img if isinstance(img, Image.Image) else Image.open(img)
    return ImageOps.fit(im.convert("RGB"), size, Image.LANCZOS)


def double_exposure(portrait, scene, size=(600, 600), mode="screen", threshold=0.55,
                    feather=6.0, scene_strength=0.9):
    """Silhouette-masked double exposure.

    The portrait's light background becomes the mask boundary: the scene shows
    through the dark figure (classic in-camera double exposure where the
    subject is underexposed against a bright sky)."""
    p = np.asarray(_load(portrait, size), dtype=np.float32) / 255.0
    s = np.asarray(_load(scene, size), dtype=np.float32) / 255.0
    lum = p @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    figure = (lum < threshold).astype(np.float32)
    figure = ndimage.binary_fill_holes(ndimage.binary_opening(figure > 0, iterations=2)).astype(np.float32)
    if feather > 0:
        figure = ndimage.gaussian_filter(figure, feather)
    m = figure[..., None] * scene_strength
    if mode == "screen":
        blend = 1 - (1 - p) * (1 - s)
    elif mode == "multiply":
        blend = p * s
    elif mode == "lighten":
        blend = np.maximum(p, s)
    else:
        raise ValueError(f"unknown mode {mode}")
    inside = blend * (1 - m) + s * m * 0.35 + blend * m * 0.65
    out = p * (1 - figure[..., None]) + inside * figure[..., None]
    # background goes to paper white so it is NOT stitched
    out = out * figure[..., None] + (1 - figure[..., None]) * np.maximum(out, 0.96)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)), figure


def quantize(img, colors=6, min_region_px=40, background_cutoff=0.93):
    """Reduce to a thread palette. Returns (label map, palette RGB uint8). Label -1 = unstitched fabric."""
    im = img.filter(ImageFilter.MedianFilter(5))
    q = im.quantize(colors=colors + 1, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    pal = np.array(q.getpalette()[: 3 * (colors + 1)], dtype=np.uint8).reshape(-1, 3)
    lab = np.asarray(q, dtype=np.int32)
    bright = (pal.astype(np.float32).mean(axis=1) / 255.0) >= background_cutoff
    lab = np.where(bright[lab], -1, lab)
    for c in range(len(pal)):  # drop specks a needle cannot render
        regions, n = ndimage.label(lab == c)
        if n:
            sizes = ndimage.sum(np.ones_like(regions), regions, range(1, n + 1))
            for i, sz in enumerate(sizes, 1):
                if sz < min_region_px:
                    lab[regions == i] = -1
    used = [c for c in range(len(pal)) if (lab == c).any()]
    # darkest last: light fills first, dark detail sits on top (standard digitizing order)
    used.sort(key=lambda c: -int(pal[c].astype(int).sum()))
    remap = {c: i for i, c in enumerate(used)}
    out = np.full_like(lab, -1)
    for c, i in remap.items():
        out[lab == c] = i
    return out, pal[used]


@dataclass
class Plan:
    width_mm: float
    height_mm: float
    palette: list
    blocks: list = field(default_factory=list)  # [(color_index, [(x_mm, y_mm), ...])]

    @property
    def stitch_count(self):
        return sum(len(b[1]) for b in self.blocks)

    def summary(self):
        return {"width_mm": round(self.width_mm, 1), "height_mm": round(self.height_mm, 1),
                "colors": len(self.palette), "stitches": self.stitch_count,
                "palette_hex": ["#%02x%02x%02x" % tuple(int(v) for v in c) for c in self.palette]}


def plan_stitches(labels, palette, width_mm=100.0, row_mm=0.45, max_stitch_mm=4.0, angle_deg=0.0):
    """Tatami-style fill: per color, scanline rows `row_mm` apart, each run split into
    stitches <= max_stitch_mm, rows serpentine, row offset staggered to avoid a visible seam."""
    h, w = labels.shape
    scale = width_mm / w
    height_mm = h * scale
    plan = Plan(width_mm, height_mm, [tuple(int(v) for v in c) for c in palette])
    rot = ndimage.rotate if angle_deg else None
    for ci in range(len(palette)):
        mask = labels == ci
        if rot:
            mask = rot(mask.astype(np.uint8), angle_deg, reshape=False, order=0) > 0
        pts = []
        step_px = max(1, int(round(row_mm / scale)))
        for ri, y in enumerate(range(0, h, step_px)):
            row = mask[y]
            if not row.any():
                continue
            edges = np.flatnonzero(np.diff(np.concatenate([[0], row.astype(np.int8), [0]])))
            runs = list(zip(edges[::2], edges[1::2] - 1))
            if ri % 2:
                runs = [(b, a) for a, b in reversed(runs)]
            stagger = (ri % 3) / 3.0
            for a, b in runs:
                length = abs(b - a) * scale
                n = max(1, int(np.ceil(length * 4 / 3 / max_stitch_mm)))  # headroom for stagger
                xs = np.linspace(a, b, n + 1)
                if n > 1:
                    xs[1:-1] += np.sign(b - a) * stagger * (abs(b - a) / n) * 0.5
                pts.extend((float(x) * scale, y * scale) for x in xs)
        if pts:
            plan.blocks.append((ci, pts))
    return plan


def export_embroidery(plan, path):
    """Write any pyembroidery-supported machine format by extension (.dst .pes .exp .jef .vp3 ...)."""
    import pyembroidery as pe

    pattern = pe.EmbPattern()
    for ci, pts in plan.blocks:
        r, g, b = plan.palette[ci]
        pattern.add_thread(pe.EmbThread((r << 16) | (g << 8) | b))
    for k, (ci, pts) in enumerate(plan.blocks):
        if k:
            pattern.color_change()
        x0, y0 = pts[0]
        pattern.add_stitch_absolute(pe.JUMP, x0 * MM, y0 * MM)
        for x, y in pts:
            pattern.add_stitch_absolute(pe.STITCH, x * MM, y * MM)
        pattern.trim()
    pattern.end()
    pe.write(pattern, str(path), {"long_stitch_contingency": pe.CONTINGENCY_LONG_STITCH_SEW_TO})
    return path


def export_svg(labels, palette, path, width_mm=100.0, mode="regions"):
    """SVG in millimetres. mode=regions: filled color regions (print / vinyl / applique cut).
    mode=paths: per-color contour outlines only (laser / CNC drag-knife / pen plotter)."""
    from skimage import measure

    h, w = labels.shape
    s = width_mm / w
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width_mm:.2f}mm" height="{h*s:.2f}mm" '
           f'viewBox="0 0 {width_mm:.3f} {h*s:.3f}">']
    for ci, c in enumerate(palette):
        mask = np.pad(labels == ci, 1)
        if not mask.any():
            continue
        hexc = "#%02x%02x%02x" % tuple(int(v) for v in c)
        d = []
        for cont in measure.find_contours(mask.astype(float), 0.5):
            cont = measure.approximate_polygon(cont, tolerance=0.8)
            if len(cont) < 3:
                continue
            d.append("M" + "L".join(f"{(x-1)*s:.2f},{(y-1)*s:.2f}" for y, x in cont) + "Z")
        if not d:
            continue
        if mode == "regions":
            out.append(f'<path id="thread-{ci}" fill="{hexc}" fill-rule="evenodd" d="{" ".join(d)}"/>')
        else:
            out.append(f'<path id="cut-{ci}" fill="none" stroke="{hexc}" stroke-width="0.1" d="{" ".join(d)}"/>')
    out.append("</svg>")
    Path(path).write_text("\n".join(out))
    return path


def preview(plan, path, px_per_mm=6, fabric=(244, 240, 232)):
    from PIL import ImageDraw

    W, H = int(plan.width_mm * px_per_mm) + 2, int(plan.height_mm * px_per_mm) + 2
    im = Image.new("RGB", (W, H), fabric)
    d = ImageDraw.Draw(im)
    for ci, pts in plan.blocks:
        col = plan.palette[ci]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if abs(y1 - y0) > 1.0:  # row change inside a block is a travel, draw thin
                continue
            d.line([(x0 * px_per_mm, y0 * px_per_mm), (x1 * px_per_mm, y1 * px_per_mm)], fill=col, width=2)
    im.save(path)
    return path


def run(portrait, scene, outdir, colors=6, width_mm=100.0, **kw):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    blend, _ = double_exposure(portrait, scene, **kw)
    blend.save(out / "double_exposure.png")
    labels, pal = quantize(blend, colors=colors)
    plan = plan_stitches(labels, pal, width_mm=width_mm)
    for ext in ("dst", "pes", "exp", "jef"):
        export_embroidery(plan, out / f"design.{ext}")
    export_svg(labels, pal, out / "print_regions.svg", width_mm)
    export_svg(labels, pal, out / "cnc_paths.svg", width_mm, mode="paths")
    preview(plan, out / "stitch_preview.png")
    summary = plan.summary()
    (out / "summary.json").write_text(json.dumps(summary, indent=2))
    return summary
