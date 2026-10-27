// Monospace fonts: a bundled set (served from node_modules/@fontsource) plus the
// monospace fonts installed on the machine (Local Font Access API).
(function () {
  const BUNDLED = [
    ['JetBrains Mono', 'jetbrains-mono'],
    ['Fira Code', 'fira-code'],
    ['Cascadia Code', 'cascadia-code'],
    ['Geist Mono', 'geist-mono'],
    ['IBM Plex Mono', 'ibm-plex-mono'],
    ['Source Code Pro', 'source-code-pro'],
    ['Commit Mono', 'commit-mono'],
    ['Iosevka', 'iosevka'],
    ['Monaspace Neon', 'monaspace-neon'],
    ['Victor Mono', 'victor-mono'],
    ['Martian Mono', 'martian-mono'],
    ['Intel One Mono', 'intel-one-mono'],
    ['Space Mono', 'space-mono']
  ];

  const loaded = new Map(); // family -> Promise
  let installed = null;

  function url(pkg, weight) {
    return `url("../../node_modules/@fontsource/${pkg}/files/${pkg}-latin-${weight}-normal.woff2")`;
  }

  // Registers and loads a bundled family (no-op for installed fonts).
  function ensure(family) {
    const entry = BUNDLED.find(([name]) => name === family);
    if (!entry) return document.fonts.load(`14px "${family}"`).catch(() => {});
    if (!loaded.has(family)) {
      // Not every family ships every weight: missing ones simply fail to load and are skipped.
      const faces = ['300', '400', '500', '700'].map(weight => new FontFace(family, url(entry[1], weight), { weight }));
      loaded.set(family, Promise.all(faces.map(f => f.load().then(ff => document.fonts.add(ff)).catch(() => {}))));
    }
    return loaded.get(family);
  }

  // A family is monospace when "iiiii" and "WWWWW" have the same width.
  function isMono(family) {
    const c = isMono.ctx || (isMono.ctx = document.createElement('canvas').getContext('2d'));
    c.font = `40px "${family}", serif`;
    const a = c.measureText('iiiiiiiiii').width;
    const b = c.measureText('WWWWWWWWWW').width;
    c.font = '40px serif';
    const fallback = c.measureText('iiiiiiiiii').width;
    return Math.abs(a - b) < 0.5 && Math.abs(a - fallback) > 0.01;
  }

  async function listInstalled() {
    if (installed) return installed;
    try {
      const fonts = await window.queryLocalFonts();
      const families = [...new Set(fonts.map(f => f.family))].sort((x, y) => x.localeCompare(y));
      const bundled = new Set(BUNDLED.map(([n]) => n));
      // Symbol and CJK system fonts are monospaced too, but useless in a terminal.
      const junk = /marlett|wingdings|webdings|symbol|mdl2|holomdl|mingliu|simsun|gothic|mincho|batang|gulim|dotum|gungsuh|miriam|\bdavid\b|\brod\b/i;
      installed = families.filter(f => !bundled.has(f) && !junk.test(f) && isMono(f));
    } catch (e) {
      console.warn('installed fonts unavailable', e);
      installed = [];
    }
    return installed;
  }

  // Fonts dropped in ~/.lumen/fonts: "MyFont-Bold.ttf" becomes family "MyFont", weight 700.
  const WEIGHTS = [[/thin|hairline/i, '100'], [/extra-?light|ultra-?light/i, '200'], [/light/i, '300'], [/semi-?bold|demi-?bold/i, '600'],
    [/extra-?bold|ultra-?bold/i, '800'], [/black|heavy/i, '900'], [/medium/i, '500'], [/bold/i, '700']];
  let user = new Map(); // family -> [{ url, weight, style }]

  function setUser(files) {
    const next = new Map();
    for (const { name, url: src } of files) {
      const stem = name.replace(/\.(ttf|otf|woff2?)$/i, '');
      const parts = stem.split(/[-_ ](?=[A-Za-z]*(?:thin|light|regular|book|medium|bold|black|heavy|italic|oblique)[A-Za-z]*$)/i);
      const family = (parts.length > 1 ? parts.slice(0, -1).join(' ') : stem).replace(/[-_]+/g, ' ').trim();
      const suffix = parts.length > 1 ? parts[parts.length - 1] : '';
      const weight = (WEIGHTS.find(([re]) => re.test(suffix)) || [null, '400'])[1];
      const style = /italic|oblique/i.test(suffix) ? 'italic' : 'normal';
      if (!next.has(family)) next.set(family, []);
      next.get(family).push({ url: src, weight, style });
    }
    for (const family of next.keys()) if (JSON.stringify(next.get(family)) !== JSON.stringify(user.get(family))) loaded.delete(family);
    user = next;
  }

  const baseEnsure = ensure;
  function ensureAny(family) {
    const faces = user.get(family);
    if (!faces) return baseEnsure(family);
    if (!loaded.has(family)) {
      loaded.set(family, Promise.all(faces.map(f => new FontFace(family, `url("${f.url}")`, { weight: f.weight, style: f.style })
        .load().then(ff => document.fonts.add(ff)).catch(() => {}))));
    }
    return loaded.get(family);
  }

  window.Fonts = { bundled: () => BUNDLED.map(([n]) => n), user: () => [...user.keys()].sort(), setUser, ensure: ensureAny, listInstalled };
})();
