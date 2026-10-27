// Fuzzy picker used by the command palette, theme picker and shell picker.
(function () {
  const root = document.getElementById('palette');
  const input = document.getElementById('palette-input');
  const list = document.getElementById('palette-list');
  const prefix = document.getElementById('palette-prefix');

  let current = null;
  let filtered = [];
  let index = 0;

  // Subsequence match with bonuses for consecutive and word-start hits. Returns null if no match.
  function score(query, text) {
    if (!query) return { score: 0, hits: [] };
    const q = query.toLowerCase();
    const t = text.toLowerCase();
    let ti = 0;
    let s = 0;
    let last = -2;
    const hits = [];
    for (const ch of q) {
      const found = t.indexOf(ch, ti);
      if (found < 0) return null;
      s += found === last + 1 ? 6 : 1;
      if (found === 0 || /[\s\-_./:]/.test(t[found - 1])) s += 4;
      s -= Math.min(found - ti, 6) * 0.2;
      hits.push(found);
      last = found;
      ti = found + 1;
    }
    return { score: s, hits };
  }

  function highlight(text, hits) {
    const set = new Set(hits);
    let html = '';
    for (let i = 0; i < text.length; i++) {
      const c = escape(text[i]);
      html += set.has(i) ? `<b>${c}</b>` : c;
    }
    return html;
  }

  function escape(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function render() {
    const q = input.value.trim();
    filtered = current.items
      .map(item => ({ item, m: score(q, item.label + (item.keywords ? ' ' + item.keywords : '')) }))
      .filter(x => x.m)
      .sort((a, b) => b.m.score - a.m.score);
    if (!q) filtered.sort((a, b) => (b.item.pinned ? 1 : 0) - (a.item.pinned ? 1 : 0));
    index = Math.min(index, Math.max(0, filtered.length - 1));

    list.innerHTML = '';
    if (!filtered.length) {
      list.innerHTML = '<div class="palette-empty">No results</div>';
      return;
    }
    filtered.forEach(({ item, m }, i) => {
      const row = document.createElement('div');
      row.className = 'palette-item' + (i === index ? ' active' : '');
      const hits = m.hits.filter(h => h < item.label.length);
      row.innerHTML = `
        ${item.swatch ? `<span class="swatch">${item.swatch.map(c => `<i style="background:${escape(c)}"></i>`).join('')}</span>` : ''}
        <span class="label">${highlight(item.label, hits)}</span>
        ${item.detail ? `<span class="detail">${escape(item.detail)}</span>` : ''}
        ${item.hint && item.hint.length ? `<span class="hint">${item.hint.map(k => `<kbd>${escape(k)}</kbd>`).join('')}</span>` : ''}`;
      row.addEventListener('mousemove', () => { if (index !== i) { index = i; updateActive(); } });
      row.addEventListener('mousedown', e => { e.preventDefault(); index = i; accept(); });
      list.appendChild(row);
    });
    updateActive();
  }

  function updateActive() {
    [...list.children].forEach((el, i) => el.classList.toggle('active', i === index));
    const el = list.children[index];
    if (el) el.scrollIntoView({ block: 'nearest' });
    current?.onHighlight?.(filtered[index]?.item);
  }

  function accept() {
    const item = filtered[index]?.item;
    const opts = current;
    close(false);
    if (item) opts.onSelect?.(item);
    else opts.onCancel?.();
  }

  function open(opts) {
    if (current) close(true);
    current = opts;
    index = Math.max(0, opts.items.findIndex(i => i.selected));
    prefix.textContent = opts.prefix || '›';
    input.placeholder = opts.placeholder || 'Search…';
    input.value = '';
    root.classList.remove('hidden');
    requestAnimationFrame(() => root.classList.add('open'));
    render();
    input.focus();
  }

  function close(cancelled = true) {
    if (!current) return;
    const opts = current;
    current = null;
    root.classList.remove('open');
    root.classList.add('hidden');
    if (cancelled) opts.onCancel?.();
    opts.onClose?.();
  }

  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) { index = (index + 1) % Math.max(1, filtered.length); updateActive(); }
    else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) { index = (index - 1 + filtered.length) % Math.max(1, filtered.length); updateActive(); }
    else if (e.key === 'PageDown') { index = Math.min(filtered.length - 1, index + 8); updateActive(); }
    else if (e.key === 'PageUp') { index = Math.max(0, index - 8); updateActive(); }
    else if (e.key === 'Enter') accept();
    else if (e.key === 'Escape') close(true);
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  root.addEventListener('mousedown', e => { if (e.target === root) close(true); });

  window.Palette = { open, close, isOpen: () => !!current };
})();
