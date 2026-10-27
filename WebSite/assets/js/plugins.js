// Plugin catalog: the built-in plugins, then the community registry (registry/plugins.json in
// Lumen's repository, the same index the app's Plugins panel reads).
(function () {
  const REPO = 'https://github.com/D4L1IR3Tr0/lumen-terminal';
  const INDEX = 'https://raw.githubusercontent.com/D4L1IR3Tr0/lumen-terminal/main/registry/plugins.json';
  const BUILTIN = [
    { id: 'git', name: 'Git', author: 'Lumen', builtin: true, category: 'dev', permissions: ['git', 'github'], description: 'Changes, diffs, commit, pull/push, branches, stashes, and your GitHub: PRs, issues, CI status, contributions.' },
    { id: 'notes', name: 'Notes', author: 'Lumen', builtin: true, category: 'productivity', permissions: [], description: 'Pinned notes and reminders in the sidebar. Markdown welcome.' },
    { id: 'clipboard', name: 'Clipboard', author: 'Lumen', builtin: true, category: 'productivity', permissions: ['clipboard'], description: 'Clipboard history kept in memory, pinned snippets, click to paste into the terminal.' }
  ];
  const CATS = [['all', 'All'], ['dev', 'Dev'], ['productivity', 'Productivity'], ['bar', 'Status bar'], ['themes', 'Themes'], ['ai', 'AI']];

  const grid = document.getElementById('grid');
  const cats = document.getElementById('cats');
  const q = document.getElementById('q');
  let cat = 'all';
  let community = null;   // null while loading
  let failed = false;

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // A two-letter monospace tag instead of an icon: "po" for Pomodoro.
  const tag = name => esc(name.replace(/[^a-z0-9]/gi, '').slice(0, 2).toLowerCase() || '··');

  cats.innerHTML = CATS.map(([id, label]) => `<button data-cat="${id}" class="${id === cat ? 'on' : ''}">${label}</button>`).join('');

  function card(p, i) {
    const action = p.builtin
      ? '<span class="muted" style="font-size:11px">included</span>'
      : `<span class="acts">
           <a class="btn sm ghost" href="${REPO}/blob/main/registry/plugins/${esc(p.id)}.js" target="_blank" rel="noopener">Code</a>
           <a class="btn sm" href="lumen://install/${esc(p.id)}" title="Opens Lumen's Plugins panel on this plugin">Install</a>
         </span>`;
    return `
      <article class="plugin reveal" style="transition-delay:${Math.min(i, 8) * 40}ms">
        <div class="top">
          <span class="pi">${tag(p.name)}</span>
          <div>
            <h3>${esc(p.name)} ${p.builtin ? '<span class="badge">built-in</span>' : `<span class="badge">v${esc(p.version)}</span>`}</h3>
            <span class="by">by ${esc(p.author)} · #${esc(p.category)}</span>
          </div>
        </div>
        <p>${esc(p.description)}</p>
        <div class="foot">
          <span class="stats">
            ${p.builtin ? '<span>ships with Lumen</span>' : `<span>${(p.size / 1024).toFixed(1)} KB</span>`}
            ${p.permissions.map(x => `<span class="badge perm" title="Needs the ${esc(x)} permission">${esc(x)}</span>`).join('')}
          </span>
          ${action}
        </div>
      </article>`;
  }

  function paint() {
    const text = q.value.trim().toLowerCase();
    const list = [...BUILTIN, ...(community || [])]
      .filter(p => cat === 'all' || p.category === cat)
      .filter(p => !text || `${p.name} ${p.description} ${p.category} ${p.author}`.toLowerCase().includes(text));
    let html = list.map(card).join('');
    if (community === null && !failed) html += '<div class="empty">Loading the community catalog…</div>';
    else if (failed) html += `<div class="empty">The community catalog could not be loaded.\nBrowse it on GitHub: registry/plugins</div>`;
    else if (!list.length) html = `<div class="empty">  ¯\\_(ツ)_/¯\n\nNo plugin matches "${esc(text)}".\nWrite it, and be the first.</div>`;
    grid.innerHTML = html;
    requestAnimationFrame(() => grid.querySelectorAll('.reveal').forEach(el => el.classList.add('in')));
  }

  cats.addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat;
    cats.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    paint();
  });
  q.addEventListener('input', paint);
  // "/" focuses the search, like in a terminal pager.
  addEventListener('keydown', e => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } });

  paint();
  fetch(INDEX, { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(data => { community = (data.plugins || []).map(p => ({ ...p, permissions: p.permissions || [] })); })
    .catch(() => { failed = true; })
    .finally(paint);
})();
