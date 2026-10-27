# Lumen

A beautiful, tiling, extensible terminal inspired by omarchy and Hyprland.
Electron + xterm.js (WebGL renderer) + ConPTY.

## Run

- Double-click **`Lumen.lnk`** (right click → Pin to taskbar)
- or `npm start`

## Build the installers

Each system builds its own installers (native terminal backend and installer tools):

| Command | On | Produces (in `dist/`) |
|---|---|---|
| `npm run dist:win` | Windows | `Lumen-Setup-<version>.exe` (per-user install, shortcuts, uninstaller) |
| `npm run dist:linux` | Linux (or Windows for `.tar.gz`) | `.AppImage`, `.deb`, `.tar.gz` for x64 and arm64 |
| `npm run dist:mac` | macOS only | `.dmg` and `.zip` for Apple Silicon and Intel |
| `npm run pack` | any | an unpacked app in `dist/<os>-unpacked`, to try without installing |

**Releases for all three systems**: push the project to GitHub, then push a version tag:

```
npm version 0.2.0        # bumps package.json and creates the tag v0.2.0
git push --follow-tags
```

`.github/workflows/build.yml` builds Windows, Linux and macOS on GitHub's machines and drafts a
GitHub Release with every installer attached; check it and click Publish. (Without a tag, run the
workflow by hand from the Actions tab: the installers are kept as downloadable artifacts.)

Installers are not signed yet: Windows SmartScreen and macOS Gatekeeper warn on first launch
(macOS: right click the app → Open). Signing needs a certificate per platform, added later as
repository secrets (see the workflow file).

Your settings, themes, plugins, backgrounds, fonts and notes live in `~/.lumen` and are never
touched by installing, updating or uninstalling.

## Shortcuts

| Action | Shortcut |
|---|---|
| New terminal (auto tiling) | `Ctrl+Shift+Enter` |
| Split right / down | `Ctrl+Shift+D` / `Ctrl+Shift+E` |
| Close pane | `Ctrl+Shift+W` |
| Zoom pane | `Ctrl+Shift+Z` |
| Focus | `Ctrl+Shift+←↑→↓` |
| Move pane | `Alt+Shift+←↑→↓` |
| Resize | `Ctrl+Alt+←↑→↓` (or drag between panes, double-click = 50/50) |
| Workspace 1…9 | `Alt+1…9` |
| Send pane to workspace N | `Alt+Shift+1…9` |
| Command palette | `Ctrl+Shift+P` |
| Themes (live preview) | `Ctrl+Shift+T` |
| New terminal with another shell | `Ctrl+Shift+S` |
| Search | `Ctrl+Shift+F` |
| New window | `Ctrl+Shift+N` |
| Settings | `Ctrl+,` (config file: `Ctrl+Alt+,`) |
| Font size | `Ctrl+=` / `Ctrl+-` / `Ctrl+0` |
| Copy / paste | `Ctrl+C` (with a selection) / `Ctrl+V`, or right click |

## Live settings (`Ctrl+,`)

