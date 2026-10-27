// @name Git
// @description Your repositories and your GitHub account: changes, staging, commit, pull/push, history, branches, stashes, pull requests, issues, activity and contributions.
// @version 1.0.0
// @author Lumen
// @permissions git, github
//
// Built-in plugin: turn it off in the Plugins panel or with "builtinPlugins": { "git": false }.
// The panel follows the focused terminal: cd into a repository and it shows up. Every repository
// you visit is remembered (storage key "repos"). GitHub sign-in goes through the official GitHub
// CLI (`gh auth login`, in a terminal) or a personal access token stored encrypted; the token
// stays in Lumen's main process.

const svg = (body, cls = 'i') => `<svg viewBox="0 0 24 24" class="${cls}">${body}</svg>`;
const P = {
  branch: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10M18 8c0 5-4 6-10 9"/>',
  repo: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3M9 7h6"/>',
  fetch: '<path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5"/><path d="M5 3v4h4M19 21v-4h-4"/>',
  pull: '<path d="M12 4v12M7 11l5 5 5-5M5 20h14"/>',
  push: '<path d="M12 20V8M7 13l5-5 5 5M5 4h14"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
  minus: '<path d="M6 12h12"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7"/>',
  star: '<path d="M12 3.8l2.5 5.2 5.7.8-4.1 4 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4.1-4 5.7-.8z"/>',
  dot: '<circle cx="12" cy="12" r="4"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  box: '<path d="M4 8l8-4 8 4v8l-8 4-8-4z"/><path d="M4 8l8 4 8-4M12 12v8"/>',
  pr: '<circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="19" r="2"/><path d="M6 7v10M18 17V9a3 3 0 0 0-3-3h-4M13 3.5L10.5 6 13 8.5"/>',
  issue: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1.5"/>'
};
const GITHUB = '<svg viewBox="0 0 24 24" class="i g-gh-mark"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.19-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.9 1.57 2.35 1.12 2.92.85.09-.66.35-1.12.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05A9.4 9.4 0 0 1 12 6.84c.85 0 1.71.12 2.51.34 1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9v2.81c0 .27.18.6.69.49A10.1 10.1 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>';
const ICON = '<svg viewBox="0 0 24 24"><circle cx="6" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><circle cx="18" cy="6" r="2"/><path d="M6 7v10M18 8c0 5-4 6-10 9"/></svg>';

const ui = lumen.ui;
const esc = s => ui.escape(s == null ? '' : s);
const ago = t => ui.relativeTime(t);
const base = p => String(p).split(/[\\/]/).filter(Boolean).pop() || p;
const sameDir = (a, b) => !!a && !!b && a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase();
const githubRepo = url => {
  const m = String(url || '').match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?\/?$/i);
  return m ? { owner: m[1], name: m[2], full: `${m[1]}/${m[2]}` } : null;
};

// ─── State shared by the panel and the commands ──────────────────────

const S = {
  repos: [],          // [{ root, remote }] every repository seen
  current: null,      // root shown in the panel
  follow: true,       // follow the focused terminal's folder
  st: null,           // full status of `current`
  error: null,
  log: null,
  branches: null,
  tab: 'changes',
  view: null,         // overlay: { kind: 'diff' | 'commit' | 'repos', … }
  busy: new Set(),
  gh: null,           // GitHub status
  ghTab: 'repos',
  ghData: {},         // repos, mine, reviews, issues, events, contrib
  ghLoading: new Set(),
  ghExtra: new Map(), // `${full}@${branch}@${oid}` -> { pr, checks, defaultBranch, at }
  waitingLogin: 0
};
let panel = null; // DOM helpers once the panel has been rendered

const rootCache = new Map(); // cwd -> { root, at }
async function rootOf(cwd) {
  if (!cwd) return null;
  const hit = rootCache.get(cwd);
  if (hit && Date.now() - hit.at < 15000) return hit.root;
  const root = await lumen.git.root(cwd).catch(() => null);
  rootCache.set(cwd, { root, at: Date.now() });
  return root;
}

async function loadRepos() {
  const saved = (await lumen.storage.get('repos')) || [];
  S.repos = saved.filter(r => r && typeof r.root === 'string');
}

function rememberRepo(root, remote) {
  const hit = S.repos.find(r => sameDir(r.root, root));
  if (hit && (remote === undefined || hit.remote === remote)) return;
  if (hit) hit.remote = remote;
  else S.repos.unshift({ root, remote: remote || null });
  lumen.storage.set('repos', S.repos);
}

async function focusedRoot() {
  return rootOf(lumen.panes.focused()?.cwd);
}

async function select(root, { follow = S.follow } = {}) {
  S.follow = follow;
  if (!sameDir(root, S.current)) {
    S.current = root;
    S.st = null; S.log = null; S.branches = null; S.error = null;
    if (S.view?.kind !== 'repos') S.view = null;
  }
  await refresh({ full: true });
}

async function refresh({ full = false } = {}) {
  if (!S.current) { S.st = null; paint(); return; }
  try {
    const st = await lumen.git.status(S.current);
    const changed = JSON.stringify(st) !== JSON.stringify(S.st);
    S.st = st;
    S.error = null;
    rememberRepo(st.root, st.remote);
    if (changed || full) {
      if (S.tab === 'history' || S.log) S.log = await lumen.git.log(S.current, { limit: 60 }).catch(() => S.log);
      if (S.tab === 'branches' || S.branches) S.branches = await lumen.git.branches(S.current).catch(() => S.branches);
      paint();
      loadGithubExtra();
    }
  } catch (e) {
    S.st = null;
    S.error = e.message;
    paint();
  }
}

// Runs one network/write operation at a time per kind, with feedback in the panel.
async function op(kind, fn, done) {
  if (S.busy.has(kind) || !S.current) return;
  S.busy.add(kind);
  paintHead();
  try {
    const result = await fn();
    if (done) ui.toast(typeof done === 'function' ? done(result) : done);
  } catch (e) {
    ui.toast(e.message, 'error');
  } finally {
    S.busy.delete(kind);
    await refresh({ full: true });
  }
}

const doFetch = (quiet = false) => op('fetch', () => lumen.git.fetch(S.current), quiet ? null : 'Fetched');
const doPull = () => op('pull', () => lumen.git.pull(S.current), r => `Pulled${r ? `: ${r}` : ''}`);
const doPush = () => op('push', () => lumen.git.push(S.current), r => `Pushed${r ? `: ${r}` : ''}`);

// ─── GitHub ──────────────────────────────────────────────────────────

async function loadGithub(force = false) {
  if (S.gh && !force) return S.gh;
  try { S.gh = await lumen.github.status(); } catch (e) { S.gh = { connected: false, error: e.message }; }
  paint();
  return S.gh;
}

async function ghFetch(key, fn, force = false) {
  const hit = S.ghData[key];
  if (S.ghLoading.has(key) || (hit && !force && Date.now() - hit.at < 120000)) return;
  S.ghLoading.add(key);
  if (S.tab === 'github') paintGithub();
  try { S.ghData[key] = { at: Date.now(), value: await fn() }; }
  catch (e) { S.ghData[key] = { at: Date.now(), error: e.message }; }
  S.ghLoading.delete(key);
  if (S.tab === 'github') paintGithub();
}

