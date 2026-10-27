// Tools of Lumen's AI: used by the built-in Claude chat (ai.js) and offered to external agents
// (Claude Code, Codex, Gemini, Vibe) through Lumen's MCP server (mcp-server.js).
// side "ui": executed by the renderer; side "main": executed by the main process.

const TOOLS = [
  {
    name: 'run_command',
    side: 'ui',
    description: "Runs a shell command in a visible Lumen terminal pane and returns its output and exit code once the prompt comes back. By default it uses the dedicated agent pane (created on first use, PowerShell on Windows). Use pane=\"focused\" only when the command must affect the user's own pane (e.g. cd). Long-running or interactive programs (servers, editors, watch modes) never return: don't start them this way, tell the user instead.",
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command line, in the syntax of the target shell.' },
        pane: { type: 'string', enum: ['agent', 'focused'], description: 'Where to run it. Default: agent.' },
        cwd: { type: 'string', description: 'Optional working directory to cd into first (agent pane only).' },
        timeout_seconds: { type: 'integer', description: 'Max wait before returning partial output. Default 120.' }
      },
      required: ['command']
    }
  },
  {
    name: 'read_terminal',
    side: 'ui',
    description: "Returns the last lines visible in a terminal pane (the user's focused pane by default), e.g. to see an error the user is asking about.",
    input_schema: {
      type: 'object',
      properties: {
        pane: { type: 'string', description: '"focused", "agent", or a pane id from the environment block.' },
        lines: { type: 'integer', description: 'How many lines from the bottom. Default 80, max 500.' }
      },
      required: []
    }
  },
  {
    name: 'read_file',
    side: 'main',
    description: 'Reads a UTF-8 text file (200 KB max). Paths may be absolute or relative to the home folder; ~ is expanded.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'list_dir',
    side: 'main',
    description: 'Lists a directory (name, type, size). ~ is expanded.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] }
  },
  {
    name: 'write_file',
    side: 'main',
    description: 'Creates or overwrites a UTF-8 text file. Parent folders are created. The user approves each write.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string' } },
      required: ['path', 'content']
    }
  },
  {
    name: 'get_lumen_config',
    side: 'ui',
    description: "Returns Lumen's current effective configuration (theme, fonts, window, background, cursor, keybindings, shells), the list of themes and background modes, and the important paths.",
    input_schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'set_lumen_setting',
    side: 'ui',
    description: 'Changes one Lumen setting live and saves it to config.jsonc (comments are preserved). key is the path, e.g. ["background","mode"] or ["font","family"] or ["theme"].',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'array', items: { type: 'string' } },
        value: { description: 'New value (string, number, boolean, array or object).' }
      },
      required: ['key', 'value']
    }
  },
  {
    name: 'install_plugin',
    side: 'ui',
    description: 'Writes a Lumen plugin (JavaScript, see the plugin API in your instructions) to the plugins folder and loads it immediately. Re-installing the same name replaces it. The user approves the code first.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short file name, e.g. "git-shortcuts".' },
        code: { type: 'string', description: 'Full plugin source.' }
      },
      required: ['name', 'code']
    }
  },
  {
    name: 'add_alias',
    side: 'ui',
    description: 'Adds or replaces a Lumen alias: available in every new PowerShell, bash (Git Bash/WSL) and cmd pane. Extra arguments are passed through.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        command: { type: 'string' },
        description: { type: 'string' }
      },
      required: ['name', 'command']
    }
  },
  {
    name: 'add_note',
    side: 'ui',
    description: 'Creates a note in the Lumen notes panel, optionally with a reminder (desktop notification at that time).',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        remind_at: { type: 'string', description: 'Optional ISO 8601 local date-time, e.g. 2026-10-27T09:00.' }
      },
      required: ['title']
    }
  }
];

const APPROVAL = new Set(['run_command', 'write_file', 'install_plugin', 'add_alias']);

// Only for external agents (they have their own file tools): the current state of Lumen.
const MCP_EXTRA = [
  {
    name: 'get_environment',
    side: 'ui',
    description: "Describes the user's environment as Lumen sees it: OS, shells, every terminal pane with its folder, git status and last exit code, the focused pane, the theme. Call it first when the request is about the user's terminals or setup.",
    input_schema: { type: 'object', properties: {}, required: [] }
  }
];

// The tools external agents get through MCP: Lumen-specific ones only.
const MCP_TOOLS = [...MCP_EXTRA, ...TOOLS.filter(t => t.side === 'ui')];

module.exports = { TOOLS, APPROVAL, MCP_TOOLS };
