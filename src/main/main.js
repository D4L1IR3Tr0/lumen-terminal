const { app, BrowserWindow, ipcMain, shell, clipboard, screen, session, Notification } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pty = require('@lydell/node-pty');
const config = require('./config');
const shells = require('./shells');
const git = require('./git');
const github = require('./github');
const stats = require('./stats');
const store = require('./store');
const clipboardWatch = require('./clipboard-watch');
const aliases = require('./aliases');
const plugins = require('./plugins');
const ai = require('./ai');
const agents = require('./agents');
const acp = require('./acp');
const sessions = require('./session');
const updates = require('./updates');
const builtinThemes = require('../shared/themes');

const ICON = path.join(__dirname, '..', '..', 'assets', 'icon.png');
const ICON_ICO = path.join(__dirname, '..', '..', 'assets', 'icon.ico');
const APP_ID = 'dev.lumen.terminal';
// How Windows starts Lumen again from a pinned taskbar button (not bare electron.exe).
const RELAUNCH = app.isPackaged ? `"${process.execPath}"` : `"${process.execPath}" "${app.getAppPath()}"`;
const ptys = new Map(); // id -> { proc, wc }
const pendingRestore = new Map(); // webContents id -> session snapshot to reopen
let nextPtyId = 1;

// ─── Windows ──────────────────────────────────────────────────────────

function themeBackground(cfg) {
  const t = builtinThemes[cfg.theme] || config.loadThemes()[cfg.theme] || builtinThemes.gruvbox;
  return t.ui?.crust || t.background || '#000000';
}

function initialBounds() {
  const state = config.loadState();
  const others = BrowserWindow.getAllWindows();
  if (others.length) {
    const b = others[0].getBounds();
    return { bounds: { x: b.x + 32, y: b.y + 32, width: b.width, height: b.height }, maximized: false };
  }
  const saved = state.bounds;
  const visible = saved && screen.getAllDisplays().some(d => {
    const a = d.workArea;
    return saved.x < a.x + a.width && saved.x + saved.width > a.x && saved.y < a.y + a.height && saved.y + saved.height > a.y;
  });
  return { bounds: visible ? saved : { width: 1240, height: 780 }, maximized: !!state.maximized };
}

function createWindow(restore = null) {
  const { config: cfg } = config.load();
  const { bounds, maximized } = initialBounds();
  const material = materialOf(cfg);
  const translucent = material !== 'none';

  const win = new BrowserWindow({
    ...bounds,
    minWidth: 520,
    minHeight: 340,
    // macOS keeps its native traffic lights, inset in Lumen's bar; elsewhere Lumen draws its own.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 11 } }
      : { frame: false }),
    show: false,
    title: 'Lumen',
    ...(fs.existsSync(ICON) ? { icon: ICON } : {}),
    backgroundColor: translucent ? '#00000000' : themeBackground(cfg),
    ...(translucent ? { backgroundMaterial: material } : {}),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.once('ready-to-show', () => {
    if (maximized) win.maximize();
    win.show();
  });

  // Taskbar identity: the pinned button keeps Lumen's icon and relaunches Lumen itself.
  if (process.platform === 'win32') {
    win.setAppDetails({ appId: APP_ID, appIconPath: ICON_ICO, appIconIndex: 0, relaunchCommand: RELAUNCH, relaunchDisplayName: 'Lumen' });
  }

  const sendMax = () => !win.isDestroyed() && win.webContents.send('win:maximized', win.isMaximized());
  win.on('focus', () => win.flashFrame(false));
  win.on('maximize', sendMax);
  win.on('unmaximize', sendMax);

  win.on('close', () => {
    // Closing one window among several forgets it; the last one is kept for the next start.
    if (!quitting && BrowserWindow.getAllWindows().length > 1) sessions.forget(win.webContents.id);
    if (BrowserWindow.getAllWindows().length === 1) {
      config.saveState({ bounds: win.getNormalBounds(), maximized: win.isMaximized() });
    }
  });

  const wc = win.webContents;
  if (restore) pendingRestore.set(wc.id, restore);
  // A reload (or the window closing) leaves the page's shells without a terminal: end them.
  const killOwned = () => { for (const [id, p] of ptys) if (p.wc === wc) killPty(id); };
  wc.on('destroyed', killOwned);
  wc.on('did-start-loading', killOwned);
  // Links clicked inside the page open in the user's browser, never in the app.
  wc.setWindowOpenHandler(({ url }) => {
    openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', e => e.preventDefault());

  devHarness(win);
  return win;
}

// LUMEN_SCREENSHOT=out.png [LUMEN_SCRIPT="js"] : run a script in the page, capture it, quit.
function devHarness(win) {
  const out = process.env.LUMEN_SCREENSHOT;
  if (!out) return;
  win.webContents.on('console-message', e => console.log(`[renderer] ${e.message}`));
  win.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 2500));
    let script = process.env.LUMEN_SCRIPT;
    if (script && fs.existsSync(script)) script = fs.readFileSync(script, 'utf8');
    if (script) {
      try { await win.webContents.executeJavaScript(script); } catch (e) { console.error(e); }
      await new Promise(r => setTimeout(r, 2500));
    }
    const img = await win.webContents.capturePage();
    fs.writeFileSync(out, img.toPNG());
    stats.stop();
    app.exit(0);
  });
}

