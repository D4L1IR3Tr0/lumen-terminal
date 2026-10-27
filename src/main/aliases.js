// Aliases.
//  - Lumen aliases: defined once in Lumen, injected into every new PowerShell, bash and cmd pane.
//  - System aliases: read-only list of what the user's own shell profiles define.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { paths } = require('./config');
const store = require('./store');

const SHELL_DIR = path.join(paths.dir, 'shell');
const NAME = /^[A-Za-z_][\w.-]{0,40}$/;

function list() {
  return (store.get('aliases', []) || []).filter(a => a && NAME.test(a.name) && typeof a.command === 'string');
}

function save(aliases) {
  store.set('aliases', aliases.filter(a => NAME.test(a.name) && a.command));
  writeShellFiles();
}

const shQuote = s => `'${String(s).replace(/'/g, `'\\''`)}'`;

// bash and cmd read generated files; PowerShell gets the definitions in its startup hook.
function writeShellFiles() {
  fs.mkdirSync(SHELL_DIR, { recursive: true });
  const all = list();
  fs.writeFileSync(path.join(SHELL_DIR, 'aliases.sh'), all.map(a => `alias ${a.name}=${shQuote(a.command)}`).join('\n') + '\n');
  fs.writeFileSync(path.join(SHELL_DIR, 'aliases.doskey'), all.map(a => `${a.name}=${a.command.replace(/\r?\n/g, ' ')} $*`).join('\r\n') + '\r\n');
}

function powershellDefinitions() {
  return list().map(a => [
    `Remove-Item -Force -ErrorAction SilentlyContinue Alias:\\${a.name}`,
    `function global:${a.name} { ${a.command} @args }`
  ].join('\n')).join('\n');
}

// Paths of the generated files as each shell sees them.
function bashFile(kind) {
  const win = path.join(SHELL_DIR, 'aliases.sh');
  if (process.platform !== 'win32') return win;
  const drive = win[0].toLowerCase();
  const rest = win.slice(2).replace(/\\/g, '/');
  return kind === 'wsl' ? `/mnt/${drive}${rest}` : `/${drive}${rest}`;
}

function doskeyFile() {
  return path.join(SHELL_DIR, 'aliases.doskey');
}

// zsh (the macOS default) has no PROMPT_COMMAND: Lumen starts it with ZDOTDIR pointing here.
// Each file sources the user's own one first, so their setup is untouched; .zshrc then adds
// Lumen's prompt hook (folder, exit code, aliases) and hands ZDOTDIR back to the user.
function zshDir() {
  const dir = path.join(SHELL_DIR, 'zsh');
  fs.mkdirSync(dir, { recursive: true });
  const user = '"${LUMEN_USER_ZDOTDIR:-$HOME}"';
  const relay = name => [
    `__lumen_zdotdir="$ZDOTDIR"`,
    `ZDOTDIR=${user}`,
    `[ -f "$ZDOTDIR/${name}" ] && . "$ZDOTDIR/${name}"`,
    `ZDOTDIR="$__lumen_zdotdir"`,
    ''
  ].join('\n');
  const aliasFile = path.join(SHELL_DIR, 'aliases.sh').replace(/\\/g, '/');
  const files = {
    '.zshenv': relay('.zshenv'),
    '.zprofile': relay('.zprofile'),
    '.zshrc': [
      `ZDOTDIR=${user}`,
      '[ -f "$ZDOTDIR/.zshrc" ] && . "$ZDOTDIR/.zshrc"',
      `[ -f "${aliasFile}" ] && . "${aliasFile}"`,
      '__lumen_precmd() {',
      '  local ec=$?',
      `  printf '\\033]133;D;%s\\007\\033]7;file://%s%s\\007' "$ec" "\${HOST:-localhost}" "$PWD"`,
      '  [ -n "$LUMEN_ALIAS_FILE" ] && alias -L > "$LUMEN_ALIAS_FILE" 2>/dev/null',
      '}',
      'typeset -ga precmd_functions',
      'precmd_functions+=(__lumen_precmd)',
      ''
    ].join('\n')
  };
  for (const [name, text] of Object.entries(files)) {
    const file = path.join(dir, name);
    try { if (fs.readFileSync(file, 'utf8') === text) continue; } catch {}
    fs.writeFileSync(file, text);
  }
  return dir;
}

// ─── Detection of the user's own aliases ───────────────────────────────

function run(file, args, timeout = 8000) {
  return new Promise(resolve => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

// User aliases/functions = what exists with the profile loaded minus what exists without it.
const PS_LIST = "Get-ChildItem Alias:,Function: | ForEach-Object { [pscustomobject]@{ n = $_.Name; d = if ($_.CommandType -eq 'Alias') { $_.Definition } else { ($_.Definition -replace '\\s+', ' ').Trim() } } } | ConvertTo-Json -Compress";

async function detectPowerShell(exe) {
  const [bare, full] = await Promise.all([
    run(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS_LIST]),
    run(exe, ['-NoLogo', '-NonInteractive', '-Command', PS_LIST])
  ]);
  try {
    const base = new Set(JSON.parse(bare || '[]').map(x => x.n));
    return JSON.parse(full || '[]')
      .filter(x => !base.has(x.n) && !x.n.startsWith('__lumen') && !/^[A-Z]:$/.test(x.n))
      .map(x => ({ name: x.n, command: String(x.d || '').slice(0, 300) }));
  } catch {
    return [];
  }
}

async function detectBash(exe, args) {
  const out = await run(exe, args);
  return out.split('\n')
    .map(l => l.match(/^alias ([^=]+)='(.*)'$/))
    .filter(Boolean)
    .map(m => ({ name: m[1], command: m[2].replace(/'\\''/g, "'") }));
}

// ─── Aliases of one running terminal ────────────────────────────────────
// With shell integration, each shell writes its aliases to LIVE_DIR at every prompt (see
// shells.js), so this is what that terminal really has, session definitions included.

const LIVE_DIR = path.join(SHELL_DIR, 'live');

function clearLive() {
  try { fs.rmSync(LIVE_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(LIVE_DIR, { recursive: true });
}

// What a bare PowerShell defines (no profile), cached per executable: everything else is yours.
const psBase = new Map();
const PS_NAMES = "(Get-ChildItem Alias:,Function: | ForEach-Object Name) -join \"`n\"";
function powershellBaseline(exe) {
  if (!psBase.has(exe)) {
    psBase.set(exe, run(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', PS_NAMES]).then(out => new Set(out.split(/\r?\n/).map(s => s.trim()).filter(Boolean))));
  }
  return psBase.get(exe);
}

function readText(file) {
  try { return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''); } catch { return null; }
}

// profile: { kind, command, name }, file: the live file of that terminal (may not exist yet).
async function forTerminal(profile, file) {
  const lumen = new Set(list().map(a => a.name));
  const tag = items => items.map(a => ({ ...a, lumen: lumen.has(a.name) }));
  const text = file ? readText(file) : null;

  if (profile.kind === 'powershell') {
    if (text) {
      let all = [];
      try { all = JSON.parse(text); } catch {}
      if (!Array.isArray(all)) all = [all];
      const base = await powershellBaseline(profile.command);
      const items = all
        // Commands that come from a module (PSReadLine, built-in modules…) are not yours.
        .filter(x => x && x.n && !x.m && !base.has(x.n) && !x.n.startsWith('__lumen') && x.n !== 'prompt' && !/^[A-Z]:$/i.test(x.n))
        .map(x => ({ name: x.n, command: String(x.d || ''), type: x.t === 'Alias' ? 'alias' : 'function' }));
      return { live: true, items: tag(items) };
    }
    return { live: false, items: tag(await detectPowerShell(profile.command)) };
  }
  if (profile.kind === 'bash' || profile.kind === 'posix' || profile.kind === 'wsl') {
    if (text != null) return { live: true, items: tag(parseBash(text)) };
    const args = profile.kind === 'wsl' ? ['-e', 'bash', '-lic', 'alias'] : ['-lic', 'alias'];
    return { live: false, items: tag(parseBash(await run(profile.command, args))) };
  }
  if (profile.kind === 'cmd') {
    // cmd cannot report its macros: Lumen's are loaded in every cmd pane, plus AutoRun ones.
    const out = await run(profile.command, ['/c', 'doskey', '/macros']);
    const items = out.split(/\r?\n/).map(l => l.match(/^([^=\s]+)=(.*)$/)).filter(Boolean)
      .map(m => ({ name: m[1], command: m[2].replace(/\s*\$\*\s*$/, ''), type: 'macro' }));
    const known = new Set(items.map(i => i.name));
    for (const a of list()) if (!known.has(a.name)) items.push({ name: a.name, command: a.command, type: 'macro' });
    return { live: false, items: tag(items) };
  }
  return { live: false, items: [], unsupported: true };
}

function parseBash(out) {
  return String(out).split('\n')
    // bash quotes every value; zsh's "alias -L" leaves simple ones bare (alias ll=ls).
    .map(l => l.match(/^alias (?:-- )?([^=]+)=(?:'(.*)'|(\S*))$/))
    .filter(Boolean)
    .map(m => ({ name: m[1], command: (m[2] ?? m[3]).replace(/'\\''/g, "'"), type: 'alias' }));
}

async function detect(profiles) {
  const result = [];
  for (const p of profiles) {
    let items = [];
    if (p.kind === 'powershell') items = await detectPowerShell(p.command);
    else if (p.kind === 'bash' || p.kind === 'posix') items = await detectBash(p.command, ['-lic', 'alias']);
    else if (p.kind === 'wsl') items = await detectBash(p.command, ['-e', 'bash', '-lic', 'alias']);
    else continue;
    result.push({ shell: p.name, id: p.id, items });
  }
  return result;
}

// Started in the background at launch so the first look at the panel is instant.
function warm(profiles) {
  for (const p of profiles) if (p.kind === 'powershell') powershellBaseline(p.command);
}

module.exports = { list, save, writeShellFiles, powershellDefinitions, bashFile, doskeyFile, zshDir, detect, forTerminal, clearLive, warm, LIVE_DIR, NAME };
