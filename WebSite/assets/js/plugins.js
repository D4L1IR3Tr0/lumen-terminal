// Plugin catalog. Placeholder data for the design: the real list will come from the registry.
(function () {
  const PLUGINS = [
    { id: 'git', name: 'Git', icon: '⎇', author: 'Lumen', builtin: true, cat: 'dev', installs: null, perms: ['git', 'github'], desc: 'Changes, diffs, commit, pull/push, branches, stashes, and your GitHub: PRs, issues, CI status, contributions.' },
    { id: 'notes', name: 'Notes', icon: '✎', author: 'Lumen', builtin: true, cat: 'productivity', installs: null, perms: [], desc: 'Pinned notes and reminders in the sidebar. Markdown welcome.' },
    { id: 'clipboard', name: 'Clipboard', icon: '⧉', author: 'Lumen', builtin: true, cat: 'productivity', installs: null, perms: ['clipboard'], desc: 'Clipboard history kept in memory, pinned snippets, click to paste into the terminal.' },
    { id: 'pomodoro', name: 'Pomodoro', icon: '◷', author: 'community', cat: 'productivity', installs: 1240, perms: [], desc: 'A 25/5 focus timer in the top bar, with a gentle toast when it is time for a break.' },
    { id: 'weather', name: 'Weather', icon: '☼', author: 'community', cat: 'bar', installs: 980, perms: ['network'], desc: 'Current temperature and conditions in the bar, refreshed every ten minutes.' },
    { id: 'now-playing', name: 'Now Playing', icon: '♪', author: 'community', cat: 'bar', installs: 860, perms: ['network'], desc: 'What Spotify is playing, with play/pause and next from the palette.' },
    { id: 'docker', name: 'Docker', icon: '▣', author: 'community', cat: 'dev', installs: 2140, perms: ['shell'], desc: 'Containers in a sidebar panel: logs in a new pane, start, stop, exec in one click.' },
    { id: 'kube', name: 'Kube Context', icon: '☸', author: 'community', cat: 'dev', installs: 1530, perms: ['shell'], desc: 'The current Kubernetes context and namespace in the bar, switch them from the palette.' },
    { id: 'ssh', name: 'SSH Hosts', icon: '⇄', author: 'community', cat: 'dev', installs: 1870, perms: ['shell'], desc: 'Your ~/.ssh/config hosts in a panel. Click to open a session in a new pane.' },
    { id: 'todo', name: 'Todo', icon: '☐', author: 'community', cat: 'productivity', installs: 1110, perms: [], desc: 'A tiny todo list per project folder, following the focused terminal.' },
    { id: 'sysmon', name: 'System Monitor', icon: '▤', author: 'community', cat: 'bar', installs: 740, perms: [], desc: 'Per-core CPU, network and disk sparklines in a sidebar panel.' },
    { id: 'synthwave', name: 'Synthwave \'84', icon: '◢', author: 'community', cat: 'themes', installs: 2560, perms: [], desc: 'Neon pink and cyan, glowing cursor, sunset background. Turn it up.' },
    { id: 'jira', name: 'Jira', icon: 'J', author: 'community', cat: 'dev', installs: 430, perms: ['network'], desc: 'Your assigned issues in a panel, the branch name of the current one in the bar.' },
    { id: 'crt', name: 'CRT', icon: '▒', author: 'community', cat: 'themes', installs: 1690, perms: [], desc: 'Scanlines, a soft bloom and a phosphor green theme. 1983 called.' },
    { id: 'ai-commit', name: 'AI Commit', icon: '✦', author: 'community', cat: 'ai', installs: 1320, perms: ['git'], desc: 'Writes a commit message for the staged changes with your own AI agent.' },
    { id: 'explain', name: 'Explain Error', icon: '?', author: 'community', cat: 'ai', installs: 990, perms: [], desc: 'When a command fails, one click asks your AI agent what went wrong.' }
  ];
  const CATS = [['all', 'All'], ['dev', 'Dev'], ['productivity', 'Productivity'], ['bar', 'Status bar'], ['themes', 'Themes'], ['ai', 'AI']];

  const grid = document.getElementById('grid');
  const cats = document.getElementById('cats');
  const q = document.getElementById('q');
  let cat = 'all';

  cats.innerHTML = CATS.map(([id, label]) => `<button data-cat="${id}" class="${id === cat ? 'on' : ''}">${label}</button>`).join('');

  const fmt = n => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

  function paint() {
    const text = q.value.trim().toLowerCase();
    const list = PLUGINS
      .filter(p => cat === 'all' || p.cat === cat)
      .filter(p => !text || `${p.name} ${p.desc} ${p.cat}`.toLowerCase().includes(text))
      .sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0) || (b.installs || 0) - (a.installs || 0));
    grid.innerHTML = list.map((p, i) => `
      <article class="plugin reveal" style="transition-delay:${Math.min(i, 8) * 40}ms">
        <div class="top">
          <span class="pi">${p.icon}</span>
          <div>
            <h3>${p.name} ${p.builtin ? '<span class="badge">built-in</span>' : ''}</h3>
            <span class="by">by ${p.author}</span>
          </div>
        </div>
        <p>${p.desc}</p>
        <div class="foot">
          <span class="stats">
            ${p.installs ? `<span>↓ ${fmt(p.installs)}</span>` : '<span>ships with Lumen</span>'}
            ${p.perms.map(x => `<span class="badge perm" title="Needs the ${x} permission">${x}</span>`).join('')}
          </span>
          ${p.builtin ? '<span class="muted" style="font-size:11px">included</span>' : `<button class="btn sm ghost todo" data-todo="One-click install is coming soon">Install</button>`}
        </div>
      </article>`).join('') || `<div class="empty">  ¯\\_(ツ)_/¯\n\nNo plugin matches "${text.replace(/[<>&"]/g, '')}".\nWrite it, and be the first.</div>`;
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
})();