function openExternal(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

function takeRestore(wcId) {
  const snap = pendingRestore.get(wcId) || sessions.current(wcId);
  pendingRestore.delete(wcId);
  return snap;
}

function broadcast(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
}

async function initPayload(wcId = null) {
  const { config: cfg, error } = config.load();
  return {
    config: cfg,
    error,
    themes: config.loadThemes(),
    plugins: config.loadPlugins(cfg),
    shells: await shells.profiles(cfg),
    paths: config.paths,
    platform: process.platform,
    osBuild: Number(os.release().split('.')[2]) || 0,
    version: app.getVersion(),
    // The session this window should reopen (or its own, after a reload).
    restore: wcId == null ? null : takeRestore(wcId),
    // The dev screenshot harness always starts with a terminal, even on a fresh profile.
    harness: !!process.env.LUMEN_SCREENSHOT && !process.env.LUMEN_TEST_FIRST_LAUNCH
  };
}

// ─── PTY ──────────────────────────────────────────────────────────────

async function spawnPty(wc, { profile: profileId, cols, rows, cwd }) {
  const { config: cfg } = config.load();
  const profiles = await shells.profiles(cfg);
  const wanted = profileId && profileId !== 'auto' ? profileId : cfg.shells.default;
  const profile = profiles.find(p => p.id === wanted) || profiles[0];

  const integration = cfg.behavior.shellIntegration !== false;
  const dir = cwd && !cwd.startsWith('/') && fs.existsSync(cwd) ? cwd : os.homedir();
  // Where this shell writes its aliases at each prompt, for the Aliases panel.
  const liveAliasFile = path.join(aliases.LIVE_DIR, `${process.pid}-${nextPtyId}-${Date.now().toString(36)}.${profile.kind === 'powershell' ? 'json' : 'txt'}`);
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TERM_PROGRAM: 'Lumen',
    ...shells.spawnEnv(profile, integration, { ...aliasExtras(), liveAliasFile }),
    ...(profile.env || {})
  };
  const opts = { name: 'xterm-256color', cols: cols || 80, rows: rows || 24, cwd: dir, env };
  const args = shells.spawnArgs(profile, integration, cwd, aliasExtras());

  let proc;
  try {
    proc = pty.spawn(profile.command, args, { ...opts, useConptyDll: process.platform === 'win32' });
  } catch {
    proc = pty.spawn(profile.command, args, opts);
  }

  const id = wirePty(proc, wc, { profile, liveAliasFile });
  return { id, profile: { id: profile.id, name: profile.name, kind: profile.kind }, cwd: dir };
}

// Registers a pty and streams it to its window (one IPC message per tick of output).
function wirePty(proc, wc, extra = {}) {
  const id = nextPtyId++;
  ptys.set(id, { proc, wc, ...extra });
  let buffer = '';
  let scheduled = false;
  const flush = () => {
    scheduled = false;
    if (buffer && !wc.isDestroyed()) wc.send('pty:data', id, buffer);
    buffer = '';
  };
  proc.onData(data => {
    buffer += data;
    if (!scheduled) { scheduled = true; setImmediate(flush); }
  });
  proc.onExit(({ exitCode }) => {
    flush();
    ptys.delete(id);
    if (extra.liveAliasFile) fs.rm(extra.liveAliasFile, { force: true }, () => {});
    if (!wc.isDestroyed()) wc.send('pty:exit', id, exitCode);
  });
  return id;
}

