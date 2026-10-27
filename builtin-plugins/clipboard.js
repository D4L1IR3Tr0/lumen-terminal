// @name Clipboard
// @description Clipboard history (kept in memory only) and pinned snippets. Click an entry to paste it into the active terminal.
// @version 1.0.0
// @author Lumen
// @permissions clipboard
//
// Built-in plugin: turn it off in the Plugins panel or with "builtinPlugins": { "clipboard": false }.
// Pinned snippets are saved with lumen.storage under the key "pins".

const ICON = '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.8h6V5M8.5 11h7M8.5 14.5h7M8.5 18h4"/></svg>';

lumen.sidebar.add({
  id: 'panel',
  title: 'Clipboard',
  icon: ICON,
  hint: 'Ctrl+Shift+H',
  order: 30,
  render(el, ui, actions) {
    let history = [];
    let pins = [];
    let tab = 'history';
    let query = '';

    actions.innerHTML = `<button class="p-icon-btn" data-act="clear" title="Clear history">${ui.icon('trash')}</button>`;
    el.innerHTML = `
      <div class="p-tabs">
        <button data-tab="history" class="active">History</button>
        <button data-tab="pins">Pinned</button>
      </div>
      <input class="p-search" placeholder="Filter…" spellcheck="false">
      <div class="p-list clip-list"></div>
      <p class="p-foot">History stays in memory (nothing is written to disk); only pinned items are kept.</p>`;

    const list = el.querySelector('.clip-list');

    const ago = at => {
      const s = Math.round((Date.now() - at) / 1000);
      if (s < 60) return 'just now';
      if (s < 3600) return `${Math.round(s / 60)} min ago`;
      if (s < 86400) return `${Math.round(s / 3600)} h ago`;
      return new Date(at).toLocaleDateString('en-GB');
    };

    function paint() {
      const source = tab === 'history' ? history : pins;
      const q = query.toLowerCase();
      const items = source.filter(i => !q || i.text.toLowerCase().includes(q));
      list.innerHTML = items.map(item => {
        const pinned = pins.some(p => p.text === item.text);
        const lines = item.text.split('\n').length;
        return `
          <div class="clip-item" data-index="${source.indexOf(item)}">
            <pre class="clip-text">${ui.escape(item.text.slice(0, 600))}</pre>
            <div class="clip-meta">
              <span>${ago(item.at)}${lines > 1 ? ` · ${lines} lines` : ''} · ${item.text.length} chars</span>
              <span class="clip-actions">
                <button data-act="copy" title="Copy">${ui.icon('copy')}</button>
                <button data-act="pin" class="${pinned ? 'on' : ''}" title="${pinned ? 'Unpin' : 'Pin'}">${ui.icon('pin')}</button>
                <button data-act="remove" title="Remove">${ui.icon('x')}</button>
              </span>
            </div>
          </div>`;
      }).join('') || `<p class="p-empty">${tab === 'history' ? 'Copy some text and it will show up here.' : 'Pin the snippets you reuse often.'}</p>`;
    }

    async function load() {
      history = await lumen.clipboard.history.list();
      pins = (await lumen.storage.get('pins')) || [];
      paint();
    }

    el.querySelector('.p-tabs').addEventListener('click', e => {
      const t = e.target.closest('[data-tab]');
      if (!t) return;
      tab = t.dataset.tab;
      el.querySelectorAll('.p-tabs button').forEach(b => b.classList.toggle('active', b === t));
      paint();
    });
    el.querySelector('.p-search').addEventListener('input', e => { query = e.target.value.trim(); paint(); });

    list.addEventListener('click', async e => {
      const card = e.target.closest('.clip-item');
      if (!card) return;
      const source = tab === 'history' ? history : pins;
      const item = source[+card.dataset.index];
      if (!item) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'copy') { lumen.clipboard.write(item.text); ui.toast('Copied'); }
      else if (act === 'pin') {
        pins = pins.some(p => p.text === item.text) ? pins.filter(p => p.text !== item.text) : [{ text: item.text, at: Date.now() }, ...pins];
        await lumen.storage.set('pins', pins);
        paint();
      } else if (act === 'remove') {
        if (tab === 'history') history = await lumen.clipboard.history.remove(item.text);
        else { pins = pins.filter(p => p.text !== item.text); await lumen.storage.set('pins', pins); }
        paint();
      } else {
        const pane = lumen.panes.focused();
        if (pane) { pane.paste(item.text); ui.toast('Pasted into the terminal'); }
      }
    });

    actions.addEventListener('click', async e => {
      const clear = e.target.closest('[data-act="clear"]');
      if (clear && ui.confirmClick(clear, 'Click again to clear the history')) {
        history = await lumen.clipboard.history.clear();
        paint();
      }
    });

    lumen.clipboard.history.onChange(h => { history = h; if (lumen.sidebar.isOpen('panel')) paint(); });
    lumen.storage.onChange('pins', data => { pins = data || []; paint(); });
    this.onOpen = load;
    load();
  }
});

lumen.commands.register('panel.clipboard', {
  title: 'Clipboard history',
  keywords: 'clipboard copy paste',
  run: () => lumen.sidebar.toggle('panel')
});
