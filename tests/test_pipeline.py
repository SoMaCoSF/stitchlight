import json
import numpy as np
import pyembroidery as pe
from xml.etree import ElementTree as ET
from examples.make_fixtures import portrait, scene
from stitchlight import run, double_exposure, quantize, plan_stitches


def test_end_to_end(tmp_path):
    s = run(portrait(300), scene(300), tmp_path, colors=5, width_mm=80, size=(300, 300))
    assert 0 < s["colors"] <= 5 and s["stitches"] > 500
    for ext in ("dst", "pes", "exp", "jef"):
        p = pe.read(str(tmp_path / f"design.{ext}"))
        assert p is not None and len(p.stitches) > 500
        x0, y0, x1, y1 = p.bounds()
        assert (x1 - x0) <= 80 * 10 + 5  # 0.1 mm units, hoop-safe width
    dst = pe.read(str(tmp_path / "design.dst"))
    assert dst.count_color_changes() == s["colors"] - 1
    for name in ("print_regions.svg", "cnc_paths.svg"):
        root = ET.parse(tmp_path / name).getroot()
        assert root.get("width") == "80.00mm" and len(root) >= 1
    assert json.loads((tmp_path / "summary.json").read_text())["stitches"] == s["stitches"]


def test_background_is_not_stitched():
    blend, fig = double_exposure(portrait(200), scene(200), size=(200, 200))
    labels, _ = quantize(blend, colors=4)
    corner = labels[:20, :20]
    assert (corner == -1).mean() > 0.9  # bright sky stays fabric


def test_max_stitch_length():
    labels = np.zeros((50, 200), dtype=int)
    plan = plan_stitches(labels, np.array([[0, 0, 0]]), width_mm=100, max_stitch_mm=4.0)
    pts = plan.blocks[0][1]
    same_row = [(a, b) for a, b in zip(pts, pts[1:]) if a[1] == b[1]]
    assert max(abs(b[0] - a[0]) for a, b in same_row) <= 4.0 + 1e-6
