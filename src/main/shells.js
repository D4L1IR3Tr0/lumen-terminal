// Detects the shells available on this machine and builds spawn profiles.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const os = require('os');

function which(exe) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const full = path.join(dir, exe);
    if (fs.existsSync(full)) return full;
  }
  return null;
}

function firstExisting(...candidates) {
  return candidates.find(p => p && fs.existsSync(p)) || null;
}

function hasWslDistro(wsl) {
  return new Promise(resolve => {
    execFile(wsl, ['-l', '-q'], { timeout: 2500, encoding: 'buffer', windowsHide: true }, (err, stdout) => {
      if (err) return resolve(false);
      // wsl.exe prints UTF-16LE
      resolve(stdout.toString('utf16le').replace(/\0/g, '').trim().length > 0);
    });
  });
}

async function detectWindows() {
  const profiles = [];
  const pf = process.env.ProgramFiles || 'C:\\Program Files';

  const pwsh = firstExisting(which('pwsh.exe'), path.join(pf, 'PowerShell', '7', 'pwsh.exe'));
  if (pwsh) profiles.push({ id: 'pwsh', name: 'PowerShell 7', command: pwsh, args: ['-NoLogo'], kind: 'powershell' });

  profiles.push({ id: 'powershell', name: 'Windows PowerShell', command: 'powershell.exe', args: ['-NoLogo'], kind: 'powershell' });
  profiles.push({ id: 'cmd', name: 'Command Prompt', command: 'cmd.exe', args: [], kind: 'cmd' });

  const gitBash = firstExisting(path.join(pf, 'Git', 'bin', 'bash.exe'), path.join(pf, 'Git', 'usr', 'bin', 'bash.exe'));
  if (gitBash) profiles.push({ id: 'gitbash', name: 'Git Bash', command: gitBash, args: ['--login', '-i'], kind: 'bash' });

  const wsl = which('wsl.exe');
  if (wsl && await hasWslDistro(wsl)) profiles.push({ id: 'wsl', name: 'WSL', command: wsl, args: ['~'], kind: 'wsl' });

  return profiles;
}

function detectUnix() {
  const profiles = [];
  const login = process.env.SHELL;
  if (login) profiles.push({ id: path.basename(login), name: path.basename(login), command: login, args: ['-l'], kind: 'posix' });
  for (const sh of ['bash', 'zsh', 'fish']) {
    const p = which(sh);
    if (p && !profiles.some(x => x.command === p)) profiles.push({ id: sh, name: sh, command: p, args: ['-l'], kind: 'posix' });
  }
  return profiles;
}

let cache = null;
function detect() {
  if (!cache) cache = process.platform === 'win32' ? detectWindows() : Promise.resolve(detectUnix());
  return cache;
}

// User profiles from config override or extend detected ones (matched by id).
async function profiles(config) {
  const list = [...await detect()];
  for (const p of config.shells?.profiles || []) {
    if (!p || !p.id || !p.command) continue;
    const merged = { args: [], kind: 'custom', name: p.id, ...p };
    const i = list.findIndex(x => x.id === p.id);
    if (i >= 0) list[i] = merged; else list.push(merged);
  }
  return list;
}

// Shell integration: at every prompt the shell reports the last exit code (OSC 133;D;code)
// and its current directory (OSC 9;9 or OSC 7). Lumen uses this to open new panes in the same
// folder, show failures and refresh git status. The user's own prompt is kept as is.
const PWSH_HOOK = [
  '$global:__lumenPrompt = $function:prompt',
  'function global:prompt {',
  '  $ok = $?',
  '  $code = 0',
  '  if (-not $ok) { $code = 1; if ($global:LASTEXITCODE) { $code = $global:LASTEXITCODE } }',
  '  $e = [char]27; $b = [char]7',
  '  [Console]::Write("$e]133;D;$code$b")',
  '  $loc = $executionContext.SessionState.Path.CurrentLocation',
  '  if ($loc.Provider.Name -eq "FileSystem") { [Console]::Write("$e]9;9;`"$($loc.ProviderPath)`"$b") }',
  // The session's aliases and functions, for Lumen's Aliases panel: written only when their
  // number changes, so a normal prompt costs a single count.
  '  if ($env:LUMEN_ALIAS_FILE) { try {',
  '    $n = @(Get-ChildItem Alias:).Count * 100000 + @(Get-ChildItem Function:).Count',
  '    if ($n -ne $global:__lumenAliasCount) {',
  '      $global:__lumenAliasCount = $n',
  "      Get-ChildItem Alias:,Function: | ForEach-Object { $d = if ($_.CommandType -eq 'Alias') { [string]$_.Definition } else { ([string]$_.Definition -replace '\\s+', ' ').Trim() }; if ($d.Length -gt 300) { $d = $d.Substring(0, 300) }; [pscustomobject]@{ n = $_.Name; t = [string]$_.CommandType; d = $d; m = [string]$_.ModuleName } } | ConvertTo-Json -Compress | Set-Content -LiteralPath $env:LUMEN_ALIAS_FILE -Encoding UTF8",
  '    }',
  '  } catch {} }',
  '  & $global:__lumenPrompt',
  '}'
].join('\n');