function loadGithubTab(force = false) {
  if (!S.gh?.connected) return;
  const login = S.gh.user.login;
  ghFetch('contrib', () => lumen.github.contributions(), force);
  if (S.ghTab === 'repos') ghFetch('repos', () => lumen.github.get('/user/repos?sort=pushed&per_page=100&affiliation=owner,collaborator,organization_member'), force);
  if (S.ghTab === 'prs') {
    ghFetch('reviews', () => lumen.github.get(`/search/issues?q=${encodeURIComponent('is:open is:pr archived:false review-requested:@me')}&per_page=30`), force);
    ghFetch('mine', () => lumen.github.get(`/search/issues?q=${encodeURIComponent('is:open is:pr archived:false author:@me')}&sort=updated&per_page=30`), force);
  }
  if (S.ghTab === 'issues') ghFetch('issues', () => lumen.github.get(`/search/issues?q=${encodeURIComponent('is:open is:issue archived:false assignee:@me')}&sort=updated&per_page=30`), force);
  if (S.ghTab === 'activity') ghFetch('events', () => lumen.github.get(`/users/${encodeURIComponent(login)}/events?per_page=40`), force);
}

// Pull request and CI checks for the current branch, when the remote is on GitHub.
async function loadGithubExtra() {
  const st = S.st;
  const repo = githubRepo(st?.remote);
  if (!repo || !st.branch || !S.gh?.connected) return;
  const key = `${repo.full}@${st.branch}@${st.oid}`;
  const hit = S.ghExtra.get(key);
  if (hit && Date.now() - hit.at < 60000) return;
  S.ghExtra.set(key, { ...(hit || {}), at: Date.now() });
  const extra = { at: Date.now() };
  try {
    const [info, pulls] = await Promise.all([
      lumen.github.get(`/repos/${repo.full}`),
      lumen.github.get(`/repos/${repo.full}/pulls?state=open&head=${encodeURIComponent(`${repo.owner}:${st.branch}`)}&per_page=1`)
    ]);
    extra.defaultBranch = info.default_branch;
    extra.htmlUrl = info.html_url;
    extra.pr = pulls[0] ? { number: pulls[0].number, title: pulls[0].title, url: pulls[0].html_url, draft: pulls[0].draft } : null;
    if (st.upstream && !st.ahead) {
      const runs = await lumen.github.get(`/repos/${repo.full}/commits/${st.oid}/check-runs?per_page=100`).catch(() => null);
      const list = runs?.check_runs || [];
      if (list.length) {
        const failed = list.filter(r => ['failure', 'timed_out', 'cancelled', 'action_required'].includes(r.conclusion)).length;
        const running = list.filter(r => r.status !== 'completed').length;
        extra.checks = { total: list.length, failed, running, url: `${info.html_url}/commit/${st.oid}/checks` };
      }
    }
  } catch (e) { extra.error = e.message; }
  S.ghExtra.set(key, extra);
  if (S.ghExtra.size > 50) S.ghExtra.delete(S.ghExtra.keys().next().value);
  paintChanges();
}

function ghExtra() {
  const repo = githubRepo(S.st?.remote);
  return repo && S.st?.branch ? S.ghExtra.get(`${repo.full}@${S.st.branch}@${S.st.oid}`) : null;
}

// Signs in with the GitHub CLI in a terminal (installing it first if needed), then waits for it.
async function ghLogin(logout = false) {
  const win = lumen.platform === 'win32';
  const ps = lumen.shells.find(s => s.kind === 'powershell');
  const pane = await lumen.panes.create({ profile: win && ps ? ps.id : undefined });
  if (!pane) return;
  await pane.ready();
  let line = logout ? 'gh auth logout --hostname github.com' : 'gh auth login --web --hostname github.com --git-protocol https';
  if (!logout && !S.gh?.gh) {
    line = win
      ? `winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements; $env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User'); ${line}`
      : `command -v gh >/dev/null || { echo "Install the GitHub CLI first: https://cli.github.com"; false; } && ${line}`;
    ui.toast('Installing the GitHub CLI…');
  }
  pane.run(line);
  pane.focus();
  const started = Date.now();
  const want = !logout;
  const token = ++S.waitingLogin;
  paintGithub();
  while (S.waitingLogin === token && Date.now() - started < 5 * 60000) {
    await new Promise(r => setTimeout(r, 3000));
    await lumen.github.refresh();
    const st = await lumen.github.status().catch(() => null);
    if (st && st.connected === want) {
      S.gh = st;
      S.ghData = {};
      ui.toast(want ? `Signed in to GitHub as @${st.user.login}` : 'Signed out of GitHub');
      break;
    }
  }
  if (S.waitingLogin === token) S.waitingLogin = 0;
  paint();
  loadGithubTab(true);
  loadGithubExtra();
}

// ─── Rendering helpers ───────────────────────────────────────────────

const LETTER = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', 'type changed': 'T', conflict: '!', untracked: 'U' };

function fileRow(f, staged) {
  const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
  const label = staged ? ({ M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'type changed' }[f.index] || f.label) : f.label;
  return `
    <div class="p-row g-file" data-act="diff" data-path="${esc(f.path)}" data-staged="${staged ? 1 : 0}"${f.untracked ? ' data-untracked="1"' : ''} title="${esc(f.path)} (${label})">
      <span class="g-letter g-${label.replace(' ', '-')}">${LETTER[label] || 'M'}</span>
      <span class="p-row-main"><span class="p-row-title">${esc(base(f.path))}${f.from ? ` <span class="g-muted">← ${esc(base(f.from))}</span>` : ''}</span>${dir ? `<span class="p-row-sub">${esc(dir)}</span>` : ''}</span>
      <span class="p-row-actions">
        ${staged
          ? `<button data-act="unstage" title="Unstage">${svg(P.minus)}</button>`
          : `<button data-act="discard" title="Discard changes">${svg(P.undo)}</button><button data-act="stage" title="Stage">${ui.icon('plus')}</button>`}
      </span>
    </div>`;
}

function diffHtml(text) {
  const lines = text.split('\n');
  const max = 4000;
  const out = lines.slice(0, max).map(l => {
    let cls = '';
    if (l.startsWith('@@')) cls = 'hunk';
    else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|rename |old mode|new mode)/.test(l)) cls = 'meta';
    else if (l.startsWith('+')) cls = 'add';
    else if (l.startsWith('-')) cls = 'del';
    return `<span class="g-l ${cls}">${esc(l) || ' '}</span>`;
  });
  if (lines.length > max) out.push(`<span class="g-l meta">… ${lines.length - max} more lines</span>`);
  return out.join('');
}

function loading(text = 'Loading…') { return `<p class="p-empty g-loading">${text}</p>`; }

// ─── Panel ───────────────────────────────────────────────────────────

