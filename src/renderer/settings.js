// Settings drawer: every control applies live and is saved to config.jsonc by the host.
(function () {
  const root = document.getElementById('settings');
  let host = null;
  let built = false;
  let previews = [];
  let fontQuery = '';

  const BACKGROUNDS = [
    ['none', 'None'],
    ['aurora', 'Aurora'],
    ['constellation', 'Constellation'],
    ['waves', 'Waves'],
    ['koi', 'ASCII koi'],
    ['koi-blocks', 'Block koi'],
    ['jellyfish', 'Jellyfish'],
    ['dither', 'Dither'],
    ['matrix', 'Rain'],
    ['starfield', 'Hyperspace'],
    ['horizon', 'Horizon'],
    ['image', 'Image']
  ];
  const ANIMATED = BACKGROUNDS.map(([id]) => id).filter(id => id !== 'none' && id !== 'image');

  const CURSOR_COLORS = [
    ['theme', 'Theme'], ['accent', 'Accent'], ['accent2', 'Accent 2'],
    ['#ffffff', 'White'], ['#ff9e64', 'Orange'], ['#9ece6a', 'Green'], ['#f7768e', 'Pink'], ['#7dcfff', 'Cyan']
  ];

  const formats = {};
  const toggleValues = {};
  const pct = v => `${Math.round(v * 100)} %`;
  const px = v => `${v} px`;

  function slider(path, label, min, max, step, format) {
    const id = path.join('.');
    formats[id] = format;
    return `
      <label class="s-row s-slider" data-row="${id}">
        <span class="s-label">${label}<span class="s-value" data-value="${id}"></span></span>
        <input type="range" min="${min}" max="${max}" step="${step}" data-path="${id}">
      </label>`;
  }

  // values: [on, off] when the setting is not a boolean
  function toggle(path, label, hint = '', values = null) {
    const id = path.join('.');
    if (values) toggleValues[id] = values;
    return `
      <label class="s-row s-toggle">
        <span><span class="s-label">${label}</span>${hint ? `<span class="s-hint">${hint}</span>` : ''}</span>
        <input type="checkbox" data-path="${id}"><span class="s-switch"></span>
      </label>`;
  }

  function segmented(path, label, options) {
    const id = path.join('.');
    return `
      <div class="s-row">
        <span class="s-label">${label}</span>
        <div class="s-seg" data-seg="${id}">
          ${options.map(([v, l]) => `<button data-seg-value="${v}">${l}</button>`).join('')}
        </div>
      </div>`;
  }

  const SECTIONS = [
    { title: 'Theme', html: () => '<div class="s-themes" data-themes></div>' },
    {
      title: 'Background',
      html: () => `
        <div class="s-tiles">${BACKGROUNDS.map(([id, label]) => `
          <button class="s-tile" data-bg="${id}">
            <span class="s-preview p-${id}">${ANIMATED.includes(id) ? '<canvas></canvas>' : ''}</span>
            <span>${label}</span>
          </button>`).join('')}
        </div>
        <div class="s-when" data-when="image">
          <div class="s-gallery" data-gallery></div>
          ${segmented(['background', 'imageStyle'], 'Style', [['plain', 'Plain'], ['dither', 'Dither'], ['dither-animated', 'Animated'], ['ascii', 'ASCII']])}
          <div data-row="background.blur">${slider(['background', 'blur'], 'Blur', 0, 40, 1, px)}</div>
          ${slider(['background', 'dim'], 'Darken', 0, 0.9, 0.01, pct)}
          <div class="s-file">
            <span class="s-file-name">~/.lumen/backgrounds</span>
            <button class="s-btn ghost" data-act="open-backgrounds">Open folder</button>
          </div>
        </div>
        <div class="s-when" data-when="animated">
          ${slider(['background', 'speed'], 'Speed', 0.1, 3, 0.05, v => `×${(+v).toFixed(2).replace(/\.?0+$/, '')}`)}
          ${slider(['background', 'intensity'], 'Intensity', 0.1, 1, 0.01, pct)}
        </div>`
    },
    {
      title: 'Font',
      html: () => `
        <input class="s-search" data-font-search placeholder="Search fonts…" spellcheck="false">
        <div class="s-fonts" data-fonts></div>
        <div class="s-file">
          <span class="s-file-name">Your fonts: drop .ttf / .otf / .woff2 files in ~/.lumen/fonts</span>
          <button class="s-btn ghost" data-act="open-fonts">Open folder</button>
        </div>
        ${slider(['font', 'size'], 'Size', 9, 24, 1, px)}
        ${slider(['font', 'lineHeight'], 'Line height', 1, 1.7, 0.05, v => (+v).toFixed(2))}
        ${segmented(['font', 'weight'], 'Weight', [['300', 'Light'], ['400', 'Regular'], ['500', 'Medium']])}`
    },
    {
      title: 'Cursor',
      html: () => `
        <div class="s-cursors">
          ${[['bar', 'Bar'], ['block', 'Block'], ['underline', 'Underline']].map(([id, label]) => `
            <button class="s-cursor" data-cursor="${id}">
              <span class="s-cursor-demo">ls<i class="c-${id}"></i></span>
              <span>${label}</span>
            </button>`).join('')}
        </div>
        ${slider(['cursor', 'width'], 'Bar thickness', 1, 6, 1, px)}
        ${toggle(['cursor', 'blink'], 'Blink')}
        ${segmented(['cursor', 'inactive'], 'Unfocused pane', [['outline', 'Outline'], ['block', 'Block'], ['bar', 'Bar'], ['underline', 'Underline'], ['none', 'Hidden']])}
        <div class="s-row">
          <span class="s-label">Color</span>
          <div class="s-colors" data-cursor-colors>
            ${CURSOR_COLORS.map(([v, l]) => `<button class="s-color" data-cursor-color="${v}" title="${l}"></button>`).join('')}
            <label class="s-color custom" title="Custom"><input type="color" data-cursor-custom></label>
          </div>
        </div>`
    },
    {
      title: 'Text flow',
      html: () => `
        <div class="s-flows">
          ${[['top', 'Top down', 'Classic'], ['bottom', 'From the bottom', 'Text rises']].map(([id, label, sub]) => `
            <button class="s-flow" data-flow="${id}">
              <span class="s-flow-demo f-${id}"><i></i><i></i><i></i><b></b></span>
              <span>${label}</span><small>${sub}</small>
            </button>`).join('')}
        </div>
        ${toggle(['terminal', 'separators'], 'Line between commands', 'A thin separator above each new prompt (red after a failure)')}
        ${toggle(['terminal', 'blocks'], 'Command blocks', 'Hover a command to copy it, copy its output or run it again')}`
    },
    {
      title: 'Session & commands',
      html: () => `
        ${toggle(['behavior', 'restoreSession'], 'Restore the session', 'Reopen windows, panes, layouts and folders at startup')}
        ${toggle(['behavior', 'notifyAfter'], 'Notify when a long command ends', 'Over 10 s, when Lumen or the pane is in the background', [10, 0])}`
    },
    {
      title: 'Transparency',
      html: () => `
        ${slider(['window', 'paneOpacity'], 'Pane background opacity', 0.3, 1, 0.01, pct)}
        ${slider(['window', 'inactiveOpacity'], 'Unfocused pane text', 0.3, 1, 0.01, pct)}
        ${toggle(['window', 'backgroundMaterial'], 'Windows transparency (acrylic)', 'Lets the desktop show through the window', ['acrylic', 'none'])}`
    },
    {
      title: 'Layout',
      html: () => `
        ${slider(['window', 'gap'], 'Gaps', 0, 24, 1, px)}
        ${slider(['window', 'radius'], 'Corner radius', 0, 20, 1, px)}
        ${slider(['window', 'padding'], 'Padding', 0, 28, 1, px)}
        ${slider(['window', 'borderWidth'], 'Border', 0, 4, 1, px)}`
    },
    {
      title: 'Bar & tracking',
      html: () => `
        ${toggle(['window', 'stats'], 'System stats', 'Live CPU, GPU and RAM')}
        ${toggle(['behavior', 'git'], 'Git tracking', 'Branch and changes of the current folder')}
        ${toggle(['window', 'clock'], 'Clock')}
        ${toggle(['window', 'animations'], 'Animations')}`
    }
  ];

  function build() {
    root.innerHTML = `
      <div class="s-panel">
        <header class="s-head">
          <div>
            <div class="s-title">Settings</div>
            <div class="s-sub">Applied live, saved to config.jsonc</div>
          </div>
          <button class="s-close" data-act="close" title="Close (Esc)">
            <svg viewBox="0 0 12 12" width="12" height="12"><path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4"/></svg>
          </button>
        </header>
        <div class="s-body">
          ${SECTIONS.map(s => `<section class="s-section"><h3>${s.title}</h3>${s.html()}</section>`).join('')}
        </div>
        <footer class="s-foot">
          <button class="s-btn ghost" data-act="open-config">Open config.jsonc</button>
          <button class="s-btn ghost" data-act="open-themes">Themes folder</button>
        </footer>
      </div>`;

    root.addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.fontSearch !== undefined) { fontQuery = el.value.trim().toLowerCase(); renderFonts(); return; }
      if (el.dataset.cursorCustom !== undefined) { host.set(['cursor', 'color'], el.value); syncCursorColors(); return; }
      if (!el.dataset.path) return;
      const path = el.dataset.path.split('.');
      if (el.type === 'range') {
        host.set(path, +el.value);
        paintSlider(el);
      } else if (el.type === 'checkbox') {
        const values = toggleValues[el.dataset.path];
        host.set(path, values ? values[el.checked ? 0 : 1] : el.checked);
      }
    });

    root.addEventListener('click', async e => {
      if (e.target === root) return close();
      const bg = e.target.closest('[data-bg]');
      if (bg) {
        const mode = bg.dataset.bg;
        if (mode === 'image' && !host.get(['background', 'image'])) {
          // First time: the first picture of ~/.lumen/backgrounds, or ask for one.
          const first = (await host.assets.list('backgrounds'))[0];
          const file = first ? first.rel : await addImage();
          if (!file) return;
          host.set(['background', 'image'], file);
        }
        if (mode !== 'none' && host.get(['window', 'paneOpacity']) >= 1) host.set(['window', 'paneOpacity'], 0.86);
        host.set(['background', 'mode'], mode);
        sync();
        return;
      }
      const seg = e.target.closest('[data-seg-value]');
      if (seg) {
        const path = seg.parentElement.dataset.seg.split('.');
        host.set(path, seg.dataset.segValue);
        sync();
        return;
      }
      const flow = e.target.closest('[data-flow]');
      if (flow) { host.set(['terminal', 'flow'], flow.dataset.flow); sync(); return; }
      const cursor = e.target.closest('[data-cursor]');
      if (cursor) { host.set(['cursor', 'style'], cursor.dataset.cursor); sync(); return; }
      const color = e.target.closest('[data-cursor-color]');
      if (color) { host.set(['cursor', 'color'], color.dataset.cursorColor); syncCursorColors(); return; }
      const font = e.target.closest('[data-font]');
      if (font) { host.set(['font', 'family'], font.dataset.font); renderFonts(); return; }
      const theme = e.target.closest('[data-theme]');
      if (theme) { host.setTheme(theme.dataset.theme); sync(); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'close') close();
      else if (act === 'open-config') host.openConfig();
      else if (act === 'open-themes') host.openThemes();
      else if (act === 'add-image') {
        const file = await addImage();
        if (file) { host.set(['background', 'image'], file); host.set(['background', 'mode'], 'image'); sync(); }
      } else if (act === 'open-backgrounds') host.openFolder('backgrounds');
      else if (act === 'open-fonts') host.openFolder('fonts');
      else if (act === 'pick-bg') {
        host.set(['background', 'image'], e.target.closest('[data-rel]').dataset.rel);
        sync();
      } else if (act === 'remove-bg') {
        // Two clicks: the first arms the button, the second deletes the file.
        const btn = e.target.closest('button');
        if (!btn.classList.contains('armed')) {
          btn.classList.add('armed');
          btn.title = 'Click again to delete this image';
          setTimeout(() => btn.classList.remove('armed'), 2500);
          return;
        }
        const rel = btn.closest('[data-rel]').dataset.rel;
        await host.assets.remove('backgrounds', rel.split('/').pop());
        if (host.get(['background', 'image']) === rel) host.set(['background', 'image'], '');
        sync();
      }
    });

    // Background previews come alive on hover.
    root.addEventListener('mouseover', e => {
      const tile = e.target.closest('[data-bg]');
      previews.forEach(p => (p.tile === tile ? p.handle.start() : p.handle.stop()));
    });
    root.addEventListener('mouseleave', () => previews.forEach(p => p.handle.stop()));

    built = true;
  }

  function paintSlider(el) {
    const p = ((el.value - el.min) / (el.max - el.min)) * 100;
    el.style.setProperty('--p', `${p}%`);
    const out = root.querySelector(`[data-value="${el.dataset.path}"]`);
    if (out) out.textContent = formats[el.dataset.path](el.value);
  }

  function resolveColor(v) {
    const css = getComputedStyle(document.documentElement);
    if (v === 'theme') return css.getPropertyValue('--fg').trim();
    if (v === 'accent') return css.getPropertyValue('--accent').trim();
    if (v === 'accent2') return css.getPropertyValue('--accent2').trim();
    return v;
  }

  function syncCursorColors() {
    const current = host.get(['cursor', 'color']) || 'theme';
    const preset = CURSOR_COLORS.some(([v]) => v === current);
    root.querySelectorAll('[data-cursor-color]').forEach(b => {
      b.style.background = resolveColor(b.dataset.cursorColor);
      b.classList.toggle('active', b.dataset.cursorColor === current);
    });
    const custom = root.querySelector('.s-color.custom');
    custom.classList.toggle('active', !preset);
    if (!preset && /^#[0-9a-f]{6}$/i.test(current)) {
      custom.style.background = current;
      custom.querySelector('input').value = current;
    }
    root.style.setProperty('--cursor-color', resolveColor(current));
  }

  async function renderFonts() {
    const list = root.querySelector('[data-fonts]');
    const current = host.get(['font', 'family']);
    const match = name => !fontQuery || name.toLowerCase().includes(fontQuery);
    const row = name => `
      <button class="s-font${name === current ? ' active' : ''}" data-font="${name}" style="font-family:'${name.replace(/'/g, '')}', monospace">
        <span class="s-font-name">${name}</span><span class="s-font-sample">0Oo 1lI {}=&gt;</span>
      </button>`;
    const mine = Fonts.user().filter(match);
    mine.forEach(n => Fonts.ensure(n));
    const bundled = Fonts.bundled().filter(match);
    bundled.forEach(n => Fonts.ensure(n));
    const installed = (await Fonts.listInstalled()).filter(match);
    list.innerHTML = `
      ${mine.length ? `<div class="s-font-group">Yours · ~/.lumen/fonts</div>${mine.map(row).join('')}` : ''}
      ${bundled.length ? `<div class="s-font-group">Bundled</div>${bundled.map(row).join('')}` : ''}
      ${installed.length ? `<div class="s-font-group">Installed on this PC</div>${installed.map(row).join('')}` : ''}
      ${!bundled.length && !installed.length ? '<div class="s-font-group">No font found</div>' : ''}`;
    list.querySelector('.active')?.scrollIntoView({ block: 'nearest' });
  }

  // Pictures of ~/.lumen/backgrounds: click one to use it, + to add one (it is copied there).
  let galleryRun = 0;
  async function renderGallery() {
    const box = root.querySelector('[data-gallery]');
    if (!box) return;
    const run = ++galleryRun;
    const list = await host.assets.list('backgrounds');
    if (run !== galleryRun) return;
    const current = host.get(['background', 'image']);
    box.innerHTML = list.map(f => `
      <div class="s-thumb${f.rel === current ? ' active' : ''}" data-rel="${f.rel}" title="${f.name}">
        <button class="s-thumb-img" data-act="pick-bg" style="background-image:url('${host.fileUrl(f.rel).replace(/'/g, '%27')}')"></button>
        <button class="s-thumb-x" data-act="remove-bg" title="Delete">×</button>
      </div>`).join('') +
      '<button class="s-thumb s-thumb-add" data-act="add-image" title="Add an image (it is copied to ~/.lumen/backgrounds)">+</button>';
  }

  async function addImage() {
    const file = await host.pickImage();
    if (!file) return null;
    try { return await host.assets.import('backgrounds', file); } catch { return null; }
  }

  // Pulls current values into every control.
  function sync() {
    if (!built || !host || !isOpen()) return;
    root.querySelectorAll('input[data-path]').forEach(el => {
      const v = host.get(el.dataset.path.split('.'));
      if (el.type === 'range') {
        if (document.activeElement !== el) el.value = v;
        paintSlider(el);
      } else {
        const values = toggleValues[el.dataset.path];
        el.checked = values ? v !== values[1] : !!v;
      }
    });
    root.querySelectorAll('[data-seg]').forEach(seg => {
      const v = String(host.get(seg.dataset.seg.split('.')));
      seg.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.segValue === v));
    });

    const mode = host.get(['background', 'mode']);
    root.querySelectorAll('[data-bg]').forEach(b => b.classList.toggle('active', b.dataset.bg === mode));
    root.querySelector('[data-when="image"]').classList.toggle('show', mode === 'image');
    root.querySelector('[data-when="animated"]').classList.toggle('show', ANIMATED.includes(mode));

    const image = host.get(['background', 'image']);
    renderGallery();
    root.querySelector('[data-row="background.blur"]').style.display = (host.get(['background', 'imageStyle']) || 'plain') === 'plain' ? '' : 'none';
    const thumb = root.querySelector('.p-image');
    thumb.style.backgroundImage = image ? `url("${host.fileUrl(image)}")` : '';
    thumb.classList.toggle('has-image', !!image);

    const flow = host.get(['terminal', 'flow']) || 'top';
    root.querySelectorAll('[data-flow]').forEach(b => b.classList.toggle('active', b.dataset.flow === flow));

    const style = host.get(['cursor', 'style']);
    root.querySelectorAll('[data-cursor]').forEach(b => b.classList.toggle('active', b.dataset.cursor === style));
    root.querySelector('[data-row="cursor.width"]').style.display = style === 'bar' ? '' : 'none';
    syncCursorColors();

    const current = host.themeId();
    root.querySelector('[data-themes]').innerHTML = host.themes().map(([id, t]) => `
      <button class="s-theme${id === current ? ' active' : ''}" data-theme="${id}" title="${t.name || id}" style="--t-bg:${t.background};--t-fg:${t.foreground};--t-ac:${(t.ui && t.ui.accent) || t.blue}">
        <span class="s-theme-dots">${[t.red, t.green, t.yellow, t.blue, t.magenta].map(c => `<i style="background:${c}"></i>`).join('')}</span>
        <span class="s-theme-name">${t.name || id}</span>
      </button>`).join('');

    // Re-render previews so they follow the theme.
    previews.forEach(p => p.handle.stop());
    previews = [...root.querySelectorAll('[data-bg]')]
      .filter(tile => tile.querySelector('canvas'))
      .map(tile => ({ tile, handle: Backdrop.preview(tile.dataset.bg, tile.querySelector('canvas')) }));
  }

  function open() {
    if (!built) build();
    root.classList.remove('hidden');
    sync();
    renderFonts();
    requestAnimationFrame(() => root.classList.add('open'));
  }

  function close() {
    if (!isOpen()) return;
    previews.forEach(p => p.handle.stop());
    root.classList.remove('open');
    setTimeout(() => root.classList.add('hidden'), 220);
    host?.onClose?.();
  }

  function isOpen() {
    return !root.classList.contains('hidden');
  }

  window.Settings = {
    init(h) { host = h; },
    open,
    close,
    toggle: () => (isOpen() ? close() : open()),
    sync,
    isOpen
  };
})();