// A command an embedded agent runs (ACP terminal/create): its own pty, shown in a pane of the
// agent's window so the user sees everything it does.
function openAgentTerminal(wc, { command, args, cwd, env, title }) {
  const win = process.platform === 'win32';
  let file = command;
  let argv = args;
  if (!args.length && /\s/.test(command)) {
    // A whole command line: run it through a shell.
    if (win) { file = 'powershell.exe'; argv = ['-NoLogo', '-NoProfile', '-Command', command]; }
    else { file = process.env.SHELL || '/bin/sh'; argv = ['-lc', command]; }
  } else {
    const exe = path.isAbsolute(command) ? command : shells.findCommand(command) || command;
    if (win && /\.(cmd|bat)$/i.test(exe)) { file = process.env.ComSpec || 'cmd.exe'; argv = ['/d', '/c', exe, ...args]; }
    else file = exe;
  }
  const dir = cwd && fs.existsSync(cwd) ? cwd : os.homedir();
  const opts = { name: 'xterm-256color', cols: 110, rows: 30, cwd: dir, env: { ...process.env, ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor', TERM_PROGRAM: 'Lumen' } };
  let proc;
  try { proc = pty.spawn(file, argv, { ...opts, useConptyDll: win }); } catch { proc = pty.spawn(file, argv, opts); }
  const ptyId = wirePty(proc, wc, { agent: true });
  wc.send('acp:terminal', { ptyId, title, command: [command, ...args].join(' '), cwd: dir });
  return {
    ptyId,
    onData: fn => proc.onData(fn),
    onExit: fn => proc.onExit(({ exitCode }) => fn(exitCode)),
    kill: () => { try { proc.kill(); } catch {} }
  };
}

function aliasExtras() {
  return {
    psAliases: aliases.powershellDefinitions(),
    bashAliasFile: kind => aliases.bashFile(kind),
    doskeyFile: aliases.doskeyFile(),
    zshDir: () => aliases.zshDir()
  };
}

function killPty(id) {
  const p = ptys.get(id);
  if (!p) return;
  ptys.delete(id);
  try { p.proc.kill(); } catch {}
}

// ─── IPC ──────────────────────────────────────────────────────────────

ipcMain.handle('app:init', e => initPayload(e.sender.id));
ipcMain.on('session:update', (e, snap) => sessions.update(e.sender.id, snap));

// A long command finished while Lumen was in the background: desktop notification + taskbar flash.
ipcMain.on('notify', (e, { title, body, paneId } = {}) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  if (!win.isFocused()) win.flashFrame(true);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: String(title || 'Lumen'), body: String(body || ''), silent: false });
  n.on('click', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    e.sender.send('notify:click', paneId);
  });
  n.show();
});
ipcMain.handle('pty:spawn', (e, opts) => spawnPty(e.sender, opts));
ipcMain.on('pty:write', (_e, id, data) => ptys.get(id)?.proc.write(data));
ipcMain.on('pty:resize', (_e, id, cols, rows) => {
  try { if (cols > 0 && rows > 0) ptys.get(id)?.proc.resize(cols, rows); } catch {}
});
ipcMain.on('pty:kill', (_e, id) => killPty(id));

const winOf = e => BrowserWindow.fromWebContents(e.sender);
ipcMain.on('win:minimize', e => winOf(e)?.minimize());
ipcMain.on('win:toggleMaximize', e => {
  const w = winOf(e);
  if (w) w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.on('win:close', e => winOf(e)?.close());
ipcMain.on('win:new', () => createWindow());
ipcMain.on('win:toggleFullscreen', e => {
  const w = winOf(e);
  if (w) w.setFullScreen(!w.isFullScreen());
});
ipcMain.on('win:reload', e => e.sender.reload());
ipcMain.on('win:devtools', e => e.sender.toggleDevTools());
ipcMain.handle('win:isMaximized', e => winOf(e)?.isMaximized() ?? false);

ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text)));

ipcMain.on('open:external', (_e, url) => openExternal(url));
// file:// links printed by programs (OSC 8) are shown in the file manager, never executed.
ipcMain.on('open:reveal', (_e, target) => {
  try {
    const file = /^file:/i.test(target) ? require('url').fileURLToPath(target) : String(target);
    if (fs.existsSync(file)) shell.showItemInFolder(file);
  } catch {}
});
ipcMain.on('open:path', (_e, which) => {
  const target = { config: config.paths.config, dir: config.paths.dir, themes: config.paths.themes, plugins: config.paths.plugins, backgrounds: config.paths.backgrounds, fonts: config.paths.fonts }[which];
  if (target) shell.openPath(target);
});
// ─── Content folders: ~/.lumen/backgrounds and ~/.lumen/fonts ──────────

