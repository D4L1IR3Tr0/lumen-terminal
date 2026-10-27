// Embedded agents: Lumen as an Agent Client Protocol (ACP) client. The user's own AI CLIs
// (Gemini CLI, Codex, Claude Code, Mistral Vibe) run as subprocesses speaking JSON-RPC over
// stdio, and their conversation is shown in the AI panel instead of a terminal.
//
// Safety rules:
//   - permission requests go to the user (Allow / Deny), unless they switched "Auto" on;
//   - commands the agent runs through ACP terminals run in a visible Lumen pane;
//   - Lumen's own tools reach the agent through an MCP server on stdio, which talks to this
//     process over a local pipe guarded by a per-session token (no network port);
//   - Lumen never sees the user's credentials: each CLI signs in with its own account.
// Spec: https://agentclientprotocol.com
const fs = require('fs');
const os = require('os');
const net = require('net');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { findCommand } = require('./shells');

const PROTOCOL_VERSION = 1;

// How each agent starts in ACP mode. "npx" adapters are downloaded on first use.
const AGENTS = {
  gemini: { name: 'Gemini CLI', command: 'gemini', args: ['--acp'], needs: 'gemini' },
  codex: { name: 'Codex', npx: '@agentclientprotocol/codex-acp', needs: 'codex' },
  claude: { name: 'Claude Code', npx: '@agentclientprotocol/claude-agent-acp', needs: 'claude' },
  vibe: { name: 'Mistral Vibe', command: 'vibe-acp', needs: 'vibe-acp' }
};

// Development only: LUMEN_ACP_MOCK=<script> adds a scripted agent to test the whole flow.
if (process.env.LUMEN_ACP_MOCK) AGENTS.mock = { name: 'Mock agent', node: process.env.LUMEN_ACP_MOCK };

let deps = null; // { openTerminal(wc, spec), version, mcpScript, nodeBinary }
const sessions = new Map(); // webContents id -> Session

const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b[@-Z\\-_]/g, '');

// ─── Local bridge for Lumen's MCP server (one per app) ────────────────

let bridgePath = null;
const tokens = new Map(); // token -> Session

