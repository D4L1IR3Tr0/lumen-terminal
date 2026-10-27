// Animated backdrops drawn behind the panes, tinted with the active theme.
//
// Each mode is a factory (ctx, env) -> { resize(w, h), frame(dt, t), ...flags } drawing in CSS
// pixels. Flags: resolution (canvas pixels per CSS pixel), pixelated, persistent (no clear
// between frames), fps. The same factories render the small previews in the settings drawer.
(function () {
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function rgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(hex, a) {
    const [r, g, b] = rgb(hex);
    return `rgba(${r}, ${g}, ${b}, ${clamp(a, 0, 1)})`;
  }
  function mix(a, b, t) {
    const A = rgb(a);
    const B = rgb(b);
    return '#' + A.map((x, i) => Math.round(x + (B[i] - x) * t).toString(16).padStart(2, '0')).join('');
  }
  const angleDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

  const MODES = {};

  // ─── Aurora: drifting soft light ─────────────────────────────────────
  MODES.aurora = (ctx, env) => {
    let w = 0;
    let h = 0;
    return {
      resolution: 0.25,
      fps: 24,
      resize(W, H) { w = W; h = H; },
      frame(_dt, t) {
        const { a, b, c, d, light } = env.colors;
        const k = env.opts.intensity;
        ctx.globalCompositeOperation = light ? 'multiply' : 'screen';
        [[a, 0.13, 0, 0.55], [b, 0.09, 2.1, 0.5], [c, 0.07, 4.2, 0.45], [d, 0.05, 1.3, 0.35]].forEach(([color, s, phase, size], i) => {
          const x = w * (0.5 + 0.38 * Math.sin(t * s + phase));
          const y = h * (0.5 + 0.34 * Math.cos(t * s * 1.3 + phase * 1.7 + i));
          const r = Math.max(w, h) * size;
          const g = ctx.createRadialGradient(x, y, 0, x, y, r);
          g.addColorStop(0, rgba(color, 0.55 * k));
          g.addColorStop(0.5, rgba(color, 0.18 * k));
          g.addColorStop(1, rgba(color, 0));
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, w, h);
        });
        ctx.globalCompositeOperation = 'source-over';
      }
    };
  };

  // ─── Constellation: drifting points linked by proximity ──────────────
  MODES.constellation = (ctx, env) => {
    let w = 0;
    let h = 0;
    let pts = [];
    return {
      resolution: 0.75,
      fps: 24,
      resize(W, H) {
        w = W; h = H;
        const count = Math.min(140, Math.round((w * h) / 14000));
        pts = Array.from({ length: Math.max(8, count) }, () => ({
          x: Math.random() * w, y: Math.random() * h,
          vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
          r: 0.8 + Math.random() * 1.4
        }));
      },
      frame(dt) {
        const { a, b } = env.colors;
        const k = env.opts.intensity;
        const step = (dt / 1000) * env.opts.speed;
        const max = env.preview ? 40 : 140;
        for (const p of pts) {
          p.x = (p.x + p.vx * step + w + 20) % (w + 20) - 10;
          p.y = (p.y + p.vy * step + h + 20) % (h + 20) - 10;
        }
        ctx.lineWidth = 1;
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          for (let j = i + 1; j < pts.length; j++) {
            const q = pts[j];
            const dx = p.x - q.x;
            const dy = p.y - q.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > max * max) continue;
            ctx.strokeStyle = rgba(a, (1 - Math.sqrt(d2) / max) * 0.35 * k);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
          }
          const md = Math.hypot(p.x - env.mouse.x, p.y - env.mouse.y);
          if (md < 180) {
            ctx.strokeStyle = rgba(b, (1 - md / 180) * 0.5 * k);
            ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(env.mouse.x, env.mouse.y); ctx.stroke();
          }
        }
        ctx.fillStyle = rgba(b, 0.75 * k + 0.15);
        for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill(); }
      }
    };
  };

  // ─── Waves: layered flowing lines ────────────────────────────────────
  MODES.waves = (ctx, env) => {
    let w = 0;
    let h = 0;
    return {
      resolution: 0.75,
      fps: 24,
      resize(W, H) { w = W; h = H; },
      frame(_dt, t) {
        const { a, b } = env.colors;
        const k = env.opts.intensity;
        const lines = 6;
        for (let i = 0; i < lines; i++) {
          const f = i / (lines - 1);
          const base = h * (0.52 + f * 0.36);
          const amp = h * (0.05 + 0.03 * Math.sin(i * 1.7));
          const grad = ctx.createLinearGradient(0, 0, w, 0);
          grad.addColorStop(0, rgba(a, (0.55 - f * 0.3) * k));
          grad.addColorStop(1, rgba(b, (0.55 - f * 0.3) * k));
          ctx.beginPath();
          for (let x = 0; x <= w + 8; x += 8) {
            const y = base + Math.sin(x * 0.0035 + t * 0.6 + i * 0.9) * amp + Math.sin(x * 0.0011 - t * 0.35 + i * 2.1) * amp * 0.8;
            if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = grad;
          ctx.lineWidth = 1.5;
          ctx.stroke();
          if (i === 0) {
            ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
            const fill = ctx.createLinearGradient(0, base - amp, 0, h);
            fill.addColorStop(0, rgba(a, 0.1 * k));
            fill.addColorStop(1, rgba(b, 0));
            ctx.fillStyle = fill;
            ctx.fill();
          }
        }
      }
    };
  };

  // ─── Koi: goldfish pond seen from above ──────────────────────────────
  // Two renderings of the same simulation:
  //   "ascii"  -> density ramp  .:-=+*#%@
  //   "blocks" -> each cell split into two half-height sub-cells, drawn as █ ▀ ▄
  const RAMP = ' .:-=+*#%@';
  MODES.koi = (ctx, env) => makeKoi(ctx, env, 'ascii');
  MODES['koi-blocks'] = (ctx, env) => makeKoi(ctx, env, 'blocks');

  function makeKoi(ctx, env, style) {
    const SEGMENTS = 14;
    const WHITE = '#f1ece4';
    const RED = '#e5432a';
    const ORANGE = '#ff7a2a';
    const GOLD = '#f0c04a';
    const INK = '#4a4a52';
    // Segment colour patterns, head first.
    const BREEDS = [
      { body: i => ORANGE, fin: '#ffa863' },
      { body: i => ORANGE, fin: '#ffa863' },
      { body: i => ([1, 2, 3, 6, 7, 8].includes(i) ? RED : WHITE), fin: WHITE },   // kohaku
      { body: i => (i === 1 ? RED : WHITE), fin: WHITE },                          // tancho
      { body: i => GOLD, fin: '#f7d98a' },                                         // ogon
      { body: i => ([1, 2, 7].includes(i) ? RED : [4, 9].includes(i) ? INK : WHITE), fin: WHITE } // sanke
    ];

    let w = 0;
    let h = 0;
    let cw = 8;
    let ch = 16;
    let cols = 0;
    let rows = 0;
    let dens = new Float32Array(0);
    let color = [];
    let fish = [];
    let drops = [];
    let fontPx = 13;
    let ascent = 10;
    let size = 1;

    function spawn(i) {
      const L = (240 + Math.random() * 120) * size;
      const a = Math.random() * TAU;
      const x = w * (0.15 + Math.random() * 0.7);
      const y = h * (0.15 + Math.random() * 0.7);
      const breed = BREEDS[i % BREEDS.length];
      const spine = [];
      for (let s = 0; s < SEGMENTS; s++) spine.push({ x: x - Math.cos(a) * s * (L / SEGMENTS), y: y - Math.sin(a) * s * (L / SEGMENTS) });
      return {
        a, L, seg: L / SEGMENTS, width: L * 0.145, spine,
        speed: (45 + Math.random() * 30) * size, turn: 0, phase: Math.random() * TAU,
        colors: Array.from({ length: SEGMENTS }, (_, s) => breed.body(s)), fin: breed.fin
      };
    }

    // Writes a soft disc into the half-height sub-cell grid (cols × rows*2).
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

    function tone(c) {
      // Pale fish would vanish on light themes: darken them a little there.
      return env.colors.light && (c === WHITE) ? '#b8b0a4' : c;
    }

    return {
      // Backgrounds never render above 1x: on high-DPI screens that alone halves GPU work.
      resolution: 1,
      fps: 24, // slow swimmers, but 24 fps keeps them smooth
      resize(W, H) {
        w = W; h = H;
        fontPx = env.preview ? 5 : 11;
        size = env.preview ? 0.2 : clamp(Math.min(w, h) / 1000, 0.6, 1.2);
        // Cells take the exact box of the block glyph so shades tile with no gaps.
        ctx.font = `${fontPx}px ${env.font}`;
        const m = ctx.measureText('█');
        cw = m.width || fontPx * 0.6;
        ascent = m.actualBoundingBoxAscent || fontPx;
        ch = Math.max(4, (m.actualBoundingBoxAscent + m.actualBoundingBoxDescent) || fontPx * 1.2);
        cols = Math.ceil(w / cw);
        rows = Math.ceil(h / ch);
        dens = new Float32Array(cols * rows * 2);
        color = new Array(cols * rows * 2);
        const n = env.preview ? 2 : clamp(Math.round((w * h) / 380000), 3, 7);
        fish = Array.from({ length: n }, (_, i) => spawn(i));
        drops = [];
      },
      frame(dt, t) {
        const s = Math.min(0.1, dt / 1000) * env.opts.speed;
        const k = env.opts.intensity;

        // Swim: wander gently, keep away from each other, get curious about the cursor.
        // Turn rate stays low so the turning radius is longer than the fish (no "banana" bodies);
        // fish that leave the pond re-enter from the opposite side.
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
          const md = Math.hypot(env.mouse.x - head.x, env.mouse.y - head.y);
          if (md < 320 && md > 40) steer += clamp(angleDiff(Math.atan2(env.mouse.y - head.y, env.mouse.x - head.x), f.a), -1, 1) * 0.18;
          f.a += clamp(steer, -0.38, 0.38) * s;
          const far = f.L * 1.1;
          const shift = head.x < -far ? w + far * 1.6 : head.x > w + far ? -(w + far * 1.6) : 0;
          const shiftY = head.y < -far ? h + far * 1.6 : head.y > h + far ? -(h + far * 1.6) : 0;
          if (shift || shiftY) for (const p of f.spine) { p.x += shift; p.y += shiftY; }
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

        // Occasional drops on the surface.
        if (Math.random() < s * 0.35) drops.push({ x: Math.random() * w, y: Math.random() * h, r: 0, life: 1 });
        drops = drops.filter(d => (d.life -= s * 0.35) > 0);

        dens.fill(0);
        for (const f of fish) {
          // Swimming undulation travels from head to tail.
          const pts = f.spine.map((p, i) => {
            const q = f.spine[Math.min(i + 1, SEGMENTS - 1)];
            const r = f.spine[Math.max(i - 1, 0)];
            const ang = Math.atan2(r.y - q.y, r.x - q.x);
            const wave = Math.sin(t * 6 * env.opts.speed - i * 0.55 + f.phase) * f.width * 0.55 * Math.pow(i / SEGMENTS, 1.4);
            return { x: p.x - Math.sin(ang) * wave, y: p.y + Math.cos(ang) * wave, ang };
          });
          // Fins first so the body draws over them.
          // Pectoral fins: small, swept back, just off the body.
          const fin = pts[3];
          const flap = 1 + 0.2 * Math.sin(t * 4 + f.phase);
          for (const side of [-1, 1]) {
            const px = fin.x - Math.sin(fin.ang) * side * f.width * 0.95 * flap - Math.cos(fin.ang) * f.width * 0.55;
            const py = fin.y + Math.cos(fin.ang) * side * f.width * 0.95 * flap - Math.sin(fin.ang) * f.width * 0.55;
            stamp(px, py, f.width * 0.5, 0.42, f.fin);
          }
          // Tail: a forked fan that swishes with the body wave.
          const tail = pts[SEGMENTS - 1];
          const swish = Math.sin(t * 6 * env.opts.speed + f.phase - SEGMENTS * 0.55);
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
            stamp(p.x, p.y, Math.max(r, f.width * 0.18), 1, tone(f.colors[i]));
          });
          // Eyes: two holes near the head.
          const head = pts[0];
          for (const side of [-1, 1]) {
            const ex = head.x + Math.cos(head.ang) * f.width * 0.15 - Math.sin(head.ang) * side * f.width * 0.5;
            const ey = head.y + Math.sin(head.ang) * f.width * 0.15 + Math.cos(head.ang) * side * f.width * 0.5;
            const cx = Math.floor(ex / cw);
            const sy = Math.floor(ey / (ch / 2));
            if (cx >= 0 && sy >= 0 && cx < cols && sy < rows * 2) dens[sy * cols + cx] = 0;
          }
        }

        // Turn each pair of sub-cells into one block character.
        const groups = new Map();
        const put = (c, cx, cy, glyph) => {
          if (!groups.has(c)) groups.set(c, []);
          groups.get(c).push(cx, cy, glyph);
        };
        const water = rgba(env.colors.a, 0.14 * k + 0.04);
        const empty = new Uint8Array(cols * rows);
        // Caustics, split into per-column and per-row terms with sin(a+b) = sin a·cos b + cos a·sin b,
        // so each cell costs a few multiplications instead of four sines.
        const cSa = new Float32Array(cols);
        const cCa = new Float32Array(cols);
        const cSb = new Float32Array(cols);
        const cCb = new Float32Array(cols);
        for (let cx = 0; cx < cols; cx++) {
          const a = cx * 0.19 + t * 0.8;
          const b = Math.sin(cx * 0.07 + t * 0.3) * 2;
          cSa[cx] = Math.sin(a); cCa[cx] = Math.cos(a);
          cSb[cx] = Math.sin(b); cCb[cx] = Math.cos(b);
        }
        const rSa = new Float32Array(rows);
        const rCa = new Float32Array(rows);
        const rSb = new Float32Array(rows);
        const rCb = new Float32Array(rows);
        for (let cy = 0; cy < rows; cy++) {
          const a = Math.sin(cy * 0.13 - t * 0.45) * 2;
          const b = cy * 0.31 - t * 0.55;
          rSa[cy] = Math.sin(a); rCa[cy] = Math.cos(a);
          rSb[cy] = Math.sin(b); rCb[cy] = Math.cos(b);
        }
        for (let cy = 0; cy < rows; cy++) {
          for (let cx = 0; cx < cols; cx++) {
            const ti = (cy * 2) * cols + cx;
            const bi = ti + cols;
            const top = dens[ti];
            const bot = dens[bi];
            if (style === 'ascii') {
              const v = Math.max(top, bot);
              if (v > 0.06) {
                put(top >= bot ? color[ti] : color[bi], cx, cy, RAMP[Math.min(RAMP.length - 1, 1 + Math.floor(v * (RAMP.length - 1)))]);
                continue;
              }
            }
            const on = 0.22;
            const glyph = style === 'blocks' ? (top > on && bot > on ? '█' : top > on ? '▀' : bot > on ? '▄' : null) : null;
            if (glyph) {
              // Shade by depth into the body: lit spine, darker flanks.
              const v = Math.max(top, bot);
              const c = top >= bot ? color[ti] : color[bi];
              const shade = v > 0.82 ? mix(c, '#ffffff', 0.12) : v > 0.36 ? c : mix(c, env.colors.base, 0.25);
              put(shade, cx, cy, glyph);
              continue;
            }
            empty[cy * cols + cx] = 1;
            // Caustics: thin shimmering lines on the water.
            const q = (cSa[cx] * rCa[cy] + cCa[cx] * rSa[cy]) * (rSb[cy] * cCb[cx] + rCb[cy] * cSb[cx]);
            if (q > 0.93) put(water, cx, cy, q > 0.975 ? '~' : '-');
          }
        }
        for (const d of drops) {
          const r = (1 - d.life) * 70 * size + 4;
          // Alpha in steps of 0.1 so ripples reuse a handful of cached glyphs.
          const c = rgba(env.colors.b, Math.round((d.life * 0.6 * k + 0.05) * 10) / 10);
          const steps = Math.max(8, Math.round(r / 3));
          for (let i = 0; i < steps; i++) {
            const cx = Math.floor((d.x + Math.cos((i / steps) * TAU) * r) / cw);
            const cy = Math.floor((d.y + Math.sin((i / steps) * TAU) * r * 0.9) / ch);
            if (cx >= 0 && cy >= 0 && cx < cols && cy < rows && empty[cy * cols + cx]) put(c, cx, cy, '·');
          }
        }

        // Solid and half blocks are drawn as exact rectangles (no seams between rows).
        // Other glyphs are gathered into one string per row and color and drawn with a single
        // fillText each: the font is monospaced, so columns stay aligned, and a frame costs a
        // few dozen calls instead of thousands.
        ctx.font = `${fontPx}px ${env.font}`;
        ctx.textBaseline = 'alphabetic';
        for (const [c, cells] of groups) {
          const lines = new Map();
          ctx.fillStyle = c;
          for (let i = 0; i < cells.length; i += 3) {
            const g = cells[i + 2];
            const x0 = Math.floor(cells[i] * cw);
            const x1 = Math.ceil((cells[i] + 1) * cw);
            const y0 = Math.floor(cells[i + 1] * ch);
            const y1 = Math.ceil((cells[i + 1] + 1) * ch);
            const ym = Math.round((cells[i + 1] + 0.5) * ch);
            if (g === '█') ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
            else if (g === '▀') ctx.fillRect(x0, y0, x1 - x0, ym - y0);
            else if (g === '▄') ctx.fillRect(x0, ym, x1 - x0, y1 - ym);
            else {
              let line = lines.get(cells[i + 1]);
              if (!line) lines.set(cells[i + 1], (line = { min: cols, chars: new Array(cols).fill(' ') }));
              line.chars[cells[i]] = g;
              if (cells[i] < line.min) line.min = cells[i];
            }
          }
          for (const [row, line] of lines) {
            ctx.fillText(line.chars.slice(line.min).join('').trimEnd(), line.min * cw, row * ch + ascent);
          }
        }
      }
    };
  }

  // ─── Jellyfish: drifting ASCII medusae in deep water ─────────────────
  MODES.jellyfish = (ctx, env) => {
    let w = 0;
    let h = 0;
    let cw = 8;
    let ch = 16;
    let cols = 0;
    let rows = 0;
    let fontPx = 13;
    let size = 1;
    let jellies = [];
    let snow = [];
    let cells = new Map(); // idx -> [priority, glyph, color]

    function spawn(i, fromBottom) {
      const R = (58 + Math.random() * 40) * size;
      const palette = [env.colors.b, env.colors.c, env.colors.d, env.colors.a];
      return {
        x: w * (0.1 + Math.random() * 0.8),
        y: fromBottom ? h + R * 2 + Math.random() * h * 0.3 : h * (0.15 + Math.random() * 0.75),
        R,
        phase: Math.random() * TAU,
        rate: 0.8 + Math.random() * 0.5,
        drift: (Math.random() - 0.5) * 14 * size,
        tentacles: 5 + ((Math.random() * 4) | 0),
        length: 9 + ((Math.random() * 7) | 0),
        color: palette[i % palette.length]
      };
    }

    function put(x, y, glyph, col, alpha, priority) {
      const cx = Math.floor(x / cw);
      const cy = Math.floor(y / ch);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
      const idx = cy * cols + cx;
      const prev = cells.get(idx);
      if (prev && prev[0] > priority) return;
      cells.set(idx, [priority, glyph, rgba(col, alpha)]);
    }

    return {
      resolution: 1,
      fps: 24,
      resize(W, H) {
        w = W; h = H;
        fontPx = env.preview ? 5 : 13;
        size = env.preview ? 0.22 : clamp(Math.min(w, h) / 900, 0.7, 1.3);
        ctx.font = `${fontPx}px ${env.font}`;
        cw = ctx.measureText('M').width || fontPx * 0.6;
        ch = Math.round(fontPx * 1.25);
        cols = Math.ceil(w / cw);
        rows = Math.ceil(h / ch);
        const n = env.preview ? 2 : clamp(Math.round((w * h) / 330000), 3, 7);
        jellies = Array.from({ length: n }, (_, i) => spawn(i, false));
        snow = Array.from({ length: env.preview ? 12 : 90 }, () => ({ x: Math.random() * w, y: Math.random() * h, v: 4 + Math.random() * 8, a: Math.random() }));
      },
      frame(dt, t) {
        const s = Math.min(0.1, dt / 1000) * env.opts.speed;
        const k = env.opts.intensity;
        cells = new Map();

        // Light shafts from the surface.
        for (let i = 0; i < 3; i++) {
          const x = w * (0.2 + i * 0.3) + Math.sin(t * 0.15 + i * 2) * w * 0.05;
          const g = ctx.createLinearGradient(0, 0, 0, h * 0.85);
          g.addColorStop(0, rgba(env.colors.c, 0.045 * k));
          g.addColorStop(1, rgba(env.colors.c, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x - w * 0.03, 0);
          ctx.lineTo(x + w * 0.05, 0);
          ctx.lineTo(x + w * 0.16, h * 0.85);
          ctx.lineTo(x - w * 0.02, h * 0.85);
          ctx.fill();
        }

        // Marine snow.
        for (const p of snow) {
          p.y += p.v * s;
          p.x += Math.sin(t * 0.5 + p.a * 10) * 3 * s;
          if (p.y > h) { p.y = -5; p.x = Math.random() * w; }
          put(p.x, p.y, p.a > 0.7 ? '·' : '.', env.colors.fg, 0.12 + 0.25 * p.a * k, 0);
        }

        jellies.forEach((j, idx) => {
          // Swim in pulses: the bell contracts, pushes up, then relaxes and sinks.
          const beat = Math.sin(t * 1.6 * j.rate + j.phase);
          const squeeze = Math.max(0, beat);
          j.y += (squeeze > 0 ? -squeeze * 46 * size : 9 * size) * s;
          j.x += (j.drift + Math.sin(t * 0.3 + j.phase) * 8 * size) * s;
          if (j.x < -j.R * 2) j.x = w + j.R; else if (j.x > w + j.R * 2) j.x = -j.R;
          if (j.y < -j.R * 4) jellies[idx] = spawn(idx, true);

          const bw = j.R * (1 - 0.2 * squeeze);
          const bh = j.R * (0.72 + 0.16 * squeeze);
          const col = env.colors.light ? mix(j.color, '#000000', 0.25) : j.color;

          // Bell: soft inside, crisp outline, inner rings like a moon jelly.
          for (let y = j.y - bh; y < j.y; y += ch * 0.5) {
            const half = bw * Math.sqrt(Math.max(0, 1 - ((j.y - y) / bh) ** 2));
            for (let x = j.x - half; x <= j.x + half; x += cw) {
              const rx = (x - j.x) / bw;
              const ry = (j.y - y) / bh;
              const ring = Math.abs(Math.hypot(rx * 1.6, ry * 1.4 - 0.45) - 0.38) < 0.09;
              put(x, y, ring ? 'o' : ry > 0.55 ? ':' : '.', col, ring ? 0.75 * k + 0.2 : 0.3 * k + 0.1, 1);
            }
          }
          const steps = Math.max(14, Math.round((bw * 3.2) / cw));
          for (let i = 0; i <= steps; i++) {
            const th = Math.PI + (i / steps) * Math.PI;
            const x = j.x + Math.cos(th) * bw;
            const y = j.y + Math.sin(th) * bh;
            const u = i / steps;
            const glyph = u < 0.12 ? '(' : u < 0.32 ? '/' : u < 0.68 ? (y < j.y - bh * 0.92 ? '_' : '-') : u < 0.88 ? '\\' : ')';
            put(x, y, glyph, col, 0.85 * k + 0.15, 3);
          }
          // Scalloped rim.
          for (let x = j.x - bw; x <= j.x + bw; x += cw) {
            const wave = Math.sin(x * 0.25 + t * 3) > 0;
            put(x, j.y, wave ? '~' : '^', col, 0.7 * k + 0.2, 2);
          }

          // Tentacles trail and sway; they bunch up when the bell squeezes.
          const seg = j.R * 0.24;
          for (let i = 0; i < j.tentacles; i++) {
            const ax = j.x - bw * 0.85 + (i / (j.tentacles - 1)) * bw * 1.7;
            let px = ax;
            let py = j.y + ch * 0.6;
            for (let n = 1; n <= j.length; n++) {
              const nx = ax + Math.sin(t * 1.8 * j.rate - n * 0.45 + i * 1.3) * seg * 0.35 * Math.pow(n, 0.85) - j.drift * n * 0.04;
              const ny = py + seg * (1 - 0.3 * squeeze);
              const dx = nx - px;
              const glyph = n > j.length - 2 ? '.' : Math.abs(dx) < seg * 0.25 ? '|' : dx > 0 ? '\\' : '/';
              put(nx, ny, glyph, col, (1 - n / (j.length + 2)) * (0.7 * k + 0.2), 1);
              px = nx;
              py = ny;
            }
          }
          // Two frilly oral arms in the middle.
          for (const side of [-1, 1]) {
            let py = j.y + ch * 0.6;
            for (let n = 1; n <= Math.round(j.length * 0.7); n++) {
              const nx = j.x + side * bw * 0.15 + Math.sin(t * 1.1 - n * 0.6 + side) * seg * 0.5;
              py += seg * 0.85 * (1 - 0.25 * squeeze);
              put(nx, py, Math.sin(t * 2 - n + side) > 0 ? '(' : ')', col, (1 - n / j.length) * (0.8 * k + 0.2), 2);
            }
          }
        });

        ctx.font = `${fontPx}px ${env.font}`;
        ctx.textBaseline = 'top';
        const byColor = new Map();
        for (const [idx, [, glyph, c]] of cells) {
          if (!byColor.has(c)) byColor.set(c, []);
          byColor.get(c).push(idx, glyph);
        }
        for (const [c, list] of byColor) {
          ctx.fillStyle = c;
          for (let i = 0; i < list.length; i += 2) {
            const idx = list[i];
            ctx.fillText(list[i + 1], (idx % cols) * cw, Math.floor(idx / cols) * ch);
          }
        }
      }
    };
  };

  // ─── Dither: ordered (Bayer 8×8) dithering of a slowly warping field ──
  MODES.dither = (ctx, env) => {
    const B = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
      3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map(v => (v + 0.5) / 64);
    let w = 0;
    let h = 0;
    let bw = 0;
    let bh = 0;
    let off = null;
    let octx = null;
    let img = null;
    let px = null;
    const cell = env.preview ? 2 : 4;

    function packed(hex) {
      const [r, g, b] = rgb(hex);
      return (255 << 24) | (b << 16) | (g << 8) | r; // little-endian RGBA
    }

    return {
      resolution: 1,
      pixelated: true,
      fps: 20, // a slightly steppy dither is part of the look
      resize(W, H) {
        w = W; h = H;
        bw = Math.ceil(w / cell);
        bh = Math.ceil(h / cell);
        off = document.createElement('canvas');
        off.width = bw;
        off.height = bh;
        octx = off.getContext('2d');
        img = octx.createImageData(bw, bh);
        px = new Uint32Array(img.data.buffer);
      },
      frame(_dt, t) {
        const { base, a, b, light } = env.colors;
        const k = env.opts.intensity;
        const levels = [packed(base), packed(mix(base, a, 0.12 + 0.2 * k)), packed(mix(base, b, 0.25 + 0.35 * k))];
        const T = t * 0.6;
        // Separable warped field: sin(X+Y) and cos(U+V) expand into per-row/per-column terms.
        const X = new Float32Array(bw);
        const V = new Float32Array(bw);
        for (let x = 0; x < bw; x++) {
          const nx = (x / bw) * 4;
          const q = Math.sin(nx * 1.3 + T * 0.35);
          X[x] = nx * 1.1 + q * 1.4 + T * 0.2;
          V[x] = -nx * 0.4 + q * 0.8 - T * 0.31;
        }
        const sX = X.map(Math.sin);
        const cX = X.map(Math.cos);
        const sV = V.map(Math.sin);
        const cV = V.map(Math.cos);
        for (let y = 0; y < bh; y++) {
          const ny = (y / bh) * 3;
          const q = Math.sin(ny * 1.7 - T * 0.27);
          const Y = ny * 0.9 + q * 1.4;
          const U = ny * 1.3 + q * 0.8;
          const sY = Math.sin(Y);
          const cY = Math.cos(Y);
          const sU = Math.sin(U);
          const cU = Math.cos(U);
          const fade = light ? 1 : 0.55 + 0.45 * (y / bh); // a touch brighter towards the bottom
          const row = y * bw;
          const by = (y & 7) * 8;
          for (let x = 0; x < bw; x++) {
            const s = sX[x] * cY + cX[x] * sY;
            const c = cU * cV[x] - sU * sV[x];
            let v = (0.5 + 0.5 * s * c) * fade;
            v = v * v * 2;
            const lv = Math.min(1.999, v);
            const lo = lv | 0;
            px[row + x] = levels[lo + (lv - lo > B[by + (x & 7)] ? 1 : 0)];
          }
        }
        octx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, bw * cell, bh * cell);
      }
    };
  };

  // ─── Background images: dithered (still or alive) and ASCII ─────────
  // The image comes from ~/.lumen/backgrounds as a resized JPEG data URL (env.opts.imagePath),
  // sampled once per size; frames only redo the cheap part.

  const imageCache = new Map(); // path -> Promise<HTMLImageElement|null>
  function loadImage(file) {
    if (!file) return Promise.resolve(null);
    if (!imageCache.has(file)) {
      imageCache.set(file, (window.native?.image?.sample(file, 1600) || Promise.resolve(null)).then(url => new Promise(resolve => {
        if (!url) return resolve(null);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      })));
      if (imageCache.size > 6) imageCache.delete(imageCache.keys().next().value);
    }
    return imageCache.get(file);
  }

  // Draws the image "cover"-fitted for a W×H area onto a cols×rows grid; returns its pixels.
  function sampleCover(img, W, H, cols, rows) {
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = 'high';
    const scale = Math.max(W / img.width, H / img.height);
    const sw = W / scale;
    const sh = H / scale;
    x.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, 0, 0, cols, rows);
    return { canvas: c, data: x.getImageData(0, 0, cols, rows).data };
  }

  const BAYER8 = [0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26, 12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25, 15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21].map(v => (v + 0.5) / 64);

  // Ordered dithering of the image in the theme's colors. Animated: a slow light wave crosses
  // it and the threshold pattern drifts, so the picture shimmers like an old screen.
  function makeImageDither(ctx, env, animated) {
    const cell = env.preview ? 2 : 3;
    let W = 0, H = 0, bw = 0, bh = 0;
    let lum = null;
    let off = null, octx = null, img = null, px = null;
    let source = null;
    let alive = true;

    function packed(hex) {
      const [r, g, b] = rgb(hex);
      return (255 << 24) | (b << 16) | (g << 8) | r;
    }

    function sample() {
      if (!source || !bw) return;
      const { data } = sampleCover(source, W, H, bw, bh);
      lum = new Float32Array(bw * bh);
      for (let i = 0; i < bw * bh; i++) {
        const l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
        // Lifted shadows and a little more contrast read better in 4 tones.
        lum[i] = Math.min(1, Math.max(0, (Math.pow(l, 0.75) - 0.5) * 1.25 + 0.5));
      }
    }

    loadImage(env.opts.imagePath).then(im => {
      if (!alive || !im) return;
      source = im;
      sample();
      env.repaint?.();
    });

    return {
      resolution: 1,
      pixelated: true,
      fps: 12,
      still: !animated,
      resize(w, h) {
        W = w; H = h;
        bw = Math.ceil(w / cell);
        bh = Math.ceil(h / cell);
        off = document.createElement('canvas');
        off.width = bw;
        off.height = bh;
        octx = off.getContext('2d');
        img = octx.createImageData(bw, bh);
        px = new Uint32Array(img.data.buffer);
        sample();
      },
      frame(_dt, t) {
        if (!lum) return;
        const { base, a, b, fg } = env.colors;
        const dim = Math.min(0.9, Math.max(0, env.opts.dim ?? 0.35));
        // Four tones from the theme, darkened by the "dim" setting.
        const top = mix(mix(fg, b, 0.25), base, dim * 0.45);
        const levels = [packed(base), packed(mix(base, a, 0.55 - dim * 0.2)), packed(mix(mix(a, b, 0.45), base, dim * 0.3)), packed(top)];
        const n = levels.length - 1;
        const T = t * 0.9;
        const shift = animated ? Math.floor(t * 3) : 0;
        const band = animated ? (t * 0.07) % 1.3 - 0.15 : -9;
        // The ripple sin(x·0.03 + T + 2·wy) is split with sin(a+b) = sin a·cos b + cos a·sin b:
        // one sine per column and one per row instead of one per pixel.
        const sA = new Float32Array(bw);
        const cA = new Float32Array(bw);
        if (animated) for (let x = 0; x < bw; x++) { sA[x] = Math.sin(x * 0.03 + T); cA[x] = Math.cos(x * 0.03 + T); }
        for (let y = 0; y < bh; y++) {
          const row = y * bw;
          const by = ((y + shift) & 7) * 8;
          const ny = y / bh;
          const scan = animated ? 0.16 * Math.exp(-((ny - band) ** 2) / 0.003) : 0;
          const wy = animated ? 2 * Math.sin(y * 0.045 - T * 0.7) : 0;
          const sB = 0.07 * Math.sin(wy);
          const cB = 0.07 * Math.cos(wy);
          for (let x = 0; x < bw; x++) {
            let v = lum[row + x];
            if (animated) v += sA[x] * cB + cA[x] * sB + scan;
            const lv = Math.min(n - 0.001, Math.max(0, v * n));
            const lo = lv | 0;
            px[row + x] = levels[lo + (lv - lo > BAYER8[by + ((x + shift) & 7)] ? 1 : 0)];
          }
        }
        octx.putImageData(img, 0, 0);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, bw * cell, bh * cell);
      },
      dispose() { alive = false; }
    };
  }

  // The image redrawn with characters, in its own colors: dense glyphs where it is bright.
  // The characters are drawn once per size; a frame only moves a band of light across them
  // and flips a few characters, so it costs three canvas copies, not 30 000 glyphs.
  function makeImageAscii(ctx, env) {
    const RAMP_A = ' .,:;-=+*#%@';
    let W = 0, H = 0, cw = 6, ch = 12, ascent = 9, cols = 0, rows = 0, fontPx = 10;
    let lum = null;
    let colorLayer = null;
    let mask = null;     // white glyphs
    let colored = null;  // glyphs in the image's colors
    let light = null;    // scratch canvas for the moving band
    let source = null;
    let alive = true;

    const layer = () => {
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(W));
      c.height = Math.max(1, Math.ceil(H));
      return c;
    };

    // Renders the glyphs once: the mask, then the colored copy.
    function build() {
      if (!lum || !colorLayer) return;
      mask = layer();
      const m = mask.getContext('2d');
      m.font = `700 ${fontPx}px ${env.font}`;
      m.textBaseline = 'alphabetic';
      m.fillStyle = '#fff';
      const n = RAMP_A.length - 1;
      for (let y = 0; y < rows; y++) {
        let line = '';
        for (let x = 0; x < cols; x++) line += RAMP_A[Math.min(n, Math.round(lum[y * cols + x] * n))];
        m.fillText(line, 0, y * ch + ascent);
      }
      colored = layer();
      const c = colored.getContext('2d');
      c.drawImage(mask, 0, 0);
      c.globalCompositeOperation = 'source-in';
      c.imageSmoothingEnabled = false;
      c.drawImage(colorLayer, 0, 0, cols * cw, rows * ch);
      light = document.createElement('canvas');
      light.width = colored.width;
      light.height = BAND;
      fresh = true;
    }

    // The canvas keeps the picture between frames (persistent): a frame only repairs what the
    // previous one touched (the band, the flickering cells) and draws the new ones.
    const BAND = 150;
    let fresh = true;
    let prevBand = null;
    let prevCells = [];
    function restore(x, y, w, h) {
      ctx.fillStyle = env.colors.base;
      ctx.fillRect(x, y, w, h);
      ctx.drawImage(colored, x, y, w, h, x, y, w, h);
    }

    function sample() {
      if (!source || !cols) return;
      const { canvas, data } = sampleCover(source, W, H, cols, rows);
      lum = new Float32Array(cols * rows);
      // Lifted shadows: dark pictures still get glyphs, not just dots.
      for (let i = 0; i < cols * rows; i++) lum[i] = Math.pow((0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255, 0.5);
      // Thin glyphs cover little of a cell, so colors are brightened, then dimmed by "dim".
      const dim = Math.min(0.9, Math.max(0, env.opts.dim ?? 0.35));
      const x = canvas.getContext('2d');
      x.globalCompositeOperation = 'screen';
      x.globalAlpha = 0.6;
      x.drawImage(canvas, 0, 0);
      x.globalCompositeOperation = 'source-over';
      x.globalAlpha = dim * 0.3;
      x.fillStyle = env.colors.base;
      x.fillRect(0, 0, cols, rows);
      colorLayer = canvas;
      build();
    }

    loadImage(env.opts.imagePath).then(im => {
      if (!alive || !im) return;
      source = im;
      sample();
      env.repaint?.();
    });

    return {
      resolution: 1,
      fps: 12,
      resize(w, h) {
        W = w; H = h;
        fontPx = env.preview ? 4 : 10;
        ctx.font = `${fontPx}px ${env.font}`;
        const m = ctx.measureText('M');
        cw = m.width || fontPx * 0.6;
        ascent = m.actualBoundingBoxAscent || fontPx * 0.8;
        ch = Math.round(fontPx * 1.2);
        cols = Math.ceil(w / cw);
        rows = Math.ceil(h / ch);
        sample();
      },
      persistent: true,
      invalidate() { fresh = true; },
      frame(_dt, t) {
        if (!colored) return;
        if (fresh) {
          ctx.fillStyle = env.colors.base;
          ctx.fillRect(0, 0, W, H);
          ctx.drawImage(colored, 0, 0);
          fresh = false;
          prevBand = null;
          prevCells = [];
        } else {
          if (prevBand != null) restore(0, prevBand, W, BAND);
          for (const [x, y] of prevCells) restore(x * cw, y * ch, Math.ceil(cw), ch);
        }
        // A band of light slides down the picture, lighting only the glyphs.
        const top = Math.round(((t * 0.05) % 1.3 - 0.15) * H);
        if (top > -BAND && top < H) {
          const l = light.getContext('2d');
          l.globalCompositeOperation = 'source-over';
          l.clearRect(0, 0, light.width, BAND);
          const g = l.createLinearGradient(0, 0, 0, BAND);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          l.fillStyle = g;
          l.fillRect(0, 0, light.width, BAND);
          l.globalCompositeOperation = 'destination-in';
          l.drawImage(mask, 0, top, light.width, BAND, 0, 0, light.width, BAND);
          ctx.save();
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.45;
          ctx.drawImage(light, 0, top);
          ctx.restore();
          prevBand = top;
        } else prevBand = null;
        // A few characters flicker, in the theme's accents.
        ctx.font = `700 ${fontPx}px ${env.font}`;
        ctx.textBaseline = 'alphabetic';
        prevCells = [];
        for (let i = 0; i < 12; i++) {
          const x = (Math.random() * cols) | 0;
          const y = (Math.random() * rows) | 0;
          if (lum[y * cols + x] < 0.25) continue;
          ctx.fillStyle = env.colors.base;
          ctx.fillRect(x * cw, y * ch, Math.ceil(cw), ch);
          ctx.fillStyle = Math.random() < 0.5 ? env.colors.a : env.colors.b;
          ctx.fillText(RAMP_A[1 + ((Math.random() * (RAMP_A.length - 1)) | 0)], x * cw, y * ch + ascent);
          prevCells.push([x, y]);
        }
      },
      dispose() { alive = false; }
    };
  }

  MODES['image-dither'] = (ctx, env) => makeImageDither(ctx, env, false);
  MODES['image-dither-animated'] = (ctx, env) => makeImageDither(ctx, env, true);
  MODES['image-ascii'] = (ctx, env) => makeImageAscii(ctx, env);

  // ─── Matrix: digital rain ────────────────────────────────────────────
  MODES.matrix = (ctx, env) => {
    const GLYPHS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789:=*+-<>¦';
    const pick = () => GLYPHS[(Math.random() * GLYPHS.length) | 0];
    let w = 0;
    let h = 0;
    let size = 15;
    let drops = [];
    return {
      resolution: 1,
      persistent: true,
      fps: 24,
      resize(W, H) {
        w = W; h = H;
        size = env.preview ? 7 : 15;
        const cols = Math.ceil(w / size);
        const rows = h / size;
        drops = Array.from({ length: cols }, () => ({
          y: env.preview ? Math.random() * rows : -Math.random() * 60,
          v: (6 + Math.random() * 14) * (env.preview ? 2 : 1),
          on: Math.random() < (env.preview ? 0.9 : 0.55)
        }));
      },
      frame(dt) {
        const k = env.opts.intensity;
        const s = Math.min(0.1, dt / 1000) * env.opts.speed;
        ctx.fillStyle = rgba(env.colors.base, clamp(s * 5, 0.04, 0.4));
        ctx.fillRect(0, 0, w, h);
        ctx.font = `${size}px ${env.font}`;
        ctx.textBaseline = 'top';
        const green = env.colors.green;
        const head = mix(green, env.colors.light ? '#000000' : '#ffffff', 0.7);
        drops.forEach((d, i) => {
          if (!d.on) { if (Math.random() < s * 0.08) d.on = true; return; }
          const prev = Math.floor(d.y);
          d.y += d.v * s;
          const row = Math.floor(d.y);
          if (row !== prev && row >= 0) {
            ctx.fillStyle = rgba(green, 0.55 * k + 0.2);
            ctx.fillText(pick(), i * size, (row - 1) * size);
            ctx.fillStyle = rgba(head, 0.7 * k + 0.3);
            ctx.fillText(pick(), i * size, row * size);
          }
          if (d.y * size > h + Math.random() * h) {
            d.y = -Math.random() * 20;
            d.v = 6 + Math.random() * 14;
            d.on = Math.random() < 0.6;
          }
        });
      }
    };
  };

  // ─── Starfield: warp through space ───────────────────────────────────
  MODES.starfield = (ctx, env) => {
    let w = 0;
    let h = 0;
    let stars = [];
    const make = z => ({ x: (Math.random() - 0.5) * 2, y: (Math.random() - 0.5) * 2, z: z ?? Math.random(), tint: Math.random() });
    return {
      resolution: 0.75,
      fps: 30, // fast-moving stars need the extra frames
      resize(W, H) {
        w = W; h = H;
        stars = Array.from({ length: env.preview ? 70 : 380 }, () => make());
      },
      frame(dt) {
        const k = env.opts.intensity;
        const s = Math.min(0.1, dt / 1000) * env.opts.speed * 0.22;
        const cx = w / 2;
        const cy = h / 2;
        const f = Math.max(w, h) * 0.5;
        ctx.lineCap = 'round';
        for (const st of stars) {
          const px = cx + (st.x / st.z) * f;
          const py = cy + (st.y / st.z) * f;
          st.z -= s;
          if (st.z <= 0.02) { Object.assign(st, make(1)); continue; }
          const nx = cx + (st.x / st.z) * f;
          const ny = cy + (st.y / st.z) * f;
          if (nx < -50 || nx > w + 50 || ny < -50 || ny > h + 50) { Object.assign(st, make(1)); continue; }
          const near = 1 - st.z;
          const c = st.tint < 0.7 ? env.colors.fg : st.tint < 0.85 ? env.colors.a : env.colors.b;
          ctx.strokeStyle = rgba(c, Math.pow(near, 1.4) * (0.7 * k + 0.35));
          ctx.lineWidth = 0.6 + near * 2.2;
          ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke();
        }
      }
    };
  };

  // ─── Horizon: retro sun over a moving grid ───────────────────────────
  MODES.horizon = (ctx, env) => {
    let w = 0;
    let h = 0;
    let stars = [];
    return {
      resolution: 0.75,
      fps: 24,
      resize(W, H) {
        w = W; h = H;
        stars = Array.from({ length: env.preview ? 12 : 90 }, () => ({ x: Math.random(), y: Math.random() * 0.55, r: Math.random() }));
      },
      frame(_dt, t) {
        const { base, a, b, yellow, light } = env.colors;
        const k = env.opts.intensity;
        const hy = h * 0.62;
        const sky = ctx.createLinearGradient(0, 0, 0, hy);
        sky.addColorStop(0, rgba(base, 0));
        sky.addColorStop(1, rgba(b, 0.18 * k));
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, w, hy);

        for (const st of stars) {
          ctx.fillStyle = rgba(env.colors.fg, (0.25 + 0.35 * Math.sin(t * 1.5 + st.r * 20) ** 2) * k);
          ctx.fillRect(st.x * w, st.y * h, 1.2, 1.2);
        }

        // Sun with the classic horizontal cuts.
        const r = Math.min(w, h) * 0.2;
        const sx = w / 2;
        const sy = hy - r * 0.55;
        ctx.save();
        ctx.beginPath(); ctx.rect(0, 0, w, hy); ctx.clip();
        const sun = ctx.createLinearGradient(0, sy - r, 0, sy + r);
        sun.addColorStop(0, rgba(yellow, 0.85 * k + 0.1));
        sun.addColorStop(1, rgba(b, 0.85 * k + 0.1));
        ctx.shadowColor = rgba(b, 0.6 * k);
        ctx.shadowBlur = env.preview ? 6 : 40;
        ctx.fillStyle = sun;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
        // Bands get thicker towards the horizon and slowly scroll down; they show the sky behind.
        const top = sy - r * 0.1;
        const span = hy - top;
        const bands = 7;
        const drift = (t * 0.12 * env.opts.speed) % 1;
        for (let i = 0; i < bands; i++) {
          const u = (i + drift) / bands;
          const y = top + span * u;
          const bh = 1 + u * u * span * 0.11;
          ctx.fillStyle = base;
          ctx.fillRect(sx - r - 2, y, r * 2 + 4, bh);
          ctx.fillStyle = sky;
          ctx.fillRect(sx - r - 2, y, r * 2 + 4, bh);
        }
        ctx.restore();

        // Floor grid.
        const floor = ctx.createLinearGradient(0, hy, 0, h);
        floor.addColorStop(0, rgba(a, 0.12 * k));
        floor.addColorStop(1, rgba(base, 0));
        ctx.fillStyle = floor;
        ctx.fillRect(0, hy, w, h - hy);
        ctx.strokeStyle = rgba(light ? b : a, 0.55 * k + 0.1);
        ctx.lineWidth = 1;
        ctx.beginPath();
        const n = 22;
        for (let i = -n; i <= n; i++) {
          ctx.moveTo(w / 2 + i * w * 0.012, hy);
          ctx.lineTo(w / 2 + i * w * 0.14, h);
        }
        const off = (t * 0.35 * env.opts.speed) % 1;
        for (let j = 0; j < 14; j++) {
          const z = (j + off) / 14;
          const y = hy + (h - hy) * z * z;
          ctx.moveTo(0, y); ctx.lineTo(w, y);
        }
        ctx.stroke();
        ctx.strokeStyle = rgba(b, 0.8 * k);
        ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(w, hy); ctx.stroke();
      }
    };
  };

  // ─── Host ─────────────────────────────────────────────────────────────

  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  const env = {
    colors: { base: '#13141c', fg: '#c0caf5', a: '#7aa2f7', b: '#bb9af7', c: '#7dcfff', d: '#f7768e', green: '#9ece6a', yellow: '#e0af68', light: false },
    opts: { speed: 1, intensity: 0.6, animate: true },
    mouse: { x: -1e4, y: -1e4 },
    font: '"JetBrains Mono", monospace',
    preview: false
  };

  let mode = 'none';
  let inst = null;
  let raf = null;
  let last = 0;
  let time = 0;

  function paint(c, it, W, H, dt, t) {
    if (!it.persistent) {
      c.clearRect(0, 0, W, H);
      c.fillStyle = env.colors.base;
      c.fillRect(0, 0, W, H);
    }
    it.frame(dt, t);
  }

  function resize() {
    if (!inst) return;
    const res = inst.resolution ?? 1;
    canvas.width = Math.max(1, Math.round(innerWidth * res));
    canvas.height = Math.max(1, Math.round(innerHeight * res));
    canvas.style.imageRendering = inst.pixelated ? 'pixelated' : '';
    ctx.setTransform(res, 0, 0, res, 0, 0);
    inst.resize(innerWidth, innerHeight);
    ctx.fillStyle = env.colors.base;
    ctx.fillRect(0, 0, innerWidth, innerHeight);
  }

  // The loop sleeps between frames and only asks for an animation frame when one is due.
  // Polling requestAnimationFrame every vsync and skipping frames keeps Chromium's whole
  // rendering pipeline awake at 60 Hz, which cost ~10% of a core whatever the frame rate.
  let timer = null;

  function loop(ts) {
    raf = null;
    const dt = last ? Math.min(100, ts - last) : 16;
    last = ts;
    time += (dt / 1000) * env.opts.speed;
    paint(ctx, inst, innerWidth, innerHeight, dt, time);
    const fps = Math.min(inst.fps || 30, 30);
    // Wake a little early; requestAnimationFrame then lands the paint on the next vsync.
    timer = setTimeout(() => { timer = null; raf = requestAnimationFrame(loop); }, Math.max(0, 1000 / fps - 6));
  }

  function start() {
    if (!raf && !timer) raf = requestAnimationFrame(loop);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = null;
    timer = null;
    last = 0;
  }

  // mode: none | image | aurora | constellation | waves | koi | dither | matrix | starfield | horizon
  // Image styles are rebuilt when the picture (or, for ASCII, its dimming) changes.
  const keyOf = (m, o) => (m.startsWith('image-') ? `${m}|${o.imagePath}|${m === 'image-ascii' ? o.dim : ''}` : m);
  let key = '';
  env.repaint = () => { if (inst && !raf && !timer) paint(ctx, inst, innerWidth, innerHeight, 33, time); };

  function set(nextMode, nextOpts, palette) {
    const recolor = JSON.stringify(palette) !== JSON.stringify(env.colors);
    mode = nextMode;
    Object.assign(env.opts, nextOpts);
    Object.assign(env.colors, palette);
    if (nextOpts.font) env.font = nextOpts.font;
    const nextKey = keyOf(mode, env.opts);
    const changed = nextKey !== key;
    key = nextKey;
    const animated = !!MODES[mode];
    canvas.classList.toggle('on', animated);
    if (!animated) { stop(); inst?.dispose?.(); inst = null; key = ''; return; }
    if (changed || !inst) {
      inst?.dispose?.();
      inst = MODES[mode](ctx, env);
      time = Math.random() * 100;
      resize();
    } else if (recolor && inst.persistent) {
      ctx.fillStyle = env.colors.base;
      ctx.fillRect(0, 0, innerWidth, innerHeight);
      inst.invalidate?.();
    }
    // A still style (plain dithered image) is painted once, then costs nothing.
    if (inst.still) { stop(); paint(ctx, inst, innerWidth, innerHeight, 33, time); return; }
    if (env.opts.animate && document.hasFocus()) start();
    else {
      stop();
      // Static: let the simulation settle a little before the single frame.
      for (let i = 0; i < 15; i++) paint(ctx, inst, innerWidth, innerHeight, 33, (time += 0.033));
    }
  }

  // Renders a mode into a small canvas; returns a handle that can animate it on hover.
  function preview(name, target) {
    const factory = MODES[name];
    const c = target.getContext('2d');
    const W = target.clientWidth || 100;
    const H = target.clientHeight || 40;
    const penv = { ...env, colors: { ...env.colors }, opts: { ...env.opts }, mouse: { x: -1e4, y: -1e4 }, preview: true };
    if (!factory) { c.clearRect(0, 0, target.width, target.height); return { start() {}, stop() {} }; }
    const it = factory(c, penv);
    const res = window.devicePixelRatio || 1;
    target.width = Math.round(W * res);
    target.height = Math.round(H * res);
    target.style.imageRendering = it.pixelated ? 'pixelated' : '';
    c.setTransform(res, 0, 0, res, 0, 0);
    it.resize(W, H);
    c.fillStyle = penv.colors.base;
    c.fillRect(0, 0, W, H);
    let t = Math.random() * 50;
    for (let i = 0; i < 20; i++) { t += 0.033; paint(c, it, W, H, 33, t); }
    let id = null;
    let prev = 0;
    const tick = ts => {
      id = requestAnimationFrame(tick);
      if (ts - prev < 33) return;
      prev = ts;
      t += 0.033 * penv.opts.speed;
      paint(c, it, W, H, 33, t);
    };
    return {
      start() { if (!id) id = requestAnimationFrame(tick); },
      stop() { if (id) cancelAnimationFrame(id); id = null; }
    };
  }

  addEventListener('resize', () => { if (inst) { resize(); if (!raf) paint(ctx, inst, innerWidth, innerHeight, 33, time); } });
  // Freeze the background while Lumen isn't the active window: zero cost in the background.
  addEventListener('blur', () => stop());
  addEventListener('focus', () => { if (inst && !inst.still && env.opts.animate) start(); });
  addEventListener('mousemove', e => { env.mouse.x = e.clientX; env.mouse.y = e.clientY; }, { passive: true });
  document.addEventListener('mouseleave', () => { env.mouse.x = env.mouse.y = -1e4; });

  // Average ms per frame of a mode at full window size (devtools: Backdrop.bench('waves')).
  function bench(name, frames = 40) {
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    const it = MODES[name](x, { ...env, colors: { ...env.colors }, opts: { ...env.opts }, mouse: { x: -1e4, y: -1e4 }, preview: false });
    const res = it.resolution ?? 1;
    c.width = Math.round(innerWidth * res);
    c.height = Math.round(innerHeight * res);
    x.setTransform(res, 0, 0, res, 0, 0);
    it.resize(innerWidth, innerHeight);
    paint(x, it, innerWidth, innerHeight, 33, 1);
    const t0 = performance.now();
    for (let i = 0; i < frames; i++) paint(x, it, innerWidth, innerHeight, 33, 1 + i * 0.033);
    return (performance.now() - t0) / frames;
  }

  window.Backdrop = { set, preview, bench, modes: () => Object.keys(MODES) };
})();
