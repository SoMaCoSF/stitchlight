"""Generate license-clean synthetic inputs: a profile silhouette on a bright sky and a mountain/forest scene."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter
import numpy as np

def portrait(size=600):
    im = Image.new("RGB", (size, size), (236, 232, 226))
    d = ImageDraw.Draw(im)
    s = size / 600
    d.ellipse([170*s, 90*s, 430*s, 380*s], fill=(58, 46, 42))            # head
    d.polygon([(165*s, 230*s), (130*s, 270*s), (170*s, 300*s)], fill=(58, 46, 42))  # nose
    d.rectangle([250*s, 340*s, 360*s, 470*s], fill=(58, 46, 42))         # neck
    d.ellipse([110*s, 440*s, 520*s, 760*s], fill=(58, 46, 42))           # shoulders
    d.ellipse([300*s, 60*s, 480*s, 300*s], fill=(40, 32, 30))            # hair
    return im.filter(ImageFilter.GaussianBlur(1.5))

def scene(size=600, seed=7):
    rng = np.random.default_rng(seed)
    y = np.linspace(0, 1, size)[:, None]
    sky = np.dstack([200 + 40*y, 170 + 50*y, 120 + 90*y]).repeat(size, 1)
    im = Image.fromarray(np.clip(sky, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(im)
    for k, (base, col) in enumerate([(330, (96, 112, 140)), (400, (60, 86, 92)), (470, (34, 62, 48))]):
        xs = np.linspace(0, size, 14)
        ys = base + rng.normal(0, 30 + 10*k, xs.size)
        d.polygon([(0, size)] + list(zip(xs, ys)) + [(size, size)], fill=col)
    for _ in range(40):
        x = rng.uniform(0, size); h = rng.uniform(40, 110); b = rng.uniform(470, 600)
        d.polygon([(x, b-h), (x-h/4, b), (x+h/4, b)], fill=(22, 44, 34))
    d.ellipse([400, 90, 470, 160], fill=(250, 236, 200))
    return im

if __name__ == "__main__":
    out = Path(__file__).parent
    portrait().save(out / "portrait.png"); scene().save(out / "scene.png")
