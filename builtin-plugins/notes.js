// @name Notes
// @description Notes and reminders in the sidebar. Reminders fire as a toast (or a desktop notification when Lumen is in the background).
// @version 1.0.0
// @author Lumen
//
// Built-in plugin: turn it off in the Plugins panel or with "builtinPlugins": { "notes": false }.
// Notes are saved with lumen.storage under the key "notes" (~/.lumen/data/plugin-notes-notes.json);
// the main process reads the same file to fire reminders (checked every 30 s).

const ICON = '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8.5 12h7M8.5 15.5h5"/></svg>';

function newNote(fields = {}) {
  const now = new Date().toISOString();
  return {
    id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: '', body: '', createdAt: now, updatedAt: now, pinned: false, remindAt: null, reminded: false,
    ...fields
  };
}

lumen.sidebar.add({
  id: 'panel',
  title: 'Notes',
  icon: ICON,
  hint: 'Ctrl+Shift+M',
  order: 20,
  width: 380,
  render(el, ui, actions) {
    let notes = [];
    let current = null;
    let query = '';
    let saveTimer = null;

    actions.innerHTML = `<button class="p-icon-btn" data-act="new" title="New note">${ui.icon('plus')}</button>`;
    el.innerHTML = `
      <div class="notes-list-view">
        <input class="p-search" placeholder="Search notes…" spellcheck="false">
        <div class="p-list notes-list"></div>
      </div>
      <div class="notes-editor hidden">
        <div class="notes-toolbar">
          <button class="p-icon-btn" data-act="back" title="Back">${ui.icon('back')}</button>
          <span class="notes-saved"></span>
          <button class="p-icon-btn" data-act="pin" title="Pin">${ui.icon('pin')}</button>
          <button class="p-icon-btn danger" data-act="delete" title="Delete">${ui.icon('trash')}</button>
        </div>
        <input class="notes-title" placeholder="Title" spellcheck="false">
        <textarea class="notes-body" placeholder="Write here… (Markdown welcome)" spellcheck="true"></textarea>
        <div class="notes-remind">
          <span>${ui.icon('bell')} Reminder</span>
          <input type="datetime-local" class="notes-remind-at">
          <button class="p-link" data-act="clear-remind">Clear</button>
        </div>
      </div>`;

    const listEl = el.querySelector('.notes-list');
    const search = el.querySelector('.p-search');
    const listView = el.querySelector('.notes-list-view');
    const editor = el.querySelector('.notes-editor');
    const title = el.querySelector('.notes-title');
    const body = el.querySelector('.notes-body');
    const remindAt = el.querySelector('.notes-remind-at');
    const saved = el.querySelector('.notes-saved');

    const fmt = iso => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const toLocalInput = iso => {
      if (!iso) return '';
      const d = new Date(iso);
      const pad = n => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    function paintList() {
      const q = query.toLowerCase();
      const shown = notes
        .filter(n => !q || `${n.title} ${n.body}`.toLowerCase().includes(q))
        .sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.updatedAt.localeCompare(a.updatedAt));
      listEl.innerHTML = shown.map(n => `
        <div class="note-card${n.pinned ? ' pinned' : ''}" data-id="${ui.escape(n.id)}">
          <div class="note-card-title">${n.pinned ? ui.icon('pin') : ''}${ui.escape(n.title || 'Untitled')}</div>
          <div class="note-card-body">${ui.escape((n.body || '').slice(0, 160))}</div>
          <div class="note-card-meta">
            <span>${fmt(n.updatedAt)}</span>
            ${n.remindAt ? `<span class="note-remind${n.reminded ? ' done' : ''}">${ui.icon('bell')} ${fmt(n.remindAt)}</span>` : ''}
          </div>
        </div>`).join('') || `<p class="p-empty">${q ? 'No matching notes.' : 'No notes yet. Click + to start.'}</p>`;
    }

    function openNote(note) {
      current = note;
      title.value = note.title || '';
      body.value = note.body || '';
      remindAt.value = toLocalInput(note.remindAt);
      el.querySelector('[data-act="pin"]').classList.toggle('on', !!note.pinned);
      saved.textContent = '';
      listView.classList.add('hidden');
      editor.classList.remove('hidden');
      (note.title ? body : title).focus();
    }

    function showList() {
      current = null;
      editor.classList.add('hidden');
      listView.classList.remove('hidden');
      paintList();
    }

    async function persist() {
      await lumen.storage.set('notes', notes);
      saved.textContent = 'Saved';
    }

    function touch() {
      if (!current) return;
      current.title = title.value;
      current.body = body.value;
      current.updatedAt = new Date().toISOString();
      saved.textContent = '…';
      clearTimeout(saveTimer);
      saveTimer = setTimeout(persist, 400);
    }

    async function load() {
      notes = (await lumen.storage.get('notes')) || [];
      if (!current) paintList();
    }

    title.addEventListener('input', touch);
    body.addEventListener('input', touch);
    body.addEventListener('keydown', e => {
      // Tab inserts spaces instead of leaving the editor.
      if (e.key === 'Tab') {
        e.preventDefault();
        const s = body.selectionStart;
        body.setRangeText('  ', s, body.selectionEnd, 'end');
        touch();
      }
    });
    remindAt.addEventListener('change', () => {
      if (!current) return;
      current.remindAt = remindAt.value ? new Date(remindAt.value).toISOString() : null;
      current.reminded = false;
      touch();
      if (current.remindAt) ui.toast(`Reminder set: ${fmt(current.remindAt)}`);
    });
    search.addEventListener('input', () => { query = search.value.trim(); paintList(); });
    listEl.addEventListener('click', e => {
      const card = e.target.closest('.note-card');
      if (card) openNote(notes.find(n => n.id === card.dataset.id));
    });

    const onAction = async e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new') { const note = newNote(); notes.unshift(note); openNote(note); await persist(); }
      else if (act === 'back') { clearTimeout(saveTimer); await persist(); showList(); }
      else if (act === 'pin' && current) { current.pinned = !current.pinned; e.target.closest('button').classList.toggle('on', current.pinned); touch(); }
      else if (act === 'delete' && current) {
        clearTimeout(saveTimer);
        notes = notes.filter(n => n !== current);
        await persist();
        showList();
        ui.toast('Note deleted');
      } else if (act === 'clear-remind' && current) { remindAt.value = ''; current.remindAt = null; touch(); }
    };
    actions.addEventListener('click', onAction);
    editor.addEventListener('click', onAction);

    // Notes added elsewhere (the AI, another window) or marked as reminded by the main process.
    lumen.storage.onChange('notes', () => { if (!current) load(); });

    this.onOpen = async id => {
      await load();
      const target = id && notes.find(n => n.id === id);
      if (target) openNote(target);
    };
    load();
  }
});

lumen.commands.register('panel.notes', {
  title: 'Notes & reminders',
  keywords: 'notepad memo todo reminder',
  run: () => lumen.sidebar.toggle('panel')
});

lumen.commands.register('note.new', {
  title: 'New note',
  keywords: 'notepad memo',
  run: async () => {
    const note = newNote();
    const notes = (await lumen.storage.get('notes')) || [];
    notes.unshift(note);
    await lumen.storage.set('notes', notes);
    lumen.sidebar.open('panel', note.id);
  }
});

lumen.on('reminder', n => lumen.ui.toast(`⏰ Reminder: ${n?.title || 'note'}`));
