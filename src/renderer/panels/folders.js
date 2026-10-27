// Folders: a file browser rooted at the active terminal's folder (or any folder you pick).
//   - places: favorites and recent folders, as chips;
//   - a tree with lazy loading, keyboard navigation and a filter;
//   - a 3D "city" of the same folder (city.js): folders as platforms, files as blocks sized by weight.
// Folder: click expands, double click (or Enter) cd's the active terminal there.
// File: double click (or Enter) types its path in the active terminal.
//
// LumenFiles.mount(el, host, actions, { mode, isVisible, onRoot }) builds it anywhere:
//   mode "panel": everything, in the sidebar (actions = the panel's header buttons);
//   mode "files": places + tree, in a pane;   mode "graph": the city alone, in a pane.
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
      : `<div class="fx-places"></div><div class="fx-crumbs"></div>${TREE}<div class="fx-graph-head"><span>City</span><button class="p-link" data-act="graph-fit">Fit</button></div>${GRAPH}`;
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
          c.size = e.size;
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
      // The city gets one more level, so it shows the shape of the folder.
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

    // ─── Map of the folder: City (city.js), Constellation (constellation.js) or Graph (graph.js),
    // as chosen in Settings ("folders.view"). Switching rebuilds it on a fresh canvas.
    const box = el.querySelector('.fx-graph');
    const MAPS = { city: ['City', () => window.LumenCity], constellation: ['Constellation', () => window.LumenConstellation], graph: ['Graph', () => window.LumenGraph] };
    const mapApi = {
      root: () => root,
      node: path => nodes.get(path),
      children: visibleChildren,
      kindOf,
      isVisible,
      selected: () => selected,
      select: path => select(path, { reveal: true }),
      activate,
      async open(n) { await load(n.path); n.open = true; paintTree(); graph.rebuild(); }
    };
    let graph = { rebuild() {}, fit() {}, wake() {}, recolor() {}, highlight() {}, dispose() {} };
    let mapKind = null;
    function makeMap() {
      if (!box) return;
      const kind = MAPS[host.cfg().folders?.view] ? host.cfg().folders.view : 'city';
      if (kind === mapKind) return;
      graph.dispose();
      box.className = 'fx-graph';
      box.querySelector('canvas').replaceWith(document.createElement('canvas'));
      box.querySelector('.fx-graph-tip').classList.add('hidden');
      mapKind = kind;
      graph = MAPS[kind][1]().create(box, mapApi);
      const head = el.querySelector('.fx-graph-head span');
      if (head) head.textContent = MAPS[kind][0];
      if (root) graph.rebuild();
    }
    makeMap();
    listen('config:changed', makeMap);

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
