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
      'Command blocks, session restore, and Git built in.',
      'Your folder as a living graph, right next to your shell.'
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

  const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const rgbOf = hex => { const n = parseInt(hex.replace('#', ''), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

  // Runs draw(t) about 20 times a second while the canvas is on screen.
  function animate(canvas, draw) {
    let visible = false;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(canvas);
    const t0 = performance.now();
    draw(0);
    if (!reduced) setInterval(() => { if (visible && !document.hidden) draw((performance.now() - t0) / 1000); }, 50);
  }

  // A small folder graph, like Lumen's Graph pane: the folder in the middle, its folders around,
  // their files as dots, drifting slowly.
  function artGraph() {
    const c = $('#art-graph');
    if (!c) return;
    const ctx = c.getContext('2d');
    const dirs = [
      { name: 'src', files: 7 }, { name: 'plugins', files: 4 }, { name: 'assets', files: 5 },
      { name: 'docs', files: 3 }, { name: 'tests', files: 6 }
    ].map((d, i, all) => ({ ...d, a: (i / all.length) * Math.PI * 2 + 0.4, seed: i * 1.7 }));
    animate(c, t => {
      const dpr = devicePixelRatio || 1;
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const accent = cssVar('--accent'), muted = cssVar('--muted'), fg = cssVar('--fg');
      const cx = W / 2, cy = H / 2, Rx = Math.min(W * 0.32, 190), Ry = H * 0.34;
      const focus = Math.floor(t / 2.5) % dirs.length;
      ctx.font = '10px "JetBrains Mono", ui-monospace, monospace';
      ctx.textAlign = 'center';
      for (const [i, d] of dirs.entries()) {
        const a = d.a + Math.sin(t * 0.3 + d.seed) * 0.12;
        const x = cx + Math.cos(a) * Rx, y = cy + Math.sin(a) * Ry;
        const on = i === focus;
        ctx.globalAlpha = on ? 0.9 : 0.35;
        ctx.strokeStyle = on ? accent : muted;
        ctx.lineWidth = on ? 1.2 : 0.8;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(x, y); ctx.stroke();
        for (let k = 0; k < d.files; k++) {
          const b = a + (k - (d.files - 1) / 2) * 0.42 + Math.sin(t * 0.5 + k + d.seed) * 0.05;
          const r = 22 + (k % 2) * 8;
          const fx = x + Math.cos(b) * r, fy = y + Math.sin(b) * r * 0.8;
          ctx.globalAlpha = on ? 0.75 : 0.3;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(fx, fy); ctx.stroke();
          ctx.fillStyle = on ? accent : muted;
          ctx.beginPath(); ctx.arc(fx, fy, 1.6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = accent;
        ctx.beginPath(); ctx.arc(x, y, on ? 3.5 : 2.6, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = on ? fg : muted;
        ctx.fillText(d.name, x, y - 8);
      }
      ctx.fillStyle = accent;
      ctx.beginPath(); ctx.arc(cx, cy, 4.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = fg;
      ctx.font = 'bold 11px "JetBrains Mono", ui-monospace, monospace';
      ctx.fillText('~/projects/lumen', cx, cy + 18);
    });
  }

  // A sunset, dithered with a 4×4 Bayer matrix in four tones of the page's theme, like an image
  // background with ditherColors "theme".
  function artDither() {
    const c = $('#art-dither');
    if (!c) return;
    const ctx = c.getContext('2d');
    const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
    animate(c, t => {
      const W = Math.max(40, Math.round(c.clientWidth / 3)), H = Math.max(20, Math.round(c.clientHeight / 3));
      if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
      const tones = ['--crust', '--overlay', '--accent2', '--accent'].map(v => rgbOf(cssVar(v)));
      const img = ctx.createImageData(W, H);
      const sunX = W * 0.62, sunY = H * (0.52 + Math.sin(t * 0.25) * 0.05), sunR = H * 0.24;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const horizon = H * 0.66;
          let v;
          if (y < horizon) {
            const d = Math.hypot(x - sunX, (y - sunY) * 1.1);
            v = 0.18 + (y / horizon) * 0.35 + Math.max(0, 1 - d / (sunR * 2.6)) * 0.45 + (d < sunR ? 0.5 : 0);
          } else {
            const ripple = Math.sin(x * 0.35 + t * 2 + y * 0.9) * 0.5 + 0.5;
            const glow = Math.max(0, 1 - Math.abs(x - sunX) / (sunR * 1.6));
            v = 0.12 + glow * ripple * 0.6 * ((y - horizon) / (H - horizon) * 0.4 + 0.6);
          }
          const level = Math.min(3, Math.max(0, Math.floor(v * 3 + BAYER[(y & 3) * 4 + (x & 3)] / 16)));
          const [r, g, b] = tones[level];
          const i = (y * W + x) * 4;
          img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
    });
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

  // ─── Downloads: the latest GitHub release, for the visitor's OS ──────

  const REPO = 'D4L1IR3Tr0/lumen-terminal';

  async function latestRelease() {
    const KEY = 'lumen-site-release';
    try {
      const cached = JSON.parse(sessionStorage.getItem(KEY) || 'null');
      if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.data;
    } catch {}
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(res.status === 404 ? 'none' : `HTTP ${res.status}`);
    const r = await res.json();
    const data = { tag: r.tag_name, url: r.html_url, assets: r.assets.map(a => ({ name: a.name, url: a.browser_download_url, size: a.size })) };
    try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), data })); } catch {}
    return data;
  }

  async function setupDownloads() {
    const main = $('#dl-main');
    if (!main && !$$('[data-dl-label]').length) return;
    const ua = `${navigator.userAgentData?.platform || ''} ${navigator.platform || ''} ${navigator.userAgent}`;
    const os = /mac|iphone|ipad/i.test(ua) ? 'mac' : /linux|x11|cros/i.test(ua) && !/android/i.test(ua) ? 'linux' : 'win';
    const OS_NAME = { win: 'Windows', mac: 'macOS', linux: 'Linux' };
    $$('[data-dl-label]').forEach(el => { el.textContent = `Download for ${OS_NAME[os]}`; });
    const NOTES = {
      win: 'Lumen is not code-signed yet: if SmartScreen stops the installer, click <b>More info</b> → <b>Run anyway</b>.',
      mac: 'Lumen is not notarized yet: after moving it to Applications, run <code>xattr -cr /Applications/Lumen.app</code> once.',
      linux: 'AppImage: <code>chmod +x Lumen-*.AppImage</code>, then run it. The .deb installs with <code>sudo apt install ./Lumen-*.deb</code>.'
    };
    const note = $('#dl-note');
    let rel;
    try {
      rel = await latestRelease();
    } catch (e) {
      if (note && e.message === 'none') note.textContent = 'The first public release is on its way: watch the repository to know when it lands.';
      return;
    }
    const find = re => rel.assets.find(a => re.test(a.name));
    const files = [
      { os: 'win', label: 'Windows 10 / 11', a: find(/\.exe$/i) },
      { os: 'mac', label: 'macOS · Apple silicon', a: find(/arm64\.dmg$/i) },
      { os: 'mac', label: 'macOS · Intel', a: find(/x64\.dmg$/i) },
      { os: 'linux', label: 'Linux · AppImage', a: find(/(x86_64|x64)\.AppImage$/i) },
      { os: 'linux', label: 'Linux · .deb', a: find(/amd64\.deb$/i) }
    ].filter(f => f.a);
    const mb = n => `${Math.round(n / 1048576)} MB`;
    $$('[data-release-version]').forEach(el => { el.textContent = rel.tag; });
    const mine = files.find(f => f.os === os);
    if (main && mine) {
      main.href = mine.a.url;
      main.removeAttribute('target');
      $('#dl-file').textContent = `${mine.a.name} · ${mb(mine.a.size)}`;
    }
    const all = $('#dl-all');
    if (all && files.length) {
      all.innerHTML = files.map(f => `<a href="${f.a.url}" class="${f.os === os ? 'ok' : ''}">${f.label}<small>${mb(f.a.size)}</small></a>`).join('');
    }
    if (note) note.innerHTML = NOTES[os];
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
  artGraph();
  artDither();
  setupDownloads();
  paletteDemo();
  asciiLines();
})();
