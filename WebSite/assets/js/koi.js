// ASCII koi pond: the same fish as Lumen's "koi" background, drawn with characters.
// Usage: KoiPond.mount(canvas, { density, fontPx, interactive })
(function () {
  const TAU = Math.PI * 2;
  const RAMP = ' .:-=+*#%@';
  const SEGMENTS = 14;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  const WHITE = '#f1ece4';
  const RED = '#e5432a';
  const ORANGE = '#ff7a2a';
  const GOLD = '#f0c04a';
  const INK = '#4a4a52';
  const BREEDS = [
    { body: () => ORANGE, fin: '#ffa863' },
    { body: i => ([1, 2, 3, 6, 7, 8].includes(i) ? RED : WHITE), fin: WHITE },               // kohaku
    { body: () => GOLD, fin: '#f7d98a' },                                                     // ogon
    { body: i => (i === 1 ? RED : WHITE), fin: WHITE },                                       // tancho
    { body: i => ([1, 2, 7].includes(i) ? RED : [4, 9].includes(i) ? INK : WHITE), fin: WHITE }, // sanke
    { body: () => ORANGE, fin: '#ffa863' }
  ];

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${clamp(a, 0, 1)})`;
  }

  function mount(canvas, opts = {}) {
    const ctx = canvas.getContext('2d');
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const font = getComputedStyle(document.documentElement).getPropertyValue('--mono') || 'monospace';
    const mouse = { x: -9999, y: -9999 };
    let w = 0, h = 0, cw = 7, ch = 13, cols = 0, rows = 0, ascent = 10;
    let dens = new Float32Array(0);
    let color = [];
    let fish = [];
    let drops = [];
    let size = 1;
    let fontPx = opts.fontPx || 12;
    let running = false;
    let visible = true;
    let last = 0;
    let t = 0;
    let water = '#7aa2f7';
    let ripple = '#bb9af7';

    function themeColors() {
      const s = getComputedStyle(document.documentElement);
      water = s.getPropertyValue('--accent').trim() || water;
      ripple = s.getPropertyValue('--accent2').trim() || ripple;
    }

    function spawn(i) {
      const L = (240 + Math.random() * 130) * size;
      const a = Math.random() * TAU;
      const x = w * (0.1 + Math.random() * 0.8);
      const y = h * (0.15 + Math.random() * 0.7);
      const breed = BREEDS[i % BREEDS.length];
      const spine = [];
      for (let s = 0; s < SEGMENTS; s++) spine.push({ x: x - Math.cos(a) * s * (L / SEGMENTS), y: y - Math.sin(a) * s * (L / SEGMENTS) });
      return {
        a, L, seg: L / SEGMENTS, width: L * 0.145, spine,
        speed: (42 + Math.random() * 30) * size, turn: 0, phase: Math.random() * TAU,
        colors: Array.from({ length: SEGMENTS }, (_, s) => breed.body(s)), fin: breed.fin
      };
    }

    function stamp(x, y, r, value, col) {
      const sh = ch / 2;
      const x0 = Math.max(0, Math.floor((x - r) / cw));
      const x1 = Math.min(cols - 1, Math.floor((x + r) / cw));
      const y0 = Math.max(0, Math.floor((y - r) / sh));
      const y1 = Math.min(rows * 2 - 1, Math.floor((y + r) / sh));
      for (let sy = y0; sy <= y1; sy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const dx = (cx + 0.5) * cw - x;
          const dy = (sy + 0.5) * sh - y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= r * r) continue;
          const v = Math.sqrt(1 - Math.sqrt(d2) / r) * value;
          const idx = sy * cols + cx;
          if (v > dens[idx]) { dens[idx] = v; color[idx] = col; }
        }
      }
    }

    function resize() {
      const r = canvas.getBoundingClientRect();
      w = Math.max(1, Math.round(r.width));
      h = Math.max(1, Math.round(r.height));
      canvas.width = w;
      canvas.height = h;
      fontPx = opts.fontPx || (w < 700 ? 10 : 12);
      size = clamp(Math.min(w, h) / 900, 0.45, 1.15) * (opts.scale || 1);
      ctx.font = `${fontPx}px ${font}`;
      const m = ctx.measureText('█');
      cw = m.width || fontPx * 0.6;
      ascent = m.actualBoundingBoxAscent || fontPx;
      ch = Math.max(4, (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || fontPx * 1.2);
      cols = Math.ceil(w / cw);
      rows = Math.ceil(h / ch);
      dens = new Float32Array(cols * rows * 2);
      color = new Array(cols * rows * 2);
      const n = opts.count || clamp(Math.round((w * h) / 260000), 2, 7);
      fish = Array.from({ length: n }, (_, i) => spawn(i));
      themeColors();
    }

    function step(dt) {
      const s = Math.min(0.1, dt / 1000);
      for (const f of fish) {
        const head = f.spine[0];
        f.turn = clamp(f.turn + (Math.random() - 0.5) * 0.8 * s, -0.22, 0.22);
        let steer = f.turn;
        const m = f.L * 0.4;
        if (head.x < -m || head.x > w + m || head.y < -m || head.y > h + m) {
          steer += clamp(angleDiff(Math.atan2(h / 2 - head.y, w / 2 - head.x), f.a), -1, 1) * 0.25;
        }
        for (const o of fish) {
          if (o === f) continue;
          const dx = head.x - o.spine[0].x;
          const dy = head.y - o.spine[0].y;
          if (Math.hypot(dx, dy) < f.L * 0.6) steer += clamp(angleDiff(Math.atan2(dy, dx), f.a), -1, 1) * 0.2;
        }
        // Curious about the cursor.
        const md = Math.hypot(mouse.x - head.x, mouse.y - head.y);
        if (md < 340 && md > 40) steer += clamp(angleDiff(Math.atan2(mouse.y - head.y, mouse.x - head.x), f.a), -1, 1) * 0.2;
        f.a += clamp(steer, -0.38, 0.38) * s;
        const far = f.L * 1.1;
        const sx = head.x < -far ? w + far * 1.6 : head.x > w + far ? -(w + far * 1.6) : 0;
        const sy = head.y < -far ? h + far * 1.6 : head.y > h + far ? -(h + far * 1.6) : 0;
        if (sx || sy) for (const p of f.spine) { p.x += sx; p.y += sy; }
        const v = f.speed * (0.8 + 0.25 * Math.sin(t * 0.7 + f.phase));
        head.x += Math.cos(f.a) * v * s;
        head.y += Math.sin(f.a) * v * s;
        for (let i = 1; i < SEGMENTS; i++) {
          const p = f.spine[i];
          const q = f.spine[i - 1];
          const d = Math.hypot(p.x - q.x, p.y - q.y) || 1;
          p.x = q.x + ((p.x - q.x) / d) * f.seg;
          p.y = q.y + ((p.y - q.y) / d) * f.seg;
        }
      }
      if (Math.random() < s * 0.45) drops.push({ x: Math.random() * w, y: Math.random() * h, life: 1 });
      drops = drops.filter(d => (d.life -= s * 0.35) > 0);
    }

    function draw() {
      dens.fill(0);
      for (const f of fish) {
        const pts = f.spine.map((p, i) => {
          const q = f.spine[Math.min(i + 1, SEGMENTS - 1)];
          const r = f.spine[Math.max(i - 1, 0)];
          const ang = Math.atan2(r.y - q.y, r.x - q.x);
          const wave = Math.sin(t * 6 - i * 0.55 + f.phase) * f.width * 0.55 * Math.pow(i / SEGMENTS, 1.4);
          return { x: p.x - Math.sin(ang) * wave, y: p.y + Math.cos(ang) * wave, ang };
        });
        const fin = pts[3];
        const flap = 1 + 0.2 * Math.sin(t * 4 + f.phase);
        for (const side of [-1, 1]) {
          const px = fin.x - Math.sin(fin.ang) * side * f.width * 0.95 * flap - Math.cos(fin.ang) * f.width * 0.55;
          const py = fin.y + Math.cos(fin.ang) * side * f.width * 0.95 * flap - Math.sin(fin.ang) * f.width * 0.55;
          stamp(px, py, f.width * 0.5, 0.42, f.fin);
        }
        const tail = pts[SEGMENTS - 1];
        const swish = Math.sin(t * 6 + f.phase - SEGMENTS * 0.55);
        for (const side of [-1, 1]) {
          for (const reach of [0.45, 0.85]) {
            const spread = f.width * reach * (0.75 + 0.25 * side * swish);
            const tx = tail.x - Math.cos(tail.ang) * f.width * reach * 1.1 - Math.sin(tail.ang) * side * spread;
            const ty = tail.y - Math.sin(tail.ang) * f.width * reach * 1.1 + Math.cos(tail.ang) * side * spread;
            stamp(tx, ty, f.width * (0.55 - reach * 0.2), 0.5, f.fin);
          }
        }
        pts.forEach((p, i) => {
          const u = i / (SEGMENTS - 1);
          const r = f.width * (u < 0.3 ? 0.72 + 0.93 * u : 1 - 0.82 * Math.pow((u - 0.3) / 0.7, 1.2));
          stamp(p.x, p.y, Math.max(r, f.width * 0.18), 1, f.colors[i]);
        });
        const head = pts[0];
        for (const side of [-1, 1]) {
          const ex = head.x + Math.cos(head.ang) * f.width * 0.15 - Math.sin(head.ang) * side * f.width * 0.5;
          const ey = head.y + Math.sin(head.ang) * f.width * 0.15 + Math.cos(head.ang) * side * f.width * 0.5;
          const cx = Math.floor(ex / cw);
          const sy = Math.floor(ey / (ch / 2));
          if (cx >= 0 && sy >= 0 && cx < cols && sy < rows * 2) dens[sy * cols + cx] = 0;
        }
      }

      // One string per row and color: a frame is a few dozen fillText calls.
      const lines = new Map();
      const put = (c, cx, cy, g) => {
        let byRow = lines.get(c);
        if (!byRow) lines.set(c, (byRow = new Map()));
        let row = byRow.get(cy);
        if (!row) byRow.set(cy, (row = new Array(cols).fill(' ')));
        row[cx] = g;
      };
      const caustic = rgba(water, 0.16);
      const empty = new Uint8Array(cols * rows);
      for (let cy = 0; cy < rows; cy++) {
        const ra = Math.sin(cy * 0.13 - t * 0.45) * 2;
        const rb = cy * 0.31 - t * 0.55;
        for (let cx = 0; cx < cols; cx++) {
          const ti = cy * 2 * cols + cx;
          const bi = ti + cols;
          const top = dens[ti];
          const bot = dens[bi];
          const v = Math.max(top, bot);
          if (v > 0.06) {
            put(top >= bot ? color[ti] : color[bi], cx, cy, RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(v * (RAMP.length - 1)))]);
            continue;
          }
          empty[cy * cols + cx] = 1;
          const q = Math.sin(cx * 0.19 + t * 0.8 + ra) * Math.sin(rb + Math.sin(cx * 0.07 + t * 0.3) * 2);
          if (q > 0.93) put(caustic, cx, cy, q > 0.975 ? '~' : '-');
        }
      }
      for (const d of drops) {
        const r = (1 - d.life) * 70 * size + 4;
        const c = rgba(ripple, Math.round((d.life * 0.55 + 0.05) * 10) / 10);
        const steps = Math.max(8, Math.round(r / 3));
        for (let i = 0; i < steps; i++) {
          const cx = Math.floor((d.x + Math.cos((i / steps) * TAU) * r) / cw);
          const cy = Math.floor((d.y + Math.sin((i / steps) * TAU) * r * 0.9) / ch);
          if (cx >= 0 && cy >= 0 && cx < cols && cy < rows && empty[cy * cols + cx]) put(c, cx, cy, '·');
        }
      }

      ctx.clearRect(0, 0, w, h);
      ctx.font = `${fontPx}px ${font}`;
      ctx.textBaseline = 'alphabetic';
      for (const [c, byRow] of lines) {
        ctx.fillStyle = c;
        for (const [cy, row] of byRow) ctx.fillText(row.join(''), 0, cy * ch + ascent);
      }
    }

    function loop(now) {
      if (!running) return;
      if (!last) last = now - 40;
      const dt = now - last;
      // 24 fps is plenty for slow swimmers and keeps the page light.
      if (dt >= 40) {
        last = now;
        t += Math.min(0.1, dt / 1000);
        step(dt);
        draw();
      }
      requestAnimationFrame(loop);
    }

    function start() {
      if (running || !visible || document.hidden) return;
      running = true;
      last = 0;
      requestAnimationFrame(loop);
    }
    function stop() { running = false; }

    resize();
    // First frame right away: the pond is never empty, even before the first animation frame.
    for (let i = 0; i < 30; i++) step(40);
    draw();
    if (!reduced) start();

    // Resizing clears the canvas: redraw at once instead of waiting for the next frame.
    new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      if (Math.round(r.width) === w && Math.round(r.height) === h) return;
      resize();
      for (let i = 0; i < 30; i++) step(40);
      draw();
    }).observe(canvas);
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible && !reduced ? start() : stop(); }).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? stop() : !reduced && start()));
    if (opts.interactive !== false) {
      const host = opts.mouseTarget || canvas;
      host.addEventListener('pointermove', e => {
        const r = canvas.getBoundingClientRect();
        mouse.x = e.clientX - r.left;
        mouse.y = e.clientY - r.top;
      });
      host.addEventListener('pointerleave', () => { mouse.x = mouse.y = -9999; });
      // A click drops a pebble in the pond.
      host.addEventListener('pointerdown', e => {
        const r = canvas.getBoundingClientRect();
        drops.push({ x: e.clientX - r.left, y: e.clientY - r.top, life: 1 });
      });
    }
    return { refreshColors: themeColors };
  }

  window.KoiPond = { mount };
})();
