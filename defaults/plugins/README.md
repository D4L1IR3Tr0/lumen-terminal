# Lumen plugins

Every `.js` file in this folder is loaded when a window starts.
A file whose name starts with `_` is disabled.

See `_example.js`: it shows how to add a command, a shortcut, a status bar item, a theme
and a sidebar panel.

Changes apply live: saving a file (re)loads the plugin, and disabling or deleting it unloads it.
You can also manage plugins from the **Plugins** panel in the sidebar. Errors show up as a notification and in the
developer tools (palette → "Developer tools").
