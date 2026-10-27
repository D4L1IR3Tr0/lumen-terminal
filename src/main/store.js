// Small JSON documents under ~/.lumen/data (notes, favourite folders, aliases…) and
// secrets encrypted with the OS keychain (Electron safeStorage).
const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');
const { paths } = require('./config');

const DATA = path.join(paths.dir, 'data');
const NAME = /^[a-z0-9][a-z0-9-]{0,40}$/;
const listeners = new Set();

function file(name) {
  if (!NAME.test(name)) throw new Error(`invalid storage name: ${name}`);
  return path.join(DATA, `${name}.json`);
}

function get(name, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file(name), 'utf8')); } catch { return fallback; }
}

function set(name, data, origin = null) {
  fs.mkdirSync(DATA, { recursive: true });
  const target = file(name);
  // Write-then-rename so a crash never leaves a half-written file.
  fs.writeFileSync(target + '.tmp', JSON.stringify(data, null, 2));
  fs.renameSync(target + '.tmp', target);
  for (const fn of listeners) fn(name, data, origin);
}

function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const SECRETS = () => path.join(DATA, 'secrets.bin');

function readSecrets() {
  try {
    const raw = fs.readFileSync(SECRETS());
    return JSON.parse(safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf8'));
  } catch {
    return {};
  }
}

function getSecret(key) {
  return readSecrets()[key] || null;
}

function setSecret(key, value) {
  const all = readSecrets();
  if (value) all[key] = value; else delete all[key];
  fs.mkdirSync(DATA, { recursive: true });
  const json = JSON.stringify(all);
  fs.writeFileSync(SECRETS(), safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : json);
}

module.exports = { DATA, get, set, onChange, getSecret, setSecret };