function startBridge() {
  if (bridgePath) return bridgePath;
  const id = `lumen-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  bridgePath = process.platform === 'win32' ? `\\\\.\\pipe\\${id}` : path.join(os.tmpdir(), `${id}.sock`);
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buf = '';
    socket.on('data', chunk => {
      buf += chunk;
      let n;
      while ((n = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, n);
        buf = buf.slice(n + 1);
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        const reply = r => { if (!socket.destroyed) socket.write(JSON.stringify({ id: msg.id, ...r }) + '\n'); };
        const s = tokens.get(msg.token);
        if (!s) { reply({ isError: true, content: 'Unknown or expired Lumen session.' }); continue; }
        s.mcpCall(String(msg.tool), msg.args || {}).then(reply, err => reply({ isError: true, content: err.message }));
      }
    });
    socket.on('error', () => {});
  });
  server.on('error', err => console.error('lumen bridge', err));
  if (process.platform !== 'win32') { try { fs.unlinkSync(bridgePath); } catch {} }
  server.listen(bridgePath, () => { if (process.platform !== 'win32') { try { fs.chmodSync(bridgePath, 0o600); } catch {} } });
  return bridgePath;
}

// ─── JSON-RPC over newline-delimited stdio ────────────────────────────

class Rpc {
  constructor(child, onRequest, onNotification) {
    this.child = child;
    this.seq = 0;
    this.pending = new Map();
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buf += chunk;
      let n;
      while ((n = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, n).trim();
        buf = buf.slice(n + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch { continue; }
        if (msg.method && msg.id !== undefined && msg.id !== null) {
          Promise.resolve()
            .then(() => onRequest(msg.method, msg.params || {}))
            .then(result => this.write({ id: msg.id, result: result ?? null }),
              err => this.write({ id: msg.id, error: { code: err.code || -32603, message: String(err.message || err) } }));
        } else if (msg.method) {
          onNotification(msg.method, msg.params || {});
        } else if (this.pending.has(msg.id)) {
          const p = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'agent error'), { code: msg.error.code, data: msg.error.data }));
          else p.resolve(msg.result);
        }
      }
    });
  }

  write(msg) {
    if (this.child.stdin.writable) this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      this.write({ id, method, params });
    });
  }

  notify(method, params) {
    this.write({ method, params });
  }

  failAll(err) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

// npm shims (.cmd) only start through cmd.exe. "/s /c" strips one pair of outer quotes, so the
// whole line is wrapped once more; spawn() passes it verbatim.
function cmdLine(line) {
  return { file: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], verbatim: true };
}

// ─── One agent session per window ─────────────────────────────────────

class Session {
  constructor(wc, agentId, opts) {
    this.wc = wc;
    this.agentId = agentId;
    this.agent = AGENTS[agentId];
    this.cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : os.homedir();
    this.auto = !!opts.auto;
    this.token = crypto.randomBytes(24).toString('hex');
    this.permissions = new Map(); // request id -> resolve
    this.mcpCalls = new Map();    // call id -> resolve
    this.terminals = new Map();   // terminal id -> { ptyId, output, truncated, limit, exit, waiters, kill }
    this.seq = 0;
    this.stderr = '';
    this.sessionId = null;
    this.closed = false;
    tokens.set(this.token, this);
  }

  send(event) {
    if (!this.wc.isDestroyed()) this.wc.send('acp:event', { agent: this.agentId, ...event });
  }

  // Command line that starts the agent in ACP mode.
  launch() {
    const a = this.agent;
    const win = process.platform === 'win32';
    if (a.node) return { file: process.execPath, args: [a.node], env: { ELECTRON_RUN_AS_NODE: '1' } };
    if (a.npx) {
      const npx = findCommand('npx');
      if (!npx) throw new Error('Node.js (npx) is needed to run this agent: install Node.js, or open the agent in a terminal instead.');
      return win ? cmdLine(`npx -y ${a.npx}`) : { file: npx, args: ['-y', a.npx] };
    }
    const exe = findCommand(a.command);
    if (!exe) throw new Error(`${a.name} is not installed (${a.command} not found).`);
    if (win && /\.(cmd|bat)$/i.test(exe)) return cmdLine([`"${exe}"`, ...a.args].join(' '));
    return { file: exe, args: a.args || [] };
  }

  async start() {
    this.send({ type: 'status', state: 'starting', name: this.agent.name });
    const { file, args, verbatim, env } = this.launch();
    this.child = spawn(file, args, {
      cwd: this.cwd,
      env: { ...process.env, TERM_PROGRAM: 'Lumen', ...(env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      windowsVerbatimArguments: !!verbatim
    });
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', d => { this.stderr = (this.stderr + d).slice(-4000); });
    this.child.on('error', err => this.fail(`Could not start ${this.agent.name}: ${err.message}`));
    this.child.on('exit', code => {
      if (this.closed) return;
      this.rpc?.failAll(new Error('agent exited'));
      const tail = this.stderr.trim().split('\n').slice(-6).join('\n');
      this.send({ type: 'status', state: 'exited', message: `${this.agent.name} stopped${code ? ` (code ${code})` : ''}.${tail ? `\n${tail}` : ''}` });
      this.dispose();
    });
    this.rpc = new Rpc(this.child, (m, p) => this.onRequest(m, p), (m, p) => this.onNotification(m, p));

    const init = await this.rpc.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true }, terminal: true },
      clientInfo: { name: 'lumen', title: 'Lumen', version: deps.version }
    });
    this.info = init?.agentInfo || null;
    this.authMethods = init?.authMethods || [];
    await this.newSession();
  }

  mcpServers() {
    return [{
      name: 'lumen',
      command: deps.nodeBinary,
      args: [deps.mcpScript],
      env: [
        { name: 'ELECTRON_RUN_AS_NODE', value: '1' },
        { name: 'LUMEN_BRIDGE', value: startBridge() },
        { name: 'LUMEN_BRIDGE_TOKEN', value: this.token },
        { name: 'LUMEN_VERSION', value: deps.version }
      ]
    }];
  }

  async newSession() {
    try {
      const r = await this.rpc.request('session/new', { cwd: this.cwd, mcpServers: this.mcpServers() });
      this.sessionId = r.sessionId;
      this.send({ type: 'status', state: 'ready', name: this.info?.title || this.agent.name, cwd: this.cwd, modes: r.modes || null });
    } catch (err) {
      // -32000: authentication required. The agent lists how to sign in.
      if (err.code === -32000 || /auth/i.test(err.message)) {
        this.send({ type: 'auth', message: err.message, methods: this.authMethods.map(m => ({ id: m.id, name: m.name, description: m.description || '' })) });
      } else throw err;
    }
  }

  async authenticate(methodId) {
    this.send({ type: 'status', state: 'starting', name: this.agent.name, message: 'Signing in…' });
    await this.rpc.request('authenticate', { methodId });
    await this.newSession();
  }

  async prompt(text, environment) {
    if (!this.sessionId) throw new Error('The agent is not ready yet.');
    const blocks = [];
    // What Lumen knows about the user's setup, so the agent doesn't have to ask.
    if (environment) blocks.push({ type: 'text', text: `<lumen-environment>\n${environment}\n</lumen-environment>\nYou are running inside Lumen, a tiling terminal. Its "lumen" MCP tools act on the user's terminals and on Lumen itself (settings, themes, aliases, notes, plugins); Lumen's own guide is ~/.lumen/AGENTS.md.` });
    blocks.push({ type: 'text', text });
    const r = await this.rpc.request('session/prompt', { sessionId: this.sessionId, prompt: blocks });
    this.send({ type: 'done', stopReason: r?.stopReason || 'end_turn' });
  }

  cancel() {
    if (!this.sessionId) return;
    this.rpc.notify('session/cancel', { sessionId: this.sessionId });
    for (const [id, resolve] of this.permissions) { resolve({ outcome: { outcome: 'cancelled' } }); this.send({ type: 'permission_closed', id }); }
    this.permissions.clear();
  }

  setMode(modeId) {
    return this.rpc.request('session/set_mode', { sessionId: this.sessionId, modeId });
  }

  // ─── Agent → client ─────────────────────────────────────────────────

  onNotification(method, params) {
    if (method === 'session/update') this.send({ type: 'update', update: params.update });
  }

  async onRequest(method, p) {
    switch (method) {
      case 'session/request_permission': return this.askPermission(p);
      case 'fs/read_text_file': return this.readFile(p);
      case 'fs/write_text_file': return this.writeFile(p);
      case 'terminal/create': return this.createTerminal(p);
      case 'terminal/output': return this.terminalOutput(p);
      case 'terminal/wait_for_exit': return this.waitForExit(p);
      case 'terminal/kill': { this.terminal(p).kill?.(); return null; }
      case 'terminal/release': { const t = this.terminal(p); if (!t.exit) t.kill?.(); this.terminals.delete(p.terminalId); return null; }
      default: throw Object.assign(new Error(`Method not supported by Lumen: ${method}`), { code: -32601 });
    }
  }

  askPermission(p) {
    const options = p.options || [];
    if (this.auto) {
      const pick = options.find(o => o.kind === 'allow_once') || options.find(o => o.kind === 'allow_always');
      if (pick) {
        this.send({ type: 'permission_auto', toolCall: p.toolCall, option: pick });
        return { outcome: { outcome: 'selected', optionId: pick.optionId } };
      }
    }
    const id = ++this.seq;
    return new Promise(resolve => {
      this.permissions.set(id, resolve);
      this.send({ type: 'permission', id, toolCall: p.toolCall, options });
    });
  }

  answerPermission(id, optionId) {
    const resolve = this.permissions.get(id);
    if (!resolve) return;
    this.permissions.delete(id);
    resolve(optionId ? { outcome: { outcome: 'selected', optionId } } : { outcome: { outcome: 'cancelled' } });
  }

  readFile({ path: file, line, limit }) {
    if (!path.isAbsolute(String(file))) throw new Error('path must be absolute');
    const st = fs.statSync(file);
    if (st.size > 5 * 1024 * 1024) throw new Error('file too large (5 MB max)');
    let content = fs.readFileSync(file, 'utf8');
    if (line || limit) {
      const lines = content.split('\n');
      const start = Math.max(0, (line || 1) - 1);
      content = lines.slice(start, limit ? start + limit : undefined).join('\n');
    }
    return { content };
  }

  writeFile({ path: file, content }) {
    if (!path.isAbsolute(String(file))) throw new Error('path must be absolute');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(content ?? ''));
    this.send({ type: 'file_written', path: file });
    return null;
  }

  // Commands the agent runs show up in a visible Lumen pane ("✦ AI").
  createTerminal(p) {
    const id = `term_${++this.seq}`;
    const limit = Math.max(1024, Math.min(+p.outputByteLimit || 1024 * 1024, 8 * 1024 * 1024));
    const t = { id, output: '', truncated: false, limit, exit: null, waiters: [] };
    const env = {};
    for (const e of p.env || []) if (e && e.name) env[e.name] = String(e.value ?? '');
    const term = deps.openTerminal(this.wc, {
      command: String(p.command),
      args: Array.isArray(p.args) ? p.args.map(String) : [],
      cwd: p.cwd && path.isAbsolute(p.cwd) ? p.cwd : this.cwd,
      env,
      title: `✦ ${this.agent.name}`
    });
    t.ptyId = term.ptyId;
    t.kill = term.kill;
    term.onData(data => {
      t.output += stripAnsi(data);
      if (Buffer.byteLength(t.output) > t.limit) {
        t.truncated = true;
        t.output = t.output.slice(-Math.floor(t.limit * 0.9));
      }
    });
    term.onExit(code => {
      t.exit = { exitCode: code ?? null, signal: null };
      for (const w of t.waiters) w(t.exit);
      t.waiters = [];
    });
    this.terminals.set(id, t);
    return { terminalId: id };
  }

  terminal(p) {
    const t = this.terminals.get(p.terminalId);
    if (!t) throw new Error(`unknown terminal: ${p.terminalId}`);
    return t;
  }

  terminalOutput(p) {
    const t = this.terminal(p);
    return { output: t.output, truncated: t.truncated, ...(t.exit ? { exitStatus: t.exit } : {}) };
  }

  waitForExit(p) {
    const t = this.terminal(p);
    if (t.exit) return t.exit;
    return new Promise(resolve => t.waiters.push(resolve));
  }

  // ─── Lumen's MCP tools (through the bridge) ─────────────────────────

  mcpCall(tool, args) {
    const id = `mcp_${++this.seq}`;
    return new Promise(resolve => {
      this.mcpCalls.set(id, resolve);
      this.send({ type: 'mcp', id, tool, args, auto: this.auto });
    });
  }

  answerMcp(id, result) {
    const resolve = this.mcpCalls.get(id);
    if (!resolve) return;
    this.mcpCalls.delete(id);
    resolve({ isError: !!result?.isError, content: String(result?.content ?? '') });
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────

  fail(message) {
    this.send({ type: 'status', state: 'error', message });
    this.dispose();
  }

  dispose() {
    if (this.closed) return;
    this.closed = true;
    tokens.delete(this.token);
    for (const resolve of this.permissions.values()) resolve({ outcome: { outcome: 'cancelled' } });
    for (const resolve of this.mcpCalls.values()) resolve({ isError: true, content: 'Session closed.' });
    for (const t of this.terminals.values()) if (!t.exit) { try { t.kill?.(); } catch {} }
    try { this.child?.kill(); } catch {}
    if (sessions.get(this.wc.id) === this) sessions.delete(this.wc.id);
  }
}

// ─── API used by main.js ──────────────────────────────────────────────

function init(options) {
  deps = options;
}

async function start(wc, agentId, opts = {}) {
  if (!AGENTS[agentId]) throw new Error(`unknown agent: ${agentId}`);
  sessions.get(wc.id)?.dispose();
  const s = new Session(wc, agentId, opts);
  sessions.set(wc.id, s);
  wc.once('destroyed', () => s.dispose());
  try {
    await s.start();
  } catch (err) {
    s.fail(err.message);
  }
}

const current = wc => sessions.get(wc.id) || null;

async function prompt(wc, text, environment) {
  const s = current(wc);
  if (!s) throw new Error('No agent is running.');
  try {
    await s.prompt(text, environment);
  } catch (err) {
    s.send({ type: 'done', stopReason: 'error', message: err.message });
  }
}

function list() {
  return Object.entries(AGENTS).map(([id, a]) => ({
    id,
    name: a.name,
    ready: a.node ? true : !!findCommand(a.needs) && (!a.npx || !!findCommand('npx'))
  }));
}

module.exports = {
  init,
  list,
  start,
  prompt,
  cancel: wc => current(wc)?.cancel(),
  stop: wc => current(wc)?.dispose(),
  setAuto: (wc, on) => { const s = current(wc); if (s) s.auto = !!on; },
  authenticate: (wc, methodId) => current(wc)?.authenticate(methodId).catch(err => current(wc)?.fail(err.message)),
  setMode: (wc, modeId) => current(wc)?.setMode(modeId),
  answerPermission: (wc, id, optionId) => current(wc)?.answerPermission(id, optionId),
  answerMcp: (wc, id, result) => current(wc)?.answerMcp(id, result),
  status: wc => { const s = current(wc); return s ? { agent: s.agentId, ready: !!s.sessionId, cwd: s.cwd } : null; }
};
