// @name Example
// @description Shows a command, a status bar item, a theme and a sidebar panel.
// @version 1.0.0
// @author Lumen
//
// Example plugin for Lumen.
// Files starting with "_" are ignored: rename this one to "example.js" to enable it.
// It loads instantly; editing, disabling or deleting it also applies live.
//
// A plugin receives the `lumen` object:
//   lumen.commands.register(id, { title, run, keybinding })
//   lumen.statusbar.add({ id, text, interval, onClick, title })
//   lumen.themes.register(id, theme)
//   lumen.panes.focused() / all() / create({ profile, cwd })
//       -> pane.run("ls"), pane.write(data), pane.onOutput(fn), pane.cwd, pane.term (xterm.js)
//   lumen.on('pane:created' | 'pane:focused' | 'pane:closed' | 'workspace:changed' | 'theme:changed', fn)
//   lumen.sidebar.add({ id, title, icon: '<svg…>', render(el, host) })   -> a panel in the sidebar
//   lumen.storage.get(key) / lumen.storage.set(key, data)                -> persistence (async)
//   lumen.ai.ask("question")                                              -> opens the AI assistant
//   lumen.notify(message), lumen.run(commandId), lumen.css(text), lumen.config

module.exports = lumen => {
  // A command, listed in the palette, with a shortcut.
  lumen.commands.register('example.hello', {
    title: 'Example: say hello in the terminal',
    keybinding: 'Ctrl+Alt+B',
    run() {
      const pane = lumen.panes.focused();
      if (pane) pane.run('echo "Hello from a plugin!"');
    }
  });

  // A status bar item, refreshed every 2 s.
  lumen.statusbar.add({
    id: 'example.panes',
    title: 'Open terminals',
    interval: 2000,
    text: () => `▣ ${lumen.panes.all().length}`
  });

  // An extra theme.
  lumen.themes.register('synthwave', {
    name: 'Synthwave',
    background: '#241b2f', foreground: '#f4eeff', cursor: '#ff7edb', selectionBackground: '#463465',
    black: '#2a2139', red: '#fe4450', green: '#72f1b8', yellow: '#fede5d', blue: '#03edf9', magenta: '#ff7edb', cyan: '#03edf9', white: '#f4eeff',
    brightBlack: '#614d85', brightRed: '#fe4450', brightGreen: '#72f1b8', brightYellow: '#f3e70f', brightBlue: '#03edf9', brightMagenta: '#ff7edb', brightCyan: '#03edf9', brightWhite: '#ffffff',
    ui: { accent: '#ff7edb', accent2: '#03edf9' }
  });

  // A sidebar panel with a saved counter.
  lumen.sidebar.add({
    id: 'counter',
    title: 'Counter',
    icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    async render(el) {
      let n = (await lumen.storage.get('counter')) || 0;
      el.innerHTML = '<p>Clicks: <b></b></p><button class="s-btn">+1</button>';
      const out = el.querySelector('b');
      out.textContent = n;
      el.querySelector('button').onclick = () => { out.textContent = ++n; lumen.storage.set('counter', n); };
    }
  });

  lumen.on('pane:created', pane => console.log('new terminal', pane.id));
};