lumen.css(`
  .g-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
  .g-repo { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 9px; border: 1px solid var(--border); border-radius: 9px; background: var(--fg-soft); color: var(--fg); font-size: 13px; font-weight: 700; text-align: left; cursor: pointer; }
  .g-repo:hover { border-color: var(--accent); }
  .g-repo .g-name { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .g-repo .g-path { color: var(--muted); font-size: 10.5px; font-weight: 400; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; max-width: 45%; }
  .g-line { display: flex; align-items: center; gap: 8px; min-height: 22px; color: var(--muted); font-size: 11px; }
  .g-branch { display: inline-flex; align-items: center; gap: 5px; max-width: 55%; padding: 2px 8px; border: 0; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font: 600 11.5px var(--mono); cursor: pointer; }
  .g-branch span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .g-ab { display: inline-flex; gap: 6px; font-family: var(--mono); }
  .g-ab b { color: var(--fg); font-weight: 600; }
  .g-fetched { margin-left: auto; white-space: nowrap; }
  .g-sync { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
  .g-sync .s-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 6px 8px; }
  .g-sync .s-btn:disabled { opacity: .45; cursor: default; }
  .g-sync .s-btn .g-count { padding: 0 5px; border-radius: 999px; background: var(--accent); color: var(--crust); font-size: 10px; }
  .g-busy svg.i { animation: g-spin .9s linear infinite; }
  @keyframes g-spin { to { transform: rotate(360deg); } }
  .g-tabs button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
  .g-tabs .g-n { opacity: .75; font-size: 10px; }
  .g-banner { margin-bottom: 10px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--yellow) 14%, transparent); color: var(--yellow); font-size: 11.5px; }
  .g-commit-box { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
  .g-commit-box textarea { min-height: 54px; max-height: 180px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 8px; background: var(--fg-soft); color: var(--fg); font: 12px/1.45 var(--mono); resize: vertical; outline: none; }
  .g-commit-box textarea:focus { border-color: var(--accent); }
  .g-commit-row { display: flex; align-items: center; gap: 8px; }
  .g-commit-row .s-btn { margin-left: auto; }
  .g-commit-row .s-btn:disabled { opacity: .45; cursor: default; }
  .g-commit-row label { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 11px; cursor: pointer; }
  .g-ghline { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 10px; margin: 8px 0 2px; padding: 7px 9px; border: 1px solid var(--border); border-radius: 8px; font-size: 11.5px; }
  .g-ghline .p-link { display: inline-flex; align-items: center; gap: 5px; }
  .g-ok { color: var(--green); } .g-bad { color: var(--red); } .g-run { color: var(--yellow); }
  .g-file { padding: 4px 8px; gap: 8px; }
  .g-letter { width: 16px; flex: none; font: 700 11px var(--mono); text-align: center; color: var(--yellow); }
  .g-added, .g-untracked { color: var(--green); } .g-deleted, .g-conflict { color: var(--red); } .g-renamed, .g-copied { color: var(--accent); }
  .g-muted { color: var(--muted); font-weight: 400; }
  .g-commit { align-items: flex-start; padding: 6px 8px; }
  .g-commit .g-dot { width: 8px; height: 8px; margin-top: 5px; flex: none; border: 2px solid var(--muted); border-radius: 50%; }
  .g-commit .g-dot.unpushed { border-color: var(--accent); background: var(--accent); }
  .g-commit .p-row-title { white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .g-refs { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
  .g-ref { padding: 0 6px; border-radius: 999px; background: var(--accent-soft); color: var(--accent); font: 600 10px/16px var(--mono); }
  .g-ref.remote { background: var(--fg-soft); color: var(--muted); }
  .g-ref.tag { background: color-mix(in srgb, var(--yellow) 16%, transparent); color: var(--yellow); }
  .g-view-head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
  .g-view-head .g-title { flex: 1; min-width: 0; overflow: hidden; font-size: 12.5px; font-weight: 700; white-space: nowrap; text-overflow: ellipsis; }
  .g-diff { margin: 0; padding: 6px 0; overflow: auto; border: 1px solid var(--border); border-radius: 8px; font: 11px/1.5 var(--mono); user-select: text; }
  .g-l { display: block; padding: 0 10px; white-space: pre; min-width: max-content; }
  .g-l.add { background: color-mix(in srgb, var(--green) 13%, transparent); color: var(--green); }
  .g-l.del { background: color-mix(in srgb, var(--red) 13%, transparent); color: var(--red); }
  .g-l.hunk { color: var(--accent2); }
  .g-l.meta { color: var(--muted); }
  .g-msg { margin: 0 0 10px; color: var(--fg); font: 12px/1.5 var(--mono); white-space: pre-wrap; user-select: text; }
  .g-meta { margin-bottom: 10px; color: var(--muted); font-size: 11px; }
  .g-new-branch { display: flex; gap: 6px; margin-bottom: 4px; }
  .g-new-branch input { flex: 1; margin: 0; }
  .g-current { color: var(--green); }
  .g-profile { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .g-profile img { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border); }
  .g-profile .g-who { flex: 1; min-width: 0; }
  .g-profile .g-who b { display: block; font-size: 13px; }
  .g-profile .g-who span { color: var(--muted); font-size: 11px; }
  .g-heat { display: grid; grid-template-rows: repeat(7, 1fr); grid-auto-flow: column; grid-auto-columns: 1fr; gap: 2px; margin: 4px 0 4px; }
  .g-heat i { aspect-ratio: 1; border-radius: 2px; background: var(--fg-soft); }
  .g-heat i.l1 { background: color-mix(in srgb, var(--accent) 30%, transparent); }
  .g-heat i.l2 { background: color-mix(in srgb, var(--accent) 52%, transparent); }
  .g-heat i.l3 { background: color-mix(in srgb, var(--accent) 76%, transparent); }
  .g-heat i.l4 { background: var(--accent); }
  .g-heat-foot { display: flex; justify-content: space-between; margin-bottom: 12px; color: var(--muted); font-size: 10.5px; }
  .g-stats { display: inline-flex; align-items: center; gap: 10px; color: var(--muted); font-size: 10.5px; }
  .g-stats span { display: inline-flex; align-items: center; gap: 3px; }
  .g-stats svg.i { width: 11px; height: 11px; }
  .g-lang { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--accent2); }
  .g-card { padding: 12px; border: 1px solid var(--border); border-radius: 10px; background: var(--fg-soft); font-size: 12px; line-height: 1.5; }
  .g-card p { margin: 0 0 10px; color: var(--muted); }
  .g-card .p-buttons { margin: 0; }
  .g-token { display: flex; gap: 6px; margin-top: 10px; }
  .g-token input { flex: 1; margin: 0; }
  .g-gh-mark { fill: currentColor; stroke: none; }
  .g-empty-actions { display: flex; flex-direction: column; gap: 6px; margin-top: 10px; }
  .g-empty-actions .s-btn { display: inline-flex; align-items: center; gap: 6px; }
  .g-repo-row.active { background: var(--accent-soft); }
`);

