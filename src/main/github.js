// GitHub account for the built-in Git plugin. Lumen has no OAuth app of its own: the user signs
// in with the official GitHub CLI (`gh auth login`, their own account) or pastes a personal
// access token, which is stored encrypted. The token never leaves the main process: the page
// only gets read-only API results.
const fs = require('fs');
const { execFile } = require('child_process');
const store = require('./store');
const { findCommand } = require('./shells');

const API = 'https://api.github.com';
const SECRET = 'github-token';

function ghPath() {
  return findCommand('gh') || [
    'C:\\Program Files\\GitHub CLI\\gh.exe',
    `${process.env.LOCALAPPDATA || ''}\\Programs\\GitHub CLI\\gh.exe`,
    '/opt/homebrew/bin/gh', '/usr/local/bin/gh', '/usr/bin/gh'
  ].find(p => p && fs.existsSync(p)) || null;
}

let ghCache = { at: 0, token: null };

function ghToken() {
  const gh = ghPath();
  if (!gh) return Promise.resolve(null);
  if (Date.now() - ghCache.at < 60000) return Promise.resolve(ghCache.token);
  return new Promise(resolve => {
    execFile(gh, ['auth', 'token', '--hostname', 'github.com'], { timeout: 8000, windowsHide: true }, (err, out) => {
      ghCache = { at: Date.now(), token: err ? null : out.trim() || null };
      resolve(ghCache.token);
    });
  });
}

async function credentials() {
  const saved = store.getSecret(SECRET);
  if (saved) return { token: saved, via: 'token' };
  const token = await ghToken();
  return token ? { token, via: 'gh' } : null;
}

async function request(token, pathname, { method = 'GET', body = null } = {}) {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Lumen-terminal',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) throw Object.assign(new Error('GitHub refused the credentials (expired or revoked token)'), { status: 401 });
  if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') throw new Error('GitHub API rate limit reached, try again in a few minutes');
  if (!res.ok) {
    let msg = `GitHub: HTTP ${res.status}`;
    try { msg = `GitHub: ${(await res.json()).message || msg}`; } catch {}
    throw Object.assign(new Error(msg), { status: res.status });
  }
  return res.status === 204 ? null : res.json();
}

let userCache = { at: 0, key: null, user: null };

async function status() {
  const gh = ghPath();
  const cred = await credentials();
  if (!cred) return { connected: false, gh: !!gh };
  try {
    if (userCache.key !== cred.token || Date.now() - userCache.at > 300000) {
      const u = await request(cred.token, '/user');
      userCache = { at: Date.now(), key: cred.token, user: { login: u.login, name: u.name, avatar: u.avatar_url, url: u.html_url, followers: u.followers, following: u.following, repos: u.public_repos + (u.total_private_repos || 0), bio: u.bio } };
    }
    return { connected: true, via: cred.via, gh: !!gh, user: userCache.user };
  } catch (e) {
    return { connected: false, gh: !!gh, error: e.message, via: cred.via };
  }
}

// Read-only access to the REST API for the plugin: GET on api.github.com paths only.
async function get(pathname) {
  pathname = String(pathname || '');
  if (!/^\/[\w\-./?=&%:@+,~*]*$/.test(pathname) || pathname.includes('..')) throw new Error('invalid GitHub API path');
  const cred = await credentials();
  if (!cred) throw new Error('not signed in to GitHub');
  return request(cred.token, pathname);
}

// Contribution calendar (the green squares) for the signed-in user.
async function contributions() {
  const cred = await credentials();
  if (!cred) throw new Error('not signed in to GitHub');
  const query = 'query { viewer { contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount color } } } } } }';
  const data = await request(cred.token, '/graphql', { method: 'POST', body: { query } });
  if (data.errors?.length) throw new Error(`GitHub: ${data.errors[0].message}`);
  const cal = data.data.viewer.contributionsCollection.contributionCalendar;
  return { total: cal.totalContributions, weeks: cal.weeks.map(w => w.contributionDays.map(d => ({ date: d.date, count: d.contributionCount }))) };
}

async function setToken(token) {
  token = String(token || '').trim();
  if (!/^[\w-]{20,255}$/.test(token)) throw new Error('this does not look like a GitHub token');
  await request(token, '/user'); // reject a bad token before saving it
  store.setSecret(SECRET, token);
  userCache = { at: 0, key: null, user: null };
  return status();
}

// Forgets the saved token. A GitHub CLI sign-in belongs to the CLI: `gh auth logout` ends it.
function signOut() {
  store.setSecret(SECRET, null);
  userCache = { at: 0, key: null, user: null };
  ghCache = { at: 0, token: null };
}

function refresh() {
  ghCache = { at: 0, token: null };
  userCache = { at: 0, key: null, user: null };
}

module.exports = { status, get, contributions, setToken, signOut, refresh, ghPath };
