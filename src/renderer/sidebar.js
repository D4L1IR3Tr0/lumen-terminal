// Left sidebar: a hairline that widens into an icon rail on hover; each icon opens a drawer
// panel that slides in from the left and pushes the panes aside.
// Panels (built-in or from plugins) are registered with Sidebar.register(def):
//   { id, title, icon: '<svg…>', order, width, render(el, host), onOpen(arg), onClose() }
(function () {
  const rail = document.getElementById('rail');
  const drawer = document.getElementById('drawer');
  const panels = new Map();
  const mounted = new Map();
  let host = null;
  let active = null;

  const ICONS = {
    folders: '<svg viewBox="0 0 24 24"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.4l2 2h8.6A1.5 1.5 0 0 1 21 9.5v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
    notes: '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5z"/><path d="M15 4v4h4M8.5 12h7M8.5 15.5h5"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.8h6V5M8.5 11h7M8.5 14.5h7M8.5 18h4"/></svg>',
    ai: '<svg viewBox="0 0 24 24"><path d="M12 3.5l1.7 4.8 4.8 1.7-4.8 1.7L12 16.5l-1.7-4.8L5.5 10l4.8-1.7z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>',
    aliases: '<svg viewBox="0 0 24 24"><path d="M4 6l5 5-5 5M11 17h9M14 7h6M17 4v6"/></svg>',
    plugins: '<svg viewBox="0 0 24 24"><path d="M9 4.5a2 2 0 1 1 4 0V6h4a1 1 0 0 1 1 1v4h-1.5a2 2 0 1 0 0 4H18v4a1 1 0 0 1-1 1h-4v-1.5a2 2 0 1 0-4 0V20H5a1 1 0 0 1-1-1v-4h1.5a2 2 0 1 0 0-4H4V7a1 1 0 0 1 1-1h4z"/></svg>',
    settings: '<svg viewBox="0 0 24 24"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="10" cy="17" r="2.2"/></svg>'
  };

  function render() {
    // Keep keyboard focus on the same rail button across re-renders.
    const focused = rail.contains(document.activeElement) ? (document.activeElement.dataset.panel || document.activeElement.dataset.action) : null;
    const list = [...panels.values()].sort((a, b) => (a.order ?? 50) - (b.order ?? 50));
    rail.innerHTML = `
      <div class="rail-line"></div>
      <nav class="rail-icons">
        ${list.map(p => `<button class="rail-btn${p.id === active ? ' active' : ''}" data-panel="${p.id}" aria-label="${p.title}">
          ${p.icon || ICONS[p.id] || ICONS.plugins}<span class="rail-tip">${p.title}${p.hint ? `<kbd>${p.hint}</kbd>` : ''}</span></button>`).join('')}
        <div class="rail-spacer"></div>
        <button class="rail-btn" data-action="settings" aria-label="Settings">${ICONS.settings}<span class="rail-tip">Settings</span></button>
      </nav>`;
    if (focused) rail.querySelector(`[data-panel="${focused}"], [data-action="${focused}"]`)?.focus();
  }

  rail.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.action === 'settings') { close(); host.run('settings.open'); return; }
    toggle(b.dataset.panel);
    // Opened from the keyboard (Enter/Space): move into the panel.
    if (e.detail === 0 && active) focusDrawer();
  });

  // ─── Keyboard: the rail and the drawer are "zones" next to the panes ───

  const railButtons = () => [...rail.querySelectorAll('.rail-btn')];

  function focusRail() {
    rail.classList.add('kbd');
    const btns = railButtons();
    (btns.find(b => b.classList.contains('active')) || btns[0])?.focus();
  }

  function focusDrawer() {
    const panel = active && mounted.get(active);
    if (!panel) return focusRail();
    const def = panels.get(active);
    const target = (def.focus && panel.querySelector(def.focus))
      || panel.querySelector('.drawer-content textarea:not([disabled]), .drawer-content input:not([type="checkbox"]):not([type="range"]):not([type="hidden"])')
      || panel.querySelector('.drawer-content button, .drawer-content [tabindex="0"]')
      || panel.querySelector('.drawer-close');
    target?.focus();
  }

  // Entering the sidebar from the leftmost pane.
  function enter() {
    if (active) focusDrawer(); else focusRail();
  }

  // Ctrl+Shift+arrow while focus is in the rail or the drawer.
  function navigate(zone, dir) {
    if (zone === 'rail') {
      const btns = railButtons();
      const i = btns.indexOf(document.activeElement);
      if (dir === 'up' || dir === 'down') btns[(i + (dir === 'down' ? 1 : -1) + btns.length) % btns.length]?.focus();
      else if (dir === 'right') { if (active) focusDrawer(); else host.focusPanes(); }
    } else if (zone === 'drawer') {
      if (dir === 'left') focusRail();
      else if (dir === 'right') host.focusPanes();
    }
  }

  rail.addEventListener('keydown', e => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') navigate('rail', e.key === 'ArrowDown' ? 'down' : 'up');
    else if (e.key === 'ArrowRight') navigate('rail', 'right');
    else if (e.key === 'Escape') host.focusPanes();
    else return;
    e.preventDefault();
  });
  rail.addEventListener('focusout', e => {
    if (!rail.contains(e.relatedTarget)) rail.classList.remove('kbd');
  });

  function register(def) {
    if (!def || !def.id) throw new Error('Sidebar.register: missing id');
    panels.set(def.id, def);
    render();
    return () => { if (active === def.id) close(); panels.delete(def.id); mounted.get(def.id)?.remove(); mounted.delete(def.id); render(); };
  }

  function mount(def) {
    if (mounted.has(def.id)) return mounted.get(def.id);
    const el = document.createElement('section');
    el.className = 'drawer-panel';
    el.dataset.panel = def.id;
    el.innerHTML = `
      <header class="drawer-head">
        <span class="drawer-icon">${def.icon || ICONS[def.id] || ICONS.plugins}</span>
        <span class="drawer-title">${def.title}</span>
        <span class="drawer-actions"></span>
        <button class="drawer-close" title="Close (Esc)"><svg viewBox="0 0 12 12" width="12" height="12"><path d="m3 3 6 6M9 3l-6 6" stroke="currentColor" stroke-width="1.4"/></svg></button>
      </header>
      <div class="drawer-content"></div>`;
    el.querySelector('.drawer-close').addEventListener('click', close);
    drawer.appendChild(el);
    mounted.set(def.id, el);
    try {
      def.render(el.querySelector('.drawer-content'), host, el.querySelector('.drawer-actions'));
    } catch (e) {
      console.error(e);
      el.querySelector('.drawer-content').innerHTML = `<p class="p-empty">This panel crashed: ${e.message}</p>`;
    }
    return el;
  }

  function open(id, arg) {
    const def = panels.get(id);
    if (!def) return;
    if (active && active !== id) panels.get(active)?.onClose?.();
    const el = mount(def);
    mounted.forEach((m, key) => m.classList.toggle('active', key === id));
    document.documentElement.style.setProperty('--drawer-w', `${def.width || 360}px`);
    document.body.classList.add('drawer-open');
    active = id;
    render();
    def.onOpen?.(arg, el);
  }

  function close() {
    if (!active) return;
    panels.get(active)?.onClose?.();
    active = null;
    document.body.classList.remove('drawer-open');
    render();
    host?.refocus();
  }

  function toggle(id, arg) {
    if (active === id) close(); else open(id, arg);
  }

  // Escape inside the drawer closes it (the terminal keeps its own Escape).
  drawer.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !e.defaultPrevented) { e.stopPropagation(); close(); }
  });

  window.Sidebar = {
    ICONS,
    init(h) { host = h; render(); },
    register,
    open,
    close,
    toggle,
    enter,
    navigate,
    active: () => active,
    isOpen: () => !!active
  };

  // Built-in panels call this before the app starts.
  window.LumenPanels = window.LumenPanels || [];
})();