lumen.sidebar.add({
  id: 'panel',
  title: 'Git',
  icon: ICON,
  hint: 'Ctrl+Shift+G',
  order: 35,
  width: 420,
  render(el, _ui, actions) {
    actions.innerHTML = `<button class="p-icon-btn" data-act="refresh" title="Refresh">${svg(P.fetch)}</button>`;
    el.innerHTML = `
      <div class="g-head"></div>
      <div class="g-main">
        <div class="p-tabs g-tabs">
          <button data-tab="changes">Changes</button>
          <button data-tab="history">History</button>
          <button data-tab="branches">Branches</button>
          <button data-tab="github">${GITHUB}GitHub</button>
        </div>
        <div data-body="changes">
          <div class="g-commit-box">
            <textarea class="g-msg-input" placeholder="Commit message (Ctrl+Enter to commit)" spellcheck="true"></textarea>
            <div class="g-commit-row">
              <label><input type="checkbox" class="g-amend"> Amend</label>
              <button class="p-icon-btn" data-act="ai-message" title="Ask the AI assistant to write the message">${ui.icon('sparkle')}</button>
              <button class="s-btn" data-act="commit">Commit</button>
            </div>
          </div>
          <div class="g-changes"></div>
        </div>
        <div data-body="history"></div>
        <div data-body="branches">
          <form class="g-new-branch">
            <input class="p-search" name="branch" placeholder="New branch name" spellcheck="false" autocomplete="off">
            <button class="s-btn" type="submit">Create</button>
          </form>
          <div class="g-branch-list"></div>
        </div>
        <div data-body="github"></div>
      </div>
      <div class="g-view hidden"></div>`;

    const $ = s => el.querySelector(s);
    const msg = $('.g-msg-input');
    panel = { el, $, msg };

    // ── Clicks ──
    el.addEventListener('click', async e => {
      const t = e.target.closest('[data-act], [data-tab], [data-ghtab]');
      if (!t) return;
      if (t.dataset.tab) { setTab(t.dataset.tab); return; }
      if (t.dataset.ghtab) { S.ghTab = t.dataset.ghtab; paintGithub(); loadGithubTab(); return; }
      const act = t.dataset.act;
      const row = t.closest('[data-path], [data-hash], [data-branch], [data-root], [data-url]');
      e.stopPropagation();
      try {
        await handle(act, t, row);
      } catch (err) {
        ui.toast(err.message, 'error');
      }
    });
    actions.addEventListener('click', e => {
      if (e.target.closest('[data-act="refresh"]')) {
        rootCache.clear();
        if (S.tab === 'github') { lumen.github.refresh().then(() => loadGithub(true)).then(() => loadGithubTab(true)); }
        refresh({ full: true });
      }
    });

    msg.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); commit(); }
    });
    msg.addEventListener('input', () => paintCommitButton());
    $('.g-amend').addEventListener('change', () => paintCommitButton());

    $('.g-new-branch').addEventListener('submit', e => {
      e.preventDefault();
      const input = e.target.elements.branch;
      const name = input.value.trim();
      if (!name) return;
      op('branch', () => lumen.git.createBranch(S.current, name), `Switched to the new branch ${name}`).then(() => { input.value = ''; });
    });

    el.addEventListener('submit', async e => {
      if (!e.target.classList.contains('g-token')) return;
      e.preventDefault();
      const value = e.target.elements.token.value;
      try {
        S.gh = await lumen.github.setToken(value);
        S.ghData = {};
        ui.toast(`Signed in to GitHub as @${S.gh.user.login}`);
        paint();
        loadGithubTab(true);
        loadGithubExtra();
      } catch (err) { ui.toast(err.message, 'error'); }
    });
    el.addEventListener('input', e => {
      if (e.target.classList.contains('g-filter')) { S.ghFilter = e.target.value.trim().toLowerCase(); paintGithubList(); }
    });

    this.onOpen = async arg => {
      if (arg === 'commit') { setTab('changes'); setTimeout(() => msg.focus(), 50); }
      await loadRepos();
      if (S.follow || !S.current) {
        S.follow = true;
        await followFocused();
        if (S.current) await refresh({ full: true }); else paint();
      } else await refresh({ full: true });
      loadGithub().then(() => { loadGithubExtra(); if (S.tab === 'github') loadGithubTab(); });
      // Keep remote counts fresh without the user thinking about it.
      if (S.st?.remote && (!S.st.lastFetch || Date.now() - S.st.lastFetch > 10 * 60000)) doFetch(true);
    };
    paint();
  }
});

function setTab(tab) {
  S.tab = tab;
  S.view = null;
  paint();
  if (tab === 'history' && S.current) lumen.git.log(S.current, { limit: 60 }).then(l => { S.log = l; paintHistory(); }, e => ui.toast(e.message, 'error'));
  if (tab === 'branches' && S.current) lumen.git.branches(S.current).then(b => { S.branches = b; paintBranches(); }, e => ui.toast(e.message, 'error'));
  if (tab === 'github') loadGithub().then(() => loadGithubTab());
}

async function handle(act, t, row) {
  const path = row?.dataset.path;
  switch (act) {
    case 'repos': S.view = S.view?.kind === 'repos' ? null : { kind: 'repos' }; paint(); return;
    case 'fetch': return doFetch();
    case 'pull': return doPull();
    case 'push': return doPush();
    case 'commit': return commit();
    case 'ai-message':
      if (!S.current) return;
      lumen.ai.ask(`Write a commit message for the staged changes of the git repository in "${S.current}". Inspect them with read-only commands (git diff --cached, git status), then answer with only the message: a short summary line, a blank line, then a few bullet points if useful.`);
      return;
    case 'stage': return op('stage', () => lumen.git.stage(S.current, [path]));
    case 'unstage': return op('stage', () => lumen.git.unstage(S.current, [path]));
    case 'stage-all': return op('stage', () => lumen.git.stageAll(S.current));
    case 'unstage-all': return op('stage', () => lumen.git.unstageAll(S.current));
    case 'discard':
      if (!ui.confirmClick(t, `Click again to discard your changes to ${base(path)}`)) return;
      return op('stage', () => lumen.git.discard(S.current, [path]), `Changes to ${base(path)} discarded`);
    case 'stash': return op('stash', () => lumen.git.stash(S.current), 'Changes stashed');
    case 'stash-pop': return op('stash', () => lumen.git.stashPop(S.current), 'Stash applied');
    case 'diff': {
      const staged = row.dataset.staged === '1';
      S.view = { kind: 'diff', path, staged, untracked: !!row.dataset.untracked, data: null };
      paint();
      S.view.data = await lumen.git.diff(S.current, path, { staged, untracked: !!row.dataset.untracked });
      paintView();
      return;
    }
    case 'show': {
      S.view = { kind: 'commit', hash: row.dataset.hash, data: null };
      paint();
      S.view.data = await lumen.git.show(S.current, row.dataset.hash);
      paintView();
      return;
    }
    case 'back': S.view = null; paint(); return;
    case 'view-stage':
      await (S.view.staged ? lumen.git.unstage(S.current, [S.view.path]) : lumen.git.stage(S.current, [S.view.path]));
      S.view = null; await refresh({ full: true }); return;
    case 'checkout':
      return op('branch', () => lumen.git.checkout(S.current, row.dataset.branch), `Switched to ${row.dataset.branch}`);
    case 'copy-hash': navigator.clipboard?.writeText(S.view?.data?.hash || ''); ui.toast('Commit hash copied'); return;
    // Repositories list
    case 'pick-repo': S.view = null; await select(row.dataset.root, { follow: false }); return;
    case 'follow': S.view = null; rootCache.clear(); { const r = await focusedRoot(); if (r) await select(r, { follow: true }); else { S.follow = true; ui.toast('The focused terminal is not inside a git repository'); paint(); } } return;
    case 'forget-repo':
      S.repos = S.repos.filter(r => !sameDir(r.root, row.dataset.root));
      await lumen.storage.set('repos', S.repos);
      paintReposView(); return;
    case 'terminal-repo': {
      const pane = await lumen.panes.create({ cwd: row.dataset.root });
      pane?.focus(); return;
    }
    case 'add-repo': {
      const dir = await ui.pickPath({ mode: 'folder', title: 'Choose a repository' });
      if (!dir) return;
      const root = await lumen.git.root(dir).catch(() => null);
      if (!root) { ui.toast('This folder is not a git repository', 'error'); return; }
      rememberRepo(root);
      S.view = null;
      await select(root, { follow: false });
      return;
    }
    case 'scan-repos': {
      const dir = await ui.pickPath({ mode: 'folder', title: 'Find repositories in…' });
      if (!dir) return;
      const found = await lumen.git.scan(dir);
      for (const root of found) rememberRepo(root);
      ui.toast(found.length ? `${found.length} repositor${found.length > 1 ? 'ies' : 'y'} found` : 'No repository found there');
      paintReposView();
      return;
    }
    case 'git-init': {
      const pane = lumen.panes.focused();
      if (pane) { pane.run('git init'); setTimeout(() => { rootCache.clear(); focusedRoot().then(r => r && select(r, { follow: true })); }, 1500); }
      return;
    }
    // GitHub
    case 'gh-login': return ghLogin();
    case 'gh-token': t.closest('.g-card').querySelector('.g-token').classList.toggle('hidden'); return;
    case 'gh-token-page': ui.openUrl('https://github.com/settings/tokens/new?scopes=repo,read:org,read:user&description=Lumen'); return;
    case 'gh-signout':
      if (S.gh?.via === 'gh') { if (ui.confirmClick(t, 'Click again: runs "gh auth logout" in a terminal')) ghLogin(true); return; }
      if (!ui.confirmClick(t, 'Click again to forget the token')) return;
      await lumen.github.signOut();
      S.gh = null; S.ghData = {};
      await loadGithub(true);
      return;
    case 'gh-cancel': S.waitingLogin = 0; paintGithub(); return;
    case 'open-url': ui.openUrl(row?.dataset.url || t.dataset.url); return;
    case 'clone': return cloneRepo(row.dataset.clone, row.dataset.name);
    case 'open-local': S.tab = 'changes'; await select(row.dataset.local, { follow: false }); return;
  }
}

