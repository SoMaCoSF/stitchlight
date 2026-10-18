// stitchlight browser port: same pipeline as stitchlight/core.py (blend -> quantize -> tatami -> DST/SVG).
const N = 360, $ = id => document.getElementById(id);
let P = null, S = null, last = null;

function fixture(kind) {
  const c = new OffscreenCanvas(N, N), g = c.getContext('2d'), s = N / 600;
  if (kind === 'p') {
    g.fillStyle = '#ece8e2'; g.fillRect(0, 0, N, N); g.fillStyle = '#3a2e2a';
    const el = (x, y, w, h) => { g.beginPath(); g.ellipse(x * s, y * s, w * s, h * s, 0, 0, 7); g.fill(); };
    el(300, 235, 130, 145); el(390, 180, 90, 120); el(315, 600, 205, 160);
    g.fillRect(250 * s, 340 * s, 110 * s, 130 * s);
    g.beginPath(); g.moveTo(165 * s, 230 * s); g.lineTo(130 * s, 270 * s); g.lineTo(170 * s, 300 * s); g.fill();
  } else {
    const gr = g.createLinearGradient(0, 0, 0, N); gr.addColorStop(0, '#c8aa78'); gr.addColorStop(1, '#f0dcd2');
    g.fillStyle = gr; g.fillRect(0, 0, N, N);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    [[330, '#60708c'], [400, '#3c565c'], [470, '#223e30']].forEach(([b, col], k) => {
      g.fillStyle = col; g.beginPath(); g.moveTo(0, N);
      for (let i = 0; i <= 13; i++) g.lineTo(i / 13 * N, (b + (rnd() - .5) * (60 + 20 * k)) * s);
      g.lineTo(N, N); g.fill();
    });
    g.fillStyle = '#162c22';
    for (let i = 0; i < 40; i++) { const x = rnd() * N, h = (40 + rnd() * 70) * s, b = (470 + rnd() * 130) * s;
      g.beginPath(); g.moveTo(x, b - h); g.lineTo(x - h / 4, b); g.lineTo(x + h / 4, b); g.fill(); }
    g.fillStyle = '#faecc8'; g.beginPath(); g.arc(435 * s, 125 * s, 35 * s, 0, 7); g.fill();
  }
  return g.getImageData(0, 0, N, N);
}

async function load(file) {
  const bmp = await createImageBitmap(file), c = new OffscreenCanvas(N, N), g = c.getContext('2d');
  const r = Math.max(N / bmp.width, N / bmp.height), w = bmp.width * r, h = bmp.height * r;
  g.drawImage(bmp, (N - w) / 2, (N - h) / 2, w, h); return g.getImageData(0, 0, N, N);
}

function blur(a, r) { // separable box blur x3 ~ gaussian
  const o = new Float32Array(a.length), t = new Float32Array(a.length);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < N; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * N + Math.min(N - 1, Math.max(0, x))];
      for (let x = 0; x < N; x++) { t[y * N + x] = s / (2 * r + 1); s += a[y * N + Math.min(N - 1, x + r + 1)] - a[y * N + Math.max(0, x - r)]; } }
    for (let x = 0; x < N; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(N - 1, Math.max(0, y)) * N + x];
      for (let y = 0; y < N; y++) { o[y * N + x] = s / (2 * r + 1); s += t[Math.min(N - 1, y + r + 1) * N + x] - t[Math.max(0, y - r) * N + x]; } }
    a = o.slice();
  }
  return a;
}

