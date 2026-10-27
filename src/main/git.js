// Git for Lumen: the quick status shown in each pane's bar, and the repository operations used
// by the built-in Git plugin. Every operation runs `git` with a fixed argument list (no shell),
// inside a directory that must be a git work tree.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const cache = new Map(); // cwd -> { at, promise }

function parse(out) {
  const info = { branch: null, ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0 };
  let oid = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('# branch.head ')) info.branch = line.slice(14).trim();
    else if (line.startsWith('# branch.oid ')) oid = line.slice(13).trim();
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { info.ahead = +m[1]; info.behind = +m[2]; }
    } else if (line.startsWith('1 ') || line.startsWith('2 ')) {
      if (line[2] !== '.') info.staged++;
      if (line[3] !== '.') info.modified++;
    } else if (line.startsWith('u ')) info.conflicts++;
    else if (line.startsWith('? ')) info.untracked++;
  }
  if (info.branch === '(detached)') info.branch = oid && oid !== '(initial)' ? oid.slice(0, 7) : 'detached';
  return info;
}

// Git Bash reports /c/Users/…; git for Windows wants C:\Users\…
function localPath(cwd) {
  if (typeof cwd !== 'string' || !cwd) return null;
  if (process.platform === 'win32' && cwd.startsWith('/')) {
    const m = cwd.match(/^\/([a-z])(\/.*)?$/i);
    return m ? `${m[1].toUpperCase()}:${(m[2] || '/').replace(/\//g, '\\')}` : null;
  }
  return cwd;
}

function status(cwd) {
  cwd = localPath(cwd);
  if (!cwd) return Promise.resolve(null);
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < 800) return hit.promise;
  const promise = new Promise(resolve => {
    if (!fs.existsSync(cwd)) return resolve(null);
    execFile('git', ['status', '--porcelain=v2', '--branch'], {
      cwd,
      timeout: 4000,
      windowsHide: true,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } // never fight the user's git for the index lock
    }, (err, stdout) => resolve(err ? null : parse(stdout)));
  });
  cache.set(cwd, { at: Date.now(), promise });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return promise;
}

// ─── Repository operations (built-in Git plugin) ─────────────────────

const NETWORK_TIMEOUT = 180000;

function git(cwd, args, { timeout = 15000, input = null, maxBuffer = 16 * 1024 * 1024, network = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, {
      cwd,
      timeout: network ? NETWORK_TIMEOUT : timeout,
      windowsHide: true,
      maxBuffer,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0', // never hang waiting for a password nobody can type
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C' // English messages, whatever the system language
      }
    }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr || stdout || err.message).trim().split('\n').filter(l => !/^hint:/.test(l)).slice(-6).join('\n');
        reject(new Error(err.killed ? 'git took too long and was stopped' : msg || `git ${args[0]} failed`));
      } else resolve({ out: stdout, err: stderr });
    });
    if (input != null) { child.stdin.end(input); }
  });
}

// Resolves a directory to its repository root, or throws.
const roots = new Map();
async function root(cwd) {
  cwd = localPath(cwd);
  if (!cwd || !fs.existsSync(cwd)) throw new Error('folder not found');
  if (roots.has(cwd)) return roots.get(cwd);
  const { out } = await git(cwd, ['rev-parse', '--show-toplevel']).catch(e => {
    throw new Error(/not a git repository/i.test(e.message) ? 'not a git repository' : e.message);
  });
  const top = path.resolve(out.trim());
  roots.set(cwd, top);
  if (roots.size > 500) roots.delete(roots.keys().next().value);
  return top;
}

function safePaths(list) {
  if (!Array.isArray(list) || !list.length) throw new Error('no files given');
  return list.map(p => {
    p = String(p);
    if (!p || path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) throw new Error(`invalid path: ${p}`);
    return p;
  });
}

