// Quick access to folders: favourites + recently visited ones.
// Click: cd into it in the focused pane. Actions: new pane there, open in Explorer, pin, remove.
window.LumenPanels.push({
  id: 'folders',
  title: 'Folders',
  hint: 'Ctrl+Shift+O',
  order: 10,
  render(el, host, actions) {
    let favorites = [];
    let recents = [];

    const defaults = () => {
      const home = host.paths().home;
      const sep = home.includes('\\') ? '\\' : '/';
      return [
        { name: 'Home', path: home },
        { name: 'Desktop', path: `${home}${sep}Desktop` },
        { name: 'Documents', path: `${home}${sep}Documents` },
        { name: 'Downloads', path: `${home}${sep}Downloads` }
      ];
    };

    actions.innerHTML = `
      <button class="p-icon-btn" data-act="add-current" title="Add the active terminal's folder">${host.icon('plus')}</button>
      <button class="p-icon-btn" data-act="browse" title="Browse…">${host.icon('search')}</button>`;

    el.innerHTML = `
      <div class="p-section-title">Favorites</div>
      <div class="p-list" data-list="favorites"></div>
      <div class="p-section-title">Recent</div>
      <div class="p-list" data-list="recents"></div>
      <p class="p-foot">Click: cd into that folder in the active terminal.</p>`;

    const row = (item, kind) => `
      <div class="p-row folder" data-path="${host.escape(item.path)}" data-kind="${kind}" title="${host.escape(item.path)}">
        <span class="p-row-icon">${host.icon('folder')}</span>
        <span class="p-row-main">
          <span class="p-row-title">${host.escape(item.name || item.path.split(/[\\/]/).filter(Boolean).pop() || item.path)}</span>
          <span class="p-row-sub">${host.escape(host.prettyPath(item.path))}</span>
        </span>
        <span class="p-row-actions">
          <button data-act="pane" title="New terminal here">${host.icon('terminal')}</button>
          <button data-act="explorer" title="Open in Explorer">${host.icon('external')}</button>
          ${kind === 'recents' ? `<button data-act="pin" title="Add to favorites">${host.icon('star')}</button>` : `<button data-act="rename" title="Rename">${host.icon('edit')}</button>`}
          <button data-act="remove" title="Remove">${host.icon('x')}</button>
        </span>
      </div>`;

    function paint() {
      el.querySelector('[data-list="favorites"]').innerHTML = favorites.map(f => row(f, 'favorites')).join('') || '<p class="p-empty">No favorites yet.</p>';
      el.querySelector('[data-list="recents"]').innerHTML = recents.map(r => row({ path: r }, 'recents')).join('') || '<p class="p-empty">Folders you visit will show up here.</p>';
    }

    async function load() {
      favorites = (await host.native.store.get('folders')) || defaults();
      recents = host.recentDirs();
      paint();
    }

    const saveFavorites = () => host.native.store.set('folders', favorites);

    async function addFavorite(p) {
      if (!p || favorites.some(f => f.path.toLowerCase() === p.toLowerCase())) return;
      favorites.push({ name: p.split(/[\\/]/).filter(Boolean).pop() || p, path: p });
      await saveFavorites();
      paint();
      host.toast('Added to favorites');
    }

    actions.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'add-current') {
        const cwd = host.focusedPane()?.cwd;
        if (cwd) addFavorite(cwd); else host.toast("The active terminal doesn't report its folder", 'error');
      } else if (act === 'browse') {
        const dir = await host.pickPath({ mode: 'folder', title: 'Add a favorite folder' });
        if (dir) addFavorite(dir);
      }
    });

    el.addEventListener('click', async e => {
      const r = e.target.closest('.p-row');
      if (!r) return;
      const p = r.dataset.path;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'pane') host.createPane({ cwd: p });
      else if (act === 'explorer') host.native.folders.open(p);
      else if (act === 'pin') addFavorite(p);
      else if (act === 'remove') {
        if (r.dataset.kind === 'favorites') { favorites = favorites.filter(f => f.path !== p); await saveFavorites(); }
        else host.forgetRecentDir(p);
        recents = host.recentDirs();
        paint();
      } else if (act === 'rename') {
        const fav = favorites.find(f => f.path === p);
        const title = r.querySelector('.p-row-title');
        const input = document.createElement('input');
        input.className = 'p-inline-input';
        input.value = fav.name;
        title.replaceWith(input);
        input.focus();
        input.select();
        const done = async ok => {
          if (ok && input.value.trim()) fav.name = input.value.trim();
          await saveFavorites();
          paint();
        };
        input.addEventListener('keydown', ev => { if (ev.key === 'Enter') done(true); if (ev.key === 'Escape') { ev.stopPropagation(); done(false); } });
        input.addEventListener('blur', () => done(true));
      } else {
        if (await host.native.folders.isDir(p)) { host.cdFocused(p); host.toast(`→ ${host.prettyPath(p)}`); }
        else host.toast('This folder no longer exists', 'error');
      }
    });

    host.on('cwd:changed', () => { recents = host.recentDirs(); if (host.panelActive('folders')) paint(); });
    host.native.store.onChange(name => { if (name === 'folders') load(); });
    this.onOpen = load;
    load();
  }
});
