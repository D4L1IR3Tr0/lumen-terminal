// Lumen website: bar, themes, reveals and the ASCII toys. Shared by every page; sections
// that are not on the page are simply skipped.
(function () {
  const $ = (s, root = document) => root.querySelector(s);
  const $$ = (s, root = document) => [...root.querySelectorAll(s)];
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const store = {
    get: k => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }
  };

  // ─── Themes (the same palettes as Lumen) ─────────────────────────────

  const THEMES = {
    'gruvbox': { name: 'Gruvbox', crust: '#1d2021', bg: '#282828', surface: '#232323', overlay: '#3c3836', border: '#3c3836', fg: '#ebdbb2', muted: '#928374', accent: '#fabd2f', accent2: '#fe8019', red: '#fb4934', green: '#b8bb26', yellow: '#fabd2f', cyan: '#8ec07c' },
    'tokyo-night': { name: 'Tokyo Night', crust: '#0f1017', bg: '#1a1b26', surface: '#1f2335', overlay: '#292e42', border: '#2f3549', fg: '#c0caf5', muted: '#565f89', accent: '#7aa2f7', accent2: '#bb9af7', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', cyan: '#7dcfff' },
    'catppuccin-mocha': { name: 'Catppuccin', crust: '#11111b', bg: '#1e1e2e', surface: '#181825', overlay: '#313244', border: '#313244', fg: '#cdd6f4', muted: '#6c7086', accent: '#cba6f7', accent2: '#89b4fa', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', cyan: '#94e2d5' },
    'rose-pine': { name: 'Rosé Pine', crust: '#111019', bg: '#191724', surface: '#1f1d2e', overlay: '#26233a', border: '#2a273f', fg: '#e0def4', muted: '#6e6a86', accent: '#ebbcba', accent2: '#c4a7e7', red: '#eb6f92', green: '#9ccfd8', yellow: '#f6c177', cyan: '#9ccfd8' },
    'matte-black': { name: 'Matte Black', crust: '#0b0b0b', bg: '#121212', surface: '#161616', overlay: '#222222', border: '#262626', fg: '#d4d4d4', muted: '#6b6b6b', accent: '#f59e0b', accent2: '#e5e5e5', red: '#d35f5f', green: '#a3b18a', yellow: '#f59e0b', cyan: '#8abeb7' },
    'solar-autumn': { name: 'Solar Autumn', crust: '#13110f', bg: '#1b1815', surface: '#211d19', overlay: '#2d2721', border: '#3a3129', fg: '#e9e0d0', muted: '#857869', accent: '#f0762a', accent2: '#ddb766', red: '#c95f4e', green: '#9ba46a', yellow: '#ddb766', cyan: '#80a59a' },
    'kanagawa': { name: 'Kanagawa', crust: '#16161d', bg: '#1f1f28', surface: '#1a1a22', overlay: '#2a2a37', border: '#2a2a37', fg: '#dcd7ba', muted: '#727169', accent: '#7e9cd8', accent2: '#e6c384', red: '#c34043', green: '#76946a', yellow: '#c0a36e', cyan: '#6a9589' },
    'everforest': { name: 'Everforest', crust: '#1e2326', bg: '#2d353b', surface: '#272e33', overlay: '#374145', border: '#374145', fg: '#d3c6aa', muted: '#859289', accent: '#a7c080', accent2: '#83c092', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f', cyan: '#83c092' },
    'nord': { name: 'Nord', crust: '#21252e', bg: '#2e3440', surface: '#292e39', overlay: '#3b4252', border: '#3b4252', fg: '#d8dee9', muted: '#616e88', accent: '#88c0d0', accent2: '#81a1c1', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', cyan: '#88c0d0' }
  };
  const ponds = [];
  let themeId = THEMES[store.get('lumen-site-theme')] ? store.get('lumen-site-theme') : 'gruvbox';

  function applyTheme(id) {
    const t = THEMES[id];
    if (!t) return;
    themeId = id;
    const root = document.documentElement.style;
    for (const k of ['crust', 'bg', 'surface', 'overlay', 'border', 'fg', 'muted', 'accent', 'accent2', 'red', 'green', 'yellow', 'cyan']) root.setProperty(`--${k}`, t[k]);
    $('meta[name="theme-color"]')?.setAttribute('content', t.crust);
    store.set('lumen-site-theme', id);
    ponds.forEach(p => p.refreshColors());
    $$('.theme').forEach(b => b.classList.toggle('active', b.dataset.theme === id));
  }
  applyTheme(themeId);

  function renderThemes() {
    const grid = $('#themes-grid');
    if (!grid) return;
    grid.innerHTML = Object.entries(THEMES).map(([id, t]) => `
      <button class="theme" data-theme="${id}" style="--t-bg:${t.bg};--t-fg:${t.fg};--t-accent:${t.accent}">
        <span class="name">${t.name}<i>●</i></span>
        <span class="sw">${[t.red, t.green, t.yellow, t.accent, t.accent2, t.cyan].map(c => `<b style="background:${c}"></b>`).join('')}</span>
<pre><span style="color:${t.accent2}">~/lumen</span> <span style="color:${t.accent}">❯</span> ls
<span style="color:${t.accent}">src</span>  <span style="color:${t.accent}">themes</span>  <span style="color:${t.green}">lumen.exe</span>
<span style="color:${t.accent2}">~/lumen</span> <span style="color:${t.accent}">❯</span> <span style="color:${t.yellow}">git</span> push <span style="color:${t.green}">✓</span></pre>
      </button>`).join('');
    grid.addEventListener('click', e => {
      const b = e.target.closest('[data-theme]');
      if (b) { applyTheme(b.dataset.theme); toast(`Theme: ${THEMES[b.dataset.theme].name}`); }
    });
    applyTheme(themeId);
  }

  // ─── Bar: clock, fake CPU, scroll state, active workspace ────────────

  function setupBar() {
    const clock = $('#clock');
    const cpu = $('#cpu');
    const tick = () => {
      const d = new Date();
      if (clock) clock.textContent = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      if (cpu) cpu.style.setProperty('--v', `${12 + Math.random() * 40}%`);
    };
    tick();
    setInterval(tick, 2000);
    const bar = $('#bar');
    addEventListener('scroll', () => bar?.classList.toggle('scrolled', scrollY > 20), { passive: true });
  }

  // The workspace pills follow the section on screen.
  function setupSections() {
    const links = $$('#ws a[href^="#"]');
    const sections = links.map(a => $(a.getAttribute('href'))).filter(Boolean);
    if (!sections.length) return;
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        if (e.isIntersecting) links.forEach(a => a.classList.toggle('active', a.getAttribute('href') === `#${e.target.id}`));
      }
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(s => io.observe(s));
  }

  // ─── Small things: toasts, copy, "coming soon" links, reveals, glow ──

  let toastTimer = null;
  function toast(msg) {
    const el = $('#soon');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
  }

  function setupMisc() {
    document.addEventListener('click', e => {
      const todo = e.target.closest('.todo');
      if (todo) { e.preventDefault(); toast(todo.dataset.todo || 'Coming soon'); return; }
      const copy = e.target.closest('[data-copy]');
      if (copy) { navigator.clipboard?.writeText(copy.dataset.copy); toast('Copied'); }
    });
    const ro = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); ro.unobserve(e.target); }
    }, { threshold: 0.12 });
    $$('.reveal').forEach(el => ro.observe(el));
    $$('[data-glow]').forEach(card => card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    }));
  }

  // ─── ASCII logo with a decode effect ─────────────────────────────────

  const LETTERS = {
    L: ['██╗     ', '██║     ', '██║     ', '██║     ', '███████╗', '╚══════╝'],
    U: ['██╗   ██╗', '██║   ██║', '██║   ██║', '██║   ██║', '╚██████╔╝', ' ╚═════╝ '],
    M: ['███╗   ███╗', '████╗ ████║', '██╔████╔██║', '██║╚██╔╝██║', '██║ ╚═╝ ██║', '╚═╝     ╚═╝'],
    E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
    N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝']
  };

  async function asciiLogo() {
    const el = $('#ascii-logo');
    if (!el) return;
    const rows = [0, 1, 2, 3, 4, 5].map(i => 'LUMEN'.split('').map(c => LETTERS[c][i]).join(''));
    const target = rows.join('\n');
    const span = document.createElement('span');
    el.appendChild(span);
    if (reduced) { span.textContent = target; return; }
    // A diagonal sweep from the bottom-left corner to the top-right one: ahead of the front the
    // logo is empty, on the front it is noise, behind it the letters are settled.
    const noise = '░▒▓█<>/\\|=+*#%@';
    const chars = [...target];
    const width = rows[0].length;
    const BAND = 0.12;
    const at = [];
    let row = 0, col = 0;
    for (const c of chars) {
      if (c === '\n') { at.push(0); row++; col = 0; continue; }
      const d = (col / width) * 0.82 + ((rows.length - 1 - row) / (rows.length - 1)) * 0.18; // 0 = bottom-left, 1 = top-right
      at.push(d * (1 - BAND) + Math.random() * 0.03);
      col++;
    }
    const start = performance.now();
    const frame = now => {
      const p = (now - start) / 1500;
      span.textContent = chars.map((c, i) => {
        if (c === '\n' || c === ' ') return c;
        if (p < at[i]) return ' ';
        if (p < at[i] + BAND) return noise[(Math.random() * noise.length) | 0];
        return c;
      }).join('');
      if (p < 1.05) requestAnimationFrame(frame);
      else span.textContent = target;
    };
    requestAnimationFrame(frame);
  }

  // ─── Typed tagline ───────────────────────────────────────────────────

  async function typedLead() {
    const el = $('#typed');
    if (!el) return;
    const lines = [
      'Hyprland-style tiling, live themes and an ASCII koi pond under your shell.',
      'Plugins in plain JavaScript, hot reloaded. No build step, no restart.',
      'Your own Claude Code, Codex or Gemini, one shortcut away.',
      'Command blocks, session restore, and Git built in.'
    ];
    if (reduced) { el.textContent = lines[0]; return; }
    for (let n = 0; ; n = (n + 1) % lines.length) {
      const line = lines[n];
      for (let i = 1; i <= line.length; i++) { el.textContent = line.slice(0, i); await sleep(18 + Math.random() * 28); }
      await sleep(2600);
      for (let i = line.length; i >= 0; i -= 2) { el.textContent = line.slice(0, i); await sleep(10); }
      await sleep(300);
    }
  }

  // ─── Tiling demo ─────────────────────────────────────────────────────

  function setupDemo() {
    const stage = $('#stage');
    if (!stage) return;
    const keycast = $('#keycast');
    let panes = [];
    let focus = null;
    let zoomed = null;
    let visible = false;
    let seq = 0;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }, { threshold: 0.2 }).observe(stage);
    const wait = async ms => {
      const end = performance.now() + ms;
      while (performance.now() < end || !visible) await sleep(50);
    };

    // Dwindle: the first pane takes half, the rest share the other half, recursively.
    function rects(list, x, y, w, h, gap) {
      if (!list.length) return [];
      if (list.length === 1) return [{ id: list[0], x, y, w, h }];
      if (w >= h * 1.1) {
        const a = Math.round((w - gap) / 2);
        return [{ id: list[0], x, y, w: a, h }, ...rects(list.slice(1), x + a + gap, y, w - a - gap, h, gap)];
      }
      const a = Math.round((h - gap) / 2);
      return [{ id: list[0], x, y, w, h: a }, ...rects(list.slice(1), x, y + a + gap, w, h - a - gap, gap)];
    }

    function layout() {
      const pad = 10;
      const gap = 10;
      const W = stage.clientWidth - pad * 2;
      const H = stage.clientHeight - pad * 2;
      const order = panes.map(p => p.id);
      const rs = zoomed ? [{ id: zoomed, x: 0, y: 0, w: W, h: H }] : rects(order, 0, 0, W, H, gap);
      for (const p of panes) {
        const r = rs.find(q => q.id === p.id);
        p.el.style.opacity = r ? '' : '0';
        if (!r) continue;
        Object.assign(p.el.style, { left: `${r.x + pad}px`, top: `${r.y + pad}px`, width: `${r.w}px`, height: `${r.h}px` });
        p.el.classList.toggle('focus', p.id === focus);
      }
    }
    new ResizeObserver(layout).observe(stage);

    const PROMPT = '<span class="t-mag">~/lumen</span> <span class="t-cy">⎇ main</span> <span class="t-prompt">❯</span> ';

    function addPane() {
      const id = ++seq;
      const el = document.createElement('div');
      el.className = 'tile enter';
      el.innerHTML = '<pre></pre>';
      stage.appendChild(el);
      const pane = { id, el, pre: el.firstChild, html: '' };
      const anchor = panes.findIndex(p => p.id === focus);
      panes.splice(anchor < 0 ? panes.length : anchor + 1, 0, pane);
      focus = id;
      layout();
      requestAnimationFrame(() => el.classList.remove('enter'));
      return pane;
    }

    function removePane(pane) {
      pane.el.classList.add('enter');
      panes = panes.filter(p => p !== pane);
      focus = panes[panes.length - 1]?.id ?? null;
      layout();
      setTimeout(() => pane.el.remove(), 400);
    }

    const paint = p => { p.pre.innerHTML = p.html + '<span class="cursor"></span>'; };
    const write = (p, html) => { p.html += html; paint(p); };
    async function type(p, text, speed = 45) {
      write(p, PROMPT);
      for (const ch of text) { p.html += ch.replace('<', '&lt;'); paint(p); await wait(speed + Math.random() * 40); }
      p.html += '\n';
      paint(p);
      await wait(250);
    }
    async function keys(combo, label) {
      keycast.innerHTML = `${combo.split('+').map(k => `<kbd>${k}</kbd>`).join('+')} <span class="muted">${label}</span>`;
      keycast.classList.add('show');
      await wait(900);
      keycast.classList.remove('show');
    }

    async function run() {
      while (true) {
        panes.forEach(p => p.el.remove());
        panes = []; zoomed = null;

        const a = addPane();
        await wait(500);
        await type(a, 'lumen --version');
        write(a, '<span class="t-ok">Lumen 0.1.0</span> <span class="t-dim">· Electron · xterm.js WebGL · ConPTY</span>\n<span class="t-sep"></span>');
        write(a, PROMPT);
        await wait(900);

        await keys('Ctrl+Shift+D', 'split right');
        const b = addPane();
        await wait(500);
        await type(b, 'git status -s');
        write(b, '<span class="t-warn"> M</span> src/renderer/app.js\n<span class="t-ok"> A</span> plugins/weather.js\n<span class="t-err">??</span> notes.md\n<span class="t-sep"></span>');
        write(b, PROMPT);
        await wait(800);

        await keys('Ctrl+Shift+E', 'split down');
        const c = addPane();
        await wait(500);
        await type(c, 'npm run build');
        const base = c.html;
        for (let i = 0; i <= 12; i++) {
          const pct = Math.round((i / 12) * 100);
          c.html = base + `<span class="t-ok">${'█'.repeat(i)}</span><span class="t-dim">${'░'.repeat(12 - i)}</span> ${pct}%\n`;
          paint(c);
          await wait(70);
        }
        write(c, '<span class="t-ok">✓ built in 2.4s</span>  <span class="t-dim">214 modules</span>\n<span class="t-sep"></span>');
        write(c, PROMPT);
        await wait(700);

        await keys('Ctrl+Shift+Enter', 'new terminal');
        const d = addPane();
        await wait(400);
        await type(d, 'btop', 70);
        const top = d.html;
        for (let f = 0; f < 18; f++) {
          const bar = n => { const v = Math.round(n); return `<span class="${v > 14 ? 't-err' : v > 9 ? 't-warn' : 't-ok'}">${'▮'.repeat(v)}</span><span class="t-dim">${'▯'.repeat(18 - v)}</span>`; };
          d.html = top + ['cpu0', 'cpu1', 'cpu2', 'cpu3'].map((n, i) => `<span class="t-dim">${n}</span> ${bar(4 + Math.random() * 13 * (i % 2 ? 0.6 : 1))}`).join('\n') + `\n<span class="t-dim">mem</span>  ${bar(9 + Math.sin(f / 3) * 2)}\n`;
          paint(d);
          await wait(160);
        }

        await keys('Ctrl+Shift+Z', 'zoom');
        zoomed = d.id; layout();
        await wait(1500);
        zoomed = null; layout();
        await wait(600);

        await keys('Alt+Shift+←', 'swap');
        const ia = panes.indexOf(a);
        const ib = panes.indexOf(b);
        [panes[ia], panes[ib]] = [panes[ib], panes[ia]];
        focus = a.id;
        layout();
        await wait(1400);

        await keys('Ctrl+Shift+W', 'close');
        for (const p of [d, c, b]) { removePane(p); await wait(450); }
        await wait(1200);
      }
    }
    if (reduced) {
      const a = addPane();
      a.html = PROMPT + 'lumen --version\n<span class="t-ok">Lumen 0.1.0</span>\n' + PROMPT;
      paint(a);
      return;
    }
    run();
  }

  // ─── ASCII art cards ─────────────────────────────────────────────────

  // Draws pane rectangles as box-drawing characters on a W×H grid.
  function boxes(list, W, H, labels) {
    const g = Array.from({ length: H }, () => Array(W).fill(' '));
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = c; };
    list.forEach((r, n) => {
      const x1 = r.x + r.w - 1;
      const y1 = r.y + r.h - 1;
      for (let x = r.x; x <= x1; x++) { set(x, r.y, '─'); set(x, y1, '─'); }
      for (let y = r.y; y <= y1; y++) { set(r.x, y, '│'); set(x1, y, '│'); }
      set(r.x, r.y, '┌'); set(x1, r.y, '┐'); set(r.x, y1, '└'); set(x1, y1, '┘');
      const label = labels[n] || '';
      [...label].forEach((c, i) => set(r.x + 2 + i, r.y + 1, c));
    });
    return g.map(row => row.join('')).join('\n');
  }

  function artTiling() {
    const el = $('#art-tiling');
    if (!el) return;
    const W = 58;
    const H = 9;
    const split = (n) => {
      const out = [];
      let x = 0, y = 0, w = W, h = H;
      for (let i = 0; i < n; i++) {
        if (i === n - 1) { out.push({ x, y, w, h }); break; }
        if (w / 2 >= h * 1.2 || i % 2 === 0) { const a = Math.floor(w / 2); out.push({ x, y, w: a, h }); x += a; w -= a; }
        else { const a = Math.floor(h / 2); out.push({ x, y, w, h: a }); y += a; h -= a; }
      }
      return out;
    };
    const frames = [
      { r: split(1), l: ['❯ nvim .'] },
      { r: split(2), l: ['❯ nvim .', '❯ git log'] },
      { r: split(3), l: ['❯ nvim .', '❯ git log', '❯ npm run dev'] },
      { r: split(4), l: ['❯ nvim .', '❯ git', '❯ npm', '❯ btop'] },
      { r: [{ x: 0, y: 0, w: W, h: H }], l: ['❯ btop        (zoomed)'] }
    ];
    let i = 0;
    const draw = () => { el.textContent = boxes(frames[i].r, W, H, frames[i].l); i = (i + 1) % frames.length; };
    draw();
    if (!reduced) setInterval(draw, 1500);
  }

  function artBlocks() {
    const el = $('#art-blocks');
    if (!el) return;
    let t = 0;
    const spin = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
    const draw = () => {
      t++;
      el.innerHTML =
        `<span class="t-ok">▍</span> <span class="t-prompt">❯</span> npm run build     <span class="t-ok">✓ 2.4s</span>\n` +
        `<span class="t-ok">▍</span> <span class="t-dim">built 214 modules</span>\n` +
        `<span class="t-err">▍</span> <span class="t-prompt">❯</span> cargo test        <span class="t-err">✕ 1 · 0.8s</span>\n` +
        `<span class="t-warn">▍</span> <span class="t-prompt">❯</span> docker compose up <span class="t-warn">${spin[t % spin.length]} ${(t * 0.1).toFixed(1)}s</span>`;
    };
    draw();
    if (!reduced) setInterval(draw, 100);
  }

  function artGit() {
    const el = $('#art-git');
    if (el) el.innerHTML =
      `<span class="t-cy">⎇ main</span>  <span class="t-ok">↑2</span> <span class="t-dim">↓0</span>   <span class="t-ok">✓ 3 checks passed</span>   <span class="t-mag">PR #42</span>\n` +
      `<span class="t-warn">M</span> src/renderer/app.js      <span class="t-ok">A</span> plugins/weather.js\n` +
      `<span class="t-prompt">●</span> feat: weather plugin      <span class="t-dim">2 min ago · not pushed</span>`;
  }

  function artConfig() {
    const el = $('#art-config');
    if (!el) return;
    const ids = Object.keys(THEMES);
    let i = 0;
    const draw = () => {
      const id = ids[i % ids.length];
      el.innerHTML =
        `<span class="t-dim">// ~/.lumen/config.jsonc</span>\n` +
        `"theme": <span class="t-ok">"${id}"</span>,\n` +
        `"font": { "family": <span class="t-ok">"Monaspace Neon"</span>, "size": <span class="t-warn">${12 + (i % 3)}</span> },\n` +
        `"background": { "mode": <span class="t-ok">"${['koi', 'aurora', 'matrix', 'starfield'][i % 4]}"</span> }`;
      i++;
    };
    draw();
    if (!reduced) setInterval(draw, 1800);
  }

  async function paletteDemo() {
    const el = $('#palette-demo');
    if (!el) return;
    const runs = [
      { q: 'split', r: [['Split right', 'Ctrl+Shift+D'], ['Split down', 'Ctrl+Shift+E'], ['Rotate split', '']] },
      { q: 'theme ros', r: [['Theme: Rosé Pine', ''], ['Theme: Rosé Pine Dawn', ''], ['Pick a theme…', 'Ctrl+Shift+T']] },
      { q: 'koi', r: [['Background: ASCII koi', ''], ['Background: Block koi', ''], ['Settings', 'Ctrl+,']] }
    ];
    const paint = (q, rows) => {
      el.innerHTML = `<div class="q">${q}<span class="cursor" style="display:inline-block;width:.55em;height:1em;vertical-align:-2px;background:var(--accent);margin-left:1px"></span></div>` +
        rows.map(([a, k], i) => `<div class="r${i === 0 ? ' sel' : ''}"><span>${a}</span><span>${k}</span></div>`).join('');
    };
    if (reduced) { paint(runs[0].q, runs[0].r); return; }
    for (let n = 0; ; n = (n + 1) % runs.length) {
      const { q, r } = runs[n];
      for (let i = 0; i <= q.length; i++) { paint(q.slice(0, i), i ? r : []); await sleep(110); }
      await sleep(2000);
    }
  }

  // ─── Dividers and the footer wave ────────────────────────────────────

  function asciiLines() {
    const dividers = $$('[data-divider]');
    const wave = $('#wave');
    let t = 0;
    const draw = () => {
      t += 0.12;
      for (const d of dividers) {
        const n = Math.max(20, Math.floor(d.clientWidth / 7.3));
        const head = Math.floor((t * 6) % n);
        d.textContent = Array.from({ length: n }, (_, i) => (i === head ? '◆' : Math.abs(i - head) < 4 ? '━' : '─')).join('');
      }
      if (wave) {
        const n = Math.max(20, Math.floor(wave.clientWidth / 7.3));
        const chars = ' .·-~=≈';
        wave.textContent = [0, 1, 2].map(row => Array.from({ length: n }, (_, i) => {
          const v = Math.sin(i * 0.12 + t + row * 0.9) * 0.5 + Math.sin(i * 0.05 - t * 0.6) * 0.5;
          const k = Math.floor(((v + 1) / 2) * (chars.length - 1) * (1 - row * 0.25));
          return chars[Math.max(0, k)];
        }).join('')).join('\n');
      }
    };
    draw();
    if (!reduced) setInterval(draw, 90);
  }

  // ─── Koi ponds ───────────────────────────────────────────────────────

  function setupPonds() {
    if (!window.KoiPond) return;
    const hero = $('#pond');
    if (hero) ponds.push(KoiPond.mount(hero, { mouseTarget: $('.hero') }));
    const mini = $('#mini-pond');
    if (mini) ponds.push(KoiPond.mount(mini, { fontPx: 7, count: 2, scale: 0.55, interactive: false }));
    const dl = $('#dl-pond');
    if (dl) ponds.push(KoiPond.mount(dl, { fontPx: 9, count: 2, scale: 0.7, interactive: false }));
    const head = $('#head-pond');
    if (head) ponds.push(KoiPond.mount(head, { fontPx: 10, count: 3, scale: 0.8, mouseTarget: $('.page-head') }));
  }

  // ─── Boot ────────────────────────────────────────────────────────────

  window.LumenSite = { toast, THEMES, applyTheme };
  document.fonts?.ready.then(setupPonds) ?? setupPonds();
  setupBar();
  setupSections();
  setupMisc();
  renderThemes();
  asciiLogo();
  typedLead();
  setupDemo();
  artTiling();
  artBlocks();
  artGit();
  artConfig();
  paletteDemo();
  asciiLines();
})();