// No subshells here: forking is slow under Git Bash. Paths like /c/Users are converted by the UI.
// On the first prompt it also sources Lumen's alias file, so the aliases land in the
// interactive shell itself.
function bashPromptCommand(aliasFile) {
  const source = aliasFile ? `[ -z "$__lumen_rc" ] && { __lumen_rc=1; [ -f "${aliasFile}" ] && . "${aliasFile}"; };` : '';
  // The session's aliases, for Lumen's Aliases panel (a builtin with a redirect: no fork).
  const dump = '[ -n "$LUMEN_ALIAS_FILE" ] && alias > "$LUMEN_ALIAS_FILE" 2>/dev/null;';
  return `__lumen_ec=$?;${source}${dump}printf "\\033]133;D;%s\\007\\033]7;file://%s%s\\007" "$__lumen_ec" "\${HOSTNAME:-localhost}" "$PWD"`;
}

// extra: { psAliases: string, bashAliasFile: kind => path, doskeyFile: string }
function spawnArgs(profile, shellIntegration, cwd, extra = {}) {
  let args = profile.args;
  if (profile.kind === 'wsl' && cwd && cwd.startsWith('/')) args = ['--cd', cwd];
  if (profile.kind === 'powershell' && shellIntegration) {
    // The final assignment resets $? so the first prompt doesn't report the alias setup as a failure.
    const script = `${PWSH_HOOK}\n${extra.psAliases || ''}\n$global:__lumenReady = $true`;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    args = [...args, '-NoExit', '-EncodedCommand', encoded];
  }
  if (profile.kind === 'cmd' && shellIntegration && extra.doskeyFile) {
    // A single command line string: node-pty passes it as is. As an array element, the quotes
    // would be escaped (\") and cmd would look for a file named \"C:\…\".
    args = [...args, '/k', `doskey /macrofile="${extra.doskeyFile}"`].join(' ');
  }
  return args;
}

// extra.liveAliasFile: where this shell writes its aliases at each prompt (Windows path).
function spawnEnv(profile, shellIntegration, extra = {}) {
  if (!shellIntegration) return {};
  const aliasFile = extra.bashAliasFile ? extra.bashAliasFile(profile.kind) : null;
  const live = extra.liveAliasFile || '';
  if (profile.kind === 'posix' && /(^|[\\/])zsh$/.test(profile.command) && extra.zshDir) {
    // zsh reads its startup files from ZDOTDIR: Lumen's relay files source the user's own.
    return { ZDOTDIR: extra.zshDir(), LUMEN_USER_ZDOTDIR: process.env.ZDOTDIR || os.homedir(), LUMEN_ALIAS_FILE: live };
  }
  if (profile.kind === 'bash' || profile.kind === 'posix') return { PROMPT_COMMAND: bashPromptCommand(aliasFile), LUMEN_ALIAS_FILE: live.replace(/\\/g, '/') };
  if (profile.kind === 'wsl') {
    const wslenv = process.env.WSLENV ? `${process.env.WSLENV}:` : '';
    // /p: WSL translates the Windows path to /mnt/c/…
    return { PROMPT_COMMAND: bashPromptCommand(aliasFile), LUMEN_ALIAS_FILE: live, WSLENV: `${wslenv}PROMPT_COMMAND/u:LUMEN_ALIAS_FILE/p` };
  }
  if (profile.kind === 'powershell') return { LUMEN_ALIAS_FILE: live };
  if (profile.kind === 'cmd') return { PROMPT: '$E]9;9;$P$E\\' + (process.env.PROMPT || '$P$G') };
  return {};
}

// Finds an executable on PATH, trying Windows launcher extensions (npm installs .cmd shims).
function findCommand(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const ext of exts) {
    const hit = which(name + ext);
    if (hit) return hit;
  }
  return null;
}

module.exports = { profiles, spawnArgs, spawnEnv, findCommand };
