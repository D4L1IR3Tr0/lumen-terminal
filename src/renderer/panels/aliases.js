// Aliases of the focused terminal, read from that terminal itself every time the panel opens
// (and when another pane gets the focus): each shell writes its aliases at every prompt.
// Below them, the Lumen aliases (shared by PowerShell, bash and cmd, editable here).
window.LumenPanels.push({
  id: 'aliases',
  title: 'Aliases',
  hint: 'Ctrl+Shift+L',
  order: 50,
  width: 380,
  render(el, host, actions) {
    let mine = [];
    let current = null;   // { shell, kind, live, items, paneId }
    let loading = false;
    let editing = null;
    let query = '';
    let request = 0;

    actions.innerHTML = `
      <button class="p-icon-btn" data-act="refresh" title="Read the aliases again">${host.icon('refresh')}</button>
      <button class="p-icon-btn" data-act="new" title="New Lumen alias">${host.icon('plus')}</button>`;
    el.innerHTML = `
      <div class="alias-term"></div>
      <input class="p-search" placeholder="Filter aliases…" spellcheck="false">
      <form class="alias-form hidden">
        <div class="p-field"><label>Name</label><input name="name" placeholder="gs" spellcheck="false" autocomplete="off"></div>
        <div class="p-field"><label>Command</label><input name="command" placeholder="git status" spellcheck="false" autocomplete="off"></div>
        <div class="p-field"><label>Description <span>(optional)</span></label><input name="description" placeholder="Repository status" autocomplete="off"></div>
        <div class="p-form-actions">
          <button type="button" class="s-btn ghost" data-act="cancel">Cancel</button>
          <button type="submit" class="s-btn">Save</button>
        </div>
      </form>
      <div class="p-section-title" data-title="terminal">In this terminal</div>
      <div class="p-list" data-list="terminal"></div>
      <div class="p-section-title">Lumen aliases <span class="p-badge">PowerShell · Bash · cmd</span></div>
      <div class="p-list" data-list="mine"></div>
      <p class="p-foot">Lumen aliases load in every new terminal. ▶ adds one to the current terminal now.</p>`;

    const form = el.querySelector('.alias-form');
    // form.name would be the form's own name attribute, so fields are looked up explicitly.
    const field = n => form.querySelector(`[name="${n}"]`);
    const match = a => !query || `${a.name} ${a.command} ${a.description || ''}`.toLowerCase().includes(query);

    function paintTerminal() {
      const head = el.querySelector('.alias-term');
      const box = el.querySelector('[data-list="terminal"]');
      const title = el.querySelector('[data-title="terminal"]');
      const term = host.focusedTerminal();
      if (!term) {
        head.innerHTML = '<p class="p-empty">No terminal focused.</p>';
        title.textContent = 'In this terminal';
        box.innerHTML = '';
        return;
      }
      const shell = term.profile?.name || 'Terminal';
      const source = !current ? '' : current.live ? 'read from this terminal' : current.kind === 'cmd' ? 'cmd macros (Lumen + AutoRun)' : 'from your profile (refreshes after the next command)';
      head.innerHTML = `
        <div class="alias-term-row">
          <span class="alias-shell">${host.icon('terminal')}${host.escape(shell)}</span>
          <span class="alias-cwd">${host.escape(host.prettyPath(term.cwd || ''))}</span>
        </div>
        <div class="alias-source">${loading ? '<span class="alias-spin"></span>Reading the aliases…' : host.escape(source)}</div>`;
      if (!current) { title.textContent = 'In this terminal'; box.innerHTML = loading ? '' : '<p class="p-empty">Waiting for the shell…</p>'; return; }
      const items = current.items.filter(match).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      title.innerHTML = `In this terminal <span class="p-badge">${current.items.length}</span>`;
      if (current.unsupported) { box.innerHTML = '<p class="p-empty">This shell cannot list its aliases.</p>'; return; }
      box.innerHTML = items.map(a => `
        <div class="p-row alias system" data-name="${host.escape(a.name)}" title="Click to type it in the terminal">
          <span class="alias-name">${host.escape(a.name)}</span>
          <span class="p-row-main"><span class="p-row-title mono">${host.escape(a.command)}</span></span>
          <span class="alias-kind${a.lumen ? ' lumen' : ''}">${a.lumen ? 'Lumen' : host.escape(a.type || '')}</span>
        </div>`).join('') || `<p class="p-empty">${query ? 'No match.' : 'No custom aliases in this terminal.'}</p>`;
    }

    function paintMine() {
      const loaded = current?.live ? new Set(current.items.map(a => a.name)) : null;
      const items = mine.filter(match);
      el.querySelector('[data-list="mine"]').innerHTML = items.map(a => `
        <div class="p-row alias" data-name="${host.escape(a.name)}" data-mine="1">
          <span class="alias-name">${host.escape(a.name)}</span>
          <span class="p-row-main">
            <span class="p-row-title mono">${host.escape(a.command)}</span>
            ${a.description || (loaded && !loaded.has(a.name)) ? `<span class="p-row-sub">${host.escape(a.description || '')}${loaded && !loaded.has(a.name) ? `${a.description ? ' · ' : ''}not loaded in this terminal` : ''}</span>` : ''}
          </span>
          <span class="p-row-actions">
            <button data-act="apply" title="Add to the current terminal">${host.icon('play')}</button>
            <button data-act="edit" title="Edit">${host.icon('edit')}</button>
            <button data-act="remove" title="Delete">${host.icon('x')}</button>
          </span>
        </div>`).join('') || `<p class="p-empty">${query ? 'No match.' : 'No aliases yet. Create one with +, or ask the AI.'}</p>`;
    }

    // Asks the focused terminal for its aliases (fresh every time).
    async function fetchTerminal() {
      const id = ++request;
      const term = host.focusedTerminal();
      if (current && current.paneId !== term?.id) current = null;
      loading = !!term?.ptyId;
      paintTerminal();
      if (!term?.ptyId) return;
      let result = null;
      try { result = await host.native.aliases.forPty(term.ptyId); } catch (e) { host.toast(e.message, 'error'); }
      if (id !== request) return; // another pane got the focus meanwhile
      loading = false;
      current = result ? { ...result, paneId: term.id } : null;
      paintTerminal();
      paintMine();
    }

    async function loadMine() {
      mine = await host.native.aliases.list();
      paintMine();
    }

    function refresh() {
      loadMine();
      fetchTerminal();
    }

    function openForm(alias) {
      editing = alias ? alias.name : null;
      field('name').value = alias?.name || '';
      field('command').value = alias?.command || '';
      field('description').value = alias?.description || '';
      form.classList.remove('hidden');
      field('name').focus();
    }

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const name = field('name').value.trim();
      const command = field('command').value.trim();
      if (!/^[A-Za-z_][\w.-]{0,40}$/.test(name)) return host.toast('Invalid name (letters, digits, - _ .)', 'error');
      if (!command) return host.toast('The command is empty', 'error');
      mine = mine.filter(a => a.name !== name && a.name !== editing);
      mine.push({ name, command, description: field('description').value.trim() });
      mine.sort((a, b) => a.name.localeCompare(b.name));
      await host.native.aliases.save(mine);
      form.classList.add('hidden');
      paintMine();
      host.toast(`Alias "${name}" saved`);
    });

    el.querySelector('.p-search').addEventListener('input', e => {
      query = e.target.value.trim().toLowerCase();
      paintTerminal();
      paintMine();
    });

    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cancel') { form.classList.add('hidden'); return; }
      const r = e.target.closest('.p-row.alias');
      if (!r) return;
      const alias = mine.find(a => a.name === r.dataset.name);
      if (act === 'edit') openForm(alias);
      else if (act === 'remove') {
        mine = mine.filter(a => a !== alias);
        await host.native.aliases.save(mine);
        paintMine();
      } else if (act === 'apply') {
        host.applyAliasToFocused(alias);
        // The shell reports its aliases at its next prompt.
        setTimeout(fetchTerminal, 900);
      } else {
        host.typeInFocused(`${r.dataset.name} `);
      }
    });

    actions.addEventListener('click', e => {
      if (e.target.closest('[data-act="new"]')) openForm(null);
      if (e.target.closest('[data-act="refresh"]')) refresh();
    });
    host.on('aliases:changed', loadMine);
    host.native.store.onChange(name => { if (name === 'aliases') loadMine(); });
    // Another pane focused while the panel is open: show that terminal's aliases.
    host.on('pane:focused', () => { if (host.panelActive('aliases')) fetchTerminal(); });
    host.on('pane:created', () => { if (host.panelActive('aliases')) fetchTerminal(); });
    this.onOpen = refresh;
    refresh();
  }
});