async function commit() {
  if (!S.current || !S.st || S.busy.has('commit')) return;
  const amend = panel.$('.g-amend').checked;
  const message = panel.msg.value.trim();
  const staged = S.st.files.filter(f => f.index && !f.untracked).length;
  if (!message && !amend) { ui.toast('Write a commit message first'); panel.msg.focus(); return; }
  if (!staged && !S.st.files.length && !amend) { ui.toast('Nothing to commit'); return; }
  await op('commit', async () => {
    const line = await lumen.git.commit(S.current, message, { amend, all: !staged && !amend });
    panel.msg.value = '';
    panel.$('.g-amend').checked = false;
    return line;
  }, r => r || 'Committed');
}

// Clones into the folder of the focused terminal, with that terminal's own shell and git
// (a WSL pane clones inside WSL, a Windows pane on Windows). If it is busy, a new pane of the
// same shell opens in the same folder.
async function cloneRepo(url, name) {
  let pane = lumen.panes.focused();
  if (!pane || pane.running) {
    pane = await lumen.panes.create(pane ? { profile: pane.shell?.id, cwd: pane.cwd } : {});
    if (!pane) return;
    await pane.ready();
  }
  pane.run(`git clone "${url.replace(/"/g, '')}"`);
  pane.focus();
  const dir = pane.cwd || '';
  if (/^[a-z]:\\/i.test(dir)) rememberRepo(dir.replace(/[\\/]+$/, '') + '\\' + name, url);
  ui.toast(`Cloning ${name} into ${ui.prettyPath(dir) || 'the terminal folder'} (${pane.shell?.name || 'terminal'})`);
}

// ─── Painting ────────────────────────────────────────────────────────

function paint() {
  if (!panel) return;
  paintHead();
  const viewing = !!S.view;
  panel.$('.g-main').classList.toggle('hidden', viewing);
  panel.$('.g-view').classList.toggle('hidden', !viewing);
  panel.el.querySelectorAll('.g-tabs [data-tab]').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  panel.el.querySelectorAll('[data-body]').forEach(b => b.classList.toggle('hidden', b.dataset.body !== S.tab));
  const n = S.st?.files.length || 0;
  panel.$('[data-tab="changes"]').innerHTML = `Changes${n ? ` <span class="g-n">${n}</span>` : ''}`;
  if (viewing) { if (S.view.kind === 'repos') paintReposView(); else paintView(); return; }
  if (S.tab === 'changes') paintChanges();
  if (S.tab === 'history') paintHistory();
  if (S.tab === 'branches') paintBranches();
  if (S.tab === 'github') paintGithub();
}

function paintHead() {
  if (!panel) return;
  const st = S.st;
  const head = panel.$('.g-head');
  const name = st ? st.name : S.current ? base(S.current) : 'No repository';
  const busy = k => (S.busy.has(k) ? ' g-busy' : '');
  const noRemote = !st?.remote;
  head.innerHTML = `
    <button class="g-repo" data-act="repos" title="${esc(st?.root || 'Choose a repository')}">
      ${svg(P.repo)}<span class="g-name">${esc(name)}</span>
      ${st ? `<span class="g-path">${esc(ui.prettyPath(st.root))}</span>` : ''}${svg(P.chevron)}
    </button>
    ${st ? `
      <div class="g-line">
        <button class="g-branch" data-tab="branches" title="Branches">${svg(P.branch)}<span>${esc(st.branch || `detached ${String(st.oid).slice(0, 7)}`)}</span></button>
        ${st.upstream ? `<span class="g-ab" title="${esc(st.upstream)}">${st.ahead ? `<b>↑${st.ahead}</b>` : ''}${st.behind ? `<b>↓${st.behind}</b>` : ''}${!st.ahead && !st.behind ? 'up to date' : ''}</span>` : `<span>${noRemote ? 'no remote' : 'not published'}</span>`}
        <span class="g-fetched">${st.remote ? (st.lastFetch ? `fetched ${ago(st.lastFetch)}` : 'never fetched') : ''}</span>
      </div>
      <div class="g-sync">
        <button class="s-btn ghost${busy('fetch')}" data-act="fetch" ${noRemote ? 'disabled' : ''} title="Download remote changes without merging">${svg(P.fetch)}Fetch</button>
        <button class="s-btn ghost${busy('pull')}" data-act="pull" ${noRemote || !st.upstream ? 'disabled' : ''} title="Fetch and merge into ${esc(st.branch || '')}">${svg(P.pull)}Pull${st.behind ? `<span class="g-count">${st.behind}</span>` : ''}</button>
        <button class="s-btn ${st.ahead || (!st.upstream && !noRemote) ? '' : 'ghost'}${busy('push')}" data-act="push" ${noRemote ? 'disabled' : ''} title="${st.upstream ? `Push to ${esc(st.upstream)}` : 'Publish this branch on origin'}">${svg(P.push)}${st.upstream ? 'Push' : 'Publish'}${st.ahead ? `<span class="g-count">${st.ahead}</span>` : ''}</button>
      </div>` : ''}`;
}

function noRepo(target) {
  target.innerHTML = `
    <p class="p-empty">${S.error && S.current ? esc(S.error)
      : lumen.panes.focused()?.shell?.kind === 'wsl' ? 'This is a WSL terminal: the panel works on Windows folders. Run git in the terminal, or open a Windows folder.'
      : `<b>${esc(ui.prettyPath(lumen.panes.focused()?.cwd || '') || 'This folder')}</b> is not a git repository.`}</p>
    <div class="g-empty-actions">
      <button class="s-btn ghost" data-act="repos">${svg(P.repo)} Your repositories (${S.repos.length})</button>
      <button class="s-btn ghost" data-act="add-repo">${ui.icon('folder')} Open a repository…</button>
      <button class="s-btn ghost" data-act="scan-repos">${ui.icon('search')} Find repositories in a folder…</button>
      <button class="s-btn ghost" data-act="git-init">${ui.icon('plus')} git init in the focused terminal</button>
    </div>`;
}

function paintCommitButton() {
  if (!panel || !S.st) return;
  const btn = panel.$('[data-act="commit"]');
  const amend = panel.$('.g-amend').checked;
  const staged = S.st.files.filter(f => f.index && !f.untracked).length;
  const all = S.st.files.length;
  btn.classList.toggle('g-busy', S.busy.has('commit'));
  btn.disabled = S.busy.has('commit') || (!amend && (!all || !panel.msg.value.trim()));
  btn.textContent = amend ? 'Amend last commit' : staged ? `Commit ${staged} file${staged > 1 ? 's' : ''}` : all ? `Commit all (${all})` : 'Commit';
}