const ASSET_KINDS = {
  backgrounds: /\.(png|jpe?g|webp|gif|bmp|avif)$/i,
  fonts: /\.(ttf|otf|woff2?)$/i
};

function assetDir(kind) {
  if (!ASSET_KINDS[kind]) throw new Error(`unknown content folder: ${kind}`);
  return config.paths[kind];
}

ipcMain.handle('assets:list', (_e, kind) => {
  const dir = assetDir(kind);
  let names = [];
  try { names = fs.readdirSync(dir).filter(n => ASSET_KINDS[kind].test(n)); } catch {}
  return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map(name => {
    const st = fs.statSync(path.join(dir, name));
    return { name, rel: `${kind}/${name}`, size: st.size, at: st.mtimeMs };
  });
});

// Copies a file into the folder (never moves the original); returns its "kind/name" path.
ipcMain.handle('assets:import', (_e, kind, source) => {
  const dir = assetDir(kind);
  source = String(source);
  if (!ASSET_KINDS[kind].test(source) || !fs.statSync(source).isFile()) throw new Error('unsupported file');
  const ext = path.extname(source);
  const stem = path.basename(source, ext).replace(/[^\w .()-]+/g, '-').slice(0, 80) || kind;
  let name = stem + ext;
  for (let i = 2; fs.existsSync(path.join(dir, name)); i++) {
    if (fs.statSync(path.join(dir, name)).size === fs.statSync(source).size) break; // same file already there
    name = `${stem} (${i})${ext}`;
  }
  if (!fs.existsSync(path.join(dir, name))) fs.copyFileSync(source, path.join(dir, name));
  return `${kind}/${name}`;
});

ipcMain.handle('assets:remove', (_e, kind, name) => {
  const file = path.join(assetDir(kind), path.basename(String(name)));
  if (ASSET_KINDS[kind].test(file) && fs.existsSync(file)) fs.unlinkSync(file);
});

// A resized JPEG of an image as a data URL, for the canvas styles (dither, ASCII): a data URL
// never taints the canvas, and the background never needs more than a screen's width.
ipcMain.handle('image:sample', (_e, file, width = 1280) => {
  const { nativeImage } = require('electron');
  let img = nativeImage.createFromPath(String(file));
  if (img.isEmpty()) return null;
  const size = img.getSize();
  if (size.width > width) img = img.resize({ width: Math.round(width), quality: 'good' });
  return `data:image/jpeg;base64,${img.toJPEG(88).toString('base64')}`;
});

ipcMain.handle('config:setTheme', (_e, id) => config.setTheme(String(id)));
ipcMain.handle('config:set', (_e, keyPath, value) => {
  if (!Array.isArray(keyPath) || !keyPath.every(k => typeof k === 'string')) return;
  config.setValue(keyPath, value);
});
ipcMain.handle('git:status', (_e, cwd) => git.status(typeof cwd === 'string' ? cwd : null));
// Repository operations for the built-in Git plugin (fixed git commands, see git.js).
ipcMain.handle('git:op', (_e, op, ...args) => {
  if (!Object.hasOwn(git.repo, op)) throw new Error(`unknown git operation: ${op}`);
  return git.repo[op](...args);
});
ipcMain.handle('github:status', () => github.status());
ipcMain.handle('github:get', (_e, pathname) => github.get(pathname));
ipcMain.handle('github:contributions', () => github.contributions());
ipcMain.handle('github:setToken', (_e, token) => github.setToken(token));
ipcMain.handle('github:signOut', () => github.signOut());
ipcMain.handle('github:refresh', () => github.refresh());

// ─── Sidebar tools: storage, clipboard, folders, aliases, plugins, AI ─

ipcMain.handle('store:get', (_e, name) => store.get(String(name)));
ipcMain.handle('store:set', (e, name, data) => store.set(String(name), data, e.sender.id));
store.onChange((name, data, origin) => {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.webContents.id !== origin) w.webContents.send('store:changed', name, data);
  }
});

