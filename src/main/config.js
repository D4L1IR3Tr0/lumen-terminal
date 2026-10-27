// User configuration: ~/.lumen/{config.jsonc, themes/, plugins/, state.json}
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// LUMEN_HOME lets tests and portable setups use another folder.
const DIR = process.env.LUMEN_HOME || path.join(os.homedir(), '.lumen');
const paths = {
  home: os.homedir(),
  dir: DIR,
  builtinPlugins: path.join(ROOT, 'builtin-plugins'),
  config: path.join(DIR, 'config.jsonc'),
  themes: path.join(DIR, 'themes'),
  plugins: path.join(DIR, 'plugins'),
  // Downloadable content lives in its own folders (the website will drop files there too).
  backgrounds: path.join(DIR, 'backgrounds'),
  fonts: path.join(DIR, 'fonts'),
  state: path.join(DIR, 'state.json'),
  defaults: path.join(ROOT, 'defaults')
};

// Strips // and /* */ comments plus trailing commas, leaving string contents intact.
function parseJSONC(text) {
  text = text.replace(/^﻿/, ''); // editors on Windows sometimes add a BOM
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (inString) {
      out += c;
      if (c === '\\') { out += n; i++; }
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObject(v) && isObject(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function copyIfMissing(src, dest) {
  if (!fs.existsSync(dest) && fs.existsSync(src)) fs.copyFileSync(src, dest);
}

function ensure() {
  for (const d of [paths.dir, paths.themes, paths.plugins, paths.backgrounds, paths.fonts]) fs.mkdirSync(d, { recursive: true });
  copyIfMissing(path.join(paths.defaults, 'config.jsonc'), paths.config);
  copyIfMissing(path.join(paths.defaults, 'plugins', '_example.js'), path.join(paths.plugins, '_example.js'));
  copyIfMissing(path.join(paths.defaults, 'plugins', 'README.md'), path.join(paths.plugins, 'README.md'));
  copyIfMissing(path.join(paths.defaults, 'themes', 'example-theme.json.txt'), path.join(paths.themes, 'example-theme.json.txt'));
  writeAgentGuides();
}

// AI CLIs read their instructions from a file in the folder they start in: AGENTS.md (Codex,
// Mistral Vibe…), CLAUDE.md (Claude Code), GEMINI.md (Gemini CLI). Lumen launches them in this
// folder, so they all learn how to customize it. Files a user wrote themselves are left alone.
function writeAgentGuides() {
  const guide = fs.readFileSync(path.join(paths.defaults, 'AGENTS.md'), 'utf8');
  for (const name of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const target = path.join(paths.dir, name);
    let current = null;
    try { current = fs.readFileSync(target, 'utf8'); } catch {}
    if (current === null || (current.startsWith('<!-- lumen-generated') && current !== guide)) fs.writeFileSync(target, guide);
  }
}

const defaults = parseJSONC(fs.readFileSync(path.join(paths.defaults, 'config.jsonc'), 'utf8'));

function load() {
  try {
    const user = parseJSONC(fs.readFileSync(paths.config, 'utf8'));
    return { config: deepMerge(defaults, user), error: null };
  } catch (e) {
    return { config: defaults, error: `config.jsonc: ${e.message}` };
  }
}

function loadThemes() {
  const themes = {};
  for (const file of safeList(paths.themes)) {
    if (!file.endsWith('.json')) continue;
    try {
      const t = parseJSONC(fs.readFileSync(path.join(paths.themes, file), 'utf8'));
      themes[path.basename(file, '.json')] = t;
    } catch (e) {
      console.error(`theme ${file}:`, e.message);
    }
  }
  return themes;
}

// Plugins are plain .js files. A leading underscore disables a plugin.
// "// @permissions clipboard, notifications" in a plugin header.
function pluginPermissions(code) {
  const m = code.slice(0, 2000).match(/^\s*\/\/\s*@permissions\s+(.+)$/m);
  return m ? m[1].split(/[\s,]+/).filter(Boolean) : [];
}

// Built-in plugins ship with Lumen (enabled unless config.builtinPlugins.<name> is false);
// user plugins come from ~/.lumen/plugins. A user plugin with the same name replaces the
// built-in one.
function loadPlugins(cfg = null) {
  const switches = cfg?.builtinPlugins || {};
  const user = safeList(paths.plugins)
    .filter(f => f.endsWith('.js') && !f.startsWith('_'))
    .map(f => {
      const code = fs.readFileSync(path.join(paths.plugins, f), 'utf8');
      return { name: path.basename(f, '.js'), code, builtin: false, permissions: pluginPermissions(code) };
    });
  const taken = new Set(user.map(p => p.name));
  const builtin = safeList(paths.builtinPlugins)
    .filter(f => f.endsWith('.js'))
    .map(f => path.basename(f, '.js'))
    .filter(name => switches[name] !== false && !taken.has(name))
    .map(name => {
      const code = fs.readFileSync(path.join(paths.builtinPlugins, `${name}.js`), 'utf8');
      return { name, code, builtin: true, permissions: pluginPermissions(code) };
    });
  return [...builtin, ...user];
}

function safeList(dir) {
  try { return fs.readdirSync(dir).sort(); } catch { return []; }
}

// Walks a JSONC document and records the [start, end) span of every value by key path,
// so single values can be rewritten without losing the user's comments and layout.
function spans(text) {
  const out = new Map();
  let i = 0;
  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i])) i++;
      if (text.startsWith('//', i)) { while (i < text.length && text[i] !== '\n') i++; }
      else if (text.startsWith('/*', i)) { const e = text.indexOf('*/', i + 2); i = e < 0 ? text.length : e + 2; }
      else return;
    }
  };
  const str = () => {
    const s = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    i++;
    return JSON.parse(text.slice(s, i));
  };
  const value = path => {
    skip();
    const start = i;
    if (text[i] === '{' || text[i] === '[') {
      const obj = text[i] === '{';
      i++;
      let index = 0;
      for (;;) {
        skip();
        if (text[i] === (obj ? '}' : ']')) { i++; break; }
        if (obj) {
          const key = str();
          skip();
          i++; // ':'
          value([...path, key]);
        } else {
          value([...path, index++]);
        }
        skip();
        if (text[i] === ',') i++;
        else if (i >= text.length) break;
      }
    } else if (text[i] === '"') {
      str();
    } else {
      while (i < text.length && !/[\s,}\]/]/.test(text[i])) i++;
    }
    out.set(path.join('\u0000'), { start, end: i });
  };
  value([]);
  return out;
}

