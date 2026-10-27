<!-- lumen-generated: this file is rewritten by Lumen at startup. Put your own notes elsewhere. -->
# Customizing Lumen (guide for AI agents)

You are running inside **Lumen**, a tiling terminal app (Electron + xterm.js). The current folder
is Lumen's user folder. Everything here is **hot-reloaded**: when you save a file, the running
app applies it within a second. Never edit files under the app's install folder; only this one.

```
config.jsonc        settings (JSONC: comments allowed, keep them)
themes/*.json       color themes (file name = theme id)
plugins/*.js        plugins (a leading "_" in the name disables one)
backgrounds/        pictures for background.image ("backgrounds/<file>")
fonts/              .ttf/.otf/.woff2 fonts, offered first in the font picker
data/aliases.json   shell aliases shared by PowerShell, bash and cmd
data/*.json         other app data (notes, favorites…) – don't edit unless asked
```

## config.jsonc

Edit values in place and keep the comments. Main keys:

| Key | Values |
|---|---|
| `theme` | a built-in id (`tokyo-night`, `catppuccin-mocha`, `rose-pine`, `kanagawa`, `gruvbox`, `everforest`, `nord`, `matte-black`, `dracula`, `one-dark`, `github-dark`, `night-owl`, `ayu-mirage`, `monokai-pro`, `solarized-dark`, `synthwave-84`, `poimandres`, `oxocarbon`, `osaka-jade`, `catppuccin-latte`, `rose-pine-dawn`, `flexoki-light`) or a file name from `themes/` |
| `font` | `family` (bundled: JetBrains Mono, Fira Code, Cascadia Code, Geist Mono, IBM Plex Mono, Source Code Pro, Commit Mono, Iosevka, Monaspace Neon, Victor Mono, Martian Mono, Intel One Mono, Space Mono, or any installed font), `size`, `lineHeight`, `weight`, `weightBold` |
| `cursor` | `style` bar/block/underline, `blink`, `width`, `inactive` outline/block/bar/underline/none, `color` theme/accent/accent2/#hex |
| `window` | `gap`, `padding`, `radius`, `borderWidth`, `inactiveOpacity`, `animations`, `bar`, `clock`, `stats`, `paneOpacity` (0.3–1), `backgroundMaterial` none/acrylic/mica |
| `background` | `mode` none/image/aurora/constellation/waves/koi/koi-blocks/jellyfish/dither/matrix/starfield/horizon, `image` ("backgrounds/<file>" in ~/.lumen/backgrounds, or an absolute path), `imageStyle` plain/dither/dither-animated/ascii, `blur` (plain only), `dim`, `speed`, `intensity` |
| `terminal` | `flow` top/bottom, `separators` (line between commands), `blocks` (hover actions on commands) |
| `behavior` | `copyOnSelect`, `rightClickPaste`, `focusFollowsMouse`, `scrollback`, `inheritCwd`, `shellIntegration`, `git`, `restoreSession`, `notifyAfter` (seconds, 0 = off) |
| `shells` | `default` ("auto" or a profile id), `profiles`: `[{ "id", "name", "command", "args": [] }]` |
| `builtinPlugins` | `{ "notes": false }` turns a built-in plugin off (built-ins: `notes`, `clipboard`, `git`) |
| `keybindings` | `{ "commandId": "Ctrl+Shift+X" }`, `""` disables. Modifiers: Ctrl, Shift, Alt, Meta |

Command ids for keybindings include `pane.new`, `pane.splitRight`, `pane.splitDown`, `pane.close`,
`pane.zoom`, `focus.left|right|up|down`, `swap.*`, `resize.*`, `workspace.1`…`9`, `moveTo.1`…`9`,
`prompt.prev`, `prompt.next`, `block.copyOutput`, `palette.open`, `theme.pick`, `settings.open`, `search.open`, `window.new`, `panel.ai`,
`panel.folders`, `panel.aliases`, plus any plugin command id (the built-in plugins add
`panel.notes`, `note.new`, `panel.clipboard`, `panel.git`, `git.commit`, `git.fetch`, `git.pull`,
`git.push`, `git.github`).

## Themes: `themes/<id>.json`

```json
{
  "name": "My theme",
  "light": false,
  "background": "#1b1d2b", "foreground": "#d6deeb", "cursor": "#80a4c2", "selectionBackground": "#2c3350",
  "black": "#1b1d2b", "red": "#ef5350", "green": "#22da6e", "yellow": "#addb67",
  "blue": "#82aaff", "magenta": "#c792ea", "cyan": "#21c7a8", "white": "#d6deeb",
  "brightBlack": "#575656", "brightRed": "#ef5350", "brightGreen": "#22da6e", "brightYellow": "#ffeb95",
  "brightBlue": "#82aaff", "brightMagenta": "#c792ea", "brightCyan": "#7fdbca", "brightWhite": "#ffffff",
  "ui": { "crust": "#11121c", "accent": "#82aaff", "accent2": "#c792ea" }
}
```

`ui` is optional (`crust` = window background, `accent` = focus color, `accent2` = secondary).
To switch to it, set `"theme": "<id>"` in config.jsonc.

## Plugins: `plugins/<name>.js`

