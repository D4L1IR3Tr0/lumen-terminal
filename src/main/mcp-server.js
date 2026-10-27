// Lumen's MCP server, started by an external agent (Claude Code, Codex, Gemini, Vibe) over stdio.
// It runs as a plain Node process (Electron with ELECTRON_RUN_AS_NODE) and forwards each tool
// call to the Lumen window that started the agent, through a local pipe (no network port).
// The window shows the call and asks the user before anything that changes something.
//   env LUMEN_BRIDGE        pipe path (\\.\pipe\… on Windows, a socket file elsewhere)
//   env LUMEN_BRIDGE_TOKEN  secret that identifies the session
const net = require('net');
const { MCP_TOOLS } = require('./ai-tools');

const PIPE = process.env.LUMEN_BRIDGE;
const TOKEN = process.env.LUMEN_BRIDGE_TOKEN;
const VERSION = process.env.LUMEN_VERSION || '0.1.0';

const out = msg => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const log = (...a) => process.stderr.write(`[lumen-mcp] ${a.join(' ')}\n`);

// ─── Bridge to the Lumen window ───────────────────────────────────────

let socket = null;
let seq = 0;
let inbox = '';
const waiting = new Map();

function bridge() {
  if (socket) return socket;
  socket = net.connect(PIPE);
  socket.setEncoding('utf8');
  socket.on('data', chunk => {
    inbox += chunk;
    let n;
    while ((n = inbox.indexOf('\n')) >= 0) {
      const line = inbox.slice(0, n);
      inbox = inbox.slice(n + 1);
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      const w = waiting.get(msg.id);
      if (w) { waiting.delete(msg.id); w(msg); }
    }
  });
  const fail = err => {
    for (const w of waiting.values()) w({ isError: true, content: `Lumen is not reachable (${err?.message || 'closed'}).` });
    waiting.clear();
    socket = null;
  };
  socket.on('error', fail);
  socket.on('close', () => fail());
  return socket;
}

function callLumen(tool, args) {
  return new Promise(resolve => {
    if (!PIPE || !TOKEN) return resolve({ isError: true, content: 'This server must be started by Lumen.' });
    const id = ++seq;
    waiting.set(id, resolve);
    bridge().write(JSON.stringify({ id, token: TOKEN, tool, args }) + '\n');
  });
}

// ─── MCP over stdio (newline-delimited JSON-RPC) ──────────────────────

const tools = MCP_TOOLS.map(t => ({ name: t.name, description: t.description, inputSchema: t.input_schema }));

async function handle(msg) {
  const { id, method, params } = msg;
  if (id === undefined || id === null) return; // notifications (initialized, cancelled…)
  try {
    switch (method) {
      case 'initialize':
        return out({ id, result: {
          protocolVersion: params?.protocolVersion || '2025-06-18',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'lumen', title: 'Lumen terminal', version: VERSION },
          instructions: 'Tools to act inside Lumen, the terminal the user is running you from: see their panes, run commands in a visible pane, change Lumen settings and themes, add aliases, notes and plugins.'
        } });
      case 'ping':
        return out({ id, result: {} });
      case 'tools/list':
        return out({ id, result: { tools } });
      case 'tools/call': {
        const name = params?.name;
        if (!tools.some(t => t.name === name)) return out({ id, result: { isError: true, content: [{ type: 'text', text: `Unknown tool: ${name}` }] } });
        const r = await callLumen(name, params.arguments || {});
        return out({ id, result: { isError: !!r.isError, content: [{ type: 'text', text: String(r.content ?? '') }] } });
      }
      default:
        return out({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (err) {
    log('error', err.stack || err);
    out({ id, error: { code: -32603, message: String(err.message || err) } });
  }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buf += chunk;
  let n;
  while ((n = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, n).trim();
    buf = buf.slice(n + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { log('unreadable message'); continue; }
    handle(msg);
  }
});
process.stdin.on('end', () => process.exit(0));
