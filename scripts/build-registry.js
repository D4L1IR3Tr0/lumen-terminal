// Builds registry/plugins.json from the plugins in registry/plugins/*.js (their header metadata
// plus a sha256 of the file). Lumen and the website both read that index.
//   node scripts/build-registry.js          write the index
//   node scripts/build-registry.js --check  fail if the committed index is out of date (CI)
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..', 'registry');
const DIR = path.join(ROOT, 'plugins');
const OUT = path.join(ROOT, 'plugins.json');
const RAW = 'https://raw.githubusercontent.com/D4L1IR3Tr0/lumen-terminal/main/registry/plugins/';
const CATEGORIES = ['dev', 'productivity', 'bar', 'themes', 'ai'];

function meta(code) {
  const out = {};
  for (const line of code.split('\n').slice(0, 40)) {
    const m = line.match(/^\s*\/\/\s*@(\w+)\s+(.+?)\s*$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

const plugins = fs.readdirSync(DIR).filter(f => /^[\w.-]+\.js$/.test(f)).sort().map(file => {
  const code = fs.readFileSync(path.join(DIR, file), 'utf8');
  const m = meta(code);
  const id = file.replace(/\.js$/, '');
  for (const key of ['name', 'description', 'version', 'author', 'category']) {
    if (!m[key]) throw new Error(`${file}: missing "// @${key}" in the header`);
  }
  if (!CATEGORIES.includes(m.category)) throw new Error(`${file}: @category must be one of ${CATEGORIES.join(', ')}`);
  return {
    id,
    name: m.name,
    description: m.description,
    version: m.version,
    author: m.author,
    category: m.category,
    permissions: (m.permissions || '').split(/[\s,]+/).filter(Boolean),
    url: RAW + file,
    sha256: crypto.createHash('sha256').update(code).digest('hex'),
    size: Buffer.byteLength(code)
  };
});

const json = JSON.stringify({ version: 1, plugins }, null, 2) + '\n';
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== json) {
    console.error('registry/plugins.json is out of date: run "node scripts/build-registry.js" and commit it.');
    process.exit(1);
  }
  console.log(`registry ok (${plugins.length} plugins)`);
} else {
  fs.writeFileSync(OUT, json);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${plugins.length} plugins)`);
}