function doubleExposure(p, s, mode, th) {
  let fig = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) { const L = (.299 * p.data[4 * i] + .587 * p.data[4 * i + 1] + .114 * p.data[4 * i + 2]) / 255; fig[i] = L < th ? 1 : 0; }
  fig = blur(fig, 3);
  const out = new ImageData(N, N);
  for (let i = 0; i < N * N; i++) {
    const f = fig[i], m = f * .9;
    for (let c = 0; c < 3; c++) {
      const a = p.data[4 * i + c] / 255, b = s.data[4 * i + c] / 255;
      const bl = mode === 'screen' ? 1 - (1 - a) * (1 - b) : mode === 'multiply' ? a * b : Math.max(a, b);
      const inside = bl * (1 - m) + b * m * .35 + bl * m * .65;
      let v = a * (1 - f) + inside * f; v = v * f + (1 - f) * Math.max(v, .96);
      out.data[4 * i + c] = v * 255;
    }
    out.data[4 * i + 3] = 255;
  }
  return out;
}

function kmeans(img, k) { // k+1 clusters; the brightest near-white one becomes fabric
  const px = []; for (let i = 0; i < N * N; i += 3) px.push([img.data[4 * i], img.data[4 * i + 1], img.data[4 * i + 2]]);
  let C = Array.from({ length: k + 1 }, (_, j) => px[Math.floor((j + .5) / (k + 1) * px.length)].slice());
  px.sort((a, b) => a[0] + a[1] + a[2] - b[0] - b[1] - b[2]);
  C = Array.from({ length: k + 1 }, (_, j) => px[Math.floor((j + .5) / (k + 1) * px.length)].slice());
  for (let it = 0; it < 12; it++) {
    const acc = C.map(() => [0, 0, 0, 0]);
    for (const q of px) { let bi = 0, bd = 1e9; C.forEach((c, j) => { const d = (q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 + (q[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = j; } });
      const a = acc[bi]; a[0] += q[0]; a[1] += q[1]; a[2] += q[2]; a[3]++; }
    C = C.map((c, j) => acc[j][3] ? acc[j].slice(0, 3).map(v => v / acc[j][3]) : c);
  }
  const lab = new Int16Array(N * N);
  for (let i = 0; i < N * N; i++) { let bi = 0, bd = 1e9; const r = img.data[4 * i], g = img.data[4 * i + 1], b = img.data[4 * i + 2];
    C.forEach((c, j) => { const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2; if (d < bd) { bd = d; bi = j; } }); lab[i] = bi; }
  const order = C.map((c, j) => j).filter(j => (C[j][0] + C[j][1] + C[j][2]) / 765 < .93).sort((a, b) => (C[b][0] + C[b][1] + C[b][2]) - (C[a][0] + C[a][1] + C[a][2]));
  const remap = new Map(order.map((j, i) => [j, i]));
  for (let i = 0; i < N * N; i++) lab[i] = remap.has(lab[i]) ? remap.get(lab[i]) : -1;
  return { lab, pal: order.map(j => C[j].map(Math.round)) };
}

function tatami(lab, ncol, widthMM, rowMM, maxMM = 4) {
  const sc = widthMM / N, step = Math.max(1, Math.round(rowMM / sc)), blocks = [];
  for (let ci = 0; ci < ncol; ci++) {
    const pts = [];
    for (let y = 0, ri = 0; y < N; y += step, ri++) {
      let runs = [], x = 0;
      while (x < N) { if (lab[y * N + x] === ci) { const a = x; while (x < N && lab[y * N + x] === ci) x++; runs.push([a, x - 1]); } else x++; }
      if (!runs.length) continue;
      if (ri % 2) runs = runs.reverse().map(([a, b]) => [b, a]);
      const st = (ri % 3) / 3;
      for (const [a, b] of runs) {
        const n = Math.max(1, Math.ceil(Math.abs(b - a) * sc * 4 / 3 / maxMM));
        for (let i = 0; i <= n; i++) { let xx = a + (b - a) * i / n; if (i && i < n) xx += Math.sign(b - a) * st * Math.abs(b - a) / n * .5; pts.push([xx * sc, y * sc]); }
      }
    }
    if (pts.length) blocks.push([ci, pts]);
  }
  return blocks;
}

function dst(blocks, label) { // Tajima DST: 512-byte header + 3-byte records, 0.1 mm units, |dx|,|dy| <= 121
  const rec = [];
  const enc = (dx, dy, flags) => {
    let b0 = 0, b1 = 0, b2 = 3 | flags;
    const bt = (v) => { const out = []; for (const w of [81, 27, 9, 3, 1]) { const lim = (w - 1) / 2; let t = 0; if (v > lim) t = 1; else if (v < -lim) t = -1; out.push(t); v -= t * w; } return out; };
    const X = bt(dx), Y = bt(dy);
    const XB = [[[2, 2], [2, 3]], [[1, 2], [1, 3]], [[0, 2], [0, 3]], [[1, 0], [1, 1]], [[0, 0], [0, 1]]];
    const YB = [[[2, 5], [2, 4]], [[1, 5], [1, 4]], [[0, 5], [0, 4]], [[1, 7], [1, 6]], [[0, 7], [0, 6]]];
    const setb = ([byte, bit]) => { if (byte === 0) b0 |= 1 << bit; else if (byte === 1) b1 |= 1 << bit; else b2 |= 1 << bit; };
    X.forEach((t, i) => { if (t === 1) setb(XB[i][0]); if (t === -1) setb(XB[i][1]); });
    Y.forEach((t, i) => { if (t === 1) setb(YB[i][0]); if (t === -1) setb(YB[i][1]); });
    rec.push(b0, b1, b2);
  };
  let cx = 0, cy = 0, n = 0, minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
  const move = (x, y, jump) => {
    let tx = Math.round(x * 10), ty = Math.round(-y * 10);
    while (tx !== cx || ty !== cy) {
      const dx = Math.max(-121, Math.min(121, tx - cx)), dy = Math.max(-121, Math.min(121, ty - cy));
      enc(dx, dy, jump ? 0x80 : 0); cx += dx; cy += dy; n++;
      minx = Math.min(minx, cx); maxx = Math.max(maxx, cx); miny = Math.min(miny, cy); maxy = Math.max(maxy, cy);
    }
  };
  blocks.forEach(([ci, pts], k) => {
    if (k) { enc(0, 0, 0xC0); n++; }           // color change
    move(pts[0][0], pts[0][1], true);
    for (const [x, y] of pts) move(x, y, false);
  });
  rec.push(0, 0, 0xF3);                          // end
  const h = `LA:${label.padEnd(16).slice(0, 16)}\rST:${String(n).padStart(7)}\rCO:${String(Math.max(0, blocks.length - 1)).padStart(3)}\r+X:${String(maxx).padStart(5)}\r-X:${String(-minx).padStart(5)}\r+Y:${String(maxy).padStart(5)}\r-Y:${String(-miny).padStart(5)}\rAX:+    0\rAY:+    0\rMX:+    0\rMY:+    0\rPD:******\r\x1a`;
  const buf = new Uint8Array(512 + rec.length); buf.fill(0x20, 0, 512);
  for (let i = 0; i < h.length; i++) buf[i] = h.charCodeAt(i);
  buf.set(rec, 512); return { buf, stitches: n };
}

function contours(lab, ci) { // pixel-edge boundary segments, merged into rings (marching squares lite)
  const seg = new Map(), key = (x, y) => x + ',' + y, add = (a, b) => { (seg.get(key(...a)) || seg.set(key(...a), []).get(key(...a))).push(b); };
  const at = (x, y) => x >= 0 && y >= 0 && x < N && y < N && lab[y * N + x] === ci;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (at(x, y)) {
    if (!at(x, y - 1)) add([x, y], [x + 1, y]); if (!at(x + 1, y)) add([x + 1, y], [x + 1, y + 1]);
    if (!at(x, y + 1)) add([x + 1, y + 1], [x, y + 1]); if (!at(x - 1, y)) add([x, y + 1], [x, y]);
  }
  const rings = [];
  for (const [k0] of seg) {
    while ((seg.get(k0) || []).length) {
      const ring = [k0.split(',').map(Number)]; let k = k0;
      while (true) { const nx = seg.get(k); if (!nx || !nx.length) break; const p = nx.pop(); k = key(...p); if (k === k0) break; ring.push(p); }
      if (ring.length > 3) rings.push(ring.filter((p, i) => i % 2 === 0));
    }
  }
  return rings;
}

function svg(lab, pal, widthMM, cut) {
  const s = widthMM / N; let o = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMM}mm" height="${widthMM}mm" viewBox="0 0 ${widthMM} ${widthMM}">\n`;
  pal.forEach((c, ci) => { const hex = '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
    const d = contours(lab, ci).map(r => 'M' + r.map(([x, y]) => `${(x * s).toFixed(2)},${(y * s).toFixed(2)}`).join('L') + 'Z').join(' ');
    if (d) o += cut ? `<path id="cut-${ci}" fill="none" stroke="${hex}" stroke-width="0.1" d="${d}"/>\n` : `<path id="thread-${ci}" fill="${hex}" fill-rule="evenodd" d="${d}"/>\n`; });
  return o + '</svg>';
}

const dl = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); };

