// Keyboard shortcut parsing and matching.
// A combo is matched against both the produced character (e.key) and the physical key (e.code),
// so bindings work on AZERTY as well as QWERTY layouts.
(function () {
  const ALIASES = {
    arrowleft: 'left', arrowright: 'right', arrowup: 'up', arrowdown: 'down',
    return: 'enter', esc: 'escape', ' ': 'space', spacebar: 'space',
    plus: '=', add: '=', minus: '-', subtract: '-', comma: ',', period: '.', del: 'delete'
  };

  const CODES = {
    Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';',
    Quote: "'", BracketLeft: '[', BracketRight: ']', Backquote: '`', NumpadAdd: '=', NumpadSubtract: '-',
    NumpadEnter: 'enter'
  };

  const MODS = ['ctrl', 'alt', 'shift', 'meta'];

  function normKey(k) {
    const l = k.toLowerCase();
    return ALIASES[l] || l;
  }

  function parse(combo) {
    if (!combo) return null;
    const parts = combo.split('+').map(s => s.trim()).filter(Boolean);
    // "Ctrl++" style: trailing empty part means the key is "+"
    if (combo.endsWith('++')) parts.push('=');
    const mods = new Set();
    let key = null;
    for (const p of parts) {
      const l = p.toLowerCase();
      if (l === 'control' || l === 'ctrl') mods.add('ctrl');
      else if (l === 'option' || l === 'alt') mods.add('alt');
      else if (l === 'shift') mods.add('shift');
      else if (l === 'cmd' || l === 'super' || l === 'win' || l === 'meta') mods.add('meta');
      else key = normKey(p);
    }
    if (!key) return null;
    return MODS.filter(m => mods.has(m)).concat(key).join('+');
  }

  function codeKey(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad\d$/.test(code)) return code.slice(6);
    if (/^F\d{1,2}$/.test(code)) return code.toLowerCase();
    return CODES[code] || normKey(code);
  }

  // Returns the candidate combo strings for a keyboard event.
  function fromEvent(e) {
    if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return [];
    const mods = [];
    if (e.ctrlKey) mods.push('ctrl');
    if (e.altKey) mods.push('alt');
    if (e.shiftKey) mods.push('shift');
    if (e.metaKey) mods.push('meta');
    const prefix = mods.length ? mods.join('+') + '+' : '';
    // Character first (what the user sees on the keycap), then the physical key as a fallback
    // for digits/punctuation (Alt+1 on AZERTY produces "&"). Letters never fall back to the
    // physical key, otherwise Ctrl+Shift+Z on AZERTY would also match Ctrl+Shift+W.
    const out = [];
    if (e.key && e.key !== 'Unidentified') out.push(prefix + normKey(e.key));
    if (!/^Key[A-Z]$/.test(e.code)) out.push(prefix + codeKey(e.code));
    return [...new Set(out)];
  }

  // Pretty label for UI hints: "Ctrl+Shift+Enter" -> ["Ctrl", "⇧", "↵"]
  const PRETTY = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win', enter: '↵', left: '←', right: '→', up: '↑', down: '↓', escape: 'Esc', tab: 'Tab', space: 'Space' };
  function pretty(combo) {
    const p = parse(combo);
    if (!p) return [];
    return p.split('+').map(k => PRETTY[k] || (k.length === 1 ? k.toUpperCase() : k.toUpperCase()));
  }

  window.Keys = { parse, fromEvent, pretty };
})();