function paintChanges() {
  if (!panel || S.tab !== 'changes' || S.view) return;
  const box = panel.$('.g-commit-box');
  const target = panel.$('.g-changes');
  if (!S.st) { box.classList.add('hidden'); if (S.current && !S.error) target.innerHTML = loading(); else noRepo(target); return; }
  box.classList.remove('hidden');
  paintCommitButton();
  const st = S.st;
  const staged = st.files.filter(f => f.index && !f.untracked && !f.conflict);
  const changes = st.files.filter(f => f.work || f.conflict);
  const conflicts = st.files.filter(f => f.conflict).length;
  const extra = ghExtra();
  const repo = githubRepo(st.remote);
  let gh = '';
  if (repo) {
    const parts = [];
    if (extra?.pr) parts.push(`<button class="p-link" data-act="open-url" data-url="${esc(extra.pr.url)}">${svg(P.pr)} PR #${extra.pr.number}${extra.pr.draft ? ' (draft)' : ''}: ${esc(extra.pr.title)}</button>`);
    else if (extra && st.branch && extra.defaultBranch && st.branch !== extra.defaultBranch && st.upstream) parts.push(`<button class="p-link" data-act="open-url" data-url="${esc(`${extra.htmlUrl}/compare/${encodeURIComponent(st.branch)}?expand=1`)}">${svg(P.pr)} Create a pull request</button>`);
    if (extra?.checks) {
      const c = extra.checks;
      const [cls, text] = c.failed ? ['g-bad', `✕ ${c.failed} check${c.failed > 1 ? 's' : ''} failing`] : c.running ? ['g-run', `● ${c.running} check${c.running > 1 ? 's' : ''} running`] : ['g-ok', `✓ ${c.total} check${c.total > 1 ? 's' : ''} passed`];
      parts.push(`<button class="p-link ${cls}" data-act="open-url" data-url="${esc(c.url)}">${text}</button>`);
    }
    parts.push(`<button class="p-link" data-act="open-url" data-url="${esc(`https://github.com/${repo.full}`)}">${GITHUB} ${esc(repo.full)}</button>`);
    gh = `<div class="g-ghline">${parts.join('')}</div>`;
  }
  target.innerHTML = `
    ${st.state || conflicts ? `<div class="g-banner">${st.state ? `${st.state[0].toUpperCase()}${st.state.slice(1)} in progress. ` : ''}${conflicts ? `${conflicts} file${conflicts > 1 ? 's' : ''} with conflicts: fix them, stage them, then commit.` : ''}</div>` : ''}
    ${gh}
    ${staged.length ? `
      <div class="p-section-title">Staged <span class="g-muted">${staged.length}</span><button class="p-link" data-act="unstage-all">Unstage all</button></div>
      <div class="p-list">${staged.map(f => fileRow(f, true)).join('')}</div>` : ''}
    <div class="p-section-title">Changes <span class="g-muted">${changes.length}</span>
      ${changes.length ? `<button class="p-link" data-act="stash" style="margin-left:auto">Stash</button><button class="p-link" data-act="stage-all" style="margin-left:8px">Stage all</button>` : ''}
    </div>
    <div class="p-list">${changes.map(f => fileRow(f, false)).join('') || `<p class="p-empty">${staged.length ? 'Everything is staged.' : 'Working tree clean.'}</p>`}</div>
    ${st.stashes ? `<div class="p-section-title">Stashes <span class="g-muted">${st.stashes}</span><button class="p-link" data-act="stash-pop">Apply the latest</button></div>` : ''}`;
}

function paintHistory() {
  if (!panel || S.tab !== 'history' || S.view) return;
  const target = panel.el.querySelector('[data-body="history"]');
  if (!S.current || (!S.st && S.error)) return noRepo(target);
  if (!S.log) { target.innerHTML = loading(); return; }
  // r: { name, type: 'head' | 'branch' | 'remote' | 'tag' }
  const refHtml = r => `<span class="g-ref ${r.type === 'remote' || r.type === 'tag' ? r.type : ''}" title="${r.type === 'head' ? 'Current branch' : r.type}">${esc(r.name)}</span>`;
  const unpushed = S.log.filter(c => c.unpushed).length;
  target.innerHTML = `
    ${unpushed ? `<p class="p-foot" style="margin:0 2px 8px">${unpushed} commit${unpushed > 1 ? 's' : ''} not pushed yet (filled dots).</p>` : ''}
    <div class="p-list">${S.log.map(c => `
      <div class="p-row g-commit" data-act="show" data-hash="${esc(c.hash)}" title="${esc(c.subject)}">
        <span class="g-dot${c.unpushed ? ' unpushed' : ''}"></span>
        <span class="p-row-main">
          <span class="p-row-title">${esc(c.subject)}</span>
          <span class="p-row-sub"><span class="mono">${esc(c.short)}</span> · ${esc(c.author)} · ${ago(c.at)}${c.merge ? ' · merge' : ''}</span>
          ${c.refs.length ? `<span class="g-refs">${c.refs.map(refHtml).join('')}</span>` : ''}
        </span>
      </div>`).join('') || '<p class="p-empty">No commits yet.</p>'}</div>`;
}

function paintBranches() {
  if (!panel || S.tab !== 'branches' || S.view) return;
  const form = panel.$('.g-new-branch');
  const target = panel.$('.g-branch-list');
  if (!S.current || (!S.st && S.error)) { form.classList.add('hidden'); return noRepo(target); }
  form.classList.remove('hidden');
  if (!S.branches) { target.innerHTML = loading(); return; }
  const row = b => `
    <div class="p-row" ${b.current ? '' : 'data-act="checkout"'} data-branch="${esc(b.name)}" title="${b.current ? 'Current branch' : `Switch to ${esc(b.name)}`}">
      <span class="p-row-icon ${b.current ? 'g-current' : ''}">${svg(b.current ? P.check : P.branch)}</span>
      <span class="p-row-main">
        <span class="p-row-title">${esc(b.name)}</span>
        <span class="p-row-sub">${b.upstream ? `${esc(b.upstream)} ${esc(b.track)} · ` : ''}${ago(b.at)}</span>
      </span>
    </div>`;
  const local = S.branches.filter(b => !b.remote);
  const remote = S.branches.filter(b => b.remote);
  target.innerHTML = `
    <div class="p-section-title">Local <span class="g-muted">${local.length}</span></div>
    <div class="p-list">${local.map(row).join('') || '<p class="p-empty">No branches yet (make a first commit).</p>'}</div>
    ${remote.length ? `<div class="p-section-title">Remote <span class="g-muted">${remote.length}</span></div><div class="p-list">${remote.map(row).join('')}</div>` : ''}`;
}

function paintView() {
  if (!panel || !S.view) return;
  const v = S.view;
  const target = panel.$('.g-view');
  if (v.kind === 'diff') {
    const d = v.data;
    target.innerHTML = `
      <div class="g-view-head">
        <button class="p-icon-btn" data-act="back" title="Back">${ui.icon('back')}</button>
        <span class="g-title" title="${esc(v.path)}">${esc(v.path)}</span>
        <button class="s-btn ghost" data-act="view-stage">${v.staged ? 'Unstage' : 'Stage'}</button>
      </div>
      ${!d ? loading() : d.binary ? '<p class="p-empty">Binary file.</p>' : d.truncated && !d.text ? '<p class="p-empty">File too large to show.</p>' : `<pre class="g-diff">${diffHtml(d.text || '(no textual change)')}</pre>`}`;
  } else if (v.kind === 'commit') {
    const d = v.data;
    target.innerHTML = `
      <div class="g-view-head">
        <button class="p-icon-btn" data-act="back" title="Back">${ui.icon('back')}</button>
        <span class="g-title mono">${esc(String(v.hash).slice(0, 10))}</span>
        <button class="p-icon-btn" data-act="copy-hash" title="Copy the full hash">${ui.icon('copy')}</button>
      </div>
      ${!d ? loading() : `
        <pre class="g-msg">${esc(d.message)}</pre>
        <div class="g-meta">${esc(d.author)} · ${new Date(d.at).toLocaleString('en-GB')}</div>
        <pre class="g-diff">${diffHtml(d.patch.trim())}</pre>`}`;
  }
}

async function paintReposView() {
  if (!panel || S.view?.kind !== 'repos') return;
  const target = panel.$('.g-view');
  const rows = S.repos.map(r => `
    <div class="p-row g-repo-row${sameDir(r.root, S.current) ? ' active' : ''}" data-act="pick-repo" data-root="${esc(r.root)}" title="${esc(r.root)}">
      <span class="p-row-icon">${githubRepo(r.remote) ? GITHUB : svg(P.repo)}</span>
      <span class="p-row-main"><span class="p-row-title">${esc(base(r.root))}</span><span class="p-row-sub" data-summary>${esc(ui.prettyPath(r.root))}</span></span>
      <span class="p-row-actions">
        <button data-act="terminal-repo" title="Open a terminal here">${ui.icon('terminal')}</button>
        <button data-act="forget-repo" title="Remove from the list">${ui.icon('x')}</button>
      </span>
    </div>`).join('');
  target.innerHTML = `
    <div class="g-view-head">
      <button class="p-icon-btn" data-act="back" title="Back">${ui.icon('back')}</button>
      <span class="g-title">Your repositories</span>
    </div>
    <div class="p-buttons">
      <button class="s-btn ghost" data-act="follow">${ui.icon('terminal')} Follow the terminal${S.follow ? ' ✓' : ''}</button>
      <button class="s-btn ghost" data-act="add-repo">${ui.icon('folder')} Open…</button>
      <button class="s-btn ghost" data-act="scan-repos">${ui.icon('search')} Find in a folder…</button>
    </div>
    <div class="p-list">${rows || '<p class="p-empty">Repositories you open in a terminal show up here.</p>'}</div>`;
  // Fill each row with a quick status (branch, ahead/behind, changes).
  for (const r of S.repos) {
    lumen.git.summary(r.root).then(s => {
      const cell = target.querySelector(`[data-root="${CSS.escape(r.root)}"] [data-summary]`);
      if (!cell) return;
      if (!s) { cell.textContent = 'not found'; return; }
      const dirty = s.staged + s.modified + s.untracked + s.conflicts;
      cell.textContent = [s.branch, s.ahead ? `↑${s.ahead}` : '', s.behind ? `↓${s.behind}` : '', dirty ? `${dirty} change${dirty > 1 ? 's' : ''}` : 'clean'].filter(Boolean).join(' · ');
    }).catch(() => {});
  }
}

function paintGithub() {
  if (!panel || S.tab !== 'github' || S.view) return;
  const target = panel.el.querySelector('[data-body="github"]');
  const gh = S.gh;
  if (!gh) { target.innerHTML = loading(); return; }
  if (!gh.connected) {
    target.innerHTML = `
      <div class="g-card">
        <p>${gh.error ? `${esc(gh.error)}<br>` : ''}Sign in to see your repositories, pull requests, issues, activity and contributions, and the PR and CI status of the current branch.</p>
        ${S.waitingLogin ? `<p>Finish signing in in the terminal (a browser page opens)… <button class="p-link" data-act="gh-cancel">Cancel</button></p>` : `
        <div class="p-buttons">
          <button class="s-btn" data-act="gh-login">${GITHUB} Sign in with GitHub</button>
          <button class="s-btn ghost" data-act="gh-token">Use a token</button>
        </div>`}
        <p style="margin:10px 0 0">Uses the official GitHub CLI${gh.gh ? '' : ' (installed first, with winget)'} with your own account. Lumen stores no password.</p>
        <form class="g-token hidden">
          <input class="p-search" name="token" type="password" placeholder="ghp_… or github_pat_…" autocomplete="off" spellcheck="false">
          <button class="s-btn" type="submit">Save</button>
        </form>
        <p class="g-token-help" style="margin:8px 0 0"><button class="p-link" data-act="gh-token-page">Create a token on github.com</button> (scopes: repo, read:org). Stored encrypted.</p>
      </div>`;
    return;
  }
  const u = gh.user;
  const contrib = S.ghData.contrib;
  let heat = '';
  if (contrib?.value) {
    const days = contrib.value.weeks.flat();
    const max = Math.max(1, ...days.map(d => d.count));
    const level = c => (!c ? 0 : Math.min(4, Math.ceil((c / max) * 4)));
    heat = `
      <div class="g-heat">${contrib.value.weeks.map((w, i) => (i === 0 ? Array(7 - w.length).fill('<i style="visibility:hidden"></i>').join('') : '') + w.map(d => `<i class="l${level(d.count)}" title="${d.count} contribution${d.count === 1 ? '' : 's'} on ${esc(d.date)}"></i>`).join('')).join('')}</div>
      <div class="g-heat-foot"><span>${contrib.value.total.toLocaleString('en-US')} contributions in the last year</span><span>${days.slice(-7).reduce((a, d) => a + d.count, 0)} this week</span></div>`;
  } else if (contrib?.error) heat = `<p class="p-empty">${esc(contrib.error)}</p>`;
  else heat = loading('Loading contributions…');
  target.innerHTML = `
    <div class="g-profile">
      <img src="${esc(u.avatar)}" alt="">
      <div class="g-who"><b>${esc(u.name || u.login)}</b><span>@${esc(u.login)} · ${u.followers} followers · ${u.repos} repos${gh.via === 'gh' ? ' · via GitHub CLI' : ''}</span></div>
      <button class="p-icon-btn" data-act="open-url" data-url="${esc(u.url)}" title="Open your profile">${ui.icon('external')}</button>
      <button class="p-link" data-act="gh-signout">Sign out</button>
    </div>
    ${heat}
    <div class="p-tabs">
      ${[['repos', 'Repos'], ['prs', 'PRs'], ['issues', 'Issues'], ['activity', 'Activity']].map(([id, label]) => `<button data-ghtab="${id}" class="${S.ghTab === id ? 'active' : ''}">${label}</button>`).join('')}
    </div>
    ${S.ghTab === 'repos' ? `<input class="p-search g-filter" placeholder="Filter repositories…" spellcheck="false" value="${esc(S.ghFilter || '')}">` : ''}
    <div class="g-gh-list"></div>`;
  paintGithubList();
}

function issueRow(i) {
  const repo = i.repository_url.split('/').slice(-2).join('/');
  return `
    <div class="p-row" data-act="open-url" data-url="${esc(i.html_url)}" title="${esc(i.title)}">
      <span class="p-row-icon">${svg(i.pull_request ? P.pr : P.issue)}</span>
      <span class="p-row-main">
        <span class="p-row-title">${esc(i.title)}</span>
        <span class="p-row-sub">${esc(repo)} #${i.number}${i.draft ? ' · draft' : ''} · ${esc(i.user?.login || '')} · ${ago(i.updated_at)}${i.comments ? ` · ${i.comments} comment${i.comments > 1 ? 's' : ''}` : ''}</span>
      </span>
    </div>`;
}

function eventText(e) {
  const p = e.payload || {};
  const ref = (p.ref || '').replace('refs/heads/', '');
  switch (e.type) {
    case 'PushEvent': { const n = p.size ?? p.commits?.length ?? p.distinct_size; return n ? `pushed ${n} commit${n > 1 ? 's' : ''} to ${ref}` : `pushed to ${ref}`; }
    case 'CreateEvent': return `created ${p.ref_type}${p.ref ? ` ${p.ref}` : ''}`;
    case 'DeleteEvent': return `deleted ${p.ref_type} ${p.ref}`;
    case 'PullRequestEvent': return `${p.action} PR #${p.number || p.pull_request?.number}${p.pull_request?.title ? `: ${p.pull_request.title}` : ''}`;
    case 'PullRequestReviewEvent': return `reviewed PR #${p.pull_request?.number}`;
    case 'PullRequestReviewCommentEvent': return `commented on PR #${p.pull_request?.number}`;
    case 'IssuesEvent': return `${p.action} issue #${p.issue?.number}: ${p.issue?.title || ''}`;
    case 'IssueCommentEvent': return `commented on #${p.issue?.number}`;
    case 'WatchEvent': return 'starred';
    case 'ForkEvent': return 'forked';
    case 'ReleaseEvent': return `${p.action} release ${p.release?.tag_name || ''}`;
    case 'PublicEvent': return 'made public';
    case 'MemberEvent': return `${p.action} a collaborator`;
    default: return e.type.replace(/Event$/, '').toLowerCase();
  }
}

function paintGithubList() {
  if (!panel || S.tab !== 'github') return;
  const target = panel.$('.g-gh-list');
  if (!target) return;
  const state = key => {
    const d = S.ghData[key];
    if (!d) return { html: loading() };
    if (d.error) return { html: `<p class="p-empty">${esc(d.error)}</p>` };
    return { value: d.value };
  };
  if (S.ghTab === 'repos') {
    const { html, value } = state('repos');
    if (html) { target.innerHTML = html; return; }
    const q = S.ghFilter || '';
    const local = r => S.repos.find(x => githubRepo(x.remote)?.full.toLowerCase() === r.full_name.toLowerCase());
    const list = value.filter(r => !q || `${r.full_name} ${r.description || ''} ${r.language || ''}`.toLowerCase().includes(q));
    target.innerHTML = `<div class="p-list">${list.map(r => {
      const here = local(r);
      return `
      <div class="p-row" data-url="${esc(r.html_url)}" data-clone="${esc(r.clone_url)}" data-name="${esc(r.name)}"${here ? ` data-local="${esc(here.root)}"` : ''} data-act="${here ? 'open-local' : 'open-url'}" title="${here ? `Show ${esc(here.root)}` : 'Open on GitHub'}">
        <span class="p-row-icon">${svg(r.private ? P.lock : P.repo)}</span>
        <span class="p-row-main">
          <span class="p-row-title">${esc(r.owner.login === S.gh.user.login ? r.name : r.full_name)}${r.fork ? ' <span class="g-muted">fork</span>' : ''}${r.archived ? ' <span class="g-muted">archived</span>' : ''}</span>
          ${r.description ? `<span class="p-row-sub">${esc(r.description)}</span>` : ''}
          <span class="g-stats">
            ${r.language ? `<span><i class="g-lang"></i>${esc(r.language)}</span>` : ''}
            <span>${svg(P.star)}${r.stargazers_count}</span>
            ${r.open_issues_count ? `<span>${svg(P.issue)}${r.open_issues_count}</span>` : ''}
            <span>${ago(r.pushed_at)}</span>
            ${here ? '<span class="g-ok">✓ cloned</span>' : ''}
          </span>
        </span>
        <span class="p-row-actions">
          ${here ? '' : `<button data-act="clone" title="Clone…">${svg(P.pull)}</button>`}
          <button data-act="open-url" title="Open on GitHub">${ui.icon('external')}</button>
        </span>
      </div>`;
    }).join('') || '<p class="p-empty">No repositories.</p>'}</div>`;
  } else if (S.ghTab === 'prs') {
    const reviews = state('reviews');
    const mine = state('mine');
    target.innerHTML = `
      <div class="p-section-title">Review requested${reviews.value ? ` <span class="g-muted">${reviews.value.total_count}</span>` : ''}</div>
      ${reviews.html || `<div class="p-list">${reviews.value.items.map(issueRow).join('') || '<p class="p-empty">Nothing to review.</p>'}</div>`}
      <div class="p-section-title">Yours${mine.value ? ` <span class="g-muted">${mine.value.total_count}</span>` : ''}</div>
      ${mine.html || `<div class="p-list">${mine.value.items.map(issueRow).join('') || '<p class="p-empty">No open pull requests.</p>'}</div>`}`;
  } else if (S.ghTab === 'issues') {
    const { html, value } = state('issues');
    target.innerHTML = html || `<div class="p-section-title">Assigned to you <span class="g-muted">${value.total_count}</span></div><div class="p-list">${value.items.map(issueRow).join('') || '<p class="p-empty">No open issues assigned to you.</p>'}</div>`;
  } else if (S.ghTab === 'activity') {
    const { html, value } = state('events');
    target.innerHTML = html || `<div class="p-list">${value.map(e => `
      <div class="p-row" data-act="open-url" data-url="${esc(`https://github.com/${e.repo.name}`)}">
        <span class="p-row-main">
          <span class="p-row-title">${esc(eventText(e))}</span>
          <span class="p-row-sub">${esc(e.repo.name)} · ${ago(e.created_at)}</span>
        </span>
      </div>`).join('') || '<p class="p-empty">No recent activity.</p>'}</div>`;
  }
}

// ─── Following the terminal, background refresh ─────────────────────

// Shows the repository of the focused terminal's folder, or "not a git repository".
async function followFocused() {
  if (!S.follow) return;
  rootCache.delete(lumen.panes.focused()?.cwd);
  const root = await focusedRoot();
  if (!S.follow) return;
  if (root && !sameDir(root, S.current)) {
    rememberRepo(root);
    if (panel && lumen.sidebar.isOpen('panel')) await select(root, { follow: true });
    else { S.current = root; S.st = null; S.log = null; S.branches = null; }
  } else if (!root && S.current) {
    S.current = null; S.st = null; S.log = null; S.branches = null; S.error = null;
    if (S.view?.kind !== 'repos') S.view = null;
    paint();
  }
}

lumen.on('pane:focused', () => followFocused());
// cd in the focused terminal: follow it again, even after picking another repository.
lumen.on('cwd:changed', dir => { if (dir && dir === lumen.panes.focused()?.cwd) { S.follow = true; followFocused(); } });

// While the panel is open (and Lumen focused), keep the status live.
setInterval(() => {
  if (!panel || !lumen.sidebar.isOpen('panel') || !document.hasFocus() || S.busy.size || S.view) return;
  refresh();
}, 4000);

loadRepos();

// ─── Commands ────────────────────────────────────────────────────────

async function withRepo(fn) {
  const root = (S.follow && await focusedRoot()) || S.current;
  if (!root) { ui.toast('The focused terminal is not inside a git repository'); return; }
  if (!sameDir(root, S.current)) { S.current = root; S.st = null; S.log = null; S.branches = null; }
  return fn();
}

lumen.commands.register('panel.git', {
  title: 'Git & GitHub',
  keywords: 'git github repository commit push pull branch',
  keybinding: 'Ctrl+Shift+G',
  run: () => lumen.sidebar.toggle('panel')
});
lumen.commands.register('git.commit', { title: 'Git: commit…', keywords: 'git commit', run: () => lumen.sidebar.open('panel', 'commit') });
lumen.commands.register('git.fetch', { title: 'Git: fetch', keywords: 'git fetch remote', run: () => withRepo(() => doFetch()) });
lumen.commands.register('git.pull', { title: 'Git: pull', keywords: 'git pull', run: () => withRepo(() => doPull()) });
lumen.commands.register('git.push', { title: 'Git: push', keywords: 'git push publish', run: () => withRepo(() => doPush()) });
lumen.commands.register('git.github', {
  title: 'GitHub: account, pull requests, issues',
  keywords: 'github pr issues',
  run: async () => { await lumen.sidebar.open('panel'); setTab('github'); }
});
