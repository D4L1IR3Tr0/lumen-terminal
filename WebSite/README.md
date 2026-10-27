# Lumen website (design draft)

Static site, no build step: open `index.html` in a browser.

- `index.html`: home (koi pond hero, tiling demo, features, themes, plugins teaser, download)
- `plugins.html`: plugin catalog (search, categories)
- `assets/js/koi.js`: the ASCII koi pond (same fish as Lumen's "koi" background)
- `assets/js/main.js`: bar, theme switcher (recolors the whole site), reveals, tiling demo, ASCII toys
- `assets/js/plugins.js`: catalog data and filtering
- `assets/css/style.css`: everything visual; colors are CSS variables set by the theme

Still placeholders (marked with `class="todo"`, they show "coming soon"):
download link, GitHub link, docs, release notes, plugin install/submit, and the
plugin list itself (`PLUGINS` in `assets/js/plugins.js`).
