// Session restore: each window sends a snapshot of its workspaces (layout tree, shell and
// folder of every pane) whenever it changes. The snapshots of the windows still open when
// Lumen quits are written to ~/.lumen/data/session.json and reopened at the next start.
const store = require('./store');

const NAME = 'session';
const live = new Map(); // webContents id -> snapshot
let timer = null;

function valid(snap) {
  return snap && typeof snap === 'object' && Array.isArray(snap.workspaces);
}

function save() {
  clearTimeout(timer);
  timer = null;
  try { store.set(NAME, { version: 1, savedAt: Date.now(), windows: [...live.values()] }); } catch {}
}

function update(wcId, snap) {
  if (!valid(snap)) return;
  live.set(wcId, snap);
  clearTimeout(timer);
  timer = setTimeout(save, 1000);
}

// A window the user closes while others stay open is gone for good.
function forget(wcId) {
  if (!live.delete(wcId)) return;
  clearTimeout(timer);
  timer = setTimeout(save, 300);
}

// Snapshots to reopen at startup (read once).
function load() {
  const data = store.get(NAME);
  return Array.isArray(data?.windows) ? data.windows.filter(valid) : [];
}

// The latest snapshot of a window, so a page reload keeps its layout.
function current(wcId) {
  return live.get(wcId) || null;
}

function flush() {
  if (timer) save();
}

module.exports = { update, forget, load, current, flush, save };
