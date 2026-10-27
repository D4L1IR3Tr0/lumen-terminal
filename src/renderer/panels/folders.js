// Folders: a file browser rooted at the active terminal's folder (or any folder you pick).
//   - places: favorites and recent folders, as chips;
//   - a tree with lazy loading, keyboard navigation and a filter;
//   - an Obsidian-like graph of the same folder (folders and files as nodes).
// Folder: click expands, double click (or Enter) cd's the active terminal there.
// File: double click (or Enter) types its path in the active terminal.
//
// LumenFiles.mount(el, host, actions, { mode, isVisible, onRoot }) builds it anywhere:
//   mode "panel": everything, in the sidebar (actions = the panel's header buttons);
//   mode "files": places + tree, in a pane;   mode "graph": the graph alone, in a pane.
(function () {
  function mount(el, host, actions, opts = {}) {
    const mode = opts.mode || 'panel';
    const isVisible = opts.isVisible || (() => true);
    const offs = [];
    const listen = (event, fn) => offs.push(host.on(event, fn));
    const sep = host.paths().home.includes('\\') ? '\\' : '/';
    const join = (dir, name) => (/[\\/]$/.test(dir) ? dir + name : dir + sep + name);
    const base = p => p.split(/[\\/]/).filter(Boolean).pop() || p;
    // Big folders shown as a node but never opened automatically.
    const HEAVY = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'target', '.venv', 'venv', '__pycache__', '.next', '.cache', 'vendor', 'coverage']);

    let favorites = [];
    let root = null;          // folder shown
    let follow = true;        // follow the active terminal
    let showHidden = false;
    let filter = '';
    let selected = null;
    const nodes = new Map();  // path -> { path, name, dir, hidden, parent, children: [paths] | null, open, loading }

    const GRAPH = '<div class="fx-graph"><canvas></canvas><div class="fx-graph-tip hidden"></div></div>';
    const TREE = '<input class="p-search fx-filter" placeholder="Filter…" spellcheck="false"><div class="fx-tree" tabindex="0"></div>';
    // In a pane, the path and the buttons share one slim bar at the top.
    const BAR = '<div class="fx-bar"><div class="fx-crumbs"></div><div class="fx-actions"></div></div>';
    el.classList.add('fx', `fx-mode-${mode}`);
    if (mode !== 'panel') el.tabIndex = -1;
    el.innerHTML = mode === 'graph' ? BAR + GRAPH
      : mode === 'files' ? BAR + '<div class="fx-places"></div>' + TREE
      : `<div class="fx-places"></div><div class="fx-crumbs"></div>${TREE}<div class="fx-graph-head"><span>Graph</span><button class="p-link" data-act="graph-fit">Fit</button></div>${GRAPH}`;
    actions = actions || el.querySelector('.fx-actions');
    actions.innerHTML = `
      <button class="p-icon-btn" data-act="follow" title="Follow the active terminal">${host.icon('terminal')}</button>
      <button class="p-icon-btn" data-act="hidden" title="Show hidden files">${host.icon('search')}</button>
      <button class="p-icon-btn" data-act="pick" title="Open a folder…">${host.icon('folder')}</button>
      ${mode === 'graph' ? '<button class="p-link fx-fit" data-act="graph-fit">Fit</button>' : ''}`;

    const tree = el.querySelector('.fx-tree');
    const crumbs = el.querySelector('.fx-crumbs');
    const places = el.querySelector('.fx-places');

    // ─── File system model ──────────────────────────────────────────────
    function node(path, extra = {}) {
      if (!nodes.has(path)) nodes.set(path, { path, name: base(path), dir: true, hidden: false, parent: null, children: null, open: false, ...extra });
      return nodes.get(path);
    }

    async function load(path) {
      const n = node(path);
      if (n.children || n.loading) return n;
      n.loading = true;
      try {
        const res = await host.native.fs.list(path);
        n.children = res.entries.map(e => {
          const p = join(path, e.name);
          const c = node(p, { name: e.name, dir: e.dir, hidden: e.hidden, parent: path });
          c.dir = e.dir;
          c.hidden = e.hidden;
          c.parent = path;
          return p;
        });
      } catch {
        n.children = [];
        n.error = true;
      }
      n.loading = false;
      return n;
    }

    const visibleChildren = n => (n.children || []).map(p => nodes.get(p)).filter(c => c && (showHidden || !c.hidden));

    // ─── Root, places, breadcrumbs ──────────────────────────────────────
    async function setRoot(path, { followed = false } = {}) {
      if (!path) return;
      if (!followed) follow = false;
      if (path === root) return;
      root = path;
      opts.onRoot?.(path);
      selected = null;
      nodes.clear();
      const r = node(path);
      r.open = true;
      await load(path);
      paintAll();
      // The graph gets one more level, so it shows the shape of the folder.
      const kids = visibleChildren(r).filter(c => c.dir && !HEAVY.has(c.name)).slice(0, 40);
      await Promise.all(kids.map(c => load(c.path)));
      if (root === path) graph.rebuild();
    }

    function paintPlaces() {
      if (!places) return;
      const recents = host.recentDirs().filter(p => !favorites.some(f => f.path.toLowerCase() === p.toLowerCase())).slice(0, 5);
      places.innerHTML = favorites.map(f => `<button class="fx-chip fav${f.path === root ? ' on' : ''}" data-root="${host.escape(f.path)}" title="${host.escape(f.path)}">${host.escape(f.name)}<span data-act="unfav" title="Remove">×</span></button>`).join('') +
        recents.map(p => `<button class="fx-chip${p === root ? ' on' : ''}" data-root="${host.escape(p)}" title="${host.escape(p)}">${host.escape(base(p))}</button>`).join('') +
        `<button class="fx-chip add" data-act="fav" title="Add the current folder to favorites">+ favorite</button>`;
    }

    function paintCrumbs() {
      if (!root) { crumbs.innerHTML = ''; return; }
      const parts = root.split(/[\\/]/).filter(Boolean);
      const unc = /^[\\/]{2}/.test(root);
      const start = root.startsWith('/') && !unc ? '/' : unc ? sep + sep : '';
      let acc = start;
      const segs = parts.map((p, i) => {
        acc = i === 0 ? start + p + (/:$/.test(p) ? sep : '') : join(acc, p);
        return `<button data-root="${host.escape(acc)}">${host.escape(p)}</button>`;
      });
      crumbs.innerHTML = `${segs.join(`<span>${sep === '\\' ? '›' : '/'}</span>`)}${follow ? '<em title="Follows the active terminal">● live</em>' : ''}`;
      crumbs.scrollLeft = crumbs.scrollWidth;
    }

    // ─── Tree ───────────────────────────────────────────────────────────
    const EXT = {
      code: /\.(js|mjs|cjs|ts|tsx|jsx|py|rs|go|java|kt|c|cc|cpp|h|hpp|cs|rb|php|swift|lua|sh|ps1|bat|cmd|zig|dart|vue|svelte|html?|css|scss|sql)$/i,
      doc: /\.(md|txt|rst|pdf|docx?|odt|rtf|org)$/i,
      data: /\.(json|jsonc|ya?ml|toml|ini|env|xml|csv|lock|conf|cfg)$/i,
      media: /\.(png|jpe?g|gif|webp|svg|ico|bmp|mp3|wav|flac|mp4|mov|mkv|webm|ttf|otf|woff2?)$/i
    };
    const kindOf = n => (n.dir ? 'dir' : EXT.code.test(n.name) ? 'code' : EXT.doc.test(n.name) ? 'doc' : EXT.data.test(n.name) ? 'data' : EXT.media.test(n.name) ? 'media' : 'file');

    // Visible rows. With a filter, matching items show with the folders leading to them
    // (only folders already read are searched).
    function rows() {
      const q = filter.toLowerCase();
      const walk = (n, depth) => {
        const out = [];
        for (const c of visibleChildren(n)) {
          const sub = c.dir && c.children && (c.open || q) ? walk(c, depth + 1) : [];
          if (!q || c.name.toLowerCase().includes(q) || sub.length) out.push({ n: c, depth }, ...sub);
        }
        return out;
      };
      const r = nodes.get(root);
      return r ? walk(r, 0) : [];
    }

    function paintTree() {
      if (!tree) return;
      const r = nodes.get(root);
      if (!r) { tree.innerHTML = '<p class="p-empty">No folder.</p>'; return; }
      if (r.loading && !r.children) { tree.innerHTML = '<p class="p-empty">Reading…</p>'; return; }
      const list = rows();
      tree.innerHTML = list.map(({ n, depth }) => `
        <div class="fx-row${n.path === selected ? ' sel' : ''}${n.hidden ? ' hid' : ''}" data-path="${host.escape(n.path)}" style="--d:${depth}" title="${host.escape(n.path)}">
          <span class="fx-twist">${n.dir ? (n.open ? '▾' : '▸') : ''}</span>
          <span class="fx-ico k-${kindOf(n)}">${n.dir ? '' : '•'}</span>
          <span class="fx-name">${host.escape(n.name)}</span>
          <span class="fx-acts">
            ${n.dir ? `<button data-act="cd" title="cd here in the active terminal">${host.icon('terminal')}</button><button data-act="pane" title="New terminal here">${host.icon('plus')}</button>` : `<button data-act="insert" title="Type the path in the active terminal">${host.icon('terminal')}</button>`}
            <button data-act="copy" title="Copy the path">${host.icon('copy')}</button>
            <button data-act="reveal" title="Show in the file manager">${host.icon('external')}</button>
          </span>
        </div>`).join('') || `<p class="p-empty">${filter ? 'No match in the opened folders.' : r.error ? 'Cannot read this folder.' : 'Empty folder.'}</p>`;
    }

    async function toggle(n, open = !n.open) {
      if (!n.dir) return;
      n.open = open;
      if (open) await load(n.path);
      paintTree();
      graph.rebuild();
    }

    const quote = p => (/[\s'"&()]/.test(p) ? `"${p}"` : p);
    async function activate(n) {
      if (n.dir) { host.cdFocused(n.path); host.toast(`→ ${host.prettyPath(n.path)}`); }
      else { host.typeInFocused(`${quote(n.path)} `); host.refocus(); }
    }

    function select(path, { reveal = false } = {}) {
      selected = path;
      if (reveal) {
        // Open every parent so the row is visible.
        let p = nodes.get(path)?.parent;
        while (p && nodes.get(p)) { nodes.get(p).open = true; p = nodes.get(p).parent; }
      }
      paintTree();
      tree?.querySelector('.fx-row.sel')?.scrollIntoView({ block: 'nearest' });
      graph.highlight(path);
    }

    if (tree) {
    tree.addEventListener('click', e => {
      const row = e.target.closest('.fx-row');
      if (!row) return;
      const n = nodes.get(row.dataset.path);
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cd') return activate(n);
      if (act === 'insert') return activate(n);
      if (act === 'pane') return host.createPane({ cwd: n.path });
      if (act === 'copy') { host.native.clipboard.write(n.path); host.toast('Path copied'); return; }
      if (act === 'reveal') return n.dir ? host.native.folders.open(n.path) : host.native.open.reveal(n.path);
      selected = n.path;
      if (n.dir && !e.target.closest('.fx-acts')) toggle(n); else select(n.path);
      graph.highlight(n.path);
    });
    tree.addEventListener('dblclick', e => {
      const row = e.target.closest('.fx-row');
      if (row && !e.target.closest('.fx-acts')) activate(nodes.get(row.dataset.path));
    });
    tree.addEventListener('keydown', e => {
      const list = rows();
      let i = list.findIndex(r => r.n.path === selected);
      const n = list[i]?.n;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        i = Math.max(0, Math.min(list.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
        if (list[i]) select(list[i].n.path);
      } else if (e.key === 'ArrowRight' && n?.dir) { e.preventDefault(); if (!n.open) toggle(n, true); }
      else if (e.key === 'ArrowLeft' && n) {
        e.preventDefault();
        if (n.dir && n.open) toggle(n, false);
        else if (n.parent && n.parent !== root) select(n.parent);
      } else if (e.key === 'Enter' && n) { e.preventDefault(); activate(n); }
    });

    el.querySelector('.fx-filter').addEventListener('input', e => { filter = e.target.value.trim(); paintTree(); });
    }

    // ─── Graph (Obsidian-like force layout) ─────────────────────────────
    const box = el.querySelector('.fx-graph');
    const graph = !box ? { rebuild() {}, fit() {}, wake() {}, recolor() {}, highlight() {}, dispose() {} } : (() => {
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
      const nodeColor = n => ({ dir: colors.accent, code: colors.accent2, doc: colors.green, data: colors.yellow, media: colors.red, file: colors.muted })[kindOf(n)];

      // Every loaded node under the root (a few hundred at most).
      function rebuild() {
        const r = nodes.get(root);
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
          if (n.dir && n.children && (depth < 2 || n.open)) for (const c of visibleChildren(n)) walk(c, depth + 1);
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
          if (g.n.path === selected) {
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
        if (!box.isConnected || !isVisible()) return;
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
          select(n.path, { reveal: true });
          if (n.dir && !n.children) { await load(n.path); n.open = true; paintTree(); rebuild(); }
        }
        wake();
      });
      canvas.addEventListener('pointerleave', () => { hover = null; tip.classList.add('hidden'); draw(); });
      canvas.addEventListener('dblclick', e => { const g = hit(e.clientX, e.clientY); if (g) activate(g.n); });
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
    })();

    function paintAll() {
      paintPlaces();
      paintCrumbs();
      paintTree();
      el.querySelector('[data-act="follow"]')?.classList.toggle('on', follow);
      actions.querySelector('[data-act="follow"]').classList.toggle('on', follow);
      actions.querySelector('[data-act="hidden"]').classList.toggle('on', showHidden);
    }

    // ─── Places and actions ─────────────────────────────────────────────
    const saveFavorites = () => host.native.store.set('folders', favorites);
    const defaults = () => {
      const home = host.paths().home;
      return [
        { name: 'Home', path: home },
        { name: 'Desktop', path: join(home, 'Desktop') },
        { name: 'Documents', path: join(home, 'Documents') },
        { name: 'Downloads', path: join(home, 'Downloads') }
      ];
    };

    el.addEventListener('click', async e => {
      const unfav = e.target.closest('[data-act="unfav"]');
      if (unfav) {
        const p = unfav.closest('[data-root]').dataset.root;
        favorites = favorites.filter(f => f.path !== p);
        await saveFavorites();
        paintPlaces();
        return;
      }
      const r = e.target.closest('[data-root]');
      if (r) { setRoot(r.dataset.root); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'fav' && root && !favorites.some(f => f.path.toLowerCase() === root.toLowerCase())) {
        favorites.push({ name: base(root), path: root });
        await saveFavorites();
        paintPlaces();
        host.toast('Added to favorites');
      } else if (act === 'graph-fit') graph.fit();
    });

    actions.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'follow') {
        follow = !follow;
        if (follow) { const cwd = host.focusedPane()?.cwd; if (cwd) await setRoot(cwd, { followed: true }); }
        paintAll();
      } else if (act === 'hidden') {
        showHidden = !showHidden;
        paintAll();
        graph.rebuild();
      } else if (act === 'pick') {
        const dir = await host.pickPath({ mode: 'folder', title: 'Open a folder' });
        if (dir) setRoot(dir);
      }
    });

    // Following the active terminal.
    const followTerminal = () => {
      if (!follow || !isVisible()) return;
      const cwd = host.focusedPane()?.cwd;
      if (cwd && cwd !== root) setRoot(cwd, { followed: true });
    };
    listen('cwd:changed', followTerminal);
    listen('pane:focused', followTerminal);
    listen('theme:changed', () => graph.recolor());
    offs.push(host.native.store.onChange(name => { if (name === 'folders') host.native.store.get('folders').then(f => { favorites = f || defaults(); paintPlaces(); }); }));

    async function open() {
      favorites = (await host.native.store.get('folders')) || defaults();
      const cwd = host.focusedPane()?.cwd;
      if (follow && cwd) await setRoot(cwd, { followed: true });
      else if (!root) await setRoot(cwd || host.paths().home, { followed: true });
      paintAll();
      graph.wake();
      setTimeout(() => graph.fit(), 900);
    }

    return {
      open,
      setRoot,
      focus: () => (tree || el).focus({ preventScroll: true }),
      dispose() {
        offs.forEach(off => off?.());
        graph.dispose();
      }
    };
  }

  window.LumenFiles = { mount };

  window.LumenPanels.push({
    id: 'folders',
    title: 'Folders',
    hint: 'Ctrl+Shift+O',
    order: 10,
    width: 400,
    render(el, host, actions) {
      const fx = mount(el, host, actions, { mode: 'panel', isVisible: () => host.panelActive('folders') });
      this.onOpen = () => fx.open();
    }
  });
})();
