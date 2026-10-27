// Official AI coding CLIs. Each one signs in with the user's own account or subscription,
// so Lumen just runs them in a terminal pane: nothing is billed to the project, and no
// third-party login is involved.
const { findCommand } = require('./shells');

const win = process.platform === 'win32';

const AGENTS = [
  {
    id: 'claude',
    name: 'Claude Code',
    vendor: 'Anthropic',
    account: 'Claude Pro / Max subscription, or an API key',
    command: 'claude',
    install: 'npm install -g @anthropic-ai/claude-code',
    docs: 'https://docs.claude.com/en/docs/claude-code/overview'
  },
  {
    id: 'codex',
    name: 'Codex',
    vendor: 'OpenAI',
    account: 'ChatGPT Plus / Pro / Team plan, or an API key',
    command: 'codex',
    install: 'npm install -g @openai/codex',
    docs: 'https://github.com/openai/codex'
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    vendor: 'Google',
    account: 'Google account (free tier) or a Gemini API key',
    command: 'gemini',
    install: 'npm install -g @google/gemini-cli',
    docs: 'https://github.com/google-gemini/gemini-cli'
  },
  {
    id: 'vibe',
    name: 'Mistral Vibe',
    vendor: 'Mistral AI',
    account: 'Mistral account (Le Chat / La Plateforme)',
    command: 'vibe',
    // Needs uv (Python tool manager); the Windows line installs it first when missing.
    install: win
      ? 'if (-not (Get-Command uv -ErrorAction SilentlyContinue)) { powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"; $env:Path = "$env:USERPROFILE\\.local\\bin;$env:Path" }; uv tool install mistral-vibe'
      : 'curl -LsSf https://mistral.ai/vibe/install.sh | bash',
    docs: 'https://docs.mistral.ai/mistral-vibe/introduction/install'
  }
];

function detect() {
  return {
    agents: AGENTS.map(a => ({ ...a, path: findCommand(a.command), needsNode: a.install.startsWith('npm ') })),
    hasNpm: !!findCommand('npm'),
    platform: process.platform
  };
}

module.exports = { detect };
