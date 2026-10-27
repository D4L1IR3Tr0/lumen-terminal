// Plugin management: list with metadata, enable/disable, install, remove.
// A plugin is a .js file in ~/.lumen/plugins; a leading "_" disables it.
// Header metadata (optional):  // @name …  // @description …  // @version …  // @author …
const fs = require('fs');
const path = require('path');
const { paths } = require('./config');

const FILE = /^_?[\w.-]+\.js$/;
const MAX_SIZE = 1024 * 1024;

function meta(code) {
  const out = {};
  for (const line of code.split('\n').slice(0, 40)) {
    const m = line.match(/^\s*\/\/\s*@(\w+)\s+(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function describe(file, code, extra) {
  const m = meta(code);
  const id = file.replace(/^_/, '').replace(/\.js$/, '');
  return {
    file,
    id,
    name: m.name || id,
    description: m.description || '',
    version: m.version || '',
    author: m.author || '',
    permissions: (m.permissions || '').split(/[\s,]+/).filter(Boolean),
    size: code.length,
    ...extra
  };
}

// Built-in plugins first (enabled unless config.builtinPlugins.<id> is false), then the user's.
function list(cfg = null) {
  const switches = cfg?.builtinPlugins || {};
  let builtin = [];
  try { builtin = fs.readdirSync(paths.builtinPlugins).filter(f => f.endsWith('.js')).sort(); } catch {}
  let files = [];
  try { files = fs.readdirSync(paths.plugins).filter(f => FILE.test(f)).sort(); } catch {}
  return [
    ...builtin.map(file => {
      const id = file.replace(/\.js$/, '');
      return describe(file, fs.readFileSync(path.join(paths.builtinPlugins, file), 'utf8'), { builtin: true, enabled: switches[id] !== false });
    }),
    ...files.map(file => describe(file, fs.readFileSync(path.join(paths.plugins, file), 'utf8'), { builtin: false, enabled: !file.startsWith('_') }))
  ];
}

function readBuiltin(file) {
  if (!/^[\w.-]+\.js$/.test(file)) throw new Error('invalid plugin name');
  return fs.readFileSync(path.join(paths.builtinPlugins, file), 'utf8');
}

function safe(file) {
  if (!FILE.test(file)) throw new Error('invalid plugin name');
  return path.join(paths.plugins, file);
}

function read(file) {
  return fs.readFileSync(safe(file), 'utf8');
}

function toggle(file) {
  const from = safe(file);
  const to = safe(file.startsWith('_') ? file.slice(1) : `_${file}`);
  fs.renameSync(from, to);
  return path.basename(to);
}

function remove(file) {
  fs.unlinkSync(safe(file));
}

// Installs code under `name`. New plugins arrive disabled so the user can read them first.
function install(name, code, { enabled = false } = {}) {
  const id = String(name).toLowerCase().replace(/\.js$/, '').replace(/[^\w.-]+/g, '-').replace(/^[-_.]+/, '').slice(0, 60) || 'plugin';
  if (Buffer.byteLength(code) > MAX_SIZE) throw new Error('plugin too large (1 MB max)');
  for (const f of [`${id}.js`, `_${id}.js`]) { try { fs.unlinkSync(path.join(paths.plugins, f)); } catch {} }
  const file = `${enabled ? '' : '_'}${id}.js`;
  fs.writeFileSync(path.join(paths.plugins, file), code);
  return file;
}

function installFromFile(source) {
  return install(path.basename(source), fs.readFileSync(source, 'utf8'));
}

async function installFromUrl(url) {
  if (!/^https:\/\//i.test(url)) throw new Error('only https:// URLs are accepted');
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const code = await res.text();
  if (/^\s*</.test(code)) throw new Error('this link returns a web page, not a .js file (use the "raw" URL)');
  const name = decodeURIComponent(new URL(url).pathname.split('/').pop() || 'plugin');
  return install(name, code);
}

module.exports = { list, read, readBuiltin, toggle, remove, install, installFromFile, installFromUrl };