ipcMain.handle('clipboard:history', () => clipboardWatch.list());
ipcMain.handle('clipboard:remove', (_e, text) => clipboardWatch.remove(String(text)));
ipcMain.handle('clipboard:clear', () => clipboardWatch.clear());

// Directory listing for Lumen's own file picker (no native OS dialogs).
// An empty path lists the drives on Windows, "/" elsewhere.
ipcMain.handle('fs:list', (_e, dir) => {
  if (!dir) {
    if (process.platform !== 'win32') dir = '/';
    else {
      const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(l => `${l}:\\`).filter(d => fs.existsSync(d));
      return { dir: '', parent: null, entries: drives.map(d => ({ name: d, dir: true })) };
    }
  }
  const full = path.resolve(String(dir));
  const entries = [];
  const list = fs.readdirSync(full, { withFileTypes: true });
  // File sizes feed the City view (block heights); skipped for huge folders to stay fast.
  const sized = list.length <= 3000;
  for (const d of list) {
    if (d.name.startsWith('$') || d.name === 'System Volume Information') continue;
    let isDir = d.isDirectory();
    if (d.isSymbolicLink()) { try { isDir = fs.statSync(path.join(full, d.name)).isDirectory(); } catch { continue; } }
    let size;
    if (!isDir && sized) { try { size = fs.statSync(path.join(full, d.name)).size; } catch {} }
    entries.push({ name: d.name, dir: isDir, hidden: d.name.startsWith('.'), size });
  }
  entries.sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  const parent = path.dirname(full);
  return { dir: full, parent: parent === full ? (process.platform === 'win32' ? '' : null) : parent, entries };
});
ipcMain.on('open:folder', (_e, dir) => {
  try { if (fs.statSync(dir).isDirectory()) shell.openPath(dir); } catch {}
});
ipcMain.handle('fs:isDir', (_e, dir) => {
  try { return fs.statSync(String(dir)).isDirectory(); } catch { return false; }
});

ipcMain.handle('aliases:list', () => aliases.list());
ipcMain.handle('aliases:save', (_e, list) => aliases.save(Array.isArray(list) ? list : []));
// Aliases of one terminal (the focused pane's), read fresh at every call.
ipcMain.handle('aliases:forPty', async (_e, id) => {
  const rec = ptys.get(id);
  if (!rec) return null;
  const { kind, command, name } = rec.profile;
  return { shell: name, kind, ...(await aliases.forTerminal({ kind, command, name }, rec.liveAliasFile)) };
});
ipcMain.handle('aliases:detect', async () => {
  const { config: cfg } = config.load();
  return aliases.detect(await shells.profiles(cfg));
});

ipcMain.handle('plugins:list', () => plugins.list(config.load().config));
ipcMain.handle('plugins:read', (_e, file) => plugins.read(String(file)));
ipcMain.handle('plugins:readBuiltin', (_e, file) => plugins.readBuiltin(String(file)));
ipcMain.handle('plugins:toggle', (_e, file) => plugins.toggle(String(file)));
ipcMain.handle('plugins:remove', (_e, file) => plugins.remove(String(file)));
ipcMain.handle('plugins:install', (_e, name, code, enabled) => plugins.install(String(name), String(code), { enabled: !!enabled }));
ipcMain.handle('plugins:installUrl', (_e, url) => plugins.installFromUrl(String(url)));
ipcMain.handle('update:ready', () => updates.ready());
ipcMain.on('update:install', () => updates.install());
ipcMain.handle('plugins:registry', (_e, fresh) => plugins.registry({ fresh: !!fresh }));
ipcMain.handle('plugins:installRegistry', (_e, id) => plugins.installFromRegistry(String(id)));
ipcMain.handle('plugins:installPath', (_e, file) => {
  if (typeof file !== 'string' || !file.toLowerCase().endsWith('.js')) throw new Error('pick a .js file');
  return plugins.installFromFile(file);
});

ipcMain.handle('agents:detect', () => agents.detect());

