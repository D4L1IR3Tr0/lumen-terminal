// Graph: an Obsidian-like 2D force layout of a folder (folders and files as nodes).
// LumenGraph.create(box, api) with the same api as LumenCity (see city.js).
(function () {
  function create(box, api) {
    const canvas = box.querySelector('canvas');
    const tip = box.querySelector('.fx-graph-tip');
    const ctx = canvas.getContext('2d');
    let gnodes = [];
    let edges = [];
    let byPath = new Map();
    let view = { x: 0, y: 0, k: 1 };
    let hover = null;
    let focus = null;
    let drag = null;
    let raf = 0;
    let heat = 0;
    let colors = {};
    let W = 0;
    let H = 0;

    function readColors() {
      const s = getComputedStyle(document.documentElement);
      const v = n => s.getPropertyValue(n).trim();
      colors = { bg: v('--crust'), fg: v('--fg'), muted: v('--muted'), border: v('--border'), accent: v('--accent'), accent2: v('--accent2'), green: v('--green'), yellow: v('--yellow'), red: v('--red') };
    }
    const nodeColor = n => ({ dir: colors.accent, code: colors.accent2, doc: colors.green, data: colors.yellow, media: colors.red, file: colors.muted })[api.kindOf(n)];

    // Every loaded node under the root (a few hundred at most).
    function rebuild() {
      const r = api.node(api.root());
      if (!r) return;
      const keep = new Map(gnodes.map(g => [g.path, g]));
      const list = [];
      const walk = (n, depth) => {
        if (list.length > 420) return;
        const old = keep.get(n.path);
        const parent = n.parent ? byPathTemp.get(n.parent) : null;
        const g = old || {
          path: n.path,
          x: parent ? parent.x + (Math.random() - 0.5) * 40 : 0,
          y: parent ? parent.y + (Math.random() - 0.5) * 40 : 0,
          vx: 0, vy: 0
        };
        g.n = n;
        g.depth = depth;
        g.deg = 0;
        list.push(g);
        byPathTemp.set(n.path, g);
        if (n.dir && n.children && (depth < 2 || n.open)) for (const c of api.children(n)) walk(c, depth + 1);
      };
      const byPathTemp = new Map();
      walk(r, 0);
      gnodes = list;
      byPath = byPathTemp;
      edges = [];
      for (const g of gnodes) {
        const p = g.n.parent && byPath.get(g.n.parent);
        if (p && g !== p && g.depth > 0) { edges.push([p, g]); p.deg++; g.deg++; }
      }
      heat = 1;
      wake();
    }

    function tick() {
      const N = gnodes.length;
      // Repulsion (all pairs; N stays small), springs on edges, a pull to the center.
      for (let i = 0; i < N; i++) {
        const a = gnodes[i];
        for (let j = i + 1; j < N; j++) {
          const b = gnodes[j];
          let dx = a.x - b.x;
          let dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.5; }
          if (d2 > 90000) continue;
          const f = 260 / d2;
          a.vx += dx * f; a.vy += dy * f;
          b.vx -= dx * f; b.vy -= dy * f;
        }
      }
      for (const [p, c] of edges) {
        const dx = c.x - p.x;
        const dy = c.y - p.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = c.n.dir ? 46 : 26;
        const f = (d - rest) * 0.04;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        c.vx -= fx; c.vy -= fy;
        p.vx += fx * 0.5; p.vy += fy * 0.5;
      }
      let energy = 0;
      for (const g of gnodes) {
        g.vx -= g.x * 0.004;
        g.vy -= g.y * 0.004;
        if (drag?.node === g) { g.vx = g.vy = 0; continue; }
        g.vx *= 0.82;
        g.vy *= 0.82;
        g.x += Math.max(-20, Math.min(20, g.vx * heat));
        g.y += Math.max(-20, Math.min(20, g.vy * heat));
        energy += g.vx * g.vx + g.vy * g.vy;
      }
      heat = Math.max(0.2, heat * 0.995);
      return energy / Math.max(1, N);
    }

    function radius(g) {
      if (g.depth === 0) return 7;
      return g.n.dir ? 3.4 + Math.min(5, Math.sqrt(g.n.children?.length || 0) * 0.8) : 2.6;
    }

    function draw() {
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2 + view.x, H / 2 + view.y);
      ctx.scale(view.k, view.k);
      // Hovering dims everything but the node and its neighbors; the selection only gets a ring.
      const lit = hover;
      const near = new Set();
      if (lit) { near.add(lit); for (const [a, b] of edges) { if (a === lit) near.add(b); if (b === lit) near.add(a); } }
      ctx.lineWidth = 1 / view.k;
      for (const [a, b] of edges) {
        const on = (lit && (a === lit || b === lit)) || (!lit && focus && (a === focus || b === focus));
        ctx.strokeStyle = on ? colors.accent : colors.border;
        ctx.globalAlpha = lit && !on ? 0.2 : on ? 0.9 : 0.7;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      for (const g of gnodes) {
        const r = radius(g);
        ctx.globalAlpha = lit && !near.has(g) ? 0.25 : 1;
        ctx.fillStyle = g.depth === 0 ? colors.accent2 : nodeColor(g.n);
        ctx.beginPath();
        ctx.arc(g.x, g.y, r, 0, Math.PI * 2);
        ctx.fill();
        if (g.n.path === api.selected()) {
          ctx.strokeStyle = colors.fg;
          ctx.lineWidth = 1.5 / view.k;
          ctx.stroke();
          ctx.lineWidth = 1 / view.k;
        }
      }
      // Labels: the root, folders when zoomed in, and whatever is lit.
      ctx.globalAlpha = 1;
      ctx.font = `${11 / view.k}px ${getComputedStyle(document.documentElement).getPropertyValue('--mono')}`;
      ctx.textAlign = 'center';
      for (const g of gnodes) {
        const show = g.depth === 0 || g === focus || near.has(g) || (g.n.dir && (g.depth === 1 || view.k > 1.4)) || view.k > 2.6;
        if (!show) continue;
        ctx.fillStyle = near.has(g) || g.depth === 0 || g === focus ? colors.fg : colors.muted;
        ctx.fillText(g.n.name, g.x, g.y - radius(g) - 4 / view.k);
      }
      ctx.restore();
    }

    // Runs while the layout moves or the user interacts, then sleeps.
    function frame() {
      raf = 0;
      if (!box.isConnected || !api.isVisible()) return;
      let e = 0;
      for (let i = 0; i < 2; i++) e = tick();
      draw();
      if (e > 0.02 || drag) raf = requestAnimationFrame(frame);
    }
    function wake() { if (!raf) raf = requestAnimationFrame(frame); }

    function resize() {
      const r = box.getBoundingClientRect();
      W = Math.max(1, r.width);
      H = Math.max(1, r.height);
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      draw();
    }
    const ro = new ResizeObserver(resize);
    ro.observe(box);

    const toWorld = (cx, cy) => {
      const r = canvas.getBoundingClientRect();
      return { x: (cx - r.left - W / 2 - view.x) / view.k, y: (cy - r.top - H / 2 - view.y) / view.k };
    };
    const hit = (cx, cy) => {
      const p = toWorld(cx, cy);
      let best = null;
      let bd = 1e9;
      for (const g of gnodes) {
        const d = Math.hypot(g.x - p.x, g.y - p.y);
        if (d < Math.max(6 / view.k, radius(g) + 3) && d < bd) { bd = d; best = g; }
      }
      return best;
    };

    canvas.addEventListener('pointerdown', e => {
      canvas.setPointerCapture(e.pointerId);
      const g = hit(e.clientX, e.clientY);
      drag = { node: g, x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
      wake();
    });
    canvas.addEventListener('pointermove', e => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
        if (drag.node) {
          const p = toWorld(e.clientX, e.clientY);
          drag.node.x = p.x;
          drag.node.y = p.y;
          heat = Math.max(heat, 0.6);
        } else {
          view.x = drag.vx + dx;
          view.y = drag.vy + dy;
        }
        wake();
        return;
      }
      const g = hit(e.clientX, e.clientY);
      if (g !== hover) {
        hover = g;
        canvas.style.cursor = g ? 'pointer' : 'grab';
        if (g) {
          tip.textContent = g.n.dir ? `${g.n.name}  ·  ${g.n.children ? `${g.n.children.length} items` : 'folder'}` : g.n.name;
          tip.classList.remove('hidden');
        } else tip.classList.add('hidden');
        draw();
      }
      if (g) {
        const r = box.getBoundingClientRect();
        tip.style.left = `${Math.min(r.width - 10, e.clientX - r.left + 12)}px`;
        tip.style.top = `${e.clientY - r.top + 12}px`;
      }
    });
    canvas.addEventListener('pointerup', async () => {
      const d = drag;
      drag = null;
      if (d && !d.moved && d.node) {
        const n = d.node.n;
        api.select(n.path);
        if (n.dir && !n.children) await api.open(n);
      }
      wake();
    });
    canvas.addEventListener('pointerleave', () => { hover = null; tip.classList.add('hidden'); draw(); });
    canvas.addEventListener('dblclick', e => { const g = hit(e.clientX, e.clientY); if (g) api.activate(g.n); });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left - W / 2;
      const my = e.clientY - r.top - H / 2;
      const k = Math.min(5, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      view.x = mx - ((mx - view.x) * k) / view.k;
      view.y = my - ((my - view.y) * k) / view.k;
      view.k = k;
      draw();
    }, { passive: false });

    function fit() {
      if (!gnodes.length) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const g of gnodes) { x0 = Math.min(x0, g.x); y0 = Math.min(y0, g.y); x1 = Math.max(x1, g.x); y1 = Math.max(y1, g.y); }
      const k = Math.min(3, Math.max(0.2, Math.min((W - 40) / (x1 - x0 || 1), (H - 40) / (y1 - y0 || 1))));
      view = { k, x: -((x0 + x1) / 2) * k, y: -((y0 + y1) / 2) * k };
      draw();
    }

    readColors();
    return {
      rebuild,
      fit,
      wake,
      recolor() { readColors(); draw(); },
      highlight(path) { focus = byPath.get(path) || null; draw(); },
      dispose() { ro.disconnect(); if (raf) cancelAnimationFrame(raf); }
    };
  }

  window.LumenGraph = { create };
})();