- **Theme**: 22 themes (Tokyo Night, Catppuccin, Rosé Pine, Dracula, Gruvbox, Nord, Kanagawa, Synthwave '84…)
- **Background**: Aurora, Constellation, Waves, ASCII koi and block koi (goldfish seen from above),
  ASCII jellyfish, Dither (Bayer), Digital rain, Hyperspace, Retro horizon, or an image (blur, darken).
  Speed and intensity are adjustable. Every animated background costs under ~2 ms per frame and
  slows down to 8 fps when the window isn't focused.
- **Font**: 13 bundled fonts + every monospace font installed on the machine; size, line height, weight
- **Cursor**: bar, block or underline; thickness, blink, unfocused style, color
- **Transparency**, gaps, corner radius, stats, git

Every change applies instantly and is saved to `config.jsonc` without touching your comments.

## Sidebar (hover the left edge)

| Panel | Shortcut | What it does |
|---|---|---|
| Folders | `Ctrl+Shift+O` | Favorites + recent folders; click = `cd` in the active terminal |
| Notes | `Ctrl+Shift+M` | Pinnable notes, reminders (built-in plugin) |
| Clipboard | `Ctrl+Shift+H` | History (memory only) + pinned items; click = paste (built-in plugin) |
| Git | `Ctrl+Shift+G` | Follows the focused terminal's repository: changes, diffs, stage, commit, fetch/pull/push, history, branches, stashes; GitHub account (via `gh auth login` or a token): repos, clone, PRs, review requests, issues, activity, contributions, PR and CI status of the branch (built-in plugin) |
| AI assistant | `Ctrl+Shift+A` | Lumen's own chat (Anthropic API key) or your own agent (Claude Code, Codex, Gemini CLI, Mistral Vibe) right in the panel |
| Aliases | `Ctrl+Shift+L` | The aliases of the focused terminal, read from it live (session ones included) + Lumen aliases shared by PowerShell, Git Bash, WSL and cmd |
| Plugins | palette | Built-in plugins on/off; enable, read, delete, install (file / URL), create with AI |

### AI: bring your own account

The AI panel has two kinds of sources:

- **Lumen**: the built-in chat, with your Anthropic API key (stored encrypted, never sent to the page).
- **Agents**: Gemini CLI, Codex, Claude Code and Mistral Vibe, each signed in with **your own**
  account. Lumen talks to them with the [Agent Client Protocol](https://agentclientprotocol.com):
  their answers, thoughts, plan, tool calls and file diffs show up in the panel. Codex and Claude
  Code go through the official ACP adapters (`@agentclientprotocol/codex-acp`,
  `@agentclientprotocol/claude-agent-acp`, fetched by `npx` on first use); Gemini runs
  `gemini --acp`, Vibe `vibe-acp`. An agent that isn't installed opens in a terminal to install it
  and sign in. Claude Code opens in a terminal by default (Anthropic hasn't approved third-party
  sign-in); you can opt in to the panel.

Safety, for both:
- anything that changes something asks first (Allow / Deny); **Auto** is off by default;
- commands an agent runs appear in a visible "✦" pane, with their output and exit code;
- agents reach Lumen's own tools (environment, terminal, settings, themes, aliases, notes, plugins)
  through Lumen's MCP server over stdio, linked to the window by a local pipe and a per-session
  token: no network port is opened;
- Lumen never handles your credentials and never pays for AI: each tool uses your own account.

Developers: `LUMEN_ACP_MOCK=<script>` adds a scripted test agent to the panel.

## Automatic tracking

- **Current folder**: PowerShell, Git Bash, WSL and cmd report it at every prompt; new panes open there.
- **Git**: branch, `↑↓` commits to push/pull, `+` staged, `~` modified, `?` untracked, `!` conflicts, `✓` clean.
- **Failures**: a `✕ code` badge appears when the last command failed.
- **System**: CPU, GPU and RAM with the last minute of history (hover for details).
- **Command blocks**: hover a command to copy it, copy its output or run it again; `Ctrl+Shift+PageUp/PageDown` jumps between prompts; optional separators (red after a failure).
- **Long commands**: a desktop notification (or a toast, if another pane is focused) when a command over 10 s ends in the background.
- **Session**: windows, workspaces, splits, shells and folders come back at the next start.
- **Drag & drop** files onto a pane to type their paths (quoted for the shell); **OSC 8 links** open with Ctrl+click (`file://` links are shown in the file manager, never run).

## Customize

Everything lives in `~/.lumen/` (`C:\Users\<you>\.lumen`) and is hot-reloaded:

- `config.jsonc`: theme, font, spacing, corners, background, shells, shortcuts
- `themes/*.json`: your themes (see `example-theme.json.txt`)
- `plugins/*.js`: your plugins (see `_example.js`); `builtin-plugins/` holds Notes, Clipboard and Git, written with the same API
- `backgrounds/`: pictures for the "image" background (shown as a gallery in the settings; four styles: plain, dither, animated dither, ASCII)
- `fonts/`: `.ttf` / `.otf` / `.woff2` files, listed first in the font picker (`MyFont-Bold.ttf` → family "MyFont", weight 700)

## Layout

```
src/main/main.js        windows, PTYs, IPC
src/main/config.js      ~/.lumen, hot reload, comment-preserving edits
src/main/shells.js      shell detection and integration hooks
src/main/ai.js          Claude agent loop (the API key stays here)
src/main/…              git, stats, clipboard, aliases, plugins, store
src/preload.js          secure bridge between the page and the system
src/renderer/app.js     workspaces, panes, themes, commands, plugin API
src/renderer/background.js  animated backgrounds
src/renderer/panels/*   sidebar panels
src/shared/themes.js    built-in themes
```
