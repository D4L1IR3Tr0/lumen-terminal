// Clipboard history: watches the system clipboard while Lumen runs.
// History lives in memory only (copied passwords never touch the disk); pinned items are
// saved by the renderer through the store.
const { clipboard } = require('electron');

const MAX = 60;
let history = [];
let last = '';
let timer = null;

// clipboard.readText() is async in recent Electron versions; awaiting also works if it isn't.
async function read() {
  try {
    const text = await clipboard.readText();
    return typeof text === 'string' ? text : '';
  } catch {
    return '';
  }
}

async function start(onChange) {
  if (timer) return;
  last = await read();
  let reading = false;
  timer = setInterval(async () => {
    if (reading) return;
    reading = true;
    const text = await read();
    reading = false;
    if (!text || text === last) return;
    last = text;
    history = [{ text, at: Date.now() }, ...history.filter(h => h.text !== text)].slice(0, MAX);
    onChange(history);
  }, 700);
}

function stop() {
  clearInterval(timer);
  timer = null;
}

function list() {
  return history;
}

function remove(text) {
  history = history.filter(h => h.text !== text);
  return history;
}

function clear() {
  history = [];
  return history;
}

module.exports = { start, stop, list, remove, clear };