function safeRef(name) {
  name = String(name || '').trim();
  if (!name || name.startsWith('-') || /[\s~^:?*[\\\x00-\x1f]|\.\.|@\{|\.lock$|\/$/.test(name)) throw new Error(`invalid branch name: ${name}`);
  return name;
}

const STATE_NAMES = { M: 'modified', T: 'type changed', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', U: 'conflict' };

// Full status: branch, upstream, ahead/behind, and every changed file.
async function repoStatus(cwd) {
  const top = await root(cwd);
  const { out } = await git(top, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']);
  const info = { root: top, name: path.basename(top), branch: null, oid: null, upstream: null, ahead: 0, behind: 0, files: [], state: null };
  const parts = out.split('\0');
  for (let i = 0; i < parts.length; i++) {
    const line = parts[i];
    if (!line) continue;
    if (line.startsWith('# branch.head ')) info.branch = line.slice(14);
    else if (line.startsWith('# branch.oid ')) info.oid = line.slice(13);
    else if (line.startsWith('# branch.upstream ')) info.upstream = line.slice(18);
    else if (line.startsWith('# branch.ab ')) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) { info.ahead = +m[1]; info.behind = +m[2]; }
    } else if (line[0] === '1' || line[0] === '2') {
      const f = line.split(' ');
      const xy = f[1];
      const file = f.slice(line[0] === '1' ? 8 : 9).join(' ');
      const from = line[0] === '2' ? parts[++i] : null;
      info.files.push({ path: file, from, index: xy[0] === '.' ? null : xy[0], work: xy[1] === '.' ? null : xy[1] });
    } else if (line[0] === 'u') {
      info.files.push({ path: line.split(' ').slice(10).join(' '), index: 'U', work: 'U', conflict: true });
    } else if (line[0] === '?') {
      info.files.push({ path: line.slice(2), index: null, work: '?', untracked: true });
    }
  }
  if (info.branch === '(detached)') info.branch = null;
  for (const f of info.files) f.label = f.untracked ? 'untracked' : STATE_NAMES[f.work || f.index] || 'changed';
  const gitDir = path.join(top, '.git');
  for (const [file, state] of [['MERGE_HEAD', 'merging'], ['rebase-merge', 'rebasing'], ['rebase-apply', 'rebasing'], ['CHERRY_PICK_HEAD', 'cherry-picking']]) {
    if (fs.existsSync(path.join(gitDir, file))) { info.state = state; break; }
  }
  try { info.remote = (await git(top, ['remote', 'get-url', 'origin'])).out.trim(); } catch { info.remote = null; }
  try { info.lastFetch = fs.statSync(path.join(gitDir, 'FETCH_HEAD')).mtimeMs; } catch { info.lastFetch = null; }
  try { info.stashes = (await git(top, ['stash', 'list'])).out.split('\n').filter(Boolean).length; } catch { info.stashes = 0; }
  return info;
}

// "HEAD -> refs/heads/main", "refs/remotes/origin/main", "tag: refs/tags/v1" → { name, type }
function decoration(ref) {
  const head = ref.startsWith('HEAD -> ');
  ref = ref.replace(/^HEAD -> /, '');
  if (ref === 'HEAD' || /^refs\/remotes\/[^/]+\/HEAD$/.test(ref)) return null;
  if (ref.startsWith('tag: ')) return { name: ref.replace(/^tag: refs\/tags\//, ''), type: 'tag' };
  if (ref.startsWith('refs/remotes/')) return { name: ref.slice(13), type: 'remote' };
  return { name: ref.replace(/^refs\/heads\//, ''), type: head ? 'head' : 'branch' };
}

async function log(cwd, { limit = 40, ref = 'HEAD' } = {}) {
  const top = await root(cwd);
  const n = Math.min(Math.max(+limit || 40, 1), 200);
  let out = '';
  try {
    out = (await git(top, ['log', `-n${n}`, '--decorate=full', '--format=%H%x1f%h%x1f%an%x1f%ae%x1f%at%x1f%s%x1f%D%x1f%P%x1e', safeRef(ref), '--'])).out;
  } catch (e) {
    if (/does not have any commits|unknown revision|bad default revision/i.test(e.message)) return [];
    throw e;
  }
  let unpushed = new Set();
  try { unpushed = new Set((await git(top, ['rev-list', '@{upstream}..HEAD'])).out.split('\n').filter(Boolean)); } catch {}
  return out.split('\x1e').map(s => s.trim()).filter(Boolean).map(rec => {
    const [hash, short, author, email, at, subject, refs, parents] = rec.split('\x1f');
    return { hash, short, author, email, at: +at * 1000, subject, refs: refs ? refs.split(', ').map(decoration).filter(Boolean) : [], merge: (parents || '').split(' ').length > 1, unpushed: unpushed.has(hash) };
  });
}

async function branches(cwd) {
  const top = await root(cwd);
  const { out } = await git(top, ['for-each-ref', '--sort=-committerdate', '--format=%(refname)%1f%(refname:short)%1f%(HEAD)%1f%(upstream:short)%1f%(upstream:track)%1f%(committerdate:unix)', 'refs/heads', 'refs/remotes']);
  return out.split('\n').filter(Boolean).map(l => {
    const [full, name, head, upstream, track, at] = l.split('\x1f');
    return { name, remote: full.startsWith('refs/remotes/'), current: head === '*', upstream: upstream || null, track: track || '', at: +at * 1000 };
  }).filter(b => !b.name.endsWith('/HEAD') && b.name !== 'origin');
}

const MAX_DIFF = 400 * 1024;

async function diff(cwd, file, { staged = false, untracked = false } = {}) {
  const top = await root(cwd);
  const [p] = safePaths([file]);
  if (untracked) {
    const full = path.join(top, p);
    const stat = fs.statSync(full);
    if (stat.size > MAX_DIFF) return { text: '', truncated: true, binary: false };
    const buf = fs.readFileSync(full);
    if (buf.includes(0)) return { text: '', binary: true };
    return { text: buf.toString('utf8').split('\n').map(l => '+' + l).join('\n'), added: true };
  }
  const { out } = await git(top, ['diff', '--no-color', '--no-ext-diff', ...(staged ? ['--cached'] : []), '--', p], { maxBuffer: 32 * 1024 * 1024 });
  const binary = /^Binary files /m.test(out);
  return { text: out.length > MAX_DIFF ? out.slice(0, MAX_DIFF) : out, truncated: out.length > MAX_DIFF, binary };
}

async function show(cwd, hash) {
  const top = await root(cwd);
  if (!/^[0-9a-f]{4,64}$/i.test(String(hash))) throw new Error('invalid commit');
  const { out } = await git(top, ['show', '--no-color', '--no-ext-diff', '--stat', '--patch', '--format=%H%n%an <%ae>%n%at%n%B%x1e', String(hash)], { maxBuffer: 32 * 1024 * 1024 });
  const [head, rest = ''] = out.split('\x1e');
  const [full, author, at, ...body] = head.split('\n');
  return { hash: full, author, at: +at * 1000, message: body.join('\n').trim(), patch: rest.length > MAX_DIFF ? rest.slice(0, MAX_DIFF) : rest, truncated: rest.length > MAX_DIFF };
}

async function stage(cwd, files) { const top = await root(cwd); await git(top, ['add', '-A', '--', ...safePaths(files)]); }
async function stageAll(cwd) { const top = await root(cwd); await git(top, ['add', '-A']); }
async function unstage(cwd, files) {
  const top = await root(cwd);
  try { await git(top, ['restore', '--staged', '--', ...safePaths(files)]); }
  catch { await git(top, ['rm', '--cached', '-r', '-q', '--', ...safePaths(files)]); } // no commit yet
}
async function unstageAll(cwd) {
  const top = await root(cwd);
  try { await git(top, ['reset', '-q']); } catch { await git(top, ['rm', '--cached', '-r', '-q', '.']); }
}

// Throws away local changes to these files (untracked files are deleted).
async function discard(cwd, files) {
  const top = await root(cwd);
  const list = safePaths(files);
  const st = await repoStatus(top);
  const untracked = list.filter(p => st.files.some(f => f.path === p && f.untracked));
  const tracked = list.filter(p => !untracked.includes(p));
  if (tracked.length) await git(top, ['restore', '--staged', '--worktree', '--source=HEAD', '--', ...tracked]).catch(() => git(top, ['checkout', 'HEAD', '--', ...tracked]));
  if (untracked.length) await git(top, ['clean', '-f', '-q', '--', ...untracked]);
}

async function commit(cwd, message, { amend = false, all = false } = {}) {
  const top = await root(cwd);
  message = String(message || '').trim();
  if (!message && !amend) throw new Error('write a commit message first');
  if (all) await git(top, ['add', '-A']);
  const args = ['commit', '--cleanup=strip', '-F', '-'];
  if (amend) args.push('--amend', ...(message ? [] : ['--no-edit']));
  const { out } = await git(top, amend && !message ? ['commit', '--amend', '--no-edit'] : args, { input: message, timeout: 60000 });
  return out.trim().split('\n')[0];
}

async function fetchRemote(cwd) {
  const top = await root(cwd);
  await git(top, ['fetch', '--all', '--prune'], { network: true });
}

async function pull(cwd) {
  const top = await root(cwd);
  const { out } = await git(top, ['pull', '--no-edit'], { network: true });
  return out.trim().split('\n').pop();
}

async function push(cwd) {
  const top = await root(cwd);
  const st = await repoStatus(top);
  if (!st.branch) throw new Error('detached HEAD: switch to a branch before pushing');
  const args = st.upstream ? ['push'] : ['push', '--set-upstream', 'origin', st.branch];
  const { err } = await git(top, args, { network: true });
  return (err || '').trim().split('\n').pop();
}

async function checkout(cwd, branch) {
  const top = await root(cwd);
  const name = safeRef(branch);
  // "origin/feature" checks out a local tracking branch "feature".
  const remotes = (await git(top, ['remote'])).out.split('\n').filter(Boolean);
  const remote = remotes.find(r => name.startsWith(r + '/'));
  if (remote) {
    const local = name.slice(remote.length + 1);
    const exists = await git(top, ['show-ref', '--verify', '--quiet', `refs/heads/${local}`]).then(() => true, () => false);
    await git(top, exists ? ['switch', local] : ['switch', '--track', name]);
  } else await git(top, ['switch', name]);
}

async function createBranch(cwd, name) {
  const top = await root(cwd);
  await git(top, ['switch', '-c', safeRef(name)]);
}

async function stash(cwd, message = '') {
  const top = await root(cwd);
  await git(top, ['stash', 'push', '--include-untracked', ...(message ? ['-m', String(message)] : [])]);
}

async function stashPop(cwd) {
  const top = await root(cwd);
  await git(top, ['stash', 'pop']);
}

// Finds repositories under a folder (2 levels deep by default), e.g. ~/Projects.
function scan(dir, depth = 2) {
  dir = localPath(dir);
  const found = [];
  const skip = new Set(['node_modules', '.git', 'AppData', '$Recycle.Bin', 'Windows', 'Program Files', 'Program Files (x86)']);
  const walk = (d, level) => {
    if (found.length >= 200) return;
    if (fs.existsSync(path.join(d, '.git'))) { found.push(d); return; }
    if (level >= depth) return;
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) if (e.isDirectory() && !skip.has(e.name) && !e.name.startsWith('.')) walk(path.join(d, e.name), level + 1);
  };
  walk(path.resolve(dir), 0);
  return found;
}

module.exports = {
  status, localPath,
  repo: {
    root, summary: status, status: repoStatus, log, branches, diff, show, stage, stageAll, unstage, unstageAll, discard,
    commit, fetch: fetchRemote, pull, push, checkout, createBranch, stash, stashPop, scan
  }
};
