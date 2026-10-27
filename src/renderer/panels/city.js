// City: a 3D view of a folder, after SGI's FSN ("It's a Unix system!").
// Folders are platforms laid out as a tree that recedes into the distance, joined by wires on
// the ground; their files stand on them as blocks whose height follows the file size (log scale).
// Plain canvas 2D with a small perspective camera: it draws while something moves, then sleeps.
//
// LumenCity.create(box, api) with api = { root(), node(path), children(n), kindOf(n),
//   isVisible(), select(path), activate(n), open(n) } returns
//   { rebuild, fit, wake, recolor, highlight, dispose } (the same shape as the old graph).
(function () {
  const FILES_PER_DIR = 100;   // the biggest ones; the rest of a huge folder is left out
  const MAX_DIRS = 160;
  const CELL = 1;
  const GAP = 0.35;
  const MARGIN = 0.6;
  const ROW = 7;               // ground between two rows of folders
  const SIBLINGS = 2.2;        // between two sibling subtrees
  const PAD_H = 0.2;
  const NEAR = 0.4;
  const GROW_MS = 650;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const fmtSize = n => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : n < 1073741824 ? `${(n / 1048576).toFixed(1)} MB` : `${(n / 1073741824).toFixed(2)} GB`);
  const heightOf = size => clamp(0.25 + Math.log2(1 + (size || 0) / 2048) * 0.42, 0.25, 7);

  function create(box, api) {
    const canvas = box.querySelector('canvas');
    const tip = box.querySelector('.fx-graph-tip');
    const ctx = canvas.getContext('2d');
    box.classList.add('fx-city');

    let pads = [];             // { n, x0, x1, z0, z1, depth, explored }
    let blocks = [];           // { n, x0, x1, z0, z1, h, born }
    let wires = [];            // ground polylines: [[x, z], …]
    let byPath = new Map();    // path -> pad or block
    let born = new Map();      // path -> time it appeared (blocks rise)
    let bounds = { x0: -5, x1: 5, z0: -5, z1: 5 };
    let shownRoot = null;
    const cam = { yaw: 0.45, pitch: 0.5, dist: 30, tx: 0, ty: 0, tz: 0 };
    let anim = null;
    let hover = null;
    let focus = null;
    let drag = null;
    let raf = 0;
    let W = 1;
    let H = 1;
    let colors = {};
    let mono = 'monospace';
    let hits = [];
    let B = null;              // camera basis for the current frame

    function readColors() {
      const s = getComputedStyle(document.documentElement);
      const v = n => s.getPropertyValue(n).trim();
      colors = { bg: v('--crust'), fg: v('--fg'), muted: v('--muted'), border: v('--border'), accent: v('--accent'), accent2: v('--accent2'), green: v('--green'), yellow: v('--yellow'), red: v('--red') };
      mono = v('--mono') || 'monospace';
    }
    const colorOf = n => ({ dir: colors.accent, code: colors.accent2, doc: colors.green, data: colors.yellow, media: colors.red, file: colors.muted })[api.kindOf(n)];

    // ─── Layout ─────────────────────────────────────────────────────────
    function layout() {
      pads = [];
      blocks = [];
      wires = [];
      byPath = new Map();
      const r = api.node(api.root());
      if (!r) return;
      let dirs = 0;
      const maxDepthD = [];   // deepest pad of each row
      const measure = (n, depth) => {
        const kids = api.children(n);
        const files = kids.filter(c => !c.dir).sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, FILES_PER_DIR);
        const cols = Math.max(1, Math.ceil(Math.sqrt(files.length)));
        const rows = Math.max(1, Math.ceil(files.length / cols));
        const padW = cols * (CELL + GAP) - GAP + MARGIN * 2;
        const padD = rows * (CELL + GAP) - GAP + MARGIN * 2;
        maxDepthD[depth] = Math.max(maxDepthD[depth] || 0, padD);
        const sub = [];
        if (n.children && (depth < 2 || n.open)) {
          for (const c of kids) {
            if (!c.dir) continue;
            if (dirs >= MAX_DIRS) break;
            dirs++;
            sub.push(measure(c, depth + 1));
          }
        }
        const subW = sub.reduce((s, i) => s + i.width, 0) + Math.max(0, sub.length - 1) * SIBLINGS;
        return { n, files, cols, padW, padD, sub, subW, width: Math.max(padW, subW), depth };
      };
      const tree = measure(r, 0);
      // Front edge (toward the camera) of each row; rows recede along -Z.
      const rowZ = [0];
      for (let d = 1; d < maxDepthD.length; d++) rowZ[d] = rowZ[d - 1] - maxDepthD[d - 1] - ROW;
      const now = performance.now();
      const place = (it, left) => {
        const cx = left + it.width / 2;
        const pad = { n: it.n, x0: cx - it.padW / 2, x1: cx + it.padW / 2, z1: rowZ[it.depth], z0: rowZ[it.depth] - it.padD, depth: it.depth, explored: !!it.n.children, kind: 'pad' };
        pads.push(pad);
        byPath.set(it.n.path, pad);
        it.files.forEach((f, i) => {
          const col = i % it.cols;
          const row = Math.floor(i / it.cols);
          const x0 = pad.x0 + MARGIN + col * (CELL + GAP);
          const z1 = pad.z1 - MARGIN - row * (CELL + GAP);
          if (!born.has(f.path)) born.set(f.path, now);
          const b = { n: f, x0, x1: x0 + CELL, z0: z1 - CELL, z1, h: heightOf(f.size), born: born.get(f.path), kind: 'block' };
          blocks.push(b);
          byPath.set(f.path, b);
        });
        let x = left + (it.width - it.subW) / 2;
        const mid = rowZ[it.depth + 1] + ROW / 2;
        for (const s of it.sub) {
          const ccx = x + s.width / 2;
          wires.push([[cx, pad.z0], [cx, mid], [ccx, mid], [ccx, rowZ[it.depth + 1]]]);
          place(s, x);
          x += s.width + SIBLINGS;
        }
      };
      place(tree, -tree.width / 2);
      bounds = { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
      for (const p of pads) {
        bounds.x0 = Math.min(bounds.x0, p.x0); bounds.x1 = Math.max(bounds.x1, p.x1);
        bounds.z0 = Math.min(bounds.z0, p.z0); bounds.z1 = Math.max(bounds.z1, p.z1);
      }
    }

    // ─── Camera ─────────────────────────────────────────────────────────
    function basis() {
      const cp = Math.cos(cam.pitch);
      const ex = cam.tx + cam.dist * cp * Math.sin(cam.yaw);
      const ey = cam.ty + cam.dist * Math.sin(cam.pitch);
      const ez = cam.tz + cam.dist * cp * Math.cos(cam.yaw);
      let fx = cam.tx - ex, fy = cam.ty - ey, fz = cam.tz - ez;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl; fy /= fl; fz /= fl;
      let rx = -fz, rz = fx;
      const rl = Math.hypot(rx, rz) || 1;
      rx /= rl; rz /= rl;
      B = { ex, ey, ez, fx, fy, fz, rx, rz, ux: -rz * fy, uy: rz * fx - rx * fz, uz: rx * fy, focal: Math.min(W, H) * 1.25 };
    }
    const toCam = (x, y, z) => {
      const dx = x - B.ex, dy = y - B.ey, dz = z - B.ez;
      return [dx * B.rx + dz * B.rz, dx * B.ux + dy * B.uy + dz * B.uz, dx * B.fx + dy * B.fy + dz * B.fz];
    };
    const proj = c => { const k = B.focal / c[2]; return [W / 2 + c[0] * k, H / 2 - c[1] * k]; };
    // Far things fade into the dark, like an old vector display.
    const fog = z => clamp(1.2 - (z - cam.dist * 0.7) / (cam.dist * 1.5), 0.1, 1);

    function line(a, b) {
      let ca = toCam(...a), cb = toCam(...b);
      if (ca[2] < NEAR && cb[2] < NEAR) return null;
      if (ca[2] < NEAR || cb[2] < NEAR) {
        const t = (NEAR - ca[2]) / (cb[2] - ca[2]);
        const c = [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, NEAR];
        if (ca[2] < NEAR) ca = c; else cb = c;
      }
      return [proj(ca), proj(cb), (ca[2] + cb[2]) / 2];
    }

    // ─── Drawing ────────────────────────────────────────────────────────
    function face(pts, item, fill, fillA, stroke, strokeA, width = 1, dash = null) {
      const cs = pts.map(p => toCam(...p));
      if (cs.some(c => c[2] < NEAR)) return;
      const ps = cs.map(proj);
      const f = fog(cs.reduce((s, c) => s + c[2], 0) / cs.length);
      ctx.beginPath();
      ps.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      ctx.closePath();
      if (fillA) { ctx.globalAlpha = fillA * f; ctx.fillStyle = fill; ctx.fill(); }
      ctx.globalAlpha = strokeA * f;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.stroke();
      if (dash) ctx.setLineDash([]);
      if (item) hits.push({ item, ps });
    }

    function cuboid(b, y0, y1, color, { fillA, strokeA, width, dash, item }) {
      const { x0, x1, z0, z1 } = b;
      const top = [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      // Only the faces turned toward the camera.
      if (B.ex < x0) face([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], item, color, fillA * 0.55, color, strokeA * 0.7, width, dash);
      if (B.ex > x1) face([[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]], item, color, fillA * 0.55, color, strokeA * 0.7, width, dash);
      if (B.ez < z0) face([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], item, color, fillA * 0.75, color, strokeA * 0.7, width, dash);
      if (B.ez > z1) face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], item, color, fillA * 0.75, color, strokeA * 0.7, width, dash);
      if (B.ey > y1) face(top, item, color, fillA, color, strokeA, width, dash);
    }

    const dist2 = b => {
      const cx = (b.x0 + b.x1) / 2 - B.ex, cz = (b.z0 + b.z1) / 2 - B.ez;
      return cx * cx + cz * cz + B.ey * B.ey;
    };

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      hits = [];
      basis();
      const now = performance.now();

      // A faint glow on the horizon.
      const sky = ctx.createLinearGradient(0, 0, 0, H * 0.6);
      sky.addColorStop(0, colors.accent);
      sky.addColorStop(1, 'transparent');
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, W, H);

      // The ground grid, a little wider than the city.
      const step = 2;
      const gx0 = Math.floor((bounds.x0 - 14) / step) * step, gx1 = Math.ceil((bounds.x1 + 14) / step) * step;
      const gz0 = Math.floor((bounds.z0 - 14) / step) * step, gz1 = Math.ceil((bounds.z1 + 14) / step) * step;
      ctx.lineWidth = 1;
      ctx.strokeStyle = colors.border;
      const grid = (a, b) => {
        const l = line(a, b);
        if (!l) return;
        ctx.globalAlpha = 0.55 * fog(l[2]);
        ctx.beginPath();
        ctx.moveTo(...l[0]);
        ctx.lineTo(...l[1]);
        ctx.stroke();
      };
      for (let x = gx0; x <= gx1; x += step) grid([x, 0, gz0], [x, 0, gz1]);
      for (let z = gz0; z <= gz1; z += step) grid([gx0, 0, z], [gx1, 0, z]);

      // Wires between folders, on the ground.
      ctx.strokeStyle = colors.accent;
      for (const w of wires) {
        for (let i = 1; i < w.length; i++) {
          const l = line([w[i - 1][0], 0.02, w[i - 1][1]], [w[i][0], 0.02, w[i][1]]);
          if (!l) continue;
          ctx.globalAlpha = 0.6 * fog(l[2]);
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(...l[0]);
          ctx.lineTo(...l[1]);
          ctx.stroke();
        }
      }

      // Platforms (flat: drawn first), then the blocks, far to near.
      for (const p of [...pads].sort((a, b) => dist2(b) - dist2(a))) {
        const lit = p === hover || p === focus || p.n.path === api.selected?.();
        cuboid(p, 0, PAD_H, p.depth === 0 ? colors.accent2 : colors.accent, {
          fillA: lit ? 0.22 : 0.09, strokeA: lit ? 1 : 0.75, width: lit ? 1.6 : 1, dash: p.explored ? null : [4, 3], item: p
        });
      }
      let growing = false;
      for (const b of [...blocks].sort((a, c) => dist2(c) - dist2(a))) {
        const t = ease((now - b.born) / GROW_MS);
        if (t < 1) growing = true;
        const lit = b === hover || b === focus || b.n.path === api.selected?.();
        cuboid(b, PAD_H, PAD_H + b.h * t, lit ? colors.fg : colorOf(b.n), { fillA: lit ? 0.4 : 0.2, strokeA: lit ? 1 : 0.85, width: lit ? 1.5 : 1, item: b });
      }

      // Folder names at the front of their platform; deeper ones only once they are big enough.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      for (const p of pads) {
        const c = toCam(p.x0, 0, p.z1 + 0.25);
        if (c[2] < NEAR) continue;
        const px = (B.focal / c[2]) * 0.62;
        const lit = p === hover || p === focus;
        if (px < 8 && !lit && p.depth > 0) continue;
        const [x, y] = proj(c);
        ctx.globalAlpha = (lit ? 1 : 0.85) * fog(c[2]);
        ctx.fillStyle = lit || p.depth === 0 ? colors.fg : colors.muted;
        ctx.font = `${p.depth === 0 ? 700 : 400} ${clamp(px, 9, 14)}px ${mono}`;
        ctx.fillText(p.depth === 0 ? p.n.name : `${p.n.name}/`, x, y + 2);
      }

      // How to move around.
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = colors.muted;
      ctx.font = `10px ${mono}`;
      ctx.textBaseline = 'bottom';
      ctx.fillText(W > 520 ? 'drag: orbit · shift+drag: pan · wheel: zoom · double click: cd' : 'drag orbit · shift pan · wheel zoom', 10, H - 8);
      ctx.globalAlpha = 1;
      return growing;
    }

    // ─── Loop: only while something moves ───────────────────────────────
    function frame() {
      raf = 0;
      if (!box.isConnected || !api.isVisible()) return;
      let moving = false;
      if (anim) {
        const t = ease((performance.now() - anim.t0) / anim.ms);
        for (const k of Object.keys(anim.to)) cam[k] = anim.from[k] + (anim.to[k] - anim.from[k]) * t;
        if (t >= 1) anim = null; else moving = true;
      }
      if (draw()) moving = true;
      if (moving) raf = requestAnimationFrame(frame);
    }
    const wake = () => { if (!raf) raf = requestAnimationFrame(frame); };

    function flyTo(to, ms = 550) {
      anim = { from: { ...cam }, to, t0: performance.now(), ms };
      wake();
    }

    // The camera that shows the whole city: a few passes adjusting the distance until the
    // projected corners fill the view (perspective makes a direct formula inexact).
    function framing() {
      const { x0, x1, z0, z1 } = bounds;
      const to = { tx: (x0 + x1) / 2, ty: 0, tz: (z0 + z1) / 2, yaw: 0.45, pitch: H > W * 1.3 ? 0.8 : 0.55, dist: 30 };
      const saved = { ...cam };
      Object.assign(cam, to);
      const pts = [[x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [x0, 2, z0], [x1, 2, z0], [x1, 2, z1], [x0, 2, z1]];
      for (let i = 0; i < 6; i++) {
        basis();
        let mx = 0, my = 0, behind = false;
        for (const p of pts) {
          const c = toCam(...p);
          if (c[2] < NEAR) { behind = true; break; }
          const [sx, sy] = proj(c);
          mx = Math.max(mx, Math.abs(sx - W / 2));
          my = Math.max(my, Math.abs(sy - H / 2));
        }
        cam.dist = clamp(cam.dist * (behind ? 1.8 : Math.max(mx / (W * 0.44), my / (H * 0.4))), 6, 800);
      }
      to.dist = cam.dist;
      Object.assign(cam, saved);
      return to;
    }

    function fit() { flyTo(framing()); }

    function focusOn(item) {
      const size = Math.max(item.x1 - item.x0, item.z1 - item.z0);
      flyTo({ tx: (item.x0 + item.x1) / 2, tz: (item.z0 + item.z1) / 2, dist: clamp(Math.min(cam.dist, size * 2.4 + 9), 8, 600) });
    }

    function rebuild() {
      const fresh = api.root() !== shownRoot;
      if (fresh) { born = new Map(); shownRoot = api.root(); }
      layout();
      if (fresh) Object.assign(cam, framing());
      wake();
    }

    // ─── Input ──────────────────────────────────────────────────────────
    function resize() {
      const r = box.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      wake();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    // Front-most face under the pointer (faces are recorded far to near).
    const pick = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      const x = cx - r.left, y = cy - r.top;
      for (let i = hits.length - 1; i >= 0; i--) {
        const ps = hits[i].ps;
        let inside = false;
        for (let a = 0, b = ps.length - 1; a < ps.length; b = a++) {
          if ((ps[a][1] > y) !== (ps[b][1] > y) && x < ((ps[b][0] - ps[a][0]) * (y - ps[a][1])) / (ps[b][1] - ps[a][1]) + ps[a][0]) inside = !inside;
        }
        if (inside) return hits[i].item;
      }
      return null;
    };

    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      anim = null;
      drag = { x: e.clientX, y: e.clientY, pan: e.shiftKey || e.button === 2 || e.button === 1, from: { ...cam }, moved: false };
    });
    canvas.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (!drag.moved) return;
        if (drag.pan) {
          // Slide the target on the ground, along the camera's right and forward directions.
          const k = cam.dist / B.focal;
          const sy = Math.sin(cam.yaw), cy = Math.cos(cam.yaw);
          cam.tx = drag.from.tx - (dx * cy + dy * sy) * k * 1.4;
          cam.tz = drag.from.tz - (-dx * sy + dy * cy) * k * 1.4;
        } else {
          cam.yaw = drag.from.yaw - dx * 0.008;
          cam.pitch = clamp(drag.from.pitch + dy * 0.006, 0.12, 1.45);
        }
        wake();
        return;
      }
      const it = pick(e.clientX, e.clientY);
      if (it !== hover) {
        hover = it;
        canvas.style.cursor = it ? 'pointer' : 'grab';
        if (it) {
          const n = it.n;
          tip.textContent = n.dir ? `${n.name}/  ·  ${n.children ? `${n.children.length} items` : 'click to open'}` : `${n.name}  ·  ${fmtSize(n.size) || 'file'}`;
          tip.classList.remove('hidden');
        } else tip.classList.add('hidden');
        wake();
      }
      if (it) {
        const r = box.getBoundingClientRect();
        tip.style.left = `${Math.min(r.width - 10, e.clientX - r.left + 12)}px`;
        tip.style.top = `${e.clientY - r.top + 12}px`;
      }
    });
    canvas.addEventListener('pointerup', async e => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const it = pick(e.clientX, e.clientY);
      if (!it) return;
      focus = it;
      api.select(it.n.path);
      if (it.n.dir && !it.n.children) await api.open(it.n);
      else focusOn(it);
    });
    canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; tip.classList.add('hidden'); wake(); } });
    canvas.addEventListener('dblclick', e => { const it = pick(e.clientX, e.clientY); if (it) api.activate(it.n); });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      anim = null;
      cam.dist = clamp(cam.dist * (e.deltaY < 0 ? 1 / 1.12 : 1.12), 4, 800);
      wake();
    }, { passive: false });

    readColors();
    return {
      rebuild,
      fit,
      wake,
      recolor() { readColors(); wake(); },
      highlight(path) {
        const it = byPath.get(path) || null;
        focus = it;
        if (it) focusOn(it); else wake();
      },
      dispose() { ro.disconnect(); if (raf) cancelAnimationFrame(raf); }
    };
  }

  window.LumenCity = { create };
})();
