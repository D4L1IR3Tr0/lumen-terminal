// Plugin manager: built-in plugins (switch on/off, read the code), installed plugins (enable/disable, read the code, remove), install from a
// file or a URL, create one with the AI. New plugins arrive disabled so they can be read first.
window.LumenPanels.push({
  id: 'plugins',
  title: 'Plugins',
  order: 60,
  width: 400,
  render(el, host, actions) {
    let list = [];

    actions.innerHTML = `<button class="p-icon-btn" data-act="folder" title="Open the plugins folder">${host.icon('external')}</button>`;
    el.innerHTML = `
      <div class="p-buttons">
        <button class="s-btn ghost" data-act="file">${host.icon('plus')} From a file</button>
        <button class="s-btn ghost" data-act="url-toggle">${host.icon('link')} From a URL</button>
        <button class="s-btn ghost" data-act="ai">${host.icon('sparkle')} Create with AI</button>
      </div>
      <form class="plugin-url hidden">
        <input name="url" placeholder="https://raw.githubusercontent.com/…/my-plugin.js" spellcheck="false" autocomplete="off">
        <button type="submit" class="s-btn">Install</button>
      </form>
      <div class="p-section-title">Built-in</div>
      <div class="p-list plugin-list" data-kind="builtin"></div>
      <div class="p-section-title">Installed</div>
      <div class="p-list plugin-list" data-kind="user"></div>
      <div class="plugin-code hidden">
        <div class="plugin-code-head"><span></span><button class="p-link" data-act="close-code">Close</button></div>
        <pre></pre>
      </div>
      <div class="plugin-market">
        <div class="plugin-market-title">${host.icon('sparkle')} Community catalog</div>
        <p>Coming soon: browse and install community plugins in one click.</p>
      </div>`;

    const builtinEl = el.querySelector('[data-kind="builtin"]');
    const userEl = el.querySelector('[data-kind="user"]');
    const urlForm = el.querySelector('.plugin-url');

    const card = p => `
        <div class="plugin-card${p.enabled ? '' : ' off'}" data-file="${host.escape(p.file)}" data-id="${host.escape(p.id)}"${p.builtin ? ' data-builtin' : ''}>
          <div class="plugin-head">
            <span class="plugin-name">${host.escape(p.name)}</span>
            ${p.version ? `<span class="p-badge">v${host.escape(p.version)}</span>` : ''}
            <label class="s-toggle mini" title="${p.enabled ? 'Disable' : 'Enable'}"><input type="checkbox" data-act="toggle" ${p.enabled ? 'checked' : ''}><span class="s-switch"></span></label>
          </div>
          ${p.description ? `<div class="plugin-desc">${host.escape(p.description)}</div>` : ''}
          ${p.permissions?.length ? `<div class="plugin-perms">${p.permissions.map(x => `<span class="p-badge" title="This plugin can use: ${host.escape(x)}">${host.icon('key')}${host.escape(x)}</span>`).join('')}</div>` : ''}
          <div class="plugin-meta">
            <span>${p.builtin ? 'Ships with Lumen' : `${host.escape(p.file)}${p.author ? ` · ${host.escape(p.author)}` : ''}`}</span>
            <span class="clip-actions">
              <button data-act="code" title="View code">${host.icon('code')}</button>
              ${p.builtin ? '' : `<button data-act="remove" title="Delete">${host.icon('trash')}</button>`}
            </span>
          </div>
        </div>`;

    function paint() {
      builtinEl.innerHTML = list.filter(p => p.builtin).map(card).join('') || '<p class="p-empty">None.</p>';
      userEl.innerHTML = list.filter(p => !p.builtin).map(card).join('') || '<p class="p-empty">No plugins installed.</p>';
    }

    async function load() {
      list = await host.native.plugins.list();
      paint();
    }

    el.addEventListener('change', async e => {
      if (e.target.dataset.act !== 'toggle') return;
      const card = e.target.closest('.plugin-card');
      if (card.hasAttribute('data-builtin')) {
        // Built-in plugins are switched in config.jsonc ("builtinPlugins"); they load or unload live.
        const p = list.find(x => x.builtin && x.id === card.dataset.id);
        if (p) p.enabled = e.target.checked;
        host.setSetting(['builtinPlugins', card.dataset.id], e.target.checked);
        paint();
        return;
      }
      // The file rename is picked up by Lumen's watcher: the plugin loads or unloads live.
      await host.native.plugins.toggle(card.dataset.file);
      load();
    });

    el.addEventListener('click', async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const card = e.target.closest('.plugin-card');
      try {
        if (act === 'file') {
          const file = await host.pickPath({ mode: 'file', extensions: ['js'], title: 'Install a plugin' });
          if (file) { await host.native.plugins.installPath(file); host.toast('Plugin installed (disabled: review it, then enable it)'); load(); }
        }
        else if (act === 'url-toggle') { urlForm.classList.toggle('hidden'); urlForm.querySelector('input').focus(); }
        else if (act === 'ai') host.askAi('Create a Lumen plugin that ', { send: false });
        else if (act === 'close-code') el.querySelector('.plugin-code').classList.add('hidden');
        else if (act === 'code' && card) {
          const box = el.querySelector('.plugin-code');
          box.querySelector('span').textContent = card.dataset.file;
          const read = card.hasAttribute('data-builtin') ? host.native.plugins.readBuiltin : host.native.plugins.read;
          box.querySelector('pre').textContent = await read(card.dataset.file);
          box.classList.remove('hidden');
          box.scrollIntoView({ block: 'nearest' });
        } else if (act === 'remove' && card && !card.hasAttribute('data-builtin')) {
          if (!host.confirmClick(e.target.closest('button'), `Click again to delete ${card.dataset.file}`)) return;
          await host.native.plugins.remove(card.dataset.file);
          load();
        }
      } catch (err) {
        host.toast(err.message, 'error');
      }
    });

    urlForm.addEventListener('submit', async e => {
      e.preventDefault();
      const url = urlForm.querySelector('input').value.trim();
      if (!url) return;
      try {
        const file = await host.native.plugins.installUrl(url);
        host.toast(`Installed: ${file} (disabled, review the code before enabling it)`);
        urlForm.classList.add('hidden');
        load();
      } catch (err) {
        host.toast(err.message, 'error');
      }
    });

    actions.addEventListener('click', e => { if (e.target.closest('[data-act="folder"]')) host.native.open.path('plugins'); });
    host.on('plugins:changed', load);
    this.onOpen = load;
    load();
  }
});