// Embedded agents (ACP): the user's own CLIs, shown in the AI panel.
acp.init({
  version: app.getVersion(),
  openTerminal: openAgentTerminal,
  nodeBinary: process.execPath,
  // Started by the agent as a plain Node process: outside the asar archive in packaged builds.
  mcpScript: path.join(__dirname, 'mcp-server.js').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)
});
ipcMain.handle('acp:list', () => acp.list());
ipcMain.handle('acp:status', e => acp.status(e.sender));
ipcMain.on('acp:start', (e, agentId, opts) => { acp.start(e.sender, String(agentId), opts || {}); });
ipcMain.on('acp:prompt', (e, text, environment) => { acp.prompt(e.sender, String(text), environment ? String(environment) : ''); });
ipcMain.on('acp:cancel', e => acp.cancel(e.sender));
ipcMain.on('acp:stop', e => acp.stop(e.sender));
ipcMain.on('acp:auto', (e, on) => acp.setAuto(e.sender, on));
ipcMain.on('acp:authenticate', (e, methodId) => acp.authenticate(e.sender, String(methodId)));
ipcMain.on('acp:mode', (e, modeId) => acp.setMode(e.sender, String(modeId)));
ipcMain.on('acp:permission', (e, id, optionId) => acp.answerPermission(e.sender, id, optionId ? String(optionId) : null));
ipcMain.on('acp:mcpReply', (e, id, result) => acp.answerMcp(e.sender, String(id), result));
ipcMain.handle('ai:status', () => ({ hasKey: ai.hasKey(), defaultModel: ai.DEFAULT_MODEL }));
ipcMain.handle('ai:setKey', (_e, key) => { ai.setKey(key); return ai.hasKey(); });
ipcMain.handle('ai:models', () => ai.listModels());
ipcMain.handle('ai:history', e => ai.history(e.sender));
ipcMain.on('ai:send', (e, payload) => { ai.chat(e.sender, payload || {}); });
ipcMain.on('ai:stop', e => ai.stop(e.sender));
ipcMain.on('ai:reply', (e, id, answer) => ai.reply(e.sender, String(id), answer));
ipcMain.on('ai:reset', e => ai.reset(e.sender));

// The Notes and Clipboard tools are now built-in plugins; their data lives in plugin storage.
const NOTES_STORE = 'plugin-notes-notes';
function migratePluginData() {
  for (const [from, to] of [['notes', NOTES_STORE], ['clipboard-pins', 'plugin-clipboard-pins']]) {
    if (store.get(to) === null && store.get(from) !== null) store.set(to, store.get(from));
  }
}

// Note reminders: checked every 30 s, fired once as a desktop notification.
function checkReminders() {
  const notes = store.get(NOTES_STORE, []);
  if (!Array.isArray(notes)) return;
  const now = Date.now();
  let changed = false;
  for (const n of notes) {
    if (!n.remindAt || n.reminded) continue;
    if (new Date(n.remindAt).getTime() > now) continue;
    n.reminded = true;
    changed = true;
    // In-app toast when Lumen is in front; the OS notification only when it's in the background.
    if (!BrowserWindow.getFocusedWindow()) {
      const notif = new Notification({ title: `⏰ ${n.title || 'Reminder'}`, body: (n.body || '').slice(0, 200), silent: false });
      notif.on('click', () => {
        const w = BrowserWindow.getAllWindows()[0];
        if (w) { w.show(); w.focus(); w.webContents.send('panel:open', 'notes.panel', n.id); }
      });
      notif.show();
    }
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('reminder', n);
  }
  if (changed) store.set(NOTES_STORE, notes);
}

// ─── Live config effects handled by the main process ─────────────────

let appliedMaterial = null;
let quitting = false;
function applyMainConfig(cfg) {
  if (quitting) return;
  if (cfg.window.stats) stats.start(s => broadcast('stats', s));
  else stats.stop();

  const material = materialOf(cfg);
  if (appliedMaterial !== null && material !== appliedMaterial && process.platform === 'win32') {
    for (const w of BrowserWindow.getAllWindows()) {
      try {
        w.setBackgroundMaterial(material);
        w.setBackgroundColor(material === 'none' ? themeBackground(cfg) : '#00000000');
      } catch (e) {
        console.error('backgroundMaterial', e);
      }
    }
  }
  appliedMaterial = material;
}

function materialOf(cfg) {
  const m = cfg.window.backgroundMaterial;
  return process.platform === 'win32' && (m === 'acrylic' || m === 'mica') ? m : 'none';
}

// ─── App lifecycle ────────────────────────────────────────────────────

app.setName('Lumen');
if (process.platform === 'win32') app.setAppUserModelId(APP_ID);