// Sets `keyPath` (e.g. ['window', 'gap']) in the user's config.jsonc, preserving everything else.
function setValue(keyPath, val) {
  let text = fs.readFileSync(paths.config, 'utf8').replace(/^﻿/, '');
  const map = spans(text);
  const hit = map.get(keyPath.join('\u0000'));
  if (hit) {
    text = text.slice(0, hit.start) + JSON.stringify(val) + text.slice(hit.end);
  } else {
    // Insert into the deepest existing parent object, nesting the missing keys.
    let depth = keyPath.length - 1;
    while (depth > 0 && !map.has(keyPath.slice(0, depth).join('\u0000'))) depth--;
    const parent = map.get(keyPath.slice(0, depth).join('\u0000'));
    let nested = val;
    for (let k = keyPath.length - 1; k > depth; k--) nested = { [keyPath[k]]: nested };
    const lineStart = text.lastIndexOf('\n', parent.start) + 1;
    const indent = text.slice(lineStart).match(/^\s*/)[0] + '  ';
    const body = JSON.stringify(nested, null, 2).replace(/\n/g, '\n' + indent);
    const inner = text.slice(parent.start + 1, parent.end - 1).replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').trim();
    const entry = `\n${indent}${JSON.stringify(keyPath[depth])}: ${body}${inner ? ',' : ''}`;
    // An empty "{}" becomes a properly indented block instead of "{ …}".
    const rest = /^\s*$/.test(text.slice(parent.start + 1, parent.end - 1)) ? `\n${indent.slice(2)}}` + text.slice(parent.end) : text.slice(parent.start + 1);
    text = text.slice(0, parent.start + 1) + entry + rest;
  }
  parseJSONC(text); // never write a file we cannot read back
  fs.writeFileSync(paths.config, text);
}

function setTheme(id) {
  setValue(['theme'], id);
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(paths.state, 'utf8')); } catch { return {}; }
}

function saveState(state) {
  try { fs.writeFileSync(paths.state, JSON.stringify(state, null, 2)); } catch {}
}

// Calls `cb` (debounced) whenever anything under ~/.lumen changes.
function watch(cb) {
  let timer = null;
  const fire = (_event, file) => {
    if (file === 'state.json') return;
    clearTimeout(timer);
    timer = setTimeout(cb, 150);
  };
  for (const d of [paths.dir, paths.themes, paths.plugins]) {
    try { fs.watch(d, fire); } catch {}
  }
}

module.exports = { paths, ensure, load, loadThemes, loadPlugins, pluginPermissions, setTheme, setValue, loadState, saveState, watch };
