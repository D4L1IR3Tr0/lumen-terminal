// Lumen renderer: workspaces, tiled panes, theming, commands, plugins.
(function () {
  'use strict';

  const native = window.native;
  const $ = id => document.getElementById(id);
  const WS_COUNT = 9;
  const DIRS = ['left', 'right', 'up', 'down'];
  const DIR_LABEL = { left: 'left', right: 'right', up: 'up', down: 'down' };
  const BACKGROUND_LABELS = [
    ['none', 'none'], ['aurora', 'aurora'], ['constellation', 'constellation'], ['waves', 'waves'],
    ['koi', 'ASCII koi'], ['koi-blocks', 'block koi'], ['jellyfish', 'ASCII jellyfish'], ['dither', 'dither'], ['matrix', 'digital rain'], ['starfield', 'hyperspace'],
    ['horizon', 'retro horizon'], ['image', 'image']
  ];

  const S = {
    cfg: null,
    fileThemes: {},
    pluginThemes: {},
    shells: [],
    paths: {},
    platform: '',
    osBuild: 0,
    version: '',
    themeId: 'gruvbox',
    previewTheme: null,
    workspaces: [],
    active: 0,
    panes: new Map(),
    byPty: new Map(),
    pendingData: new Map(),
    commands: new Map(),
    keymap: {},
    pluginKeys: {},
    bindings: new Map(),
    listeners: {},
    statusItems: new Map(),
    recentDirs: [],
    agentPaneId: null,
    pluginCode: new Map(),
    fontDelta: 0,
    selfWrite: 0
  };
  let paneSeq = 0;

  // ─── Events (also exposed to plugins) ───────────────────────────────

  function on(event, fn) {
    (S.listeners[event] ||= new Set()).add(fn);
    return () => S.listeners[event].delete(fn);
  }

  function emit(event, payload) {
    for (const fn of S.listeners[event] || []) {
      try { fn(payload); } catch (e) { console.error(`[${event}]`, e); }
    }
  }

  // ─── Colors & themes ────────────────────────────────────────────────

  function rgb(color) {
    let h = String(color).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0);
  }
  function hex(c) {
    return '#' + c.map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
  }
  function mix(a, b, t) {
    const A = rgb(a);
    const B = rgb(b);
    return hex(A.map((x, i) => x + (B[i] - x) * t));
  }
  function rgba(color, alpha) {
    return `rgba(${rgb(color).join(', ')}, ${alpha})`;
  }

  function allThemes() {
    return { ...window.LumenThemes, ...S.fileThemes, ...S.pluginThemes };
  }

  // Fills in UI tokens for user themes that only define terminal colors.
  function normalizeTheme(t) {
    const bg = t.background || '#1a1b26';
    const fg = t.foreground || '#c0caf5';
    const ui = {
      crust: mix(bg, '#000000', t.light ? 0.07 : 0.3),
      surface: mix(bg, fg, 0.04),
      overlay: mix(bg, fg, 0.1),
      border: mix(bg, fg, 0.12),
      accent: t.blue || '#7aa2f7',
      accent2: t.magenta || '#bb9af7',
      muted: mix(bg, fg, 0.45),
      ...(t.ui || {})
    };
    return { ...t, background: bg, foreground: fg, ui };
  }

  function currentTheme() {
    const themes = allThemes();
    return normalizeTheme(themes[S.previewTheme] || themes[S.themeId] || themes.gruvbox);
  }

  function hasMaterial() {
    const m = S.cfg.window.backgroundMaterial;
    return S.platform === 'win32' && (m === 'acrylic' || m === 'mica');
  }

  // Older configs used window.wallpaper; it now maps to the "image" background.
  function backgroundMode() {
    const b = S.cfg.background || {};
    if ((!b.mode || b.mode === 'none') && S.cfg.window.wallpaper) return 'image';
    return b.mode || 'none';
  }

  function backgroundImage() {
    return S.cfg.background?.image || S.cfg.window.wallpaper || '';
  }

  function translucent() {
    return backgroundMode() !== 'none' || hasMaterial();
  }

  const ANSI = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
    'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite'];

  function xtermTheme(t) {
    // The terminal itself is always transparent: the pane paints the background, so opacity
    // and backdrops can change live without recreating renderers.
    const out = {
      background: '#00000000',
      foreground: t.foreground,
      cursor: cursorColor(t),
      cursorAccent: t.background,
      selectionBackground: t.selectionBackground || rgba(t.foreground, 0.25),
      scrollbarSliderBackground: rgba(t.foreground, 0.12),
      scrollbarSliderHoverBackground: rgba(t.foreground, 0.22),
      scrollbarSliderActiveBackground: rgba(t.foreground, 0.32)
    };
    for (const k of ANSI) if (t[k]) out[k] = t[k];
    return out;
  }

  // cursor.color: "theme" (the theme's cursor), "accent", or any #hex colour.
  function cursorColor(t) {
    const c = S.cfg.cursor?.color || 'theme';
    if (c === 'accent') return t.ui?.accent || t.blue;
    if (c === 'accent2') return t.ui?.accent2 || t.magenta;
    if (/^#[0-9a-f]{3,8}$/i.test(c)) return c;
    return t.cursor || t.foreground;
  }

  function applyTheme() {
    const t = currentTheme();
    const ui = t.ui;
    const css = document.documentElement.style;
    const vars = {
      bg: t.background, fg: t.foreground, crust: ui.crust, surface: ui.surface, overlay: ui.overlay,
      border: ui.border, accent: ui.accent, accent2: ui.accent2, muted: ui.muted,
      red: t.red || '#f7768e', green: t.green || '#9ece6a', yellow: t.yellow || '#e0af68',
      selection: t.selectionBackground || rgba(t.foreground, 0.25),
      'accent-soft': rgba(ui.accent, 0.16),
      'accent-glow': rgba(ui.accent, 0.28),
      'fg-soft': rgba(t.foreground, 0.08)
    };
    for (const [k, v] of Object.entries(vars)) css.setProperty(`--${k}`, v);

    const w = S.cfg.window;
    const opacity = Math.max(0.3, Math.min(1, +w.paneOpacity || 1));
    css.setProperty('--pane-bg', opacity < 1 ? rgba(t.background, opacity) : t.background);
    css.setProperty('--app-bg', hasMaterial() ? rgba(ui.crust, 0.35) : ui.crust);
    // No backdrop blur on the bar: with an animated background it would re-blur every frame.
    css.setProperty('--bar-bg', translucent() ? rgba(ui.crust, 0.82) : ui.crust);
    document.documentElement.classList.toggle('light', !!t.light);
    document.body.classList.toggle('translucent', translucent() || opacity < 1);
    document.body.classList.toggle('material', hasMaterial());

    const xt = xtermTheme(t);
    for (const p of S.panes.values()) if (p.term) p.term.options.theme = xt;
    applyBackdrop(t);
    drawStats();
    if (!S.previewTheme) emit('theme:changed', { id: S.themeId, theme: t });
  }

  function applyBackdrop(t = currentTheme()) {
    const b = S.cfg.background || {};
    let mode = backgroundMode();
    const wall = $('wallpaper');
    const image = backgroundImage();
    // Image styles: "plain" is the CSS layer below; the others are drawn on the canvas.
    const style = ['dither', 'dither-animated', 'ascii'].includes(b.imageStyle) ? b.imageStyle : 'plain';
    if (mode === 'image' && image && style !== 'plain') {
      wall.classList.remove('on');
      mode = `image-${style}`;
    } else if (mode === 'image' && image) {
      wall.style.backgroundImage = `url("${fileUrl(image)}")`;
      wall.style.filter = b.blur ? `blur(${b.blur}px)` : '';
      wall.style.setProperty('--dim', b.dim ?? 0.35);
      wall.classList.add('on');
    } else {
      wall.classList.remove('on');
    }
    Backdrop.set(mode, {
      speed: +b.speed || 1,
      intensity: b.intensity ?? 0.6,
      animate: S.cfg.window.animations !== false,
      font: fontStack(),
      imagePath: image ? absPath(image) : '',
      dim: b.dim ?? 0.35,
      ditherColors: b.ditherColors === 'theme' ? 'theme' : 'image'
    }, {
      base: t.ui.crust,
      fg: t.foreground,
      green: t.green || t.ui.accent,
      yellow: t.yellow || t.ui.accent,
      a: t.ui.accent,
      b: t.ui.accent2,
      c: t.cyan || t.ui.accent,
      d: t.magenta || t.ui.accent2,
      light: !!t.light
    });
  }

  // ─── Config ─────────────────────────────────────────────────────────

  function fontStack() {
    const f = S.cfg.font.family || 'JetBrains Mono';
    const head = f.includes(',') ? f : `"${f}"`;
    return `${head}, "JetBrains Mono", "Cascadia Mono", Consolas, monospace`;
  }

  // Fonts dropped in ~/.lumen/fonts join the font picker (re-read whenever ~/.lumen changes).
  async function refreshUserFonts() {
    try {
      const list = await native.assets.list('fonts');
      Fonts.setUser(list.map(f => ({ name: f.name, url: fileUrl(f.rel) })));
    } catch (e) { console.warn('user fonts', e); }
  }

  // "backgrounds/sea.jpg" lives in ~/.lumen; absolute paths (older configs) still work.
  function absPath(p) {
    if (!p || /^([a-z]:[\\/]|[\\/]{2}|\/)/i.test(p)) return p;
    if (/^~[\\/]/.test(p)) return joinPath(S.paths.home, p.slice(2));
    return joinPath(S.paths.dir, p);
  }

  function fileUrl(p) {
    if (/^(https?|file):/i.test(p)) return p;
    let full = p.replace(/\\/g, '/');
    if (full.startsWith('~/')) full = S.paths.home.replace(/\\/g, '/') + full.slice(1);
    else if (!/^([a-z]:)?\//i.test(full)) full = S.paths.dir.replace(/\\/g, '/') + '/' + full;
    return 'file:///' + encodeURI(full.replace(/^\//, '')).replace(/#/g, '%23');
  }

  function termOptions() {
    const f = S.cfg.font;
    const opts = {
      fontFamily: fontStack(),
      fontSize: Math.max(6, f.size + S.fontDelta),
      lineHeight: f.lineHeight,
      fontWeight: String(f.weight),
      fontWeightBold: String(f.weightBold),
      cursorStyle: S.cfg.cursor.style,
      cursorBlink: !!S.cfg.cursor.blink,
      cursorWidth: Math.max(1, Math.min(6, +S.cfg.cursor.width || 2)),
      cursorInactiveStyle: S.cfg.cursor.inactive || 'outline',
      scrollback: S.cfg.behavior.scrollback,
      allowProposedApi: true,
      // OSC 8 hyperlinks printed by programs (ls --hyperlink, compilers, gh…).
      linkHandler: {
        allowNonHttpProtocols: true,
        activate: (e, uri) => activateLink(e, uri),
        hover: (e, uri) => showLinkTip(e, uri),
        leave: () => hideLinkTip()
      },
      allowTransparency: true,
      drawBoldTextInBrightColors: false,
      rescaleOverlappingGlyphs: true,
      customGlyphs: true,
      theme: xtermTheme(currentTheme())
    };
    if (S.platform === 'win32') opts.windowsPty = { backend: 'conpty', buildNumber: S.osBuild };
    return opts;
  }

  function applyConfig() {
    const w = S.cfg.window;
    const css = document.documentElement.style;
    css.setProperty('--gap', `${w.gap}px`);
    css.setProperty('--radius', `${w.radius}px`);
    css.setProperty('--pad', `${w.padding}px`);
    css.setProperty('--border-w', `${w.borderWidth}px`);
    css.setProperty('--inactive-opacity', w.inactiveOpacity);
    css.setProperty('--mono', fontStack());
    document.body.classList.toggle('no-anim', !w.animations);
    document.body.classList.toggle('no-bar', !w.bar);
    $('clock').style.display = w.clock ? '' : 'none';
    $('stats').style.display = w.stats ? '' : 'none';

    applyTheme();
    // Load the font first, otherwise xterm measures the fallback and the grid is off.
    const family = S.cfg.font.family;
    Fonts.ensure(family).then(() => {
      if (S.cfg.font.family !== family) return;
      const opts = termOptions();
      for (const p of S.panes.values()) {
        if (!p.term) continue;
        for (const k of ['fontFamily', 'fontSize', 'lineHeight', 'fontWeight', 'fontWeightBold', 'cursorStyle', 'cursorBlink', 'cursorWidth', 'cursorInactiveStyle', 'scrollback']) {
          if (p.term.options[k] !== opts[k]) p.term.options[k] = opts[k];
        }
      }
      fitAll();
    });
    buildBindings();
    S.workspaces.forEach(ws => layout(ws));
    S.panes.forEach(applyFlow);
    fitAll();
    renderWorkspaces();
  }

  function buildBindings() {
    const ws = {};
    for (let i = 1; i <= WS_COUNT; i++) {
      ws[`workspace.${i}`] = `Alt+${i}`;
      ws[`moveTo.${i}`] = `Alt+Shift+${i}`;
    }
    S.keymap = { ...ws, ...S.pluginKeys, ...S.cfg.keybindings };
    S.bindings.clear();
    for (const [cmd, combo] of Object.entries(S.keymap)) {
      const c = Keys.parse(combo);
      if (c) S.bindings.set(c, cmd);
    }
  }

  // ─── Workspaces ─────────────────────────────────────────────────────

  function createWorkspaces() {
    const stage = $('stage');
    for (let i = 0; i < WS_COUNT; i++) {
      const el = document.createElement('section');
      el.className = 'workspace empty' + (i === 0 ? ' active' : '');
      el.appendChild(emptyState(i));
      stage.appendChild(el);
      S.workspaces.push({ index: i, el, root: null, focused: null, zoomed: null, rects: new Map() });
    }
    new ResizeObserver(() => layout(activeWs())).observe(stage);
  }

  function emptyState(i) {
    const el = document.createElement('div');
    el.className = 'empty-state';
    const row = (cmd, label) => `<button class="empty-row" data-cmd="${cmd}"><span>${label}</span><span class="keys" data-keys="${cmd}"></span></button>`;
    el.innerHTML = `
      <div class="empty-logo"><svg viewBox="0 0 24 24"><path d="M4 5.5 11 12l-7 6.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 18.5h7" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></div>
      <div class="empty-title">Workspace ${i + 1}</div>
      <div class="empty-sub">Nothing here yet.</div>
      <div class="empty-rows">
        ${row('pane.new', 'New terminal')}
        ${row('shell.pick', 'Choose a shell')}
        ${row('palette.open', 'Command palette')}
        ${row('theme.pick', 'Change theme')}
      </div>`;
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-cmd]');
      if (b) run(b.dataset.cmd);
    });
    return el;
  }

  function refreshKeyHints() {
    document.querySelectorAll('[data-keys]').forEach(el => {
      el.innerHTML = Keys.pretty(S.keymap[el.dataset.keys]).map(k => `<kbd>${k}</kbd>`).join('');
    });
  }

  const activeWs = () => S.workspaces[S.active];
  const panesOf = ws => Layout.leaves(ws.root).map(id => S.panes.get(id)).filter(Boolean);
  const focusedPane = () => S.panes.get(activeWs().focused) || null;
  // The terminal commands act on: the focused pane, or the last terminal focused when a view
  // (graph, files) has the focus.
  const focusedTerm = () => {
    const p = focusedPane();
    if (p?.term) return p;
    const last = S.panes.get(S.lastTerm);
    if (last?.term && last.ws === S.active) return last;
    return panesOf(activeWs()).find(q => q.term) || null;
  };

  function switchWorkspace(i) {
    if (i === S.active || i < 0 || i >= WS_COUNT) return;
    const prev = activeWs();
    $('stage').style.setProperty('--slide', i > S.active ? 1 : -1);
    prev.el.classList.remove('active');
    S.active = i;
    const ws = activeWs();
    ws.el.classList.add('active');
    layout(ws);
    if (ws.focused) focusPane(ws.focused);
    else document.activeElement?.blur();
    renderWorkspaces();
    updateTitle();
    emit('workspace:changed', { index: i + 1 });
    saveSession();
  }

  function renderWorkspaces() {
    const nav = $('workspaces');
    let last = 4;
    S.workspaces.forEach((ws, i) => { if (ws.root || i === S.active) last = Math.max(last, i); });
    nav.innerHTML = '';
    for (let i = 0; i <= last; i++) {
      const ws = S.workspaces[i];
      const b = document.createElement('button');
      b.className = 'ws' + (i === S.active ? ' active' : '') + (ws.root ? ' occupied' : '');
      b.textContent = i + 1;
      b.title = `Workspace ${i + 1} (Alt+${i + 1})`;
      b.addEventListener('click', () => switchWorkspace(i));
      nav.appendChild(b);
    }
  }

  // ─── Layout ─────────────────────────────────────────────────────────

  function place(el, r) {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${Math.max(0, r.w)}px`;
    el.style.height = `${Math.max(0, r.h)}px`;
  }

  function layout(ws, { entering } = {}) {
    if (!ws) return;
    ws.el.classList.toggle('empty', !ws.root);
    ws.el.querySelectorAll(':scope > .gutter').forEach(g => g.remove());
    const W = ws.el.clientWidth;
    const H = ws.el.clientHeight;
    saveSession();
    if (!W || !H || !ws.root) return;

    const gap = S.cfg.window.gap;
    const { rects, gutters } = Layout.compute(ws.root, W, H, gap);
    ws.rects = rects;
    for (const p of panesOf(ws)) {
      const zoomed = ws.zoomed === p.id;
      const hidden = ws.zoomed && !zoomed;
      p.el.classList.toggle('zoomed', zoomed);
      p.el.classList.toggle('behind-zoom', !!hidden);
      const r = zoomed ? { x: gap, y: gap, w: W - gap * 2, h: H - gap * 2 } : rects.get(p.id);
      if (p.id === entering) p.el.style.transition = 'none';
      place(p.el, r);
      if (p.id === entering) {
        void p.el.offsetWidth;
        p.el.style.transition = '';
      }
    }
    if (ws.zoomed) return;

    for (const g of gutters) {
      const el = document.createElement('div');
      el.className = `gutter ${g.dir}`;
      const grow = 3;
      place(el, g.dir === 'h'
        ? { x: g.x - grow, y: g.y, w: g.w + grow * 2, h: g.h }
        : { x: g.x, y: g.y - grow, w: g.w, h: g.h + grow * 2 });
      el.addEventListener('mousedown', e => dragGutter(ws, g, e));
      el.addEventListener('dblclick', () => { g.node.ratio = 0.5; layout(ws); });
      ws.el.appendChild(el);
    }
  }

  function dragGutter(ws, g, e) {
    e.preventDefault();
    document.body.classList.add('dragging', g.dir === 'h' ? 'drag-h' : 'drag-v');
    const box = ws.el.getBoundingClientRect();
    const half = S.cfg.window.gap / 2;
    const move = ev => {
      const pos = g.dir === 'h' ? ev.clientX - box.left : ev.clientY - box.top;
      g.node.ratio = Math.min(0.92, Math.max(0.08, (pos - g.origin - half) / g.span));
      layout(ws);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      document.body.classList.remove('dragging', 'drag-h', 'drag-v');
      layout(ws);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // Terminals are refit (and the pty resized) shortly after their box stops changing size.
  const fitTimers = new Map();
  const resizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const id = entry.target.closest('.pane')?.dataset.id;
      if (!id) continue;
      clearTimeout(fitTimers.get(id));
      fitTimers.set(id, setTimeout(() => fitPane(S.panes.get(id)), 40));
    }
  });

  function fitPane(p) {
    if (!p || !p.term || !p.host.clientWidth || !p.host.clientHeight) return;
    try { p.fit.fit(); } catch {}
  }

  function fitAll() {
    requestAnimationFrame(() => S.panes.forEach(fitPane));
  }

  // ─── Panes ──────────────────────────────────────────────────────────

  // attach: { ptyId, title, cwd } shows a process the main process already started (an agent's command).
  // Panes that show a view of the folder instead of a terminal (Ctrl+Shift+S).
  const VIEWS = {
    graph: { name: 'Graph', detail: "follows the terminal's folder" },
    files: { name: 'Files', detail: "file browser, follows the terminal's folder" }
  };

  async function createPane({ ws = activeWs(), target, dir, before = false, profile, cwd, attach = null, view = null } = {}) {
    const id = `p${++paneSeq}`;
    const el = document.createElement('div');
    el.className = 'pane entering';
    el.dataset.id = id;
    const host = document.createElement('div');
    host.className = 'pane-term';
    el.appendChild(host);
    const badge = document.createElement('div');
    badge.className = 'pane-badge';
    badge.textContent = 'zoom';
    el.appendChild(badge);
    ws.el.appendChild(el);
    setTimeout(() => el.classList.remove('entering'), 400);

    const anchorPane = S.panes.get(target || ws.focused);
    const inherit = S.cfg.behavior.inheritCwd ? anchorPane?.cwd : null;
    const pane = {
      id, ws: ws.index, el, host, term: null, fit: null, search: null, searchEl: null,
      ptyId: null, title: '', cwd: cwd || inherit || null, profile: null, exited: false,
      outputListeners: new Set(), promptListeners: new Set(), prompts: 0
    };
    S.panes.set(id, pane);

    // Insert in the tree: split the anchor along its longest side (dwindle), unless told otherwise.
    const anchor = anchorPane ? anchorPane.id : null;
    if (!ws.root || !anchor) {
      ws.root = ws.root ? Layout.split(ws.root, Layout.leaves(ws.root).pop(), id, dir || 'h', before) : Layout.leaf(id);
    } else {
      let d = dir;
      if (!d) {
        const r = ws.rects.get(anchor);
        d = r && r.h > r.w * 0.9 ? 'v' : 'h';
      }
      ws.root = Layout.split(ws.root, anchor, id, d, before);
    }
    ws.zoomed = null;
    layout(ws, { entering: id });
    renderWorkspaces();

    if (view) {
      host.className = 'pane-view';
      pane.viewMode = view;
      pane.profile = { id: view, name: VIEWS[view].name, kind: 'view' };
      pane.view = LumenFiles.mount(host, panelHost, null, {
        mode: view,
        isVisible: () => S.active === pane.ws && S.panes.has(pane.id),
        onRoot: path => { pane.cwd = path; if (focusedPane() === pane) updateTitle(); saveSession(); }
      });
      // A click keeps its own target (filter, tree, canvas): the pane only takes the focus ring.
      el.addEventListener('mousedown', () => { if (activeWs().focused !== pane.id) focusPane(pane.id, false); }, true);
      el.addEventListener('focusin', () => { if (activeWs().focused !== pane.id) focusPane(pane.id, false); });
      el.addEventListener('mouseenter', () => {
        if (S.cfg.behavior.focusFollowsMouse && !document.body.classList.contains('dragging') && !Palette.isOpen()) focusPane(pane.id);
      });
      await pane.view.open();
      if (ws.index === S.active) focusPane(id);
      return pane;
    }

    const term = new Terminal(termOptions());
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    const search = new SearchAddon.SearchAddon();
    term.loadAddon(search);
    term.loadAddon(new WebLinksAddon.WebLinksAddon((e, uri) => {
      if (e.ctrlKey || e.metaKey) native.open.external(uri);
      else toast('Ctrl + click to open the link');
    }));
    try {
      const u = new Unicode11Addon.Unicode11Addon();
      term.loadAddon(u);
      term.unicode.activeVersion = '11';
    } catch {}
    Object.assign(pane, { term, fit, search });

    term.open(host);
    try {
      const gl = new WebglAddon.WebglAddon();
      gl.onContextLoss(() => gl.dispose());
      term.loadAddon(gl);
    } catch (e) {
      console.warn('WebGL unavailable, using the DOM renderer', e);
    }
    fitPane(pane);
    resizeObserver.observe(host);
    wireTerminal(pane);
    setupFlow(pane);
    if (ws.index === S.active) focusPane(id);

    let res;
    try {
      res = attach
        ? { id: attach.ptyId, profile: { id: 'agent', name: attach.title || '✦ Agent', kind: 'agent' }, cwd: attach.cwd || pane.cwd }
        : await native.pty.spawn({ profile, cols: term.cols, rows: term.rows, cwd: pane.cwd });
    } catch (e) {
      term.write(`\x1b[31mCould not start the shell: ${e.message}\x1b[0m\r\n`);
      return pane;
    }
    if (!S.panes.has(id)) { native.pty.kill(res.id); return null; }
    pane.ptyId = res.id;
    pane.profile = res.profile;
    pane.cwd = pane.cwd && pane.cwd.startsWith('/') ? pane.cwd : res.cwd;
    S.byPty.set(res.id, pane);
    refreshGit(pane);
    const early = S.pendingData.get(res.id);
    if (early) { S.pendingData.delete(res.id); writeOutput(pane, early); }
    term.onData(data => { trackInput(pane, data); native.pty.write(pane.ptyId, data); });
    term.onBinary(data => native.pty.write(pane.ptyId, data));
    term.onResize(({ cols, rows }) => native.pty.resize(pane.ptyId, cols, rows));
    fitPane(pane);
    native.pty.resize(pane.ptyId, term.cols, term.rows);
    updateTitle();
    emit('pane:created', paneApi(pane));
    return pane;
  }

  function wireTerminal(pane) {
    const { term, el, host } = pane;

    term.attachCustomKeyEventHandler(e => {
      if (e.type !== 'keydown') return true;
      const plainCtrl = e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
      // macOS: Cmd+C / Cmd+V copy and paste (Ctrl+C stays the shell's interrupt there).
      const cmd = S.platform === 'darwin' && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
      const k = e.key.toLowerCase();
      if (((plainCtrl && term.hasSelection()) || cmd) && k === 'c') {
        copySelection(pane);
        term.clearSelection();
        e.preventDefault();
        return false;
      }
      if ((plainCtrl || cmd) && k === 'v') {
        e.preventDefault();
        paste(pane);
        return false;
      }
      return true;
    });

    term.onTitleChange(t => { pane.title = t; updateTitle(); });
    term.onSelectionChange(() => {
      if (S.cfg.behavior.copyOnSelect && term.hasSelection()) copySelection(pane);
    });

    // Shell integration (see src/main/shells.js):
    //   OSC 7 file://host/path and OSC 9;9 "C:\path"  -> current directory
    //   OSC 133;D;code                                 -> previous command finished
    term.parser.registerOscHandler(7, data => {
      const m = data.match(/^file:\/\/[^/]*(\/.*)$/);
      if (m) {
        let p = m[1];
        try { p = decodeURIComponent(p); } catch {}
        setCwd(pane, p);
      }
      return true;
    });
    term.parser.registerOscHandler(9, data => {
      if (!data.startsWith('9;')) return false;
      setCwd(pane, data.slice(2).replace(/^"|"$/g, ''));
      // cmd has no exit-code hook: its directory report marks the prompt.
      if (pane.profile?.kind === 'cmd') firePrompt(pane, null);
      return true;
    });
    term.parser.registerOscHandler(133, data => {
      if (data[0] === 'D') {
        const code = parseInt(data.split(';')[1], 10);
        // The first prompt follows the shell's own startup, not a user command.
        pane.lastExit = Number.isNaN(code) || !pane.prompts ? 0 : code;
        refreshGit(pane);
        if (focusedPane() === pane) updateTitle();
        firePrompt(pane, pane.lastExit);
      }
      return true;
    });

    el.addEventListener('mousedown', () => focusPane(pane.id), true);
    // Drop files (their paths are typed, quoted for this shell) or text onto a pane.
    el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; el.classList.add('drop-target'); });
    el.addEventListener('dragleave', e => { if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target'); });
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('drop-target'); dropInto(pane, e.dataTransfer); });
    el.addEventListener('focusin', () => { if (activeWs().focused !== pane.id) focusPane(pane.id, false); });
    el.addEventListener('mouseenter', () => {
      if (S.cfg.behavior.focusFollowsMouse && !document.body.classList.contains('dragging') && !Palette.isOpen()) focusPane(pane.id);
    });
    host.addEventListener('contextmenu', e => {
      if (!S.cfg.behavior.rightClickPaste) return;
      e.preventDefault();
      if (term.hasSelection()) { copySelection(pane); term.clearSelection(); }
      else paste(pane);
    });
  }

  // A prompt came back: the previous command (if any) has finished.
  function firePrompt(pane, exitCode) {
    if (pane.term) openBlock(pane, exitCode);
    pane.prompts = (pane.prompts || 0) + 1;
    pane.running = false;
    for (const fn of [...pane.promptListeners]) {
      try { fn(exitCode); } catch (e) { console.error(e); }
    }
  }

  function setCwd(pane, p) {
    if (S.platform === 'win32') {
      if (/^\/[a-z]:/i.test(p)) p = p.slice(1); // /C:/Users -> C:/Users
      const msys = p.match(/^\/([a-z])(\/.*)?$/i); // Git Bash: /c/Users -> C:/Users
      if (msys && pane.profile?.kind !== 'wsl') p = `${msys[1].toUpperCase()}:${msys[2] || '/'}`;
      if (/^[a-z]:/i.test(p)) p = p.replace(/\//g, '\\');
    }
    if (pane.cwd === p) return;
    pane.cwd = p;
    pane.git = null;
    saveSession();
    refreshGit(pane);
    rememberDir(p);
    if (focusedPane() === pane) updateTitle();
  }

  // Recently visited folders, for the Folders panel.
  let recentTimer = null;
  function rememberDir(p) {
    if (!p || p.startsWith('/') && S.platform === 'win32') return;
    S.recentDirs = [p, ...S.recentDirs.filter(d => d.toLowerCase() !== p.toLowerCase())].slice(0, 12);
    clearTimeout(recentTimer);
    recentTimer = setTimeout(() => native.store.set('recent-dirs', S.recentDirs), 1000);
    emit('cwd:changed', p);
  }

  // Git status of a pane's folder, refreshed at each prompt, on focus and every few seconds.
  function refreshGit(pane) {
    if (!pane || !pane.cwd || !S.cfg.behavior.git) return;
    if (pane.gitBusy) { pane.gitAgain = true; return; }
    pane.gitBusy = true;
    const cwd = pane.cwd;
    native.git.status(cwd).then(info => {
      if (pane.cwd === cwd) pane.git = info;
      if (focusedPane() === pane) updateTitle();
    }).finally(() => {
      pane.gitBusy = false;
      if (pane.gitAgain) { pane.gitAgain = false; setTimeout(() => refreshGit(pane), 300); }
    });
  }

  // ─── Text flow, command separators ──────────────────────────────────
  // terminal.flow: "top"    classic, text starts at the top
  //                "bottom" text starts at the bottom and rises (the screen is shifted down
  //                         while it is not full, so nothing changes for the shell)
  // terminal.separators: a thin line above each new prompt.

  const flowMode = () => (S.cfg.terminal?.flow === 'bottom' ? 'bottom' : 'top');

  function setupFlow(pane) {
    const { term } = pane;
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; anchorScreen(pane); });
    };
    term.onWriteParsed(schedule);
    term.onResize(schedule);
    term.buffer.onBufferChange(schedule);
    pane.scheduleAnchor = schedule;
    new ResizeObserver(schedule).observe(pane.host);
    setupBlockHover(pane);
    applyFlow(pane);
  }

  function applyFlow(pane) {
    if (!pane.term) return;
    if (!S.cfg.terminal?.separators) clearSeparators(pane);
    pane.scheduleAnchor?.();
  }

  // Shifts the rows down so the last line in use sits on the bottom edge of the pane.
  function anchorScreen(pane) {
    const { term } = pane;
    const screen = term?.element?.querySelector('.xterm-screen');
    if (!screen) return;
    let shift = 0;
    const b = term.buffer.active;
    if (flowMode() === 'bottom' && b.type === 'normal') {
      const cell = screen.offsetHeight / term.rows;
      let used = term.rows;
      if (b.baseY === 0) {
        used = b.cursorY + 1;
        for (let y = term.rows - 1; y >= used; y--) {
          if (b.getLine(y)?.translateToString(true).trim()) { used = y + 1; break; }
        }
      }
      // Visible height = the rows plus the few pixels left over below them.
      shift = Math.max(0, term.element.clientHeight - used * cell);
    }
    const value = shift ? `translateY(${Math.round(shift)}px)` : '';
    if (screen.style.transform !== value) screen.style.transform = value;
  }

  const focusTerminal = p => (p.view ? p.view.focus() : p.term?.focus());

  // ─── Command blocks ─────────────────────────────────────────────────
  // Every prompt opens a block: { marker (prompt line), inputOffset/inputX (where typing starts),
  // command, start, end, exit }. Blocks give: separators between commands (red after a failure),
  // jumping between prompts, hover actions (copy command / output, re-run), and a notification
  // when a long command finishes in the background.

  const lastBlock = pane => pane.blocks?.[pane.blocks.length - 1] || null;

  function openBlock(pane, exitCode) {
    const { term } = pane;
    const prev = lastBlock(pane);
    if (prev?.start && !prev.end) {
      prev.end = Date.now();
      prev.exit = exitCode;
      // Read the line again now: when Enter came, the shell may not have echoed it yet.
      if (prev.inputX != null) prev.command = readInput(pane, prev).trim() || prev.command;
      commandFinished(pane, prev);
    }
    const marker = term.registerMarker(0);
    if (!marker) return;
    const block = { marker, start: null, end: null, exit: null, command: '', inputOffset: null, inputX: null };
    (pane.blocks ||= []).push(block);
    marker.onDispose(() => { const i = pane.blocks.indexOf(block); if (i >= 0) pane.blocks.splice(i, 1); block.deco?.dispose(); });
    if (prev && S.cfg.terminal?.separators && marker.line - prev.marker.line > 1) {
      const failed = !!(prev.start && exitCode);
      const deco = term.registerDecoration({ marker, width: term.cols, layer: 'top' });
      if (deco) {
        block.deco = deco;
        deco.onRender(el => { el.classList.add('cmd-sep'); el.classList.toggle('fail', failed); });
      }
    }
    if (pane.blocks.length > 2000) pane.blocks[0].marker.dispose();
  }

  function clearSeparators(pane) {
    for (const b of pane.blocks || []) { try { b.deco?.dispose(); } catch {} b.deco = null; }
  }

  // Remembers where the user starts typing at a prompt, and when Enter runs the line.
  function trackInput(pane, data) {
    const b = lastBlock(pane);
    if (!b || b.start || pane.running) return;
    markInput(pane, b);
    // Printable keys are kept as a fallback until the echoed line can be read.
    if (!data.startsWith('\x1b')) b.typed = ((b.typed || '') + data.split('\r')[0]).replace(/[\x00-\x1f\x7f]/g, '').slice(-2000);
    if (data.includes('\r')) beginCommand(pane, readInput(pane, b).trim() || b.typed);
  }

  function markInput(pane, b) {
    if (b.inputX != null) return;
    const buf = pane.term.buffer.active;
    b.inputOffset = buf.baseY + buf.cursorY - b.marker.line;
    b.inputX = buf.cursorX;
  }

  function readInput(pane, b) {
    const buf = pane.term.buffer.active;
    let y = b.marker.line + (b.inputOffset || 0);
    let text = (buf.getLine(y)?.translateToString(true) || '').slice(b.inputX || 0);
    while (buf.getLine(y + 1)?.isWrapped) text += buf.getLine(++y).translateToString(true);
    return text;
  }

  // A command starts now (typed, sent from the input box, or run by Lumen itself).
  function beginCommand(pane, text) {
    const b = lastBlock(pane);
    if (b && !b.start) {
      markInput(pane, b);
      b.start = Date.now();
      b.command = String(text || '').trim();
    }
    pane.running = true;
  }

  // Lines of a block: the prompt line, then the output (wrapped input lines skipped).
  function blockLines(pane, b) {
    const buf = pane.term.buffer.active;
    const i = pane.blocks.indexOf(b);
    const first = b.marker.line;
    let start = first + (b.inputOffset || 0);
    while (buf.getLine(start + 1)?.isWrapped) start++;
    start++;
    const next = pane.blocks[i + 1];
    let end = next ? next.marker.line - 1 : buf.baseY + buf.cursorY - (b.end ? 1 : 0);
    while (end >= start && !buf.getLine(end)?.translateToString(true).trim()) end--;
    return { first, start, end };
  }

  function blockOutput(pane, b) {
    const buf = pane.term.buffer.active;
    const { start, end } = blockLines(pane, b);
    let out = '';
    for (let y = start; y <= end; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      out += (y > start && !line.isWrapped ? '\n' : '') + line.translateToString(true);
    }
    return out.replace(/\s+$/, '');
  }

  function fmtDuration(ms) {
    const s = ms / 1000;
    if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m} min ${Math.round(s % 60)} s`;
    return `${Math.floor(m / 60)} h ${m % 60} min`;
  }

  function commandFinished(pane, b) {
    const limit = +S.cfg.behavior?.notifyAfter || 0;
    const ms = b.end - b.start;
    if (!limit || ms < limit * 1000) return;
    const ok = !b.exit;
    const name = b.command ? (b.command.length > 80 ? b.command.slice(0, 79) + '…' : b.command) : 'Command';
    const state = ok ? `finished in ${fmtDuration(ms)}` : `failed (exit ${b.exit}) after ${fmtDuration(ms)}`;
    if (!document.hasFocus()) native.notify(`${ok ? '✓' : '✕'} ${state}`, name, pane.id);
    else if (pane.ws !== S.active || focusedPane() !== pane) {
      toast(`${ok ? '✓' : '✕'} ${name}: ${state}${pane.ws !== S.active ? ` (workspace ${pane.ws + 1})` : ''}`, ok ? 'info' : 'error');
    }
  }

  // Scrolls to the previous / next prompt.
  function jumpPrompt(dir) {
    const p = focusedTerm();
    if (!p?.blocks?.length) return;
    const top = p.term.buffer.active.viewportY;
    const lines = p.blocks.map(b => b.marker.line).filter(l => l >= 0);
    const target = dir < 0 ? [...lines].reverse().find(l => l < top) : lines.find(l => l > top);
    if (target == null) { if (dir > 0) p.term.scrollToBottom(); return; }
    p.term.scrollToLine(target);
  }

  function copyLastOutput() {
    const p = focusedTerm();
    const b = [...(p?.blocks || [])].reverse().find(x => x.start && x.end);
    if (!b) return toast('No finished command in this pane yet');
    const text = blockOutput(p, b);
    native.clipboard.write(text);
    toast(text ? `Output copied (${text.split('\n').length} lines)` : 'That command printed nothing');
  }

  // Hovering a command highlights it and shows its actions.
  function setupBlockHover(pane) {
    const { el, term } = pane;
    const hl = document.createElement('div');
    hl.className = 'block-hl hidden';
    const bar = document.createElement('div');
    bar.className = 'block-bar hidden';
    el.append(hl, bar);
    let lastY = null;
    let current = null;
    let queued = false;

    const hide = () => { hl.classList.add('hidden'); bar.classList.add('hidden'); current = null; };
    const update = () => {
      queued = false;
      if (lastY == null || S.cfg.terminal?.blocks === false || term.buffer.active.type !== 'normal') return hide();
      const screen = term.element?.querySelector('.xterm-screen');
      if (!screen) return hide();
      const r = screen.getBoundingClientRect();
      const box = pane.host.getBoundingClientRect();
      const paneR = el.getBoundingClientRect();
      const cell = r.height / term.rows;
      const view = term.buffer.active.viewportY;
      const line = view + Math.floor((lastY - r.top) / cell);
      const b = [...(pane.blocks || [])].reverse().find(x => x.marker.line >= 0 && x.marker.line <= line);
      if (!b || !b.start) return hide();
      const { first, end } = blockLines(pane, b);
      const last = Math.max(first, b.end ? end : view + term.rows - 1);
      if (line > last) return hide();
      const top = Math.max(r.top + (first - view) * cell, box.top);
      const bottom = Math.min(r.top + (last + 1 - view) * cell, box.bottom);
      if (bottom <= top) return hide();
      hl.style.top = `${top - paneR.top}px`;
      hl.style.height = `${bottom - top}px`;
      hl.classList.toggle('fail', !!b.exit);
      hl.classList.remove('hidden');
      bar.style.top = `${Math.max(top - paneR.top + 2, 4)}px`;
      if (current !== b || bar.dataset.end !== String(b.end)) {
        current = b;
        bar.dataset.end = String(b.end);
        const status = !b.end
          ? `<span class="bb-status run">● running ${fmtDuration(Date.now() - b.start)}</span>`
          : `<span class="bb-status ${b.exit ? 'fail' : 'ok'}">${b.exit ? `✕ ${b.exit}` : '✓'} ${fmtDuration(b.end - b.start)}</span>`;
        bar.innerHTML = `${status}
          <button data-a="cmd" title="Copy the command">${icon('copy')}cmd</button>
          <button data-a="out" title="Copy the output">${icon('copy')}output</button>
          ${b.end ? `<button data-a="run" title="Run it again">${icon('play')}</button>` : ''}`;
      }
      bar.classList.remove('hidden');
    };
    const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };

    el.addEventListener('mousemove', e => {
      if (e.buttons || bar.contains(e.target)) return;
      lastY = e.clientY;
      schedule();
    });
    el.addEventListener('mouseleave', () => { lastY = null; hide(); });
    term.onScroll(() => lastY != null && schedule());
    term.onWriteParsed(() => lastY != null && schedule());
    bar.addEventListener('mousedown', e => e.preventDefault());
    bar.addEventListener('click', e => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      const b = current;
      if (!a || !b) return;
      if (a === 'cmd') { native.clipboard.write(b.command); toast('Command copied'); }
      else if (a === 'out') {
        const { start, end } = blockLines(pane, b);
        if (end >= start) term.selectLines(start, end);
        const text = blockOutput(pane, b);
        native.clipboard.write(text);
        toast(text ? `Output copied (${text.split('\n').length} lines)` : 'That command printed nothing');
      } else if (a === 'run' && b.command) {
        if (pane.running) return toast('A command is still running in this pane');
        beginCommand(pane, b.command);
        native.pty.write(pane.ptyId, b.command + '\r');
        term.scrollToBottom();
        focusTerminal(pane);
      }
    });
  }

  function writeOutput(pane, data) {
    pane.term.write(data);
    for (const fn of pane.outputListeners) {
      try { fn(data); } catch (e) { console.error(e); }
    }
  }

  function focusPane(id, focusTerm = true) {
    const p = S.panes.get(id);
    if (!p) return;
    const ws = S.workspaces[p.ws];
    ws.focused = id;
    if (p.term) S.lastTerm = id;
    for (const q of panesOf(ws)) q.el.classList.toggle('focused', q.id === id);
    // Never steal the keyboard from the palette, settings or a side panel being typed in.
    const busyElsewhere = Palette.isOpen() || Settings.isOpen() || document.activeElement?.closest?.('#drawer');
    if (focusTerm && ws.index === S.active && !busyElsewhere) focusTerminal(p);
    if (ws.index === S.active) { updateTitle(); refreshGit(p); }
    emit('pane:focused', paneApi(p));
    saveSession();
  }

  function closePane(id) {
    const p = S.panes.get(id);
    if (!p) return;
    const ws = S.workspaces[p.ws];
    const order = Layout.leaves(ws.root);
    const idx = order.indexOf(id);
    const neighborId = ws.rects ? DIRS.map(d => Layout.neighbor(ws.rects, id, d)).find(Boolean) : null;

    ws.root = Layout.remove(ws.root, id);
    if (ws.zoomed === id) ws.zoomed = null;
    S.panes.delete(id);
    p.view?.dispose();
    resizeObserver.unobserve(p.host);
    if (p.ptyId != null) {
      S.byPty.delete(p.ptyId);
      if (!p.exited) native.pty.kill(p.ptyId);
    }
    p.el.classList.add('leaving');
    p.el.classList.remove('focused');
    setTimeout(() => {
      try { p.term?.dispose(); } catch {}
      p.el.remove();
    }, S.cfg.window.animations ? 180 : 0);

    const rest = Layout.leaves(ws.root);
    if (ws.focused === id) ws.focused = neighborId && rest.includes(neighborId) ? neighborId : rest[Math.max(0, idx - 1)] || null;
    layout(ws);
    if (ws.focused) focusPane(ws.focused);
    renderWorkspaces();
    updateTitle();
    emit('pane:closed', { id });
  }

  // Focus moves across three zones laid out left to right: sidebar rail, open drawer, panes.
  // Going left from the leftmost pane enters the sidebar.
  function zoneOf(el) {
    if (el?.closest?.('#rail')) return 'rail';
    if (el?.closest?.('#drawer')) return 'drawer';
    return 'panes';
  }

  function focusDir(dir) {
    const zone = zoneOf(document.activeElement);
    if (zone !== 'panes') return Sidebar.navigate(zone, dir);
    const ws = activeWs();
    const n = ws.focused && !ws.zoomed ? Layout.neighbor(ws.rects, ws.focused, dir) : null;
    if (n) focusPane(n);
    else if (dir === 'left') Sidebar.enter();
  }

  function focusPanes() {
    const p = focusedPane();
    if (p?.term) focusTerminal(p);
    else document.activeElement?.blur();
  }

  function swapDir(dir) {
    const ws = activeWs();
    if (!ws.focused || ws.zoomed) return;
    const n = Layout.neighbor(ws.rects, ws.focused, dir);
    if (!n) return;
    ws.root = Layout.swap(ws.root, ws.focused, n);
    layout(ws);
  }

  function resizeDir(dir) {
    const ws = activeWs();
    if (!ws.focused || ws.zoomed) return;
    Layout.resize(ws.root, ws.focused, dir);
    layout(ws);
  }

  function toggleZoom() {
    const ws = activeWs();
    if (!ws.focused) return;
    ws.zoomed = ws.zoomed ? null : ws.focused;
    layout(ws);
  }

  function equalize() {
    const ws = activeWs();
    const walk = n => { if (n && n.type === 'split') { n.ratio = 0.5; walk(n.a); walk(n.b); } };
    walk(ws.root);
    layout(ws);
  }

  function toggleSplitDir() {
    const ws = activeWs();
    const path = Layout.findPath(ws.root, ws.focused);
    if (!path || !path.length) return;
    const node = path[path.length - 1].node;
    node.dir = node.dir === 'h' ? 'v' : 'h';
    layout(ws);
  }

  function movePaneTo(index) {
    const p = focusedPane();
    if (!p || index === p.ws) return;
    const from = S.workspaces[p.ws];
    const to = S.workspaces[index];

    from.root = Layout.remove(from.root, p.id);
    if (from.zoomed === p.id) from.zoomed = null;
    from.focused = Layout.leaves(from.root).pop() || null;

    const anchor = to.focused || Layout.leaves(to.root).pop();
    if (!to.root) to.root = Layout.leaf(p.id);
    else {
      const r = to.rects.get(anchor);
      to.root = Layout.split(to.root, anchor, p.id, r && r.h > r.w * 0.9 ? 'v' : 'h');
    }
    to.zoomed = null;
    to.el.appendChild(p.el);
    p.ws = index;
    to.focused = p.id;
    p.el.classList.remove('focused');

    layout(from);
    layout(to);
    if (from.focused) focusPane(from.focused);
    focusPane(p.id, false);
    renderWorkspaces();
    updateTitle();
    toast(`Pane moved to workspace ${index + 1}`);
  }

  // ─── Clipboard & search ─────────────────────────────────────────────

  function copySelection(p = focusedTerm()) {
    const text = p?.term?.getSelection();
    if (text) native.clipboard.write(text);
  }

  async function paste(p = focusedTerm()) {
    if (!p?.term) return;
    const text = await native.clipboard.read();
    if (text) insertText(p, text);
  }

  // Text for the shell's current line.
  function insertText(p, text) {
    p.term.paste(text);
    p.term.focus();
  }

  function openSearch(p = focusedTerm()) {
    if (!p?.term) return;
    if (!p.searchEl) {
      const box = document.createElement('div');
      box.className = 'search-box';
      box.innerHTML = `
        <svg viewBox="0 0 24 24" width="13" height="13"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="m16 16 4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input spellcheck="false" placeholder="Search">
        <span class="count"></span>
        <button data-dir="prev" title="Previous (Shift+Enter)">↑</button>
        <button data-dir="next" title="Next (Enter)">↓</button>
        <button data-dir="close" title="Close (Esc)">✕</button>`;
      p.el.appendChild(box);
      const input = box.querySelector('input');
      const count = box.querySelector('.count');
      const t = currentTheme();
      const deco = () => ({
        matchBackground: rgba(currentTheme().ui.accent, 0.25),
        matchOverviewRuler: currentTheme().ui.accent,
        activeMatchBackground: rgba(currentTheme().ui.accent2 || t.ui.accent, 0.6),
        activeMatchColorOverviewRuler: currentTheme().ui.accent2 || t.ui.accent
      });
      const find = (back = false) => {
        const q = input.value;
        if (!q) { p.search.clearDecorations(); count.textContent = ''; return; }
        const opts = { decorations: deco(), incremental: false };
        back ? p.search.findPrevious(q, opts) : p.search.findNext(q, opts);
      };
      p.search.onDidChangeResults?.(({ resultIndex, resultCount }) => {
        count.textContent = resultCount ? `${resultIndex + 1}/${resultCount}` : (input.value ? '0' : '');
      });
      const close = () => {
        box.classList.remove('open');
        p.search.clearDecorations();
        p.term.focus();
      };
      input.addEventListener('input', () => find());
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); find(e.shiftKey); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
      });
      box.addEventListener('click', e => {
        const d = e.target.closest('button')?.dataset.dir;
        if (d === 'prev') find(true);
        else if (d === 'next') find(false);
        else if (d === 'close') close();
      });
      p.searchEl = box;
    }
    p.searchEl.classList.add('open');
    const input = p.searchEl.querySelector('input');
    const sel = p.term.getSelection();
    if (sel && !sel.includes('\n')) input.value = sel;
    input.focus();
    input.select();
  }

  // ─── Session restore ────────────────────────────────────────────────
  // The main process keeps the latest snapshot of each window and reopens them at startup.

  let sessionTimer = null;
  function saveSession() {
    if (S.restoring) return;
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(() => native.session.update(sessionSnapshot()), 800);
  }

  function sessionSnapshot() {
    const tree = node => {
      if (node.type === 'leaf') {
        const p = S.panes.get(node.pane);
        return { type: 'leaf', profile: p?.profile?.id || null, cwd: p?.cwd || null, view: p?.viewMode || undefined };
      }
      return { type: 'split', dir: node.dir, ratio: node.ratio, a: tree(node.a), b: tree(node.b) };
    };
    return {
      active: S.active,
      workspaces: S.workspaces.filter(ws => ws.root).map(ws => {
        const order = Layout.leaves(ws.root);
        return { index: ws.index, root: tree(ws.root), focused: order.indexOf(ws.focused), zoomed: ws.zoomed ? order.indexOf(ws.zoomed) : -1 };
      })
    };
  }

  // Rebuilds each workspace split by split, so the tree comes back exactly as it was.
  async function restoreSession(snap) {
    const list = (snap?.workspaces || []).filter(w => w?.root && w.index >= 0 && w.index < WS_COUNT);
    if (!list.length) return false;
    const profileOf = id => (S.shells.some(s => s.id === id) ? id : undefined);
    const firstLeaf = n => (n.type === 'leaf' ? n : firstLeaf(n.a));
    let any = false;
    for (const w of list) {
      const ws = S.workspaces[w.index];
      const order = [];
      const make = (leaf, extra = {}) => createPane({ ws, profile: profileOf(leaf.profile), cwd: leaf.cwd || undefined, view: VIEWS[leaf.view] ? leaf.view : undefined, ...extra });
      const build = async (node, pane) => {
        if (node.type === 'leaf') { order.push(pane); return; }
        const other = await make(firstLeaf(node.b), { target: pane.id, dir: node.dir === 'v' ? 'v' : 'h' });
        if (!other) return;
        await build(node.a, pane);
        await build(node.b, other);
      };
      const root = await make(firstLeaf(w.root));
      if (!root) continue;
      any = true;
      await build(w.root, root);
      const copyRatios = (saved, live) => {
        if (!saved || !live || saved.type !== 'split' || live.type !== 'split') return;
        live.ratio = Math.min(0.9, Math.max(0.1, +saved.ratio || 0.5));
        copyRatios(saved.a, live.a);
        copyRatios(saved.b, live.b);
      };
      copyRatios(w.root, ws.root);
      ws.focused = order[w.focused]?.id || order[0]?.id || null;
      ws.zoomed = w.zoomed >= 0 ? order[w.zoomed]?.id || null : null;
      layout(ws);
    }
    if (!any) return false;
    const target = S.workspaces[snap.active]?.root ? snap.active : list[0].index;
    if (target !== S.active) switchWorkspace(target);
    renderWorkspaces();
    const ws = activeWs();
    if (ws.focused) focusPane(ws.focused);
    return true;
  }

  // ─── Drag & drop, hyperlinks ────────────────────────────────────────

  function quotePath(kind, file) {
    if (kind === 'cmd') return /[\s&()^,;=!'+[\]{}%]/.test(file) ? `"${file}"` : file;
    if (isPosix(kind)) {
      const posix = toPosixPath(file, kind);
      return /^[\w@%+=:,./-]+$/.test(posix) ? posix : shQuote(posix);
    }
    return /^[\w:\\/.-]+$/.test(file) ? file : `'${file.replace(/'/g, "''")}'`;
  }

  function dropInto(pane, data) {
    const files = [...(data?.files || [])].map(f => native.pathForFile(f)).filter(Boolean);
    const text = files.length ? files.map(f => quotePath(shellKind(pane), f)).join(' ') + ' ' : data?.getData('text/plain');
    if (!text) return;
    focusPane(pane.id);
    insertText(pane, text);
  }

  function activateLink(e, uri) {
    if (!(e.ctrlKey || e.metaKey)) { toast('Ctrl + click to open the link'); return; }
    if (/^https?:\/\//i.test(uri)) native.open.external(uri);
    else if (/^file:/i.test(uri)) { native.open.reveal(uri); toast('Shown in the file manager'); }
    else toast(`Lumen does not open ${uri.split(':')[0]}: links`);
  }

  let linkTip = null;
  function showLinkTip(e, uri) {
    if (!linkTip) {
      linkTip = document.createElement('div');
      linkTip.className = 'link-tip';
      document.body.appendChild(linkTip);
    }
    linkTip.textContent = `${uri.length > 90 ? uri.slice(0, 89) + '…' : uri}  ·  Ctrl+click`;
    linkTip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - 20)}px`;
    linkTip.style.top = `${e.clientY + 16}px`;
    linkTip.classList.add('show');
  }
  function hideLinkTip() { linkTip?.classList.remove('show'); }

  // ─── Bar, title, clock, toasts ──────────────────────────────────────

  function prettyPath(p) {
    if (!p) return '';
    const home = S.paths.home || '';
    let out = p;
    if (home && out.toLowerCase().startsWith(home.toLowerCase())) out = '~' + out.slice(home.length);
    return out.replace(/\\/g, '/');
  }

  // "just now", "5 min ago", "3 h ago", "2 d ago", then a date.
  function relativeTime(at) {
    const t = typeof at === 'number' ? at : Date.parse(at);
    if (!t) return '';
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    if (s < 86400 * 30) return `${Math.round(s / 86400)} d ago`;
    return new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function updateTitle() {
    const p = focusedPane();
    const el = $('title');
    if (!p) {
      el.innerHTML = `<span class="t-muted">Workspace ${S.active + 1}</span>`;
      document.title = 'Lumen';
      return;
    }
    const shell = p.profile?.name || '';
    const path = prettyPath(p.cwd);
    let main = path;
    const generic = !p.title || /\\(pwsh|powershell|cmd|bash|wsl)\.exe$/i.test(p.title) || /^(Windows PowerShell|PowerShell)/i.test(p.title);
    if (!main || !generic) main = p.title || path;
    const parts = main.split('/');
    const leaf = parts.pop();
    // Long paths keep only their last two folders: …/projects/app/src
    const shown = parts.length > 3 ? ['…', ...parts.slice(-2)] : parts;
    const dir = shown.length ? shown.join('/') + '/' : '';
    const exit = p.lastExit ? `<span class="t-exit" title="The last command failed (exit code ${p.lastExit})">✕ ${p.lastExit}</span>` : '';
    el.innerHTML = `${shell ? `<span class="t-shell">${escapeHtml(shell)}</span>` : ''}<span class="t-path" title="${escapeHtml(main)}"><span class="t-dir">${escapeHtml(dir)}</span><span class="t-leaf">${escapeHtml(leaf)}</span></span>${gitHtml(p.git)}${exit}`;
    document.title = `${leaf || shell} — Lumen`;
  }

  const BRANCH_ICON = '<svg viewBox="0 0 16 16" width="11" height="11"><circle cx="4.5" cy="3.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="4.5" cy="12.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="11.5" cy="5.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M4.5 5.3v5.4M11.5 7.3c0 2.5-3 2.2-6.2 3.6" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>';

  function gitHtml(g) {
    if (!g || !S.cfg.behavior.git) return '';
    const bits = [];
    if (g.ahead) bits.push(`<span class="g-sync" title="${g.ahead} commit(s) to push">↑${g.ahead}</span>`);
    if (g.behind) bits.push(`<span class="g-sync" title="${g.behind} commit(s) to pull">↓${g.behind}</span>`);
    if (g.conflicts) bits.push(`<span class="g-conflict" title="${g.conflicts} conflict(s)">!${g.conflicts}</span>`);
    if (g.staged) bits.push(`<span class="g-staged" title="${g.staged} staged file(s)">+${g.staged}</span>`);
    if (g.modified) bits.push(`<span class="g-modified" title="${g.modified} modified file(s)">~${g.modified}</span>`);
    if (g.untracked) bits.push(`<span class="g-untracked" title="${g.untracked} untracked file(s)">?${g.untracked}</span>`);
    const clean = !g.staged && !g.modified && !g.untracked && !g.conflicts;
    return `<span class="t-git${clean ? ' clean' : ''}" title="Git branch">${BRANCH_ICON}<span class="g-branch">${escapeHtml(g.branch || '?')}</span>${bits.join('')}${clean ? '<span class="g-clean" title="Nothing to commit">✓</span>' : ''}</span>`;
  }

  // ─── System stats ───────────────────────────────────────────────────

  const STATS = [
    { key: 'cpu', label: 'cpu' },
    { key: 'gpu', label: 'gpu' },
    { key: 'mem', label: 'ram' }
  ];
  const history = { cpu: [], gpu: [], mem: [] };
  let lastSample = null;

  function setupStats() {
    $('stats').innerHTML = STATS.map(s => `
      <div class="stat" data-stat="${s.key}">
        <span class="stat-label">${s.label}</span>
        <canvas class="stat-spark" width="38" height="14"></canvas>
        <span class="stat-value">–</span>
      </div>`).join('');
    native.stats.onSample(sample => {
      lastSample = sample;
      for (const s of STATS) {
        if (sample[s.key] == null) continue;
        const h = history[s.key];
        h.push(sample[s.key]);
        if (h.length > 30) h.shift();
      }
      drawStats();
    });
  }

  function drawStats() {
    if (!lastSample || !S.cfg.window.stats) return;
    const t = currentTheme();
    const dpr = window.devicePixelRatio || 1;
    for (const s of STATS) {
      const el = $('stats').querySelector(`[data-stat="${s.key}"]`);
      const v = lastSample[s.key];
      el.style.display = v == null ? 'none' : '';
      if (v == null) continue;
      el.querySelector('.stat-value').textContent = `${v}%`;
      const h = history[s.key];
      const avg = Math.round(h.reduce((a, b) => a + b, 0) / h.length);
      el.title = s.key === 'mem'
        ? `RAM: ${(lastSample.memUsed / 2 ** 30).toFixed(1)} / ${(lastSample.memTotal / 2 ** 30).toFixed(1)} GB (${v}%)`
        : `${s.label.toUpperCase()}: ${v}% · 1 min average: ${avg}%`;

      // Sparkline on a fixed 0–100 scale, last 30 samples (1 min).
      const c = el.querySelector('canvas');
      const W = 38;
      const H = 14;
      if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = rgba(t.foreground, 0.07);
      ctx.beginPath();
      ctx.roundRect(0, 0, W, H, 3);
      ctx.fill();
      if (h.length < 2) continue;
      const x = i => (i / 29) * (W - 2) + 1 + (30 - h.length) * ((W - 2) / 29);
      const y = val => H - 1.5 - (Math.min(100, val) / 100) * (H - 3);
      ctx.beginPath();
      h.forEach((val, i) => (i ? ctx.lineTo(x(i), y(val)) : ctx.moveTo(x(i), y(val))));
      ctx.lineTo(x(h.length - 1), H);
      ctx.lineTo(x(0), H);
      ctx.closePath();
      ctx.fillStyle = rgba(t.ui.accent, 0.16);
      ctx.fill();
      ctx.beginPath();
      h.forEach((val, i) => (i ? ctx.lineTo(x(i), y(val)) : ctx.moveTo(x(i), y(val))));
      ctx.strokeStyle = t.ui.accent;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }

  // ─── Settings drawer ────────────────────────────────────────────────

  const pendingSettings = new Map(); // "a.b" -> { path, value } not yet confirmed by a reload
  let persistTimer = null;
  let applyQueued = false;

  function getSetting(path) {
    return path.reduce((o, k) => (o == null ? undefined : o[k]), S.cfg);
  }

  function assign(cfg, path, value) {
    let o = cfg;
    for (const k of path.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
    o[path[path.length - 1]] = value;
  }

  function setSetting(path, value) {
    assign(S.cfg, path, value);
    pendingSettings.set(path.join('.'), { path, value });
    if (!applyQueued) {
      applyQueued = true;
      requestAnimationFrame(() => { applyQueued = false; applyConfig(); });
    }
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistSettings, 350);
  }

  async function persistSettings() {
    S.selfWrite = Date.now();
    try {
      for (const { path, value } of [...pendingSettings.values()]) await native.config.set(path, value);
    } catch (e) {
      toast(`Could not save: ${e.message}`, 'error');
    }
  }

  // A reload may still carry old values while a write is in flight: keep ours until it lands.
  function mergePending(cfg) {
    for (const [key, { path, value }] of pendingSettings) {
      const current = path.reduce((o, k) => (o == null ? undefined : o[k]), cfg);
      if (current === value) pendingSettings.delete(key);
      else assign(cfg, path, value);
    }
  }

  function setupSettings() {
    Settings.init({
      get: getSetting,
      set: setSetting,
      themes: () => Object.entries(allThemes()),
      themeId: () => S.themeId,
      setTheme: selectTheme,
      pickImage: () => pickPath({
        mode: 'file',
        title: 'Choose a background image',
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'],
        start: joinPath(S.paths.home, 'Pictures')
      }),
      openConfig: () => native.open.path('config'),
      openThemes: () => native.open.path('themes'),
      fileUrl,
      assets: native.assets,
      openFolder: which => native.open.path(which),
      imageSample: p => native.image.sample(absPath(p), 256),
      onClose: refocus
    });
  }

  function tickClock() {
    const d = new Date();
    $('clock').textContent = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function toast(message, kind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = message;
    $('toasts').appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 300);
    }, kind === 'error' || kind === 'tip' ? 7000 : 2200);
  }

  function renderStatusItems() {
    const root = $('status-items');
    root.innerHTML = '';
    for (const item of S.statusItems.values()) {
      const el = document.createElement(item.onClick ? 'button' : 'span');
      el.className = 'status-item';
      try { el.textContent = typeof item.text === 'function' ? item.text() : item.text; } catch { el.textContent = '⚠'; }
      if (item.title) el.title = item.title;
      if (item.onClick) el.addEventListener('click', item.onClick);
      root.appendChild(el);
    }
  }

  function setupBar() {
    $('win-min').addEventListener('click', () => native.win.minimize());
    $('win-max').addEventListener('click', () => native.win.toggleMaximize());
    $('win-close').addEventListener('click', () => native.win.close());
    $('btn-palette').addEventListener('click', () => run('palette.open'));
    $('btn-settings').addEventListener('click', () => run('settings.open'));
    $('bar').addEventListener('dblclick', e => {
      if (!e.target.closest('button')) native.win.toggleMaximize();
    });
    const setMax = m => document.body.classList.toggle('maximized', !!m);
    native.win.onMaximized(setMax);
    native.win.isMaximized().then(setMax);
    tickClock();
    setInterval(tickClock, 5000);
  }

  // ─── Pickers ────────────────────────────────────────────────────────

  function openPalette() {
    const items = [...S.commands.values()]
      .filter(c => !c.hidden)
      .map(c => ({ id: c.id, label: c.title, hint: Keys.pretty(S.keymap[c.id]), detail: c.plugin ? c.plugin : '', keywords: c.keywords }));
    Palette.open({ prefix: '›', placeholder: 'What do you want to do?', items, onSelect: item => run(item.id), onClose: refocus });
  }

  function pickTheme() {
    Palette.open({
      prefix: '◐',
      placeholder: 'Pick a theme (live preview)…',
      items: Object.entries(allThemes()).map(([id, t]) => ({
        id,
        label: t.name || id,
        detail: t.light ? 'light' : 'dark',
        selected: id === S.themeId,
        swatch: [t.background, t.red, t.green, t.yellow, t.blue, t.magenta].filter(Boolean)
      })),
      onHighlight: item => {
        if (!item || item.id === S.previewTheme) return;
        S.previewTheme = item.id;
        applyTheme();
      },
      onSelect: item => {
        S.previewTheme = null;
        selectTheme(item.id);
      },
      onCancel: () => { S.previewTheme = null; applyTheme(); },
      onClose: refocus
    });
  }

  function pickShell() {
    Palette.open({
      prefix: '❯',
      placeholder: 'Open a new pane with…',
      items: [
        ...S.shells.map(s => ({ id: s.id, label: s.name, detail: s.id })),
        ...Object.entries(VIEWS).map(([id, v]) => ({ id: `view:${id}`, label: v.name, detail: v.detail }))
      ],
      onSelect: item => item.id.startsWith('view:')
        ? createPane({ view: item.id.slice(5), cwd: focusedTerm()?.cwd || undefined })
        : createPane({ profile: item.id }),
      onClose: refocus
    });
  }

  function selectTheme(id) {
    S.themeId = id;
    applyTheme();
    S.selfWrite = Date.now();
    native.config.setTheme(id);
    Settings.sync();
    toast(`Theme: ${allThemes()[id]?.name || id}`);
  }

  function refocus() {
    setTimeout(() => {
      if (Palette.isOpen() || Settings.isOpen()) return;
      if (Sidebar.isOpen() && document.activeElement?.closest?.('#drawer')) return;
      focusTerminal(focusedPane() || {});
    }, 0);
  }

  // ─── Commands ───────────────────────────────────────────────────────

  function command(id, title, fn, extra = {}) {
    S.commands.set(id, { id, title, run: fn, ...extra });
  }

  function run(id, ...args) {
    const c = S.commands.get(id);
    if (!c) return toast(`Unknown command: ${id}`, 'error');
    try {
      const r = c.run(...args);
      if (r && r.catch) r.catch(e => toast(e.message, 'error'));
    } catch (e) {
      console.error(e);
      toast(`${c.title}: ${e.message}`, 'error');
    }
  }

  function registerCommands() {
    command('pane.new', 'New terminal', () => createPane(), { keywords: 'pane open' });
    command('pane.splitRight', 'Split right', () => createPane({ dir: 'h' }), { keywords: 'split vertical' });
    command('pane.splitDown', 'Split down', () => createPane({ dir: 'v' }), { keywords: 'split horizontal' });
    command('pane.close', 'Close pane', () => { const p = focusedPane(); if (p) closePane(p.id); });
    command('pane.zoom', 'Zoom / restore pane', toggleZoom, { keywords: 'zoom maximize fullscreen' });
    command('prompt.prev', 'Jump to the previous command', () => jumpPrompt(-1), { keywords: 'scroll prompt block up' });
    command('prompt.next', 'Jump to the next command', () => jumpPrompt(1), { keywords: 'scroll prompt block down' });
    command('block.copyOutput', 'Copy the output of the last command', copyLastOutput, { keywords: 'block output copy result' });
    command('pane.equalize', 'Equalize panes', equalize, { keywords: 'balance size' });
    command('pane.toggleSplit', 'Rotate split (horizontal ⇄ vertical)', toggleSplitDir, { keywords: 'rotate orientation' });
    for (const d of DIRS) {
      command(`focus.${d}`, `Focus ${DIR_LABEL[d]}`, () => focusDir(d));
      command(`swap.${d}`, `Move pane ${DIR_LABEL[d]}`, () => swapDir(d), { keywords: 'swap move' });
      command(`resize.${d}`, `Resize ${DIR_LABEL[d]}`, () => resizeDir(d), { keywords: 'size' });
    }
    for (let i = 1; i <= WS_COUNT; i++) {
      command(`workspace.${i}`, `Go to workspace ${i}`, () => switchWorkspace(i - 1), { keywords: 'workspace desktop' });
      command(`moveTo.${i}`, `Send pane to workspace ${i}`, () => movePaneTo(i - 1), { keywords: 'workspace move' });
    }
    command('workspace.next', 'Next workspace', () => switchWorkspace((S.active + 1) % WS_COUNT));
    command('workspace.prev', 'Previous workspace', () => switchWorkspace((S.active - 1 + WS_COUNT) % WS_COUNT));
    command('palette.open', 'Command palette', openPalette, { hidden: true });
    command('theme.pick', 'Change theme…', pickTheme, { keywords: 'colors colours theme' });
    command('theme.next', 'Next theme', () => {
      const ids = Object.keys(allThemes());
      selectTheme(ids[(ids.indexOf(S.themeId) + 1) % ids.length]);
    });
    command('settings.open', 'Settings (appearance, background, transparency…)', () => Settings.toggle(), { keywords: 'settings options preferences opacity background animation' });
    for (const [mode, label] of BACKGROUND_LABELS) {
      command(`background.${mode}`, `Background: ${label}`, () => {
        if (mode === 'image' && !backgroundImage()) return Settings.open();
        if (mode !== 'none' && S.cfg.window.paneOpacity >= 1) setSetting(['window', 'paneOpacity'], 0.86);
        setSetting(['background', 'mode'], mode);
        Settings.sync();
      }, { keywords: 'background wallpaper animation' });
    }
    for (const [id, title, keywords] of [
      ['folders', 'Folders (quick access)', 'favorites directories cd'],
      ['ai', 'AI assistant', 'claude ai agent chat'],
      ['aliases', 'Aliases', 'shortcuts commands'],
      ['plugins', 'Plugins', 'extensions addons']
    ]) {
      command(`panel.${id}`, title, () => Sidebar.toggle(id), { keywords: `panel sidebar ${keywords}` });
    }
    for (const [id, name] of [['claude', 'Claude Code'], ['codex', 'Codex (OpenAI)'], ['gemini', 'Gemini CLI'], ['vibe', 'Mistral Vibe']]) {
      command(`agent.${id}`, `Open ${name} (installs it if needed)`, () => launchAgent(id), { keywords: 'ai agent cli subscription account' });
    }
    command('ai.explain', 'AI: explain what is happening in the terminal', () => askAi('Look at the last lines of my active terminal, explain what happened and suggest a fix.'), { keywords: 'error help claude' });
    command('stats.toggle', 'Show / hide system stats', () => setSetting(['window', 'stats'], !S.cfg.window.stats), { keywords: 'cpu gpu ram' });
    command('shell.pick', 'New terminal with…', pickShell, { keywords: 'shell profile powershell cmd bash wsl' });
    command('search.open', 'Search in terminal', () => openSearch(), { keywords: 'find' });
    command('terminal.clear', 'Clear terminal', () => focusedTerm()?.term?.clear(), { keywords: 'clear reset' });
    command('copy', 'Copy', () => copySelection());
    command('paste', 'Paste', () => paste());
    command('font.increase', 'Increase font size', () => setFontDelta(S.fontDelta + 1), { keywords: 'zoom font bigger' });
    command('font.decrease', 'Decrease font size', () => setFontDelta(S.fontDelta - 1), { keywords: 'zoom font smaller' });
    command('font.reset', 'Reset font size', () => setFontDelta(0), { keywords: 'zoom font' });
    command('bar.toggle', 'Show / hide the top bar', () => { document.body.classList.toggle('no-bar'); });
    command('window.new', 'New window', () => native.win.create());
    command('window.close', 'Close window', () => native.win.close());
    command('window.fullscreen', 'Toggle fullscreen', () => native.win.toggleFullscreen());
    command('window.reload', 'Reload window (plugins)', () => native.win.reload(), { keywords: 'reload refresh' });
    command('window.devtools', 'Developer tools', () => native.win.devtools(), { keywords: 'debug console' });
    command('config.open', 'Open config file', () => native.open.path('config'), { keywords: 'settings preferences jsonc' });
    command('config.folder', 'Open Lumen folder', () => native.open.path('dir'));
    command('themes.folder', 'Open themes folder', () => native.open.path('themes'));
    command('plugins.folder', 'Open plugins folder', () => native.open.path('plugins'));
  }

  function setFontDelta(d) {
    S.fontDelta = Math.max(-8, Math.min(30, d));
    const size = Math.max(6, S.cfg.font.size + S.fontDelta);
    for (const p of S.panes.values()) if (p.term) p.term.options.fontSize = size;
    fitAll();
  }

  // Global shortcuts run in the capture phase so they win over the terminal.
  // While typing in a text field (notes, AI, search…), only these shortcuts stay global;
  // the others (Ctrl+Shift+arrows, Ctrl+C…) keep their usual text-editing meaning.
  const GLOBAL_IN_FIELDS = /^(palette\.|settings\.|panel\.|window\.|workspace\.|theme\.pick|ai\.)/;

  function atTextEdge(el, side) {
    if (typeof el?.selectionStart !== 'number') return true;
    const len = (el.value || '').length;
    return side === 'start' ? el.selectionStart === 0 && el.selectionEnd === 0 : el.selectionStart === len && el.selectionEnd === len;
  }

  function inTextField(target) {
    if (!target || target.classList?.contains('xterm-helper-textarea')) return false;
    return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
  }

  function onKeyDown(e) {
    if (Palette.isOpen()) return;
    if (Settings.isOpen() && e.key === 'Escape') {
      e.preventDefault();
      Settings.close();
      return;
    }
    const typing = inTextField(e.target);
    for (const combo of Keys.fromEvent(e)) {
      const id = S.bindings.get(combo);
      // In a text field, Ctrl+Shift+←/→ still selects words, except at the edge of the text
      // where it would do nothing: there it moves focus to the next zone.
      const leavesField = (id === 'focus.left' || id === 'focus.right') && atTextEdge(e.target, id === 'focus.left' ? 'start' : 'end');
      if (id && typing && !GLOBAL_IN_FIELDS.test(id) && !leavesField) return;
      if (id && S.commands.has(id)) {
        e.preventDefault();
        e.stopPropagation();
        run(id);
        return;
      }
    }
  }

  // ─── Sidebar host: what panels (and the AI tools) can do ────────────

  const ICON_PATHS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l2 2h8.6A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/>',
    terminal: '<path d="m5 7 5 5-5 5M12 17h7"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    star: '<path d="m12 4 2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    back: '<path d="M15 5l-7 7 7 7"/>',
    pin: '<path d="M9 4h6l-1 5 3 3H7l3-3zM12 15v5"/>',
    trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20a2 2 0 0 0 4 0"/>',
    copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
    play: '<path d="M8 5v14l11-7z"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    sparkle: '<path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M16 7l2 2M14 9l2 2"/>',
    send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
    stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5"/><path d="M5 3v4h4M19 21v-4h-4"/>'
  };
  const icon = name => `<svg viewBox="0 0 24 24" class="i">${ICON_PATHS[name] || ''}</svg>`;

  const shellKind = p => p?.profile?.kind || (S.platform === 'win32' ? 'powershell' : 'posix');
  const isPosix = kind => kind === 'bash' || kind === 'wsl' || kind === 'posix';
  const shQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

  function toPosixPath(dir, kind) {
    const m = String(dir).match(/^([a-z]):[\\/]?(.*)$/i);
    if (!m) return String(dir).replace(/\\/g, '/');
    const rest = m[2].replace(/\\/g, '/');
    return kind === 'wsl' ? `/mnt/${m[1].toLowerCase()}/${rest}` : `/${m[1].toLowerCase()}/${rest}`;
  }

  function cdLine(kind, dir) {
    if (kind === 'cmd') return `cd /d "${dir}"`;
    if (isPosix(kind)) return `cd ${shQuote(toPosixPath(dir, kind))}`;
    return `Set-Location -LiteralPath '${String(dir).replace(/'/g, "''")}'`;
  }

  const writeLine = (pane, line) => {
    beginCommand(pane, line);
    native.pty.write(pane.ptyId, `${line}\r`);
  };

  // A command an embedded agent runs (ACP terminal): shown in a "✦" pane of the active
  // workspace. Successive commands reuse that pane; one started while another still runs
  // gets a pane of its own. The pane stays after the command, to read the output.
  async function showAgentCommand({ ptyId, title, command, cwd }) {
    const header = `\r\n\x1b[90m── ${title} · ${prettyPath(cwd)}\x1b[0m\r\n\x1b[36m❯ ${command}\x1b[0m\r\n`;
    let pane = [...S.panes.values()].find(p => p.agentPane && !p.agentBusy && p.ws === S.active);
    if (pane) {
      pane.ptyId = ptyId;
      pane.agentBusy = true;
      S.byPty.set(ptyId, pane);
      pane.term.write(header);
      const early = S.pendingData.get(ptyId);
      if (early) { S.pendingData.delete(ptyId); writeOutput(pane, early); }
      native.pty.resize(ptyId, pane.term.cols, pane.term.rows);
      return;
    }
    S.pendingData.set(ptyId, header + (S.pendingData.get(ptyId) || ''));
    pane = await createPane({ dir: 'h', attach: { ptyId, title, cwd } });
    if (!pane) return;
    pane.agentPane = true;
    pane.agentBusy = S.byPty.get(ptyId) === pane;
    pane.title = title;
    updateTitle();
  }

  function typeInFocused(text) {
    const p = focusedTerm();
    if (!p?.ptyId) return false;
    native.pty.write(p.ptyId, text);
    p.term.focus();
    return true;
  }

  function pasteToFocused(text) {
    const p = focusedTerm();
    if (!p?.term) return false;
    insertText(p, text);
    return true;
  }

  function cdFocused(dir) {
    const p = focusedTerm();
    if (!p?.ptyId) return createPane({ cwd: dir });
    writeLine(p, cdLine(shellKind(p), dir));
    p.term.focus();
  }

  function applyAliasToFocused(alias) {
    const p = focusedTerm();
    if (!p?.ptyId) return;
    const kind = shellKind(p);
    const line = kind === 'cmd' ? `doskey ${alias.name}=${alias.command} $*`
      : isPosix(kind) ? `alias ${alias.name}=${shQuote(alias.command)}`
      : `function global:${alias.name} { ${alias.command} @args }`;
    writeLine(p, line);
    p.term.focus();
  }

  // Buffer rows as text, wrapped rows joined back into one line.
  function bufferText(pane, from, to) {
    const buf = pane.term.buffer.active;
    const out = [];
    for (let y = Math.max(0, from); y <= to; y++) {
      const line = buf.getLine(y);
      if (!line) continue;
      const text = line.translateToString(true);
      if (line.isWrapped && out.length) out[out.length - 1] += text;
      else out.push(text);
    }
    return out;
  }

  function resolvePane(which) {
    if (!which || which === 'focused') return focusedTerm();
    if (which === 'agent') return S.panes.get(S.agentPaneId) || null;
    return S.panes.get(which) || null;
  }

  function readTerminal(which, lines = 80) {
    const p = resolvePane(which);
    if (!p?.term) throw new Error('no matching terminal');
    const buf = p.term.buffer.active;
    const end = buf.baseY + buf.cursorY;
    return bufferText(p, end - lines + 1, end).join('\n').replace(/\s+$/, '') || '(vide)';
  }

  function waitPrompt(pane, timeoutMs) {
    return new Promise(resolve => {
      const done = code => {
        clearTimeout(timer);
        pane.promptListeners.delete(done);
        resolve({ code, timedOut: false });
      };
      const timer = setTimeout(() => {
        pane.promptListeners.delete(done);
        resolve({ code: null, timedOut: true });
      }, timeoutMs);
      pane.promptListeners.add(done);
    });
  }

  // The AI works in its own pane, split next to the user's, so it never types into theirs.
  async function agentPane() {
    const existing = S.panes.get(S.agentPaneId);
    if (existing && !existing.exited) return existing;
    const ws = activeWs();
    const previous = ws.focused;
    const p = await createPane({ dir: 'h' });
    if (!p?.ptyId) throw new Error('could not create the agent terminal');
    S.agentPaneId = p.id;
    p.el.classList.add('agent');
    if (previous && S.panes.has(previous)) focusPane(previous);
    if (!p.prompts) await waitPrompt(p, 10000);
    return p;
  }

  async function runCommand({ command, pane: where = 'agent', cwd, timeout_seconds: timeout = 120 }) {
    const p = where === 'focused' ? focusedTerm() : await agentPane();
    if (!p?.ptyId) throw new Error('no terminal available');
    const kind = shellKind(p);
    const line = cwd && where !== 'focused' ? `${cdLine(kind, cwd)}${kind === 'powershell' ? '; ' : ' && '}${command}` : command;
    const buf = p.term.buffer.active;
    const start = buf.baseY + buf.cursorY;
    const waiting = waitPrompt(p, Math.min(600, Math.max(5, timeout)) * 1000);
    writeLine(p, line);
    const { code, timedOut } = await waiting;
    await new Promise(r => setTimeout(r, 40)); // let the parser settle
    const now = p.term.buffer.active;
    const end = now.baseY + now.cursorY;
    // First row is the prompt + echoed command; the last one is the new prompt.
    const out = bufferText(p, start, timedOut ? end : end - 1).slice(1).join('\n').replace(/\s+$/, '');
    return { exitCode: code, timedOut, output: out.length > 12000 ? `…${out.slice(-12000)}` : out };
  }

  function environment() {
    const lines = [
      `date: ${new Date().toLocaleString('en-GB')} (${Intl.DateTimeFormat().resolvedOptions().timeZone})`,
      `os: ${S.platform === 'win32' ? `Windows (build ${S.osBuild})` : S.platform}; home: ${S.paths.home}`,
      `shells: ${S.shells.map(s => `${s.id} (${s.name})`).join(', ')}; default: ${S.cfg.shells.default}`,
      `lumen: theme=${S.themeId}, background=${backgroundMode()}, font="${S.cfg.font.family}" ${S.cfg.font.size}px, active workspace ${S.active + 1}`,
      'panes:'
    ];
    for (const ws of S.workspaces) {
      for (const p of panesOf(ws)) {
        const g = p.git;
        const git = g ? ` git=${g.branch}${g.ahead ? ` ↑${g.ahead}` : ''}${g.behind ? ` ↓${g.behind}` : ''}${g.staged ? ` +${g.staged}` : ''}${g.modified ? ` ~${g.modified}` : ''}${g.untracked ? ` ?${g.untracked}` : ''}${g.conflicts ? ` !${g.conflicts}` : ''}` : '';
        const flags = [ws.index === S.active && ws.focused === p.id ? 'focused' : '', p.id === S.agentPaneId ? 'agent' : ''].filter(Boolean);
        lines.push(`- ${p.id} [workspace ${ws.index + 1}${flags.length ? `, ${flags.join(', ')}` : ''}] ${p.profile?.name || '?'} cwd=${p.cwd || '?'}${git}${p.lastExit ? ` last_exit=${p.lastExit}` : ''}`);
      }
    }
    if (!S.panes.size) lines.push('- (none)');
    const f = focusedTerm();
    if (f?.term) {
      try { lines.push('focused pane, last lines:', readTerminal('focused', 25)); } catch {}
    }
    return lines.join('\n');
  }

  function configSnapshot() {
    return {
      config: S.cfg,
      themes: Object.keys(allThemes()),
      backgrounds: BACKGROUND_LABELS.map(([id]) => id),
      bundledFonts: Fonts.bundled(),
      shells: S.shells.map(({ id, name, kind }) => ({ id, name, kind })),
      paths: S.paths
    };
  }

  async function installPlugin(name, code) {
    const file = await native.plugins.install(name, code, true);
    // Loading records the code, so the file watcher sees nothing new and won't load it twice.
    loadPlugins([{ name: file.replace(/\.js$/, ''), code }]);
    buildBindings();
    emit('plugins:changed');
    return `installed and loaded: ${file}`;
  }

  async function addAlias({ name, command, description = '' }) {
    if (!/^[A-Za-z_][\w.-]{0,40}$/.test(name)) throw new Error(`invalid alias name: ${name}`);
    const list = (await native.aliases.list()).filter(a => a.name !== name);
    list.push({ name, command, description });
    list.sort((a, b) => a.name.localeCompare(b.name));
    await native.aliases.save(list);
    emit('aliases:changed');
    return `alias "${name}" saved: available in every new terminal.`;
  }

  function newNote(fields = {}) {
    const now = new Date().toISOString();
    return {
      id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: '', body: '', createdAt: now, updatedAt: now, pinned: false, remindAt: null, reminded: false,
      ...fields
    };
  }

  // Notes belong to the built-in Notes plugin (its storage key "notes").
  const NOTES_STORE = 'plugin-notes-notes';

  async function addNote(fields) {
    const notes = (await native.store.get(NOTES_STORE)) || [];
    const note = newNote(fields);
    notes.unshift(note);
    await native.store.set(NOTES_STORE, notes);
    emit('storage:changed', NOTES_STORE);
    return note;
  }

  // Lumen's own file / folder picker, built on the palette: no native OS dialog anywhere.
  // mode "file" returns a file path, "folder" a directory; Esc returns null.
  const joinPath = (dir, name) => (/[\\/]$/.test(dir) ? dir + name : dir + (S.platform === 'win32' ? '\\' : '/') + name);

  function pickPath({ mode = 'file', extensions = null, start = null, title = 'Choose a file' } = {}) {
    return new Promise(resolve => {
      let settled = false;
      const finish = value => { if (!settled) { settled = true; resolve(value); } };
      const show = async dir => {
        let listing;
        try { listing = await native.fs.list(dir); } catch (e) { toast(e.message, 'error'); listing = await native.fs.list(''); }
        const items = [];
        if (listing.parent !== null) items.push({ id: '..', label: '..', detail: 'parent folder', path: listing.parent, kind: 'dir', pinned: true });
        if (mode === 'folder' && listing.dir) items.push({ id: 'use', label: '✓ Use this folder', detail: prettyPath(listing.dir), path: listing.dir, kind: 'pick', pinned: true, selected: true });
        for (const entry of listing.entries) {
          if (entry.hidden) continue;
          const ext = entry.name.split('.').pop().toLowerCase();
          if (!entry.dir && (mode === 'folder' || (extensions && !extensions.includes(ext)))) continue;
          const full = listing.dir ? joinPath(listing.dir, entry.name) : entry.name;
          items.push({ id: full, label: entry.dir ? `${entry.name}/` : entry.name, path: full, kind: entry.dir ? 'dir' : 'pick' });
        }
        Palette.open({
          prefix: mode === 'folder' ? '▸' : '◇',
          placeholder: `${title} · ${listing.dir ? prettyPath(listing.dir) : 'drives'}`,
          items,
          onSelect: item => (item.kind === 'dir' ? show(item.path) : finish(item.path)),
          onCancel: () => finish(null)
        });
      };
      show(start || S.paths.home);
    });
  }

  // Two-step confirmation without a dialog: the first click arms the button (it turns red),
  // a second click within 3 s performs the action.
  function confirmClick(button, hint = 'Click again to confirm') {
    if (button.classList.contains('armed')) {
      button.classList.remove('armed');
      clearTimeout(button._armTimer);
      return true;
    }
    button.classList.add('armed');
    toast(hint);
    button._armTimer = setTimeout(() => button.classList.remove('armed'), 3000);
    return false;
  }

  // Opens an AI CLI (Claude Code, Codex, Gemini, Vibe) in a new pane. When it isn't
  // installed yet, the same pane installs it first (and Node.js when npm is missing), then
  // starts it; the user signs in with their own account on first launch.
  async function launchAgent(id) {
    const { agents, hasNpm, platform } = await native.agents.detect();
    const agent = agents.find(a => a.id === id);
    if (!agent) throw new Error(`unknown agent: ${id}`);
    const win = platform === 'win32';
    const psProfile = S.shells.find(s => s.kind === 'powershell');
    // Started in ~/.lumen, where AGENTS.md / CLAUDE.md / GEMINI.md teach it how to customize Lumen.
    const pane = await createPane({ dir: 'h', cwd: S.paths.dir, profile: win && psProfile ? psProfile.id : undefined });
    if (!pane?.ptyId) throw new Error('could not open a terminal');
    if (!pane.prompts) await waitPrompt(pane, 10000);

    let line = agent.command;
    if (!agent.path) {
      const steps = [];
      if (agent.needsNode && !hasNpm) {
        steps.push(win
          ? "winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements; $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')"
          : 'echo "Node.js is required: install it from https://nodejs.org and run this again" && false');
      }
      steps.push(agent.install);
      line = win
        ? `${steps.join('; ')}; if ($?) { Write-Host "\`n${agent.name} installed. Starting it…\`n" -ForegroundColor Green; ${agent.command} }`
        : `${steps.join(' && ')} && echo "${agent.name} installed. Starting it…" && ${agent.command}`;
      toast(`Installing ${agent.name}…`);
    }
    writeLine(pane, line);
    pane.term.focus();
    return agent;
  }

  function askAi(prompt, { send = true } = {}) {
    Sidebar.open('ai', { prompt, send });
  }

  const panelHost = {
    native,
    icon,
    escape: escapeHtml,
    prettyPath,
    toast,
    run: id => run(id),
    on,
    refocus,
    paths: () => S.paths,
    cfg: () => S.cfg,
    focusedPane: () => paneApi(focusedTerm()),
    // The focused terminal as the Aliases panel needs it (its pty, to ask the main process).
    focusedTerminal: () => {
      const p = focusedTerm();
      return p ? { id: p.id, ptyId: p.ptyId, cwd: p.cwd, profile: p.profile, ready: p.prompts > 0 } : null;
    },
    createPane: opts => createPane(opts),
    recentDirs: () => S.recentDirs,
    forgetRecentDir(p) {
      S.recentDirs = S.recentDirs.filter(d => d !== p);
      native.store.set('recent-dirs', S.recentDirs);
    },
    cdFocused,
    typeInFocused,
    pasteToFocused,
    applyAliasToFocused,
    runCommand,
    readTerminal,
    environment,
    configSnapshot,
    setSetting(key, value) {
      setSetting(key, value);
      Settings.sync();
    },
    installPlugin,
    addAlias,
    newNote,
    addNote,
    askAi,
    launchAgent,
    pickPath,
    confirmClick,
    focusPanes,
    panelActive: id => Sidebar.active() === id
  };

  // ─── Plugins ────────────────────────────────────────────────────────

  // track(fn) registers a cleanup to run when the plugin owning this API unloads.
  function paneApi(p, track = null) {
    if (!p) return null;
    return {
      id: p.id,
      get workspace() { return p.ws + 1; },
      get title() { return p.title; },
      get cwd() { return p.cwd; },
      get shell() { return p.profile; },
      get running() { return !!p.running; },
      term: p.term,
      write: data => p.ptyId != null && native.pty.write(p.ptyId, data),
      run: cmd => p.ptyId != null && writeLine(p, cmd),
      paste: text => { if (p.term) insertText(p, text); },
      // Resolves once the shell has printed its first prompt (false after the timeout).
      ready: (ms = 10000) => (p.prompts ? Promise.resolve(true) : waitPrompt(p, ms).then(r => !r.timedOut)),
      onOutput: fn => {
        p.outputListeners.add(fn);
        const off = () => p.outputListeners.delete(fn);
        track?.(off);
        return off;
      },
      focus: () => focusPane(p.id),
      close: () => closePane(p.id)
    };
  }

  // Everything a plugin creates goes through its API and is recorded, so the plugin can be
  // unloaded cleanly: enabling, disabling, editing or deleting a plugin applies live.
  // Services a plugin only gets when it declares them: "// @permissions clipboard".
  function permissionServices(name, track, permissions) {
    const services = {};
    if (permissions.includes('clipboard')) {
      services.clipboard = {
        read: () => native.clipboard.read(),
        write: text => native.clipboard.write(String(text)),
        history: {
          list: () => native.clipboardHistory.list(),
          remove: text => native.clipboardHistory.remove(text),
          clear: () => native.clipboardHistory.clear(),
          onChange(fn) {
            const off = native.clipboardHistory.onChange(fn);
            track(off);
            return off;
          }
        }
      };
    }
    if (permissions.includes('git')) {
      // Fixed git operations on a work tree (see src/main/git.js): status, log, branches, diff,
      // show, stage, unstage, discard, commit, fetch, pull, push, checkout, createBranch, stash…
      services.git = new Proxy({}, {
        get: (_t, op) => typeof op === 'string' && op !== 'then' ? (...args) => ipcCall(native.git.op(op, ...args)) : undefined
      });
    }
    if (permissions.includes('github')) {
      services.github = {
        status: () => ipcCall(native.github.status()),
        get: path => ipcCall(native.github.get(path)),
        contributions: () => ipcCall(native.github.contributions()),
        setToken: token => ipcCall(native.github.setToken(token)),
        signOut: () => ipcCall(native.github.signOut()),
        refresh: () => ipcCall(native.github.refresh())
      };
    }
    return services;
  }

  // Errors thrown in the main process arrive as "Error invoking remote method 'x': Error: msg".
  function ipcCall(promise) {
    return promise.catch(e => {
      throw new Error(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
    });
  }

  function pluginApi(name, track, permissions = []) {
    const status = {
      add(item) {
        const entry = { ...item };
        S.statusItems.set(item.id, entry);
        if (item.interval) entry.timer = setInterval(renderStatusItems, item.interval);
        renderStatusItems();
        track(() => status.remove(item.id));
        return () => status.remove(item.id);
      },
      remove(id) {
        clearInterval(S.statusItems.get(id)?.timer);
        S.statusItems.delete(id);
        renderStatusItems();
      },
      refresh: renderStatusItems
    };
    // UI helpers so plugin panels look like the rest of Lumen.
    const ui = {
      icon,
      escape: escapeHtml,
      prettyPath,
      toast: (msg, kind) => toast(msg, kind),
      confirmClick,
      // Lumen's own file / folder picker (no OS dialog): { mode: 'file' | 'folder', title, start }
      pickPath: opts => pickPath(opts),
      openUrl: url => { if (/^https:\/\//i.test(String(url))) native.open.external(String(url)); },
      relativeTime
    };
    return {
      ...permissionServices(name, track, permissions),
      name,
      version: S.version,
      platform: S.platform,
      permissions: [...permissions],
      get shells() { return S.shells.map(({ id, name, kind }) => ({ id, name, kind })); },
      ui,
      get config() { return S.cfg; },
      on(event, fn) {
        const off = on(event, fn);
        track(off);
        return off;
      },
      run,
      notify: (msg, kind) => toast(msg, kind),
      commands: {
        register(id, def) {
          command(id, def.title || id, def.run, { plugin: name, keywords: def.keywords });
          if (def.keybinding) { S.pluginKeys[id] = def.keybinding; buildBindings(); }
          track(() => { S.commands.delete(id); delete S.pluginKeys[id]; });
        }
      },
      themes: {
        register(id, theme) {
          S.pluginThemes[id] = theme;
          track(() => delete S.pluginThemes[id]);
        },
        apply(id) { S.themeId = id; applyTheme(); },
        get current() { return S.themeId; }
      },
      statusbar: status,
      panes: {
        focused: () => paneApi(focusedTerm(), track),
        all: () => [...S.panes.values()].map(p => paneApi(p, track)),
        create: async opts => paneApi(await createPane(opts), track)
      },
      sidebar: {
        // def: { id, title, icon: '<svg…>', width, render(el, host, actionsEl), onOpen(arg), onClose() }
        add(def) {
          // Panels get the UI helpers, never Lumen's internal host object.
          const off = Sidebar.register({
            order: 70,
            ...def,
            id: `${name}.${def.id}`,
            render(el, _host, actions) { return def.render.call(this, el, ui, actions); }
          });
          track(off);
          return off;
        },
        open: (id, arg) => Sidebar.open(`${name}.${id}`, arg),
        toggle: (id, arg) => Sidebar.toggle(`${name}.${id}`, arg),
        close: () => Sidebar.close(),
        isOpen: id => Sidebar.active() === `${name}.${id}`
      },
      storage: {
        get: key => native.store.get(storageName(name, key)),
        set: (key, data) => native.store.set(storageName(name, key), data),
        // Changes made by another window or by Lumen itself (e.g. the AI adding a note).
        onChange(key, fn) {
          const target = storageName(name, key);
          const off = native.store.onChange((n, data) => { if (n === target) fn(data); });
          track(off);
          const offLocal = on('storage:changed', n => { if (n === target) native.store.get(target).then(fn); });
          track(offLocal);
          return () => { off(); offLocal(); };
        }
      },
      ai: {
        ask: (prompt, opts) => askAi(prompt, opts)
      },
      css(text) {
        const style = document.createElement('style');
        style.dataset.plugin = name;
        style.textContent = text;
        document.head.appendChild(style);
        const off = () => style.remove();
        track(off);
        return off;
      }
    };
  }

  function storageName(plugin, key = 'data') {
    return `plugin-${`${plugin}-${key}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}`.slice(0, 41);
  }

  const pluginRuntime = new Map(); // name -> cleanup functions

  function unloadPlugin(name) {
    const cleanups = pluginRuntime.get(name);
    if (!cleanups) return;
    pluginRuntime.delete(name);
    for (const fn of cleanups.reverse()) {
      try { fn(); } catch (e) { console.error(`plugin ${name} cleanup`, e); }
    }
  }

  function loadPlugin(name, code, permissions = []) {
    unloadPlugin(name);
    const cleanups = [];
    pluginRuntime.set(name, cleanups);
    const track = fn => cleanups.push(fn);
    // Timers are handed to the plugin pre-wrapped, so its intervals stop when it unloads.
    const timers = {
      setInterval: (fn, ms, ...args) => { const id = setInterval(fn, ms, ...args); track(() => clearInterval(id)); return id; },
      setTimeout: (fn, ms, ...args) => { const id = setTimeout(fn, ms, ...args); track(() => clearTimeout(id)); return id; },
      clearInterval: id => clearInterval(id),
      clearTimeout: id => clearTimeout(id)
    };
    try {
      const api = pluginApi(name, track, permissions);
      const module = { exports: {} };
      new Function('module', 'exports', 'lumen', 'setInterval', 'setTimeout', 'clearInterval', 'clearTimeout', code)(
        module, module.exports, api, timers.setInterval, timers.setTimeout, timers.clearInterval, timers.clearTimeout);
      // A plugin may return a cleanup function (or export deactivate) for anything else it set up.
      const result = typeof module.exports === 'function' ? module.exports(api) : null;
      if (typeof result === 'function') track(result);
      if (typeof module.exports?.deactivate === 'function') track(module.exports.deactivate);
      console.info(`plugin loaded: ${name}`);
      return true;
    } catch (e) {
      console.error(`plugin ${name}`, e);
      toast(`Plugin "${name}": ${e.message}`, 'error');
      unloadPlugin(name);
      return false;
    }
  }

  function loadPlugins(list) {
    for (const { name, code, permissions } of list) {
      S.pluginCode.set(name, code);
      loadPlugin(name, code, permissions || []);
    }
  }

  // Applies the plugins folder as it is now: new and edited plugins (re)load, plugins that were
  // disabled or deleted unload. Runs whenever the folder changes, so nothing needs a reload.
  function syncPlugins(list) {
    const names = new Set(list.map(p => p.name));
    const removed = [...S.pluginCode.keys()].filter(n => !names.has(n));
    const changed = list.filter(p => S.pluginCode.get(p.name) !== p.code);
    if (!removed.length && !changed.length) return;
    for (const n of removed) { unloadPlugin(n); S.pluginCode.delete(n); }
    loadPlugins(changed);
    buildBindings();
    applyTheme();
    renderStatusItems();
    refreshKeyHints();
    emit('plugins:changed');
    const parts = [];
    if (changed.length) parts.push(`loaded ${changed.map(p => p.name).join(', ')}`);
    if (removed.length) parts.push(`unloaded ${removed.join(', ')}`);
    toast(`Plugins: ${parts.join(' · ')}`);
  }

  // ─── Boot ───────────────────────────────────────────────────────────

  function acceptPayload(p) {
    S.cfg = p.config;
    S.fileThemes = p.themes || {};
    S.shells = p.shells || [];
    S.paths = p.paths || {};
    S.platform = p.platform;
    S.osBuild = p.osBuild || 0;
    S.version = p.version;
    S.themeId = p.config.theme;
  }

  async function init() {
    const payload = await native.init();
    acceptPayload(payload);
    registerCommands();
    createWorkspaces();
    setupStats();
    setupSettings();
    S.recentDirs = (await native.store.get('recent-dirs')) || [];
    Sidebar.init(panelHost);
    for (const def of window.LumenPanels) Sidebar.register(def);
    native.onPanelOpen((id, arg) => Sidebar.open(id, arg));
    native.onReminder(n => emit('reminder', n));
    // One-time hint so new users discover the sidebar.
    const hints = (await native.store.get('hints')) || {};
    // The very first launch opens on an empty workspace 1 (its buttons start a terminal).
    const firstLaunch = !hints.launched && !payload.harness;
    if (!hints.sidebar) setTimeout(() => toast('Tip: hover the left edge (or Ctrl+Shift+← from the leftmost pane) for notes, AI, folders…', 'tip'), 2500);
    if (!hints.launched || !hints.sidebar) native.store.set('hints', { ...hints, launched: true, sidebar: true });
    await refreshUserFonts();
    applyConfig();
    setupBar();
    // Git also refreshes at every prompt and focus change; this only catches outside edits.
    setInterval(() => { if (document.hasFocus()) refreshGit(focusedTerm()); }, 15000);
    refreshKeyHints();

    try {
      await Promise.all([
        Fonts.ensure(S.cfg.font.family),
        document.fonts.load(`400 14px "JetBrains Mono"`),
        document.fonts.load(`700 14px "JetBrains Mono"`)
      ]);
    } catch {}

    loadPlugins(payload.plugins || []);
    buildBindings();
    refreshKeyHints();
    applyTheme();
    renderWorkspaces();

    native.pty.onData((id, data) => {
      const p = S.byPty.get(id);
      if (p) writeOutput(p, data);
      else S.pendingData.set(id, (S.pendingData.get(id) || '') + data);
    });
    native.pty.onExit((id, code) => {
      const p = S.byPty.get(id);
      S.pendingData.delete(id);
      if (!p) return;
      // An agent's pane stays open after its command, to read the output.
      if (p.agentPane) {
        S.byPty.delete(id);
        p.agentBusy = false;
        p.term.write(`\r\n\x1b[90m[exit code ${code ?? '?'}]\x1b[0m\r\n`);
        return;
      }
      p.exited = true;
      closePane(p.id);
    });
    native.config.onChange(async next => {
      await refreshUserFonts();
      mergePending(next.config);
      const configChanged = JSON.stringify(next.config) !== JSON.stringify(S.cfg);
      acceptPayload(next);
      applyConfig();
      refreshKeyHints();
      Settings.sync();
      syncPlugins(next.plugins || []);
      if (next.error) toast(next.error, 'error');
      else if (configChanged && Date.now() - S.selfWrite > 1500) toast('Config reloaded');
    });

    window.addEventListener('keydown', onKeyDown, true);
    document.body.classList.add('ready');
    document.body.classList.toggle('mac', S.platform === 'darwin');

    // Dropping outside a pane must never navigate the window away.
    document.addEventListener('dragover', e => e.preventDefault());
    document.addEventListener('drop', e => e.preventDefault());
    native.acp.onTerminal(showAgentCommand);
    native.onNotifyClick(id => {
      const p = S.panes.get(id);
      if (!p) return;
      switchWorkspace(p.ws);
      focusPane(id);
    });

    S.restoring = true;
    let restored = false;
    if (S.cfg.behavior?.restoreSession !== false && payload.restore) {
      try { restored = await restoreSession(payload.restore); } catch (e) { console.error('session restore', e); }
    }
    if (!restored && !firstLaunch) await createPane();
    S.restoring = false;
    saveSession();
    if (payload.error) toast(payload.error, 'error');
  }

  // Exposed for the dev screenshot harness and the devtools console.
  window.__lumen = { S, run, createPane, closePane, focusPane, switchWorkspace, toast, setSetting, host: panelHost };

  init().catch(e => {
    console.error(e);
    document.body.innerHTML = `<pre style="color:#f7768e;padding:24px;font:13px monospace">Lumen failed to start:\n${e.stack || e}</pre>`;
  });
})();