// The Lumen.lnk launcher next to the sources carries the same app id, so a window opened from
// it and a pinned button are the same app for Windows (one taskbar button, Lumen's icon).
function ensureShortcut() {
  if (process.platform !== 'win32' || app.isPackaged) return;
  const lnk = path.join(app.getAppPath(), 'Lumen.lnk');
  const want = { target: process.execPath, args: `"${app.getAppPath()}"`, cwd: app.getAppPath(), icon: ICON_ICO, iconIndex: 0, appUserModelId: APP_ID, description: 'Lumen terminal' };
  try {
    const cur = fs.existsSync(lnk) ? shell.readShortcutLink(lnk) : null;
    if (cur && cur.target === want.target && cur.args === want.args && cur.appUserModelId === APP_ID && cur.icon === want.icon) return;
  } catch {}
  try { shell.writeShortcutLink(lnk, fs.existsSync(lnk) ? 'replace' : 'create', want); } catch {}
}

// One process for all windows: launching Lumen again opens a new window in the running instance.
// The dev harness (LUMEN_SCREENSHOT) runs isolated so it never touches the user's session.
const isolated = !!process.env.LUMEN_SCREENSHOT;
if (isolated) app.setPath('userData', path.join(app.getPath('temp'), `lumen-dev-${process.pid}`));
const primary = isolated || app.requestSingleInstanceLock();

// lumen://install/<plugin-id> (the website's Install buttons) opens the plugin's card in the
// Plugins panel, where the user reads it and installs it. Nothing is installed by the link itself.
const DEEP_LINK = /^lumen:\/\/install\/([\w.-]{1,60})\/?$/i;
const linkIn = argv => argv.find(a => DEEP_LINK.test(String(a)));
let pendingLink = linkIn(process.argv);

function openDeepLink(url) {
  const m = String(url || '').match(DEEP_LINK);
  if (!m) return;
  const w = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  if (!w) { pendingLink = url; return; }
  if (w.isMinimized()) w.restore();
  w.show();
  w.focus();
  w.webContents.send('panel:open', 'plugins', { install: m[1] });
}

// Only the installed app claims lumen:// (a dev checkout never takes over the user's links).
if (!isolated && app.isPackaged) app.setAsDefaultProtocolClient('lumen');

if (!primary) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const link = linkIn(argv);
    if (link) openDeepLink(link);
    else createWindow();
  });
  // macOS delivers links through open-url, possibly before the app is ready.
  app.on('open-url', (e, url) => {
    e.preventDefault();
    if (app.isReady()) openDeepLink(url);
    else pendingLink = url;
  });
  app.whenReady().then(() => {
    // The page may only list installed fonts (for the font picker); everything else is denied.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'local-fonts'));
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'local-fonts');
    config.ensure();
    config.watch(async () => {
      const payload = await initPayload();
      applyMainConfig(payload.config);
      broadcast('config:changed', payload);
    });
    applyMainConfig(config.load().config);
    migratePluginData();
    aliases.writeShellFiles();
    // Agents may edit data/aliases.json directly: regenerate the shell files when it changes.
    try {
      fs.mkdirSync(store.DATA, { recursive: true });
      let t = null;
      fs.watch(store.DATA, (_e, file) => {
        if (file !== 'aliases.json') return;
        clearTimeout(t);
        t = setTimeout(() => { aliases.writeShellFiles(); broadcast('store:changed', 'aliases'); }, 200);
      });
    } catch {}
    aliases.clearLive();
    if (!isolated) ensureShortcut();
    setTimeout(() => shells.profiles(config.load().config).then(aliases.warm, () => {}), 3000);
    clipboardWatch.start(history => broadcast('clipboard:changed', history));
    updates.start(broadcast);
    setInterval(checkReminders, 30000);
    checkReminders();
    const { config: startCfg } = config.load();
    const previous = startCfg.behavior?.restoreSession === false ? [] : sessions.load();
    if (previous.length) previous.forEach(snap => createWindow(snap));
    else createWindow();
    if (pendingLink) {
      const link = pendingLink;
      pendingLink = null;
      BrowserWindow.getAllWindows()[0]?.webContents.once('did-finish-load', () => setTimeout(() => openDeepLink(link), 1500));
    }
  });
}

app.on('before-quit', () => {
  quitting = true;
  sessions.flush();
  stats.stop();
  clipboardWatch.stop();
});

app.on('window-all-closed', () => {
  quitting = true;
  sessions.flush();
  stats.stop();
  for (const id of [...ptys.keys()]) killPty(id);
  app.quit();
});
