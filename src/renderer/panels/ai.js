// AI panel. Two sources share the same conversation view:
//   - "Lumen": the built-in Claude chat (Anthropic API key; the loop lives in the main process
//     and this panel executes the "ui" tools: terminal, Lumen settings, plugins, aliases, notes);
//   - an agent: one of the user's own CLIs (Claude Code, Codex, Gemini CLI, Mistral Vibe) run
//     over the Agent Client Protocol. Its messages, thoughts, plan, tool calls and diffs are
//     shown here; it asks before acting (unless Auto is on) and reaches Lumen's own tools
//     through Lumen's MCP server.
window.LumenPanels.push({
  id: 'ai',
  title: 'AI assistant',
  hint: 'Ctrl+Shift+A',
  order: 40,
  width: 460,
  render(el, host, actions) {
    const native = host.native;
    let prefs = { model: null, effort: 'high', auto: false, source: 'lumen', claudeEmbedded: false };
    let busy = false;
    let agents = [];        // [{ id, name, ready }]
    let agentState = null;  // { id, state: starting|ready|error|exited|auth, name, cwd, usage }

    // Lumen tools that change something: asked first unless Auto is on.
    const APPROVAL = new Set(['run_command', 'write_file', 'install_plugin', 'add_alias']);

    actions.innerHTML = `
      <button class="p-icon-btn" data-act="new" title="New conversation">${host.icon('plus')}</button>
      <button class="p-icon-btn" data-act="key" title="Anthropic API key (Lumen chat)">${host.icon('key')}</button>`;

    el.innerHTML = `
      <div class="ai-sources" role="tablist"></div>
      <div class="ai-setup hidden">
        <div class="ai-setup-icon">${host.icon('sparkle')}</div>
        <h4>Lumen chat</h4>
        <p>The Lumen chat uses the Anthropic API with your own key. No key? Pick an agent above: it signs in with your Claude, ChatGPT, Google or Mistral account.</p>
        <p>Create a key at <a href="#" data-act="console">console.anthropic.com</a> and paste it here. It is encrypted by the OS and never leaves Lumen's main process.</p>
        <form class="ai-key-form">
          <input type="password" name="key" placeholder="sk-ant-…" autocomplete="off" spellcheck="false">
          <button type="submit" class="s-btn">Save</button>
        </form>
        <button class="p-link" data-act="remove-key">Remove the saved key</button>
      </div>
      <div class="ai-main">
        <div class="ai-controls" data-for="lumen">
          <select class="ai-model" title="Model"></select>
          <div class="s-seg ai-effort" title="Thinking effort">
            <button data-effort="low">Fast</button><button data-effort="medium">Normal</button><button data-effort="high">Deep</button>
          </div>
          <label class="ai-auto" title="Run actions without asking"><input type="checkbox"><span class="s-switch"></span><span>Auto</span></label>
        </div>
        <div class="ai-controls ai-agent-bar hidden" data-for="agent">
          <span class="ai-agent-status"></span>
          <select class="ai-model ai-mode hidden" title="Agent mode"></select>
          <label class="ai-auto" title="Approve the agent's actions without asking"><input type="checkbox"><span class="s-switch"></span><span>Auto</span></label>
          <button class="p-icon-btn" data-act="agent-terminal" title="Open this agent in a terminal instead">${host.icon('terminal')}</button>
          <button class="p-icon-btn" data-act="agent-stop" title="End the session">${host.icon('x')}</button>
        </div>
        <div class="ai-log" data-log="lumen">
          <div class="ai-welcome">
            <div class="ai-setup-icon">${host.icon('sparkle')}</div>
            <p>I can see your terminals, folders, git and Lumen's config. I can run commands, edit files, change the look, and create aliases, notes or plugins.</p>
            <div class="ai-suggestions">
              <button>Explain the last error in my terminal</button>
              <button>Give Lumen a dark purple theme with an animated background</button>
              <button>Create an alias that starts my project</button>
              <button>Create a plugin that shows the weather in the bar</button>
            </div>
          </div>
        </div>
        <div class="ai-log hidden" data-log="agent"></div>
        <form class="ai-composer">
          <textarea rows="1" placeholder="Ask anything… (Enter to send, Shift+Enter for a new line)" spellcheck="true"></textarea>
          <button type="submit" class="ai-send" title="Send">${host.icon('send')}</button>
        </form>
      </div>`;

    const setup = el.querySelector('.ai-setup');
    const main = el.querySelector('.ai-main');
    const sourcesEl = el.querySelector('.ai-sources');
    const input = el.querySelector('.ai-composer textarea');
    const sendBtn = el.querySelector('.ai-send');
    const modelSel = el.querySelector('.ai-model');
    const modeSel = el.querySelector('.ai-mode');
    const autoBoxes = [...el.querySelectorAll('.ai-auto input')];
    const statusEl = el.querySelector('.ai-agent-status');
    const isAgent = () => prefs.source !== 'lumen';

    // ─── Markdown (small, safe subset) ──────────────────────────────────
    function md(text) {
      const blocks = [];
      let src = host.escape(text).replace(/```(\w*)\n?([\s\S]*?)(```|$)/g, (_, lang, code) => {
        blocks.push(`<div class="ai-code"><div class="ai-code-head"><span>${lang || 'code'}</span><button data-act="copy-code">Copy</button><button data-act="run-code">Paste into terminal</button></div><pre>${code.replace(/\n$/, '')}</pre></div>`);
        return `\u0000${blocks.length - 1}\u0000`;
      });
      src = src
        .replace(/`([^`\n]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" data-external>$1</a>');
      const out = [];
      let list = null;
      for (const line of src.split('\n')) {
        const item = line.match(/^\s*(?:[-*]|\d+\.)\s+(.*)/);
        const head = line.match(/^(#{1,4})\s+(.*)/);
        if (item) { (list ||= []).push(`<li>${item[1]}</li>`); continue; }
        if (list) { out.push(`<ul>${list.join('')}</ul>`); list = null; }
        if (head) out.push(`<h5>${head[2]}</h5>`);
        else if (/^\u0000\d+\u0000$/.test(line.trim())) out.push(line.trim());
        else if (line.trim()) out.push(`<p>${line}</p>`);
      }
      if (list) out.push(`<ul>${list.join('')}</ul>`);
      return out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[+i]);
    }

    // ─── A conversation view (one per source) ───────────────────────────
    function createView(log) {
      const v = { log, turn: null, cards: new Map() };
      v.scroll = () => {
        const near = log.scrollHeight - log.scrollTop - log.clientHeight < 140;
        if (near) log.scrollTop = log.scrollHeight;
      };
      v.clear = () => { log.innerHTML = ''; v.cards.clear(); v.turn = null; };
      v.hideWelcome = () => log.querySelector('.ai-welcome')?.remove();
      v.addUser = text => {
        v.hideWelcome();
        const b = document.createElement('div');
        b.className = 'ai-msg user';
        b.textContent = text;
        log.appendChild(b);
        log.scrollTop = log.scrollHeight;
      };
      v.newTurn = () => {
        v.hideWelcome();
        const b = document.createElement('div');
        b.className = 'ai-msg assistant';
        log.appendChild(b);
        v.turn = { el: b, segment: null, text: '', kind: null, raf: 0 };
        return v.turn;
      };
      v.segment = kind => {
        if (!v.turn) v.newTurn();
        const t = v.turn;
        if (kind === 'thinking') {
          const d = document.createElement('details');
          d.className = 'ai-thinking';
          d.innerHTML = '<summary>Thinking</summary><div></div>';
          t.el.appendChild(d);
          t.segment = d.querySelector('div');
        } else {
          const d = document.createElement('div');
          d.className = 'ai-text';
          t.el.appendChild(d);
          t.segment = d;
        }
        t.kind = kind;
        t.text = '';
      };
      v.appendText = (kind, text) => {
        if (!v.turn || v.turn.kind !== kind) v.segment(kind);
        const t = v.turn;
        t.text += text;
        if (!t.raf) {
          t.raf = requestAnimationFrame(() => {
            t.raf = 0;
            if (t.kind === 'thinking') t.segment.textContent = t.text;
            else t.segment.innerHTML = md(t.text);
            v.scroll();
          });
        }
      };
      v.toolCard = (id, label) => {
        if (v.cards.has(id)) return v.cards.get(id);
        if (!v.turn) v.newTurn();
        const c = document.createElement('div');
        c.className = 'ai-tool pending';
        c.innerHTML = `
          <div class="ai-tool-head"><span class="ai-tool-dot"></span><span class="ai-tool-name">${host.escape(label || 'Tool')}</span><code class="ai-tool-arg"></code></div>
          <div class="ai-tool-body"></div>`;
        v.turn.el.appendChild(c);
        v.turn.kind = null; // following text starts a new segment below the card
        v.cards.set(id, c);
        v.scroll();
        return c;
      };
      v.setState = (card, state, html) => {
        card.classList.remove('pending', 'ask', 'running', 'ok', 'error');
        card.classList.add(state);
        if (html !== undefined) card.querySelector('.ai-tool-body').innerHTML = html;
        v.scroll();
      };
      v.note = (text, error = false) => {
        const n = document.createElement('div');
        n.className = `ai-note${error ? ' error' : ''}`;
        n.textContent = text;
        (v.turn?.el || log).appendChild(n);
        v.scroll();
        return n;
      };
      return v;
    }

    const lumenView = createView(el.querySelector('[data-log="lumen"]'));
    const agentView = createView(el.querySelector('[data-log="agent"]'));
    const view = () => (isAgent() ? agentView : lumenView);

    // ─── Lumen tools (built-in chat and agents' MCP calls) ──────────────
    const TOOL_LABEL = {
      run_command: 'Command', read_terminal: 'Read terminal', read_file: 'Read file', list_dir: 'List folder',
      write_file: 'Write file', get_lumen_config: 'Lumen config', set_lumen_setting: 'Lumen setting',
      install_plugin: 'Plugin', add_alias: 'Alias', add_note: 'Note', get_environment: 'Environment'
    };

    function summary(name, args = {}) {
      switch (name) {
        case 'run_command': return args.command;
        case 'read_terminal': return args.pane || 'active terminal';
        case 'read_file': case 'list_dir': case 'write_file': return args.path;
        case 'set_lumen_setting': return `${(args.key || []).join('.')} = ${JSON.stringify(args.value)}`;
        case 'install_plugin': return args.name;
        case 'add_alias': return `${args.name} → ${args.command}`;
        case 'add_note': return args.title + (args.remind_at ? ` ⏰ ${args.remind_at}` : '');
        default: return '';
      }
    }

    async function execute(name, args) {
      switch (name) {
        case 'run_command': {
          if (!args.command) throw new Error('missing "command"');
          const r = await host.runCommand(args);
          return `exit code: ${r.exitCode ?? 'unknown'}${r.timedOut ? ' (timed out, the command may still be running)' : ''}\n${r.output || '(no output)'}`;
        }
        case 'read_terminal': return host.readTerminal(args.pane || 'focused', Math.min(500, args.lines || 80));
        case 'get_environment': return host.environment();
        case 'get_lumen_config': return JSON.stringify(host.configSnapshot(), null, 2);
        case 'set_lumen_setting':
          if (!Array.isArray(args.key) || !args.key.length) throw new Error('"key" must be a non-empty array');
          host.setSetting(args.key, args.value);
          return `ok: ${args.key.join('.')} = ${JSON.stringify(args.value)}`;
        case 'install_plugin': return host.installPlugin(String(args.name), String(args.code));
        case 'add_alias': return host.addAlias(args);
        case 'add_note': {
          const note = await host.addNote({ title: args.title, body: args.body || '', remindAt: args.remind_at ? new Date(args.remind_at).toISOString() : null });
          return `note created (${note.id})${note.remindAt ? `, reminder on ${new Date(note.remindAt).toLocaleString('en-GB')}` : ''}`;
        }
        default: throw new Error(`unknown tool: ${name}`);
      }
    }

    function preview(name, args) {
      if (name === 'install_plugin' || name === 'write_file') {
        const body = name === 'install_plugin' ? args.code : args.content;
        return `<pre class="ai-preview">${host.escape(String(body || '').slice(0, 8000))}</pre>`;
      }
      return '';
    }

    function showResult(v, card, content, isError) {
      const out = String(content || '').trim();
      const lines = out.split('\n');
      const short = host.escape(lines.slice(-12).join('\n'));
      v.setState(card, isError ? 'error' : 'ok', out ? `<details class="ai-tool-out"${isError ? ' open' : ''}><summary>${isError ? 'Error' : `Result${lines.length > 1 ? ` · ${lines.length} lines` : ''}`}</summary><pre>${short}</pre></details>` : '');
    }

    // Asks Allow / Deny on a card (skipped with Auto). Resolves true when allowed.
    function approve(v, card, html = '') {
      if (prefs.auto) return Promise.resolve(true);
      return new Promise(resolve => {
        v.setState(card, 'ask', `${html}
          <div class="ai-approve"><button class="s-btn" data-a="yes">Allow</button><button class="s-btn ghost" data-a="no">Deny</button><button class="p-link" data-a="always">Always allow (Auto)</button></div>`);
        card.querySelector('.ai-approve').addEventListener('click', e => {
          const a = e.target.closest('[data-a]')?.dataset.a;
          if (!a) return;
          if (a === 'always') setAuto(true);
          resolve(a !== 'no');
        });
        if (!host.panelActive('ai')) host.toast('The assistant is waiting for your approval', 'info');
      });
    }

    // ─── Lumen chat (built-in, API key) ─────────────────────────────────
    async function onToolCall(ev) {
      const v = lumenView;
      const card = v.toolCard(ev.id, TOOL_LABEL[ev.name] || ev.name);
      card.querySelector('.ai-tool-arg').textContent = summary(ev.name, ev.input);
      const allowed = !ev.needsApproval || await approve(v, card, preview(ev.name, ev.input));
      if (!allowed) {
        v.setState(card, 'error', '<span class="ai-tool-out">Denied</span>');
        native.ai.reply(ev.id, { content: 'The user denied this action.', isError: true });
        return;
      }
      v.setState(card, 'running', '<span class="ai-spinner"></span>');
      if (ev.side === 'main') { native.ai.reply(ev.id, { approved: true }); return; }
      try {
        native.ai.reply(ev.id, { content: await execute(ev.name, ev.input) });
      } catch (err) {
        native.ai.reply(ev.id, { content: err.message, isError: true });
      }
    }

    native.ai.onEvent(ev => {
      const v = lumenView;
      switch (ev.type) {
        case 'text_start': if (!v.turn) v.newTurn(); v.segment('text'); break;
        case 'text': v.appendText('text', ev.text); break;
        case 'thinking_start': if (!v.turn) v.newTurn(); v.segment('thinking'); break;
        case 'thinking': v.appendText('thinking', ev.text); break;
        case 'tool_pending': v.toolCard(ev.id, TOOL_LABEL[ev.name] || ev.name); break;
        case 'tool_call': onToolCall(ev); break;
        case 'tool_done': { const c = v.cards.get(ev.id); if (c) showResult(v, c, ev.content, ev.isError); break; }
        case 'notice': v.note(ev.text); break;
        case 'error': v.note(ev.text, true); break;
        case 'done': if (!isAgent()) setBusy(false); v.turn = null; break;
      }
    });

    // ─── Agents (ACP) ───────────────────────────────────────────────────
    const KIND_ICON = { read: '◔', edit: '✎', delete: '✕', move: '⇄', search: '⌕', execute: '❯', think: '✦', fetch: '⇣', switch_mode: '⇆', other: '•' };

    // Old/new text as a compact line diff: shared head and tail are skipped.
    function diffHtml(oldText, newText) {
      const a = String(oldText ?? '').split('\n');
      const b = String(newText ?? '').split('\n');
      let s = 0;
      while (s < a.length && s < b.length && a[s] === b[s]) s++;
      let e = 0;
      while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
      const del = a.slice(s, a.length - e);
      const add = b.slice(s, b.length - e);
      const ctx = a.slice(Math.max(0, s - 2), s);
      const rows = [
        ...ctx.map(l => `<span class="d-ctx">  ${host.escape(l)}</span>`),
        ...del.slice(0, 200).map(l => `<span class="d-del">- ${host.escape(l)}</span>`),
        ...add.slice(0, 200).map(l => `<span class="d-add">+ ${host.escape(l)}</span>`)
      ];
      if (del.length > 200 || add.length > 200) rows.push('<span class="d-ctx">…</span>');
      return `<pre class="ai-diff">${rows.join('')}</pre>`;
    }

    function agentContent(items = []) {
      return items.map(c => {
        if (c.type === 'diff') {
          const name = String(c.path || '').split(/[\\/]/).pop();
          return `<div class="ai-diff-file" title="${host.escape(c.path || '')}">${c.oldText == null ? 'New file' : 'Edit'} · ${host.escape(name)}</div>${diffHtml(c.oldText, c.newText)}`;
        }
        if (c.type === 'terminal') return '<div class="ai-tool-out">Running in a ✦ pane</div>';
        if (c.type === 'content' && c.content?.type === 'text') {
          const text = String(c.content.text || '');
          const lines = text.split('\n');
          return `<details class="ai-tool-out"><summary>Output${lines.length > 1 ? ` · ${lines.length} lines` : ''}</summary><pre>${host.escape(lines.slice(-30).join('\n'))}</pre></details>`;
        }
        return '';
      }).join('');
    }

    const STATUS = { pending: 'pending', in_progress: 'running', completed: 'ok', failed: 'error' };

    function onToolUpdate(u) {
      const v = agentView;
      const card = v.toolCard(u.toolCallId, u.title || 'Tool');
      if (u.kind) card.dataset.kind = u.kind;
      if (u.title) card.dataset.title = u.title;
      if (u.title || u.kind) card.querySelector('.ai-tool-name').textContent = `${KIND_ICON[card.dataset.kind] || ''} ${card.dataset.title || 'Tool'}`.trim();
      const where = (u.locations || []).map(l => String(l.path || '').split(/[\\/]/).pop() + (l.line ? `:${l.line}` : '')).join(', ');
      if (where) card.querySelector('.ai-tool-arg').textContent = where;
      if (u.status) card.dataset.status = u.status;
      const state = STATUS[card.dataset.status] || 'pending';
      if (card.classList.contains('ask')) return; // keep the question visible
      v.setState(card, state, u.content ? agentContent(u.content) : undefined);
    }

    function onPlan(entries) {
      const v = agentView;
      if (!v.turn) v.newTurn();
      let box = v.turn.el.querySelector('.ai-plan');
      if (!box) {
        box = document.createElement('div');
        box.className = 'ai-plan';
        v.turn.el.appendChild(box);
        v.turn.kind = null;
      }
      const mark = { pending: '○', in_progress: '◐', completed: '●' };
      box.innerHTML = `<div class="ai-plan-title">Plan</div>${entries.map(e => `<div class="ai-plan-row ${e.status}"><span>${mark[e.status] || '○'}</span>${host.escape(e.content)}</div>`).join('')}`;
      v.scroll();
    }

    function onPermission(ev) {
      const v = agentView;
      const tc = ev.toolCall || {};
      const card = v.toolCard(tc.toolCallId || `perm_${ev.id}`, tc.title || 'Permission');
      if (tc.title && !card.dataset.title) card.querySelector('.ai-tool-name').textContent = tc.title;
      const body = tc.content ? agentContent(tc.content) : '';
      const opts = ev.options || [];
      const btn = o => `<button class="${o.kind.startsWith('allow') ? 's-btn' : 's-btn ghost'}${o.kind === 'allow_always' ? ' ghost' : ''}" data-opt="${host.escape(o.optionId)}">${host.escape(o.name)}</button>`;
      v.setState(card, 'ask', `${body}<div class="ai-approve">${opts.map(btn).join('')}<button class="p-link" data-a="auto">Auto</button></div>`);
      card.dataset.permission = ev.id;
      card.querySelector('.ai-approve').addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        let optionId = b.dataset.opt;
        if (b.dataset.a === 'auto') {
          setAuto(true);
          optionId = (opts.find(o => o.kind === 'allow_once') || opts.find(o => o.kind === 'allow_always'))?.optionId;
        }
        native.acp.answerPermission(ev.id, optionId || null);
        const chosen = opts.find(o => o.optionId === optionId);
        v.setState(card, chosen?.kind.startsWith('reject') ? 'error' : 'running', chosen?.kind.startsWith('reject') ? '<span class="ai-tool-out">Denied</span>' : '<span class="ai-spinner"></span>');
      }, { once: true });
      if (!host.panelActive('ai')) host.toast(`${agentName()} is waiting for your approval`, 'info');
    }

    // An agent calls one of Lumen's tools (through the MCP server).
    async function onMcp(ev) {
      const v = agentView;
      const card = v.toolCard(ev.id, `Lumen · ${TOOL_LABEL[ev.tool] || ev.tool}`);
      card.querySelector('.ai-tool-arg').textContent = summary(ev.tool, ev.args);
      if (APPROVAL.has(ev.tool) && !await approve(v, card, preview(ev.tool, ev.args))) {
        v.setState(card, 'error', '<span class="ai-tool-out">Denied</span>');
        native.acp.answerMcp(ev.id, { content: 'The user denied this action.', isError: true });
        return;
      }
      v.setState(card, 'running', '<span class="ai-spinner"></span>');
      try {
        const content = await execute(ev.tool, ev.args || {});
        native.acp.answerMcp(ev.id, { content });
        showResult(v, card, content, false);
      } catch (err) {
        native.acp.answerMcp(ev.id, { content: err.message, isError: true });
        showResult(v, card, err.message, true);
      }
    }

    function agentName(id = agentState?.id || prefs.source) {
      return agents.find(a => a.id === id)?.name || agentState?.name || 'The agent';
    }

    function paintStatus() {
      const s = agentState;
      if (!s) { statusEl.innerHTML = `<span class="ai-dot off"></span>${host.escape(agentName())} · not connected`; return; }
      const dot = s.state === 'ready' ? 'on' : s.state === 'starting' ? 'wait' : 'off';
      const text = s.state === 'ready' ? `${s.name}${s.cwd ? ` · ${host.prettyPath(s.cwd)}` : ''}`
        : s.state === 'starting' ? `${s.message || `Starting ${s.name || agentName()}…`}`
        : s.state === 'auth' ? 'Sign in needed'
        : 'Disconnected';
      statusEl.innerHTML = `<span class="ai-dot ${dot}"></span><span title="${host.escape(text)}">${host.escape(text)}</span>${s.usage ? `<span class="ai-usage">${s.usage}</span>` : ''}`;
    }

    native.acp.onEvent(ev => {
      const v = agentView;
      switch (ev.type) {
        case 'status':
          agentState = { ...(agentState || {}), id: ev.agent, state: ev.state, name: ev.name || agentState?.name, cwd: ev.cwd || agentState?.cwd, message: ev.message };
          if (ev.state === 'ready' && ev.modes?.availableModes?.length) {
            modeSel.innerHTML = ev.modes.availableModes.map(m => `<option value="${host.escape(m.id)}">${host.escape(m.name)}</option>`).join('');
            modeSel.value = ev.modes.currentModeId;
            modeSel.classList.remove('hidden');
          }
          if (ev.state === 'ready' && !v.log.querySelector('.ai-msg')) v.note(`Connected to ${ev.name}. It works in ${host.prettyPath(ev.cwd)} with your own account, and can use Lumen's tools.`);
          if (ev.state === 'error' || ev.state === 'exited') { v.note(ev.message || 'The agent stopped.', true); setBusy(false); v.turn = null; }
          paintStatus();
          paintSources();
          break;
        case 'auth': showAuth(ev); break;
        case 'update': onUpdate(ev.update); break;
        case 'permission': onPermission(ev); break;
        case 'permission_auto': if (ev.toolCall?.toolCallId) { const c = v.cards.get(ev.toolCall.toolCallId); if (c) c.querySelector('.ai-tool-arg').textContent += '  (auto-approved)'; } break;
        case 'permission_closed': { const c = v.log.querySelector(`[data-permission="${ev.id}"]`); if (c) v.setState(c, 'error', '<span class="ai-tool-out">Cancelled</span>'); break; }
        case 'mcp': onMcp(ev); break;
        case 'file_written': break;
        case 'done':
          if (ev.stopReason === 'error') v.note(ev.message || 'The request failed.', true);
          else if (ev.stopReason === 'refusal') v.note('The agent declined this request.', true);
          else if (ev.stopReason === 'max_tokens' || ev.stopReason === 'max_turn_requests') v.note('The agent stopped: it reached its limit for this turn.');
          else if (ev.stopReason === 'cancelled') v.note('Stopped.');
          v.turn = null;
          if (isAgent()) setBusy(false);
          break;
      }
    });

    function onUpdate(u) {
      const v = agentView;
      switch (u.sessionUpdate) {
        case 'agent_message_chunk': if (u.content?.type === 'text') v.appendText('text', u.content.text); break;
        case 'agent_thought_chunk': if (u.content?.type === 'text') v.appendText('thinking', u.content.text); break;
        case 'tool_call': case 'tool_call_update': onToolUpdate(u); break;
        case 'plan': onPlan(u.entries || []); break;
        case 'current_mode_update': modeSel.value = u.currentModeId; break;
        case 'usage_update':
          if (agentState && u.size) { agentState.usage = `${Math.round(u.used / 1000)}k / ${Math.round(u.size / 1000)}k`; paintStatus(); }
          break;
      }
    }

    function showAuth(ev) {
      const v = agentView;
      agentState = { ...(agentState || {}), state: 'auth' };
      paintStatus();
      const box = document.createElement('div');
      box.className = 'ai-auth';
      box.innerHTML = `
        <h4>Sign in to ${host.escape(agentName())}</h4>
        <p>${host.escape(ev.message || 'The agent needs you to sign in with your own account.')}</p>
        <div class="p-buttons">
          ${(ev.methods || []).map(m => `<button class="s-btn" data-method="${host.escape(m.id)}" title="${host.escape(m.description)}">${host.escape(m.name)}</button>`).join('')}
          <button class="s-btn ghost" data-act="agent-terminal">Sign in in a terminal</button>
        </div>
        <p class="ai-auth-hint">After signing in in the terminal, click ${host.escape(agentName())} above again.</p>`;
      v.log.appendChild(box);
      box.addEventListener('click', e => {
        const m = e.target.closest('[data-method]');
        if (m) { native.acp.authenticate(m.dataset.method); box.remove(); }
      });
      v.scroll();
    }

    // Starts (or restarts) an agent session in this window.
    async function connect(id) {
      const a = agents.find(x => x.id === id);
      if (!a) return;
      if (!a.ready) {
        host.toast(`${a.name} isn't installed yet: Lumen opens it in a terminal to install it and sign in. Click it here again afterwards.`, 'tip');
        try { await host.launchAgent(id); } catch (err) { host.toast(err.message, 'error'); }
        setTimeout(loadAgents, 4000);
        return;
      }
      agentView.clear();
      agentState = { id, state: 'starting', name: a.name };
      modeSel.classList.add('hidden');
      paintStatus();
      const focused = host.focusedPane();
      native.acp.start(id, { cwd: focused?.cwd || host.paths().dir, auto: prefs.auto });
    }

    // Claude Code: terminal by default, embedded only after an explicit opt-in.
    function claudeWarning() {
      const v = agentView;
      v.clear();
      const box = document.createElement('div');
      box.className = 'ai-auth ai-warn';
      box.innerHTML = `
        <h4>Claude Code in this panel</h4>
        <p>Claude Code signs in with your own Claude account. Anthropic doesn't allow third-party apps to offer claude.ai sign-in without its approval, so Lumen opens Claude Code in a terminal by default.</p>
        <p>You can still use it here: Lumen then runs Claude Code through the open-source ACP adapter, with the login you already have. Your login never goes through Lumen.</p>
        <div class="p-buttons">
          <button class="s-btn ghost" data-act="agent-terminal">Open in a terminal</button>
          <button class="s-btn" data-act="claude-embedded">Use it here anyway</button>
        </div>`;
      v.log.appendChild(box);
    }

    // ─── Sources (Lumen chat / agents) ──────────────────────────────────
    async function loadAgents() {
      try { agents = await native.acp.list(); } catch { agents = []; }
      paintSources();
    }

    function paintSources() {
      const live = agentState && ['starting', 'ready'].includes(agentState.state) ? agentState.id : null;
      sourcesEl.innerHTML = [
        `<button class="ai-source${prefs.source === 'lumen' ? ' active' : ''}" data-source="lumen" title="Lumen's own chat (Anthropic API key)">${host.icon('sparkle')}<span>Lumen</span></button>`,
        ...agents.map(a => `<button class="ai-source${prefs.source === a.id ? ' active' : ''}${a.ready ? '' : ' missing'}" data-source="${a.id}" title="${host.escape(a.ready ? `${a.name}: your own account` : `${a.name} isn't installed: click to install it`)}">
          <span class="ai-dot ${live === a.id ? (agentState.state === 'ready' ? 'on' : 'wait') : 'off'}"></span><span>${host.escape(a.name)}</span></button>`)
      ].join('');
    }

    function showSource() {
      const agent = isAgent();
      el.querySelector('[data-for="lumen"]').classList.toggle('hidden', agent);
      el.querySelector('[data-for="agent"]').classList.toggle('hidden', !agent);
      lumenView.log.classList.toggle('hidden', agent);
      agentView.log.classList.toggle('hidden', !agent);
      input.placeholder = agent ? `Ask ${agentName()}… (Enter to send)` : 'Ask anything… (Enter to send, Shift+Enter for a new line)';
      setBusy(false);
      paintSources();
      paintStatus();
      refresh();
    }

    sourcesEl.addEventListener('click', e => {
      const b = e.target.closest('[data-source]');
      if (!b) return;
      const id = b.dataset.source;
      const same = prefs.source === id;
      prefs.source = id;
      savePrefs();
      showSource();
      if (id === 'lumen') return;
      const live = agentState && agentState.id === id && ['starting', 'ready'].includes(agentState.state);
      if (live && same) return;
      if (id === 'claude' && !prefs.claudeEmbedded) { claudeWarning(); return; }
      if (!live) connect(id);
    });

    // ─── Sending ────────────────────────────────────────────────────────
    function setBusy(b) {
      busy = b;
      el.classList.toggle('busy', b);
      sendBtn.innerHTML = b ? host.icon('stop') : host.icon('send');
      sendBtn.title = b ? 'Stop' : 'Send';
    }

    function send(text) {
      text = text.trim();
      if (!text || busy) return;
      if (isAgent()) {
        if (agentState?.state !== 'ready') { host.toast(`Connect ${agentName()} first: click it above.`); return; }
        agentView.addUser(text);
        agentView.turn = null;
        agentView.newTurn();
        native.acp.prompt(text, host.environment());
      } else {
        lumenView.addUser(text);
        lumenView.turn = null;
        lumenView.newTurn();
        native.ai.send({ text, environment: host.environment(), model: prefs.model, effort: prefs.effort });
      }
      input.value = '';
      autosize();
      setBusy(true);
    }

    function autosize() {
      input.style.height = 'auto';
      input.style.height = `${Math.min(180, input.scrollHeight)}px`;
    }

    input.addEventListener('input', autosize);
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
    });
    el.querySelector('.ai-composer').addEventListener('submit', e => {
      e.preventDefault();
      if (!busy) return send(input.value);
      if (isAgent()) native.acp.cancel(); else native.ai.stop();
    });

    el.addEventListener('click', async e => {
      const sug = e.target.closest('.ai-suggestions button');
      if (sug) { send(sug.textContent); return; }
      const link = e.target.closest('a[data-external]');
      if (link) { e.preventDefault(); native.open.external(link.href); return; }
      const act = e.target.closest('[data-act]')?.dataset.act;
      const code = e.target.closest('.ai-code')?.querySelector('pre')?.textContent;
      if (act === 'copy-code' && code) { native.clipboard.write(code); host.toast('Copied'); }
      else if (act === 'run-code' && code) { host.typeInFocused(code.trim()); host.refocus(); }
      else if (act === 'console') { e.preventDefault(); native.open.external('https://console.anthropic.com/settings/keys'); }
      else if (act === 'remove-key') { await native.ai.setKey(''); host.toast('Key removed'); refresh(); }
      else if (act === 'agent-terminal') { try { await host.launchAgent(prefs.source); } catch (err) { host.toast(err.message, 'error'); } }
      else if (act === 'agent-stop') { native.acp.stop(); agentState = null; setBusy(false); paintStatus(); paintSources(); agentView.note('Session ended.'); }
      else if (act === 'claude-embedded') { prefs.claudeEmbedded = true; savePrefs(); connect('claude'); }
    });

    // ─── Prefs, models, history, key ────────────────────────────────────
    async function savePrefs() {
      await native.store.set('ai-prefs', prefs);
    }

    function setAuto(on) {
      prefs.auto = !!on;
      autoBoxes.forEach(b => { b.checked = prefs.auto; });
      native.acp.setAuto(prefs.auto);
      savePrefs();
    }

    function paintPrefs() {
      el.querySelectorAll('[data-effort]').forEach(b => b.classList.toggle('active', b.dataset.effort === prefs.effort));
      autoBoxes.forEach(b => { b.checked = !!prefs.auto; });
      if (prefs.model) modelSel.value = prefs.model;
    }

    async function loadHistory() {
      const v = lumenView;
      const messages = await native.ai.history();
      if (!messages.length) return;
      v.clear();
      const results = new Map();
      for (const m of messages) {
        if (m.role === 'user' && Array.isArray(m.content)) {
          for (const b of m.content) if (b.type === 'tool_result') results.set(b.tool_use_id, b);
        }
      }
      for (const m of messages) {
        if (m.role === 'user') {
          const blocks = Array.isArray(m.content) ? m.content : [{ type: 'text', text: m.content }];
          const texts = blocks.filter(b => b.type === 'text' && !b.text.startsWith('<environment>'));
          if (texts.length) { v.turn = null; v.addUser(texts.map(b => b.text).join('\n')); }
          continue;
        }
        if (!v.turn) v.newTurn();
        for (const b of m.content || []) {
          if (b.type === 'text') { v.segment('text'); v.turn.segment.innerHTML = md(b.text); }
          else if (b.type === 'tool_use') {
            const card = v.toolCard(b.id, TOOL_LABEL[b.name] || b.name);
            card.querySelector('.ai-tool-arg').textContent = summary(b.name, b.input);
            const r = results.get(b.id);
            const content = typeof r?.content === 'string' ? r.content : (r?.content || []).map(x => x.text || '').join('\n');
            showResult(v, card, content, !!r?.is_error);
          }
        }
      }
      v.turn = null;
      v.log.scrollTop = v.log.scrollHeight;
    }

    async function loadModels(defaultModel) {
      modelSel.innerHTML = `<option value="${defaultModel}">${defaultModel}</option>`;
      try {
        const models = await native.ai.models();
        if (models.length) {
          modelSel.innerHTML = models.map(m => `<option value="${host.escape(m.id)}">${host.escape(m.name)}</option>`).join('');
          if (!models.some(m => m.id === prefs.model)) prefs.model = models.some(m => m.id === defaultModel) ? defaultModel : models[0].id;
        }
      } catch (err) {
        lumenView.note(`Could not list models: ${err.message}`, true);
      }
      paintPrefs();
    }

    let loaded = false;
    let prefsLoaded = false;
    async function refresh() {
      const status = await native.ai.status();
      if (!prefsLoaded) {
        prefsLoaded = true;
        prefs = { ...prefs, model: status.defaultModel, ...((await native.store.get('ai-prefs')) || {}) };
        native.acp.setAuto(prefs.auto);
        showSource();
        return;
      }
      // The key screen only concerns the Lumen chat; agents use their own accounts.
      const needKey = !isAgent() && !status.hasKey;
      setup.classList.toggle('hidden', !needKey);
      main.classList.toggle('hidden', needKey);
      paintPrefs();
      if (status.hasKey && !loaded) {
        loaded = true;
        loadModels(status.defaultModel);
        loadHistory();
      }
    }

    el.querySelector('.ai-key-form').addEventListener('submit', async e => {
      e.preventDefault();
      const key = e.target.querySelector('input').value.trim();
      if (!key) return;
      await native.ai.setKey(key);
      e.target.querySelector('input').value = '';
      host.toast('Key saved');
      refresh();
    });

    el.querySelector('.ai-effort').addEventListener('click', e => {
      const b = e.target.closest('[data-effort]');
      if (!b) return;
      prefs.effort = b.dataset.effort;
      paintPrefs();
      savePrefs();
    });
    modelSel.addEventListener('change', () => { prefs.model = modelSel.value; savePrefs(); });
    modeSel.addEventListener('change', () => native.acp.setMode(modeSel.value));
    autoBoxes.forEach(b => b.addEventListener('change', () => setAuto(b.checked)));

    actions.addEventListener('click', e => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'new') {
        if (isAgent()) {
          if (busy) native.acp.cancel();
          connect(prefs.source);
        } else {
          if (busy) native.ai.stop();
          native.ai.reset();
          lumenView.clear();
          lumenView.log.insertAdjacentHTML('beforeend', '<div class="ai-note">New conversation.</div>');
        }
        input.focus();
      } else if (act === 'key') {
        const showing = !setup.classList.contains('hidden');
        setup.classList.toggle('hidden', showing);
        main.classList.toggle('hidden', !showing);
      }
    });

    // Opened from elsewhere (palette, plugins panel) with a prompt.
    this.onOpen = async arg => {
      loadAgents();
      await refresh();
      if (arg && typeof arg === 'object' && arg.prompt) {
        if (arg.send) send(arg.prompt);
        else { input.value = arg.prompt; autosize(); }
      }
      setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 60);
    };
    loadAgents();
    refresh();
  }
});