Plain JavaScript run inside the app window: **no `require`, no Node.js APIs**. Everything is live:
saving the file loads it, re-saving reloads it (the old version is fully cleaned up), renaming it
with a leading `_` or deleting it unloads it. Start the file with a metadata header:

```js
// @name Weather
// @description Shows the weather in the top bar.
// @version 1.0.0
// @author you
// @permissions clipboard   (optional: extra services, see below)

module.exports = lumen => {
  lumen.statusbar.add({
    id: 'weather', title: 'Weather', interval: 600000,
    text: () => lumen.__weather || '…'
  });
  fetch('https://wttr.in/?format=%t').then(r => r.text()).then(t => { lumen.__weather = t.trim(); lumen.statusbar.refresh(); });
};
```

### API (`lumen`)

| API | Purpose |
|---|---|
| `commands.register(id, { title, run, keybinding?, keywords? })` | adds a palette command (and optional shortcut) |
| `run(commandId)` | runs any command (built-in or plugin) |
| `themes.register(id, theme)` / `themes.apply(id)` / `themes.current` | themes from code |
| `statusbar.add({ id, text: string \| () => string, interval?, title?, onClick? })`, `.remove(id)`, `.refresh()` | items in the top bar |
| `sidebar.add({ id, title, icon: '<svg viewBox="0 0 24 24">…</svg>', hint?, order?, width?, render(el, ui, actionsEl), onOpen?(arg), onClose?() })`, `.open(id, arg?)`, `.toggle(id, arg?)`, `.isOpen(id)`, `.close()` | a panel in the left sidebar; style with classes `p-list`, `p-row`, `p-search`, `p-tabs`, `s-btn`, `p-empty` |
| `panes.focused()`, `panes.all()`, `panes.create({ profile?, cwd? })` | terminals; a pane has `id`, `cwd`, `title`, `shell`, `run(cmd)`, `write(data)`, `paste(text)`, `ready(ms?)` (resolves at the first prompt), `onOutput(fn)`, `focus()`, `close()`, `term` (xterm.js) |
| `on(event, fn)` | events: `pane:created`, `pane:focused`, `pane:closed`, `workspace:changed`, `theme:changed`, `cwd:changed`, `reminder` |
| `storage.get(key)` / `storage.set(key, data)` / `storage.onChange(key, fn)` | async JSON persistence (`data/plugin-<name>-<key>.json`); `onChange` fires when another window or Lumen changes it |
| `ui.icon(name)`, `ui.escape(text)`, `ui.prettyPath(p)`, `ui.toast(msg, kind?)`, `ui.confirmClick(button, hint)`, `ui.pickPath({ mode: 'file' | 'folder', title })`, `ui.openUrl(https)`, `ui.relativeTime(t)` | helpers for panels (`confirmClick` returns true on the second click, `pickPath` is Lumen's own picker: no popups) |
| `notify(message, 'info' \| 'error')` | toast |
| `css(text)` | injects a stylesheet; theme variables: `--bg --fg --crust --surface --overlay --border --accent --accent2 --muted --red --green --yellow` |
| `ai.ask(prompt)` | opens Lumen's built-in assistant with a prompt |
| `config`, `name`, `version`, `platform`, `permissions`, `shells` | read-only info |

Permissions (`// @permissions a, b` in the header) unlock extra services:

| Permission | Service |
|---|---|
| `clipboard` | `clipboard.read()`, `clipboard.write(text)`, `clipboard.history.list()`, `.remove(text)`, `.clear()`, `.onChange(fn)` |
| `git` | `git.root(dir)`, `.summary(dir)`, `.status(dir)`, `.log(dir, { limit })`, `.branches(dir)`, `.diff(dir, file, { staged, untracked })`, `.show(dir, hash)`, `.stage(dir, files)`, `.stageAll`, `.unstage`, `.unstageAll`, `.discard(dir, files)`, `.commit(dir, message, { amend, all })`, `.fetch`, `.pull`, `.push`, `.checkout(dir, branch)`, `.createBranch`, `.stash`, `.stashPop`, `.scan(folder)` (all async) |
| `github` | `github.status()`, `.get('/api/path')` (read-only REST), `.contributions()`, `.setToken(token)`, `.signOut()`, `.refresh()`; the token itself is never given to plugins |

The built-in Notes, Clipboard and Git panels are plugins themselves: read them in the Plugins panel
("View code") for complete examples. A user plugin with the same file name replaces a built-in one.

Rules for good plugins: keep ids prefixed with the plugin name (`weather.refresh`), never block
the UI thread with long loops, use `interval` ≥ 1000 ms for status items, and catch fetch errors.
Commands, status items, panels, themes, CSS, `on()` listeners, `onOutput` listeners and
`setInterval`/`setTimeout` are cleaned up automatically on unload; for anything else, return a
cleanup function from `module.exports = lumen => { …; return () => { /* undo */ }; }`.

## Aliases: `data/aliases.json`

```json
[{ "name": "gs", "command": "git status", "description": "Repository status" }]
```

Names: letters, digits, `-`, `_`, `.`. Saving regenerates the PowerShell, bash and cmd
definitions; they apply to **new** terminals.

## After a change

Tell the user what you changed and how to see it (most changes are visible instantly).
If something breaks, the app shows the error as a notification; fix the file and save again.
