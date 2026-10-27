// @name CRT
// @description A phosphor green theme with scanlines and a soft glow over the terminals. Turn it off by disabling the plugin.
// @version 1.0.0
// @author Lumen
// @category themes

module.exports = lumen => {
  lumen.themes.register('crt-phosphor', {
    name: 'CRT Phosphor',
    background: '#050a05', foreground: '#7dff8a', cursor: '#b6ffbe', selectionBackground: '#1d3d21',
    black: '#050a05', red: '#ff6e5a', green: '#7dff8a', yellow: '#d8ff6a',
    blue: '#5ad7ff', magenta: '#c49bff', cyan: '#62ffd0', white: '#c8ffd0',
    brightBlack: '#2f5a33', brightRed: '#ff8e7d', brightGreen: '#a6ffb0', brightYellow: '#ecffa0',
    brightBlue: '#8ce4ff', brightMagenta: '#d8bcff', brightCyan: '#9affe2', brightWhite: '#ecffee',
    ui: { crust: '#020502', accent: '#7dff8a', accent2: '#d8ff6a' }
  });

  // Scanlines and a faint glow on the text, only while this theme is applied.
  lumen.css(`
    body.crt-on .pane-term { text-shadow: 0 0 4px color-mix(in srgb, #7dff8a 55%, transparent); }
    body.crt-on .pane::after {
      content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;
      background: repeating-linear-gradient(0deg, rgba(0, 0, 0, .22) 0 1px, transparent 1px 3px);
    }
  `);
  const sync = () => document.body.classList.toggle('crt-on', lumen.themes.current === 'crt-phosphor');
  lumen.on('theme:changed', sync);
  sync();

  lumen.commands.register('crt.apply', { title: 'CRT: switch to the phosphor theme', run: () => lumen.themes.apply('crt-phosphor'), keywords: 'theme retro green' });
  return () => document.body.classList.remove('crt-on');
};