function render() {
  const mode = $('mode').value, th = +$('th').value, k = +$('k').value, w = +$('w').value, row = +$('row').value;
  $('vth').textContent = th; $('vk').textContent = k; $('vw').textContent = w; $('vr').textContent = row;
  const b = doubleExposure(P, S, mode, th), { lab, pal } = kmeans(b, k), blocks = tatami(lab, pal.length, w, row);
  for (const id of ['cb', 'cq', 'cs']) { $(id).width = N; $(id).height = N; }
  $('cb').getContext('2d').putImageData(b, 0, 0);
  const q = new ImageData(N, N); for (let i = 0; i < N * N; i++) { const c = lab[i] < 0 ? [244, 240, 232] : pal[lab[i]]; q.data.set([...c, 255], 4 * i); }
  $('cq').getContext('2d').putImageData(q, 0, 0);
  const g = $('cs').getContext('2d'), sc = N / w; g.fillStyle = '#f4f0e8'; g.fillRect(0, 0, N, N); g.lineWidth = 1.8;
  for (const [ci, pts] of blocks) { g.strokeStyle = `rgb(${pal[ci]})`; g.beginPath();
    for (let i = 1; i < pts.length; i++) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; if (Math.abs(y1 - y0) > 1e-6) continue; g.moveTo(x0 * sc, y0 * sc); g.lineTo(x1 * sc, y1 * sc); } g.stroke(); }
  const D = dst(blocks, 'stitchlight');
  $('pal').innerHTML = pal.map(c => `<span class="sw" style="background:rgb(${c})"></span>`).join('');
  $('stats').textContent = `colours ${pal.length}\nstitches ${D.stitches}\nsize ${w}×${w} mm\nrow ${row} mm, max stitch 4 mm\nest. sew time ~${Math.round(D.stitches / 700)} min @700 spm`;
  last = { b, lab, pal, D, w };
}

addEventListener('load', () => {
  P = fixture('p'); S = fixture('s'); render();
  ['mode', 'th', 'k', 'w', 'row'].forEach(id => $(id).addEventListener('input', render));
  $('fp').onchange = async e => { P = await load(e.target.files[0]); render(); };
  $('fs').onchange = async e => { S = await load(e.target.files[0]); render(); };
  $('bdst').onclick = () => dl(new Blob([last.D.buf]), 'stitchlight.dst');
  $('bsvg').onclick = () => dl(new Blob([svg(last.lab, last.pal, last.w, false)], { type: 'image/svg+xml' }), 'stitchlight_print.svg');
  $('bcnc').onclick = () => dl(new Blob([svg(last.lab, last.pal, last.w, true)], { type: 'image/svg+xml' }), 'stitchlight_cnc.svg');
  $('bpng').onclick = () => { const c = document.createElement('canvas'); c.width = c.height = N; c.getContext('2d').putImageData(last.b, 0, 0); c.toBlob(b => dl(b, 'double_exposure.png')); };
});
