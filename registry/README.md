# Lumen plugin registry

The community catalog shown in Lumen's Plugins panel and on the website's plugins page.

## Submit a plugin

1. Write your plugin (see "Plugins" in `~/.lumen/AGENTS.md`, or read the built-in ones in Lumen's
   Plugins panel). Test it in `~/.lumen/plugins`.
2. Give it a complete header:

   ```js
   // @name My plugin
   // @description One or two sentences: what it does.
   // @version 1.0.0
   // @author your-github-name
   // @category dev            (dev, productivity, bar, themes or ai)
   // @permissions git         (optional: clipboard, git, github)
   ```

3. Add it as `registry/plugins/<id>.js`, run `node scripts/build-registry.js`, and open a pull
   request with both files.

Every plugin is read before it is merged. Plugins run inside Lumen's window with the permissions
they declare; anything that hides what it does, downloads code at runtime or sends data somewhere
without saying so in its description is refused.

## How installs work

Lumen downloads `plugins.json`, then the plugin file, and checks it against the `sha256` in the
index before saving it. Plugins always arrive **disabled**, so you can read the code first.
