// @name Todo
// @description A small todo list per project, in the sidebar. It follows the focused terminal: each folder has its own list, which follows you into its subfolders.
// @version 1.0.0
// @author Lumen
// @category productivity

module.exports = lumen => {
  lumen.sidebar.add({
    id: 'todo',
    title: 'Todo',
    order: 75,
    width: 340,
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h2M4 12h2M4 18h2M10 6h10M10 12h10M10 18h7"/></svg>',
    render(el, ui) {
      let all = {};      // folder -> [{ text, done }]
      let folder = null;

      el.innerHTML = `
        <div class="todo-where p-empty" style="margin:0 0 8px;text-align:left"></div>
        <form class="todo-add"><input class="p-search" placeholder="Add a task, Enter to save" spellcheck="false"></form>
        <div class="p-list todo-list"></div>`;
      const where = el.querySelector('.todo-where');
      const listEl = el.querySelector('.todo-list');
      const input = el.querySelector('input');

      const items = () => (all[folder] ||= []);
      const save = () => lumen.storage.set('lists', all);

      function paint() {
        where.textContent = folder ? ui.prettyPath(folder) : 'No terminal focused';
        const list = folder ? items() : [];
        listEl.innerHTML = list.map((t, i) => `
          <div class="p-row" data-i="${i}" style="display:flex;align-items:center;gap:8px;${t.done ? 'opacity:.5' : ''}">
            <input type="checkbox" data-act="done" ${t.done ? 'checked' : ''}>
            <span style="flex:1;${t.done ? 'text-decoration:line-through' : ''}">${ui.escape(t.text)}</span>
            <button class="p-link" data-act="del" title="Delete">×</button>
          </div>`).join('') || '<p class="p-empty">Nothing to do here.</p>';
      }

      function follow() {
        const cwd = lumen.panes.focused()?.cwd;
        if (!cwd || cwd === folder) return;
        // Use the deepest folder that already has a list, so a project's list follows you into its subfolders.
        const parents = Object.keys(all).filter(k => cwd.toLowerCase().startsWith(k.toLowerCase())).sort((a, b) => b.length - a.length);
        folder = parents[0] || cwd;
        paint();
      }

      el.querySelector('.todo-add').addEventListener('submit', e => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text || !folder) return;
        items().push({ text, done: false });
        input.value = '';
        save();
        paint();
      });

      listEl.addEventListener('click', e => {
        const row = e.target.closest('[data-i]');
        const act = e.target.dataset.act;
        if (!row || !act) return;
        const list = items();
        const i = +row.dataset.i;
        if (act === 'done') list[i].done = e.target.checked;
        if (act === 'del') list.splice(i, 1);
        if (!list.length) delete all[folder];
        save();
        paint();
      });

      lumen.storage.get('lists').then(data => { all = data || {}; follow(); paint(); });
      lumen.storage.onChange('lists', data => { all = data || {}; paint(); });
      lumen.on('pane:focused', follow);
      lumen.on('cwd:changed', follow);
    },
    onOpen() {}
  });

  lumen.commands.register('todo.open', { title: 'Todo: open the list', run: () => lumen.sidebar.toggle('todo') });
};
