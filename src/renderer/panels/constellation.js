// Constellation: a 3D view of a folder as a star system. The folder sits at the center, its
// subfolders orbit it as wireframe spheres (sized by how much they hold), their own content
// orbits them in turn, and files are small points colored by kind. Plain canvas 2D with a
// perspective camera: it draws while something moves, then sleeps.
//
// LumenConstellation.create(box, api) with the same api as LumenCity (see city.js).
(function () {
  const FILES_PER_DIR = 60;
  const MAX_NODES = 700;
  const NEAR = 0.4;
  const GROW_MS = 700;
  const GOLDEN = Math.PI * (3 - Math.sqrt(5));

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
  const fmtSize = n => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

  // Fixed background stars (directions only: they never get closer).
  const STARS = Array.from({ length: 260 }, (_, i) => {
    const y = 1 - ((i + 0.5) / 260) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * GOLDEN * 7.3;
    return { d: [Math.cos(a) * r, y, Math.sin(a) * r], s: (i * 37) % 5 === 0 ? 1.4 : 0.8 };
  });

  // k directions spread over a cap of half-angle `cap` around u (the whole sphere when cap = π).
  function spread(u, k, cap) {
    const a = norm(Math.abs(u[1]) < 0.9 ? cross(u, [0, 1, 0]) : cross(u, [1, 0, 0]));
    const b = cross(u, a);
    const out = [];
    for (let i = 0; i < k; i++) {
      const t = Math.acos(1 - ((i + 0.5) / k) * (1 - Math.cos(cap)));
      const p = i * GOLDEN;
      const s = Math.sin(t), c = Math.cos(t);
      out.push([u[0] * c + (a[0] * Math.cos(p) + b[0] * Math.sin(p)) * s, u[1] * c + (a[1] * Math.cos(p) + b[1] * Math.sin(p)) * s, u[2] * c + (a[2] * Math.cos(p) + b[2] * Math.sin(p)) * s]);
    }
    return out;
  }

  function create(box, api) {
    const canvas = box.querySelector('canvas');
    const tip = box.querySelector('.fx-graph-tip');
    const ctx = canvas.getContext('2d');
    box.classList.add('fx-space');

    let stars = [];          // { n, p: [x,y,z], r, parent, depth, born }
    let byPath = new Map();
    let born = new Map();
    let shownRoot = null;
    let extent = 20;
    const cam = { yaw: 0.6, pitch: 0.35, dist: 50, tx: 0, ty: 0, tz: 0 };
    let anim = null;
    let hover = null;
    let focus = null;
    let drag = null;
    let raf = 0;
    let W = 1;
    let H = 1;
    let colors = {};
    let mono = 'monospace';
    let drawn = [];          // projected stars of the last frame, for picking
    let B = null;

    function readColors() {
      const s = getComputedStyle(document.documentElement);
      const v = n => s.getPropertyValue(n).trim();
      colors = { fg: v('--fg'), muted: v('--muted'), border: v('--border'), accent: v('--accent'), accent2: v('--accent2'), green: v('--green'), yellow: v('--yellow'), red: v('--red') };
      mono = v('--mono') || 'monospace';
    }
    const colorOf = n => ({ dir: colors.accent, code: colors.accent2, doc: colors.green, data: colors.yellow, media: colors.red, file: colors.muted })[api.kindOf(n)];

    // ─── Layout: every level orbits its parent, away from the grandparent ─
    function layout() {
      stars = [];
      byPath = new Map();
      const r = api.node(api.root());
      if (!r) return;
      const now = performance.now();
      const add = (n, p, parent, depth, size) => {
        if (!born.has(n.path)) born.set(n.path, now);
        const s = { n, p, r: size, parent, depth, born: born.get(n.path) };
        stars.push(s);
        byPath.set(n.path, s);
        return s;
      };
      const place = (s, out) => {
        const n = s.n;
        if (!n.children || !(s.depth < 2 || n.open) || stars.length > MAX_NODES) return;
        const kids = api.children(n);
        const dirs = kids.filter(c => c.dir);
        const files = kids.filter(c => !c.dir).slice(0, FILES_PER_DIR);
        const R = Math.max(4, 16 - s.depth * 5);
        const cap = s.depth === 0 ? Math.PI : 1.25;
        const dd = spread(out, dirs.length, cap);
        dirs.forEach((c, i) => {
          if (stars.length > MAX_NODES) return;
          const len = R * (0.85 + ((i * 7) % 5) * 0.06);
          const p = [s.p[0] + dd[i][0] * len, s.p[1] + dd[i][1] * len * 0.55, s.p[2] + dd[i][2] * len];
          const child = add(c, p, s, s.depth + 1, 0.45 + Math.sqrt(c.children?.length || 1) * 0.16);
          place(child, dd[i]);
        });
        // Files: a tight cloud around their folder.
        const fd = spread(out, files.length, s.depth === 0 ? Math.PI : 2.2);
        files.forEach((f, i) => {
          if (stars.length > MAX_NODES) return;
          const len = R * 0.32 + (i % 3) * 0.5;
          add(f, [s.p[0] + fd[i][0] * len, s.p[1] + fd[i][1] * len, s.p[2] + fd[i][2] * len], s, s.depth + 1, 0.16);
        });
      };
      const root = add(r, [0, 0, 0], null, 0, 1.3);
      place(root, [0, 0, 1]);
      extent = Math.max(8, ...stars.map(s => Math.hypot(...s.p)));
    }

    // ─── Camera ─────────────────────────────────────────────────────────
    function basis() {
      const cp = Math.cos(cam.pitch);
      const ex = cam.tx + cam.dist * cp * Math.sin(cam.yaw);
      const ey = cam.ty + cam.dist * Math.sin(cam.pitch);
      const ez = cam.tz + cam.dist * cp * Math.cos(cam.yaw);
      const f = norm([cam.tx - ex, cam.ty - ey, cam.tz - ez]);
      const r = norm([-f[2], 0, f[0]]);
      const u = cross(r, f);
      B = { e: [ex, ey, ez], f, r, u, focal: Math.min(W, H) * 1.2 };
    }
    const rot = (dx, dy, dz) => [dx * B.r[0] + dy * B.r[1] + dz * B.r[2], dx * B.u[0] + dy * B.u[1] + dz * B.u[2], dx * B.f[0] + dy * B.f[1] + dz * B.f[2]];
    const toCam = p => rot(p[0] - B.e[0], p[1] - B.e[1], p[2] - B.e[2]);
    const proj = c => { const k = B.focal / c[2]; return [W / 2 + c[0] * k, H / 2 - c[1] * k]; };
    const fog = z => clamp(1.25 - (z - cam.dist * 0.6) / (cam.dist * 1.4), 0.12, 1);
    const posOf = (s, now) => {
      if (!s.parent) return s.p;
      const t = ease((now - s.born) / GROW_MS);
      const q = posOf(s.parent, now);
      return [q[0] + (s.p[0] - s.parent.p[0]) * t, q[1] + (s.p[1] - s.parent.p[1]) * t, q[2] + (s.p[2] - s.parent.p[2]) * t];
    };

    // ─── Drawing ────────────────────────────────────────────────────────
    function draw() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      basis();
      const now = performance.now();
      let growing = false;

      // The sky.
      ctx.fillStyle = colors.muted;
      for (const st of STARS) {
        const c = rot(...st.d);
        if (c[2] <= 0.05) continue;
        const [x, y] = proj(c);
        if (x < 0 || y < 0 || x > W || y > H) continue;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(x, y, st.s, st.s);
      }

      // Orbits of the first ring, flat around the center.
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      for (const R of [16 * 0.85, 16 * 1.1]) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i <= 72; i++) {
          const a = (i / 72) * Math.PI * 2;
          const c = toCam([Math.cos(a) * R, 0, Math.sin(a) * R]);
          if (c[2] < NEAR) { started = false; continue; }
          const [x, y] = proj(c);
          ctx.globalAlpha = 0.45 * fog(c[2]);
          if (started) ctx.lineTo(x, y); else { ctx.moveTo(x, y); started = true; }
        }
        ctx.setLineDash([3, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Project everything once.
      const items = [];
      for (const s of stars) {
        if (now - s.born < GROW_MS) growing = true;
        const p = posOf(s, now);
        const c = toCam(p);
        if (c[2] < NEAR) continue;
        const [x, y] = proj(c);
        items.push({ s, c, x, y, pr: Math.max(s.n.dir ? 2.5 : 1.4, (s.r * B.focal) / c[2]) });
      }
      const at = new Map(items.map(i => [i.s, i]));

      // Links.
      const lit = hover || focus;
      for (const it of items) {
        const pa = it.s.parent && at.get(it.s.parent);
        if (!pa) continue;
        const on = lit && (it.s === lit || it.s.parent === lit);
        ctx.strokeStyle = on ? colors.accent : it.s.n.dir ? colors.accent : colors.border;
        ctx.globalAlpha = (on ? 0.95 : it.s.n.dir ? 0.45 : 0.3) * fog(it.c[2]);
        ctx.lineWidth = on ? 1.4 : 1;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(it.x, it.y);
        ctx.stroke();
      }

      // Bodies, far to near.
      items.sort((a, b) => b.c[2] - a.c[2]);
      for (const it of items) {
        const { s, x, y, pr } = it;
        const f = fog(it.c[2]);
        const on = s === hover || s === focus || s.n.path === api.selected?.();
        const col = s.depth === 0 ? colors.accent2 : on && !s.n.dir ? colors.fg : colorOf(s.n);
        if (s.n.dir) {
          // A wireframe sphere: the outline, a tilted equator and a meridian.
          ctx.globalAlpha = (on ? 0.3 : 0.12) * f;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(x, y, pr, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = (on ? 1 : 0.85) * f;
          ctx.strokeStyle = on ? colors.fg : col;
          ctx.lineWidth = on ? 1.6 : 1;
          ctx.stroke();
          if (pr > 5) {
            ctx.globalAlpha = 0.5 * f;
            ctx.beginPath();
            ctx.ellipse(x, y, pr, pr * 0.32, -0.25, 0, Math.PI * 2);
            ctx.stroke();
            ctx.beginPath();
            ctx.ellipse(x, y, pr * 0.32, pr, -0.25, 0, Math.PI * 2);
            ctx.stroke();
          }
          if (!s.n.children && s.depth > 0) {
            ctx.globalAlpha = 0.6 * f;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.arc(x, y, pr + 3, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        } else {
          ctx.globalAlpha = (on ? 1 : 0.85) * f;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(x, y, on ? pr + 1.5 : pr, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      drawn = items;

      // Names of folders, when they are big enough on screen.
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      for (const it of items) {
        const s = it.s;
        const on = s === hover || s === focus;
        if (!on && !(s.n.dir && (s.depth <= 1 || it.pr > 6))) continue;
        ctx.globalAlpha = (on ? 1 : 0.8) * fog(it.c[2]);
        ctx.fillStyle = on || s.depth === 0 ? colors.fg : colors.muted;
        ctx.font = `${s.depth === 0 ? 700 : 400} ${clamp(it.pr * 0.9, 10, 13)}px ${mono}`;
        ctx.fillText(s.n.name, it.x, it.y - it.pr - 4);
      }

      ctx.globalAlpha = 0.55;
      ctx.fillStyle = colors.muted;
      ctx.font = `10px ${mono}`;
      ctx.textAlign = 'left';
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
    const flyTo = (to, ms = 600) => { anim = { from: { ...cam }, to, t0: performance.now(), ms }; wake(); };
    const framing = () => ({ tx: 0, ty: 0, tz: 0, yaw: 0.6, pitch: 0.35, dist: clamp(extent * 2.3 * Math.max(1, H / W * 0.8), 14, 900) });

    function rebuild() {
      const fresh = api.root() !== shownRoot;
      if (fresh) { born = new Map(); shownRoot = api.root(); }
      layout();
      if (fresh) Object.assign(cam, framing());
      wake();
    }

    function focusOn(s) {
      flyTo({ tx: s.p[0], ty: s.p[1], tz: s.p[2], dist: clamp(Math.min(cam.dist, s.n.dir ? 14 + s.r * 10 : 10), 5, 900) });
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

    // The nearest body under the pointer, front-most first.
    const pick = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      const x = cx - r.left, y = cy - r.top;
      let best = null;
      for (const it of drawn) {
        const d = Math.hypot(it.x - x, it.y - y);
        if (d <= Math.max(6, it.pr + 3) && (!best || it.c[2] < best.c[2])) best = it;
      }
      return best?.s || null;
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
          const k = (cam.dist / B.focal) * 1.2;
          cam.tx = drag.from.tx - (dx * B.r[0] - dy * B.u[0]) * k;
          cam.ty = drag.from.ty - (dx * B.r[1] - dy * B.u[1]) * k;
          cam.tz = drag.from.tz - (dx * B.r[2] - dy * B.u[2]) * k;
        } else {
          cam.yaw = drag.from.yaw - dx * 0.008;
          cam.pitch = clamp(drag.from.pitch + dy * 0.006, -1.45, 1.45);
        }
        wake();
        return;
      }
      const s = pick(e.clientX, e.clientY);
      if (s !== hover) {
        hover = s;
        canvas.style.cursor = s ? 'pointer' : 'grab';
        if (s) {
          const n = s.n;
          tip.textContent = n.dir ? `${n.name}/  ·  ${n.children ? `${n.children.length} items` : 'click to open'}` : `${n.name}  ·  ${fmtSize(n.size) || 'file'}`;
          tip.classList.remove('hidden');
        } else tip.classList.add('hidden');
        wake();
      }
      if (s) {
        const r = box.getBoundingClientRect();
        tip.style.left = `${Math.min(r.width - 10, e.clientX - r.left + 12)}px`;
        tip.style.top = `${e.clientY - r.top + 12}px`;
      }
    });
    canvas.addEventListener('pointerup', async e => {
      const d = drag;
      drag = null;
      if (!d || d.moved) return;
      const s = pick(e.clientX, e.clientY);
      if (!s) return;
      focus = s;
      api.select(s.n.path);
      if (s.n.dir && !s.n.children) await api.open(s.n);
      else focusOn(s);
    });
    canvas.addEventListener('pointerleave', () => { if (hover) { hover = null; tip.classList.add('hidden'); wake(); } });
    canvas.addEventListener('dblclick', e => { const s = pick(e.clientX, e.clientY); if (s) api.activate(s.n); });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      anim = null;
      cam.dist = clamp(cam.dist * (e.deltaY < 0 ? 1 / 1.12 : 1.12), 3, 1200);
      wake();
    }, { passive: false });

    readColors();
    return {
      rebuild,
      fit() { flyTo(framing()); },
      wake,
      recolor() { readColors(); wake(); },
      highlight(path) {
        const s = byPath.get(path) || null;
        focus = s;
        if (s) focusOn(s); else wake();
      },
      dispose() { ro.disconnect(); if (raf) cancelAnimationFrame(raf); }
    };
  }

  window.LumenConstellation = { create };
})();
