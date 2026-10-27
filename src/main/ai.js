// Lumen's AI assistant: a Claude agent loop that runs in the main process (the API key never
// reaches the page). Tools execute in the UI so the user sees and approves what happens;
// file tools run here after the UI has approved them.
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');
const { paths } = require('./config');

// The SDK takes ~300 ms to load: require it on first use, not at app start.
let sdk = null;
function Anthropic() {
  if (!sdk) {
    const m = require('@anthropic-ai/sdk');
    sdk = m.default || m;
  }
  return sdk;
}
const DEFAULT_MODEL = 'claude-opus-5-5';
const MAX_READ = 200 * 1024;
const { TOOLS, APPROVAL } = require('./ai-tools');

function apiTools() {
  return TOOLS.map(({ side, ...t }) => ({ ...t, eager_input_streaming: true }));
}

// With eager input streaming the API no longer validates inputs, so check them here.
function validate(name, input) {
  const tool = TOOLS.find(t => t.name === name);
  if (!tool) return `outil inconnu : ${name}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'input must be an object';
  for (const key of tool.input_schema.required) if (!(key in input)) return `missing field "${key}"`;
  for (const [key, spec] of Object.entries(tool.input_schema.properties)) {
    if (!(key in input) || !spec.type) continue;
    const v = input[key];
    const ok = spec.type === 'string' ? typeof v === 'string'
      : spec.type === 'integer' ? Number.isInteger(v)
      : spec.type === 'array' ? Array.isArray(v)
      : true;
    if (!ok) return `field "${key}" must be ${spec.type}`;
    if (spec.enum && !spec.enum.includes(v)) return `field "${key}" must be one of ${spec.enum.join(', ')}`;
  }
  return null;
}

function expand(p) {
  let out = String(p).trim();
  if (out === '~' || out.startsWith('~/') || out.startsWith('~\\')) out = path.join(os.homedir(), out.slice(1));
  return path.resolve(os.homedir(), out);
}

function runMainTool(name, input) {
  const target = expand(input.path);
  if (name === 'read_file') {
    const st = fs.statSync(target);
    if (st.isDirectory()) throw new Error('this is a directory: use list_dir');
    if (st.size > MAX_READ) throw new Error(`file too large (${st.size} bytes, max ${MAX_READ})`);
    const buf = fs.readFileSync(target);
    if (buf.includes(0)) throw new Error('binary file');
    return buf.toString('utf8');
  }
  if (name === 'list_dir') {
    return fs.readdirSync(target, { withFileTypes: true }).slice(0, 500).map(d => {
      let size = '';
      try { if (d.isFile()) size = ` ${fs.statSync(path.join(target, d.name)).size}` ; } catch {}
      return `${d.isDirectory() ? 'd' : 'f'} ${d.name}${size}`;
    }).join('\n') || '(empty)';
  }
  if (name === 'write_file') {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, input.content);
    return `written: ${target} (${Buffer.byteLength(input.content)} bytes)`;
  }
  throw new Error(`unknown tool: ${name}`);
}

// ─── System prompt (stable, cached) ───────────────────────────────────

function systemPrompt() {
  let pluginExample = '';
  try { pluginExample = fs.readFileSync(path.join(paths.defaults, 'plugins', '_example.js'), 'utf8'); } catch {}
  return `You are the assistant built into Lumen, a customizable tiling terminal app (Electron + xterm.js) that the user runs on their own machine. Reply in the language the user writes in. Be concise and practical; format with short Markdown (code blocks for commands).

You can see and act on the user's environment through tools:
- run_command executes in a visible "agent" terminal pane, so the user watches what you do. Prefer one command per call and read its output before continuing. Never run destructive operations (deleting data, force-pushing, formatting, killing unrelated processes) unless the user explicitly asked for exactly that.
- read_terminal shows what the user sees in a pane (use it when they mention an error "here" or "in my terminal").
- read_file / list_dir / write_file work on the file system (writes are approved by the user).
- get_lumen_config / set_lumen_setting read and change Lumen itself live.
- install_plugin extends Lumen with new commands, panels, status items or themes.
- add_alias creates shell aliases that work in every new PowerShell, bash and cmd pane.
- add_note writes into Lumen's notes panel, with optional reminders.
Each user message starts with an <environment> block describing the current state (OS, shells, panes with their folders and git status, theme). Trust it over assumptions, and check with tools when it matters.

## Lumen facts
- Config: ${paths.config} (JSONC, hot-reloaded). User themes: ${paths.themes}/*.json. Plugins: ${paths.plugins}/*.js (a leading "_" disables one). Data: ${paths.dir}/data.
- Settings: theme, font {family,size,lineHeight,weight}, cursor {style: bar|block|underline, blink, width, inactive, color: theme|accent|accent2|#hex}, window {gap, padding, radius, borderWidth, inactiveOpacity, animations, bar, clock, stats, paneOpacity (0.3-1), backgroundMaterial: none|acrylic|mica}, background {mode, image, blur, dim, speed, intensity}, behavior {copyOnSelect, rightClickPaste, focusFollowsMouse, scrollback, inheritCwd, shellIntegration, git}, shells {default, profiles[]}, keybindings {commandId: "Ctrl+Shift+X"}.
- Background modes: none, image, aurora, constellation, waves, koi (ASCII), koi-blocks, jellyfish, dither, matrix, starfield, horizon.
- Keyboard: Ctrl+Shift+Enter new pane, Ctrl+Shift+D/E split, Ctrl+Shift+arrows focus, Alt+1..9 workspaces, Ctrl+Shift+P palette, Ctrl+, settings.
- Plugins are plain JavaScript evaluated in the window (no Node.js require). module.exports = lumen => { ... }. Besides the API shown below there is lumen.sidebar.add({ id, title, icon: '<svg …>', render(el, api) }) to add a side panel, and lumen.storage.get(name) / .set(name, data) (async) for persistence. After install_plugin the plugin is live; reloading the window (palette: "Reload window") gives a clean state.

## Plugin example
\`\`\`js
${pluginExample.trim()}
\`\`\``;
}

// ─── Sessions ─────────────────────────────────────────────────────────

const sessions = new Map(); // webContents id -> { messages, abort, pending }

function session(wc) {
  if (!sessions.has(wc.id)) {
    const saved = store.get('ai-conversation', null);
    sessions.set(wc.id, { messages: Array.isArray(saved?.messages) ? saved.messages : [], abort: null, pending: new Map() });
    wc.once('destroyed', () => {
      const s = sessions.get(wc.id);
      s?.abort?.abort();
      for (const resolve of s?.pending.values() || []) resolve({ content: 'window closed', isError: true });
      sessions.delete(wc.id);
    });
  }
  return sessions.get(wc.id);
}

function persist(s) {
  // Keep the saved history bounded; the API itself handles long contexts.
  store.set('ai-conversation', { messages: s.messages.slice(-200) });
}

function apiKey() {
  return store.getSecret('anthropic') || process.env.ANTHROPIC_API_KEY || null;
}

function makeClient() {
  const key = apiKey();
  if (!key) throw new Error('No Anthropic API key: add one in the AI panel (key icon).');
  const Client = Anthropic();
  return new Client({ apiKey: key });
}

// Request options that depend on the model family.
function modelParams(model, effort) {
  const params = {};
  if (/claude-(opus-(4-[678]|5)|sonnet-(4-6|5)|haiku-5|fable|mythos)/.test(model)) {
    params.thinking = { type: 'adaptive', display: 'summarized' };
    params.output_config = { effort };
  }
  // Server-side fallback: if a safety classifier declines, the API re-runs the turn on
  // a suitable model instead of stopping.
  if (/claude-(opus-5|fable-5-1|sonnet-5-5)/.test(model)) {
    params.betas = ['server-side-fallback-2026-07-01'];
    params.fallbacks = 'default';
  }
  return params;
}

async function listModels() {
  const client = makeClient();
  const out = [];
  for await (const m of client.models.list()) out.push({ id: m.id, name: m.display_name || m.id });
  return out;
}

function send(wc, event) {
  if (!wc.isDestroyed()) wc.send('ai:event', event);
}

// Asks the renderer to approve and/or execute a tool call.
function askUi(wc, s, call) {
  return new Promise(resolve => {
    s.pending.set(call.id, resolve);
    send(wc, { type: 'tool_call', id: call.id, name: call.name, input: call.input, needsApproval: APPROVAL.has(call.name), side: TOOLS.find(t => t.name === call.name)?.side });
  });
}

async function chat(wc, { text, environment, model = DEFAULT_MODEL, effort = 'high' }) {
  const s = session(wc);
  if (s.abort) throw new Error('a reply is already in progress');
  const client = makeClient();
  const abort = new AbortController();
  s.abort = abort;
  s.messages.push({
    role: 'user',
    content: [
      { type: 'text', text: `<environment>\n${environment}\n</environment>` },
      { type: 'text', text }
    ]
  });
  persist(s);

  const system = [{ type: 'text', text: systemPrompt(), cache_control: { type: 'ephemeral' } }];
  let jsonRetries = 0;
  try {
    for (;;) {
      const stream = client.beta.messages.stream({
        model,
        max_tokens: 64000,
        system,
        tools: apiTools(),
        messages: s.messages,
        ...modelParams(model, effort)
      }, { signal: abort.signal });

      for await (const event of stream) {
        if (event.type === 'content_block_start') {
          const b = event.content_block;
          if (b.type === 'text') send(wc, { type: 'text_start' });
          else if (b.type === 'thinking') send(wc, { type: 'thinking_start' });
          else if (b.type === 'tool_use') send(wc, { type: 'tool_pending', id: b.id, name: b.name });
          else if (b.type === 'fallback') send(wc, { type: 'notice', text: `${b.from?.model} declined; ${b.to?.model} took over.` });
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') send(wc, { type: 'text', text: event.delta.text });
          else if (event.delta.type === 'thinking_delta') send(wc, { type: 'thinking', text: event.delta.thinking });
        }
      }

      let message;
      try {
        message = await stream.finalMessage();
        jsonRetries = 0;
      } catch (err) {
        // With eager input streaming, a tool input that is not parseable JSON rejects here;
        // only that case is retried. API errors go up.
        if (err instanceof Anthropic().APIError || abort.signal.aborted || jsonRetries++ >= 2) throw err;
        send(wc, { type: 'notice', text: 'Unreadable tool input, retrying…' });
        continue;
      }

      send(wc, { type: 'usage', usage: message.usage, model: message.model });

      if (message.stop_reason === 'refusal') {
        s.messages.push({ role: 'assistant', content: message.content });
        send(wc, { type: 'notice', text: 'The model declined to continue with this request.' });
        break;
      }
      if (message.stop_reason === 'pause_turn') {
        s.messages.push({ role: 'assistant', content: message.content });
        continue;
      }
      const calls = message.content.filter(b => b.type === 'tool_use');
      s.messages.push({ role: 'assistant', content: message.content });
      persist(s);
      if (!calls.length) break;
      if (message.stop_reason === 'max_tokens') {
        // A truncated tool input can look valid: never run it.
        s.messages.push({ role: 'user', content: calls.map(c => ({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Tool input was truncated (max_tokens). Retry with a shorter input.' })) });
        continue;
      }

      const results = [];
      for (const call of calls) {
        const problem = validate(call.name, call.input);
        if (problem) {
          results.push({ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `INVALID_INPUT: ${problem}` });
          send(wc, { type: 'tool_done', id: call.id, isError: true, content: problem });
          continue;
        }
        const answer = await askUi(wc, s, call);
        s.pending.delete(call.id);
        let content = answer.content;
        let isError = !!answer.isError;
        if (!isError && answer.approved && TOOLS.find(t => t.name === call.name)?.side === 'main') {
          try { content = runMainTool(call.name, call.input); } catch (e) { content = e.message; isError = true; }
        }
        const body = String(content ?? '').slice(0, 60000);
        results.push({ type: 'tool_result', tool_use_id: call.id, content: body || '(no output)', ...(isError ? { is_error: true } : {}) });
        send(wc, { type: 'tool_done', id: call.id, isError, content: body.slice(0, 4000) });
        if (abort.signal.aborted) break;
      }
      // All results of one turn go back in a single user message.
      s.messages.push({ role: 'user', content: results });
      persist(s);
      if (abort.signal.aborted) break;
    }
  } catch (err) {
    // Keep the history valid: an assistant turn with tool_use must be followed by results.
    const last = s.messages[s.messages.length - 1];
    if (last?.role === 'assistant' && Array.isArray(last.content)) {
      const open = last.content.filter(b => b.type === 'tool_use');
      if (open.length) s.messages.push({ role: 'user', content: open.map(c => ({ type: 'tool_result', tool_use_id: c.id, is_error: true, content: 'Interrupted.' })) });
    }
    if (abort.signal.aborted) send(wc, { type: 'notice', text: 'Interrupted.' });
    else send(wc, { type: 'error', text: describe(err) });
  } finally {
    s.abort = null;
    persist(s);
    send(wc, { type: 'done' });
  }
}

function describe(err) {
  if (err instanceof Anthropic().AuthenticationError) return 'API key rejected: check it in the AI panel.';
  if (err instanceof Anthropic().PermissionDeniedError) return "This key doesn't have access to this model.";
  if (err instanceof Anthropic().NotFoundError) return 'Model not found: pick another one.';
  if (err instanceof Anthropic().RateLimitError) return 'Rate limit reached, try again in a moment.';
  if (err instanceof Anthropic().APIConnectionError) return 'Could not reach the API (network?).';
  if (err instanceof Anthropic().APIError) return `API error ${err.status ?? ''}: ${err.message}`;
  return err.message || String(err);
}

function stop(wc) {
  const s = sessions.get(wc.id);
  s?.abort?.abort();
  for (const [id, resolve] of s?.pending || []) resolve({ content: 'Denied: the reply was interrupted.', isError: true });
  s?.pending.clear();
}

function reply(wc, id, answer) {
  const resolve = sessions.get(wc.id)?.pending.get(id);
  if (resolve) resolve(answer || {});
}

function reset(wc) {
  stop(wc);
  const s = session(wc);
  s.messages = [];
  persist(s);
}

function history(wc) {
  return session(wc).messages;
}

module.exports = {
  DEFAULT_MODEL,
  chat,
  stop,
  reply,
  reset,
  history,
  listModels,
  hasKey: () => !!apiKey(),
  setKey: key => store.setSecret('anthropic', key ? String(key).trim() : null)
};
