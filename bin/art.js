#!/usr/bin/env node
// Plug in an art pack you own: copies the pack folder into the gitignored
// assets/ directory and installs its manifest as assets/manifest.json.
//   node bin/art.js "C:\path\to\Tech Dungeon Roguelite - Asset Pack (v7)"
//   node bin/art.js <pack folder> --manifest manifests/other-pack.json --as other-pack
//   node bin/art.js --off      go back to the placeholder art
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };

if (args.includes('--off')) {
  const m = path.join(ASSETS, 'manifest.json');
  if (fs.existsSync(m)) fs.renameSync(m, m + '.off');
  console.log('Placeholder art is on. Your pack is still in assets/; rerun with the pack path to switch back.');
  process.exit(0);
}

const pack = args.find((a, i) => !a.startsWith('--') && !['--manifest', '--as'].includes(args[i - 1]));
if (!pack || !fs.existsSync(pack)) {
  console.error('Usage: node bin/art.js <path to art pack folder> [--manifest manifests/tech-dungeon.json] [--as tech-dungeon]');
  process.exit(1);
}
const manifestSrc = path.resolve(ROOT, opt('--manifest', 'manifests/tech-dungeon.json'));
const as = opt('--as', 'tech-dungeon');
const dest = path.join(ASSETS, as);

fs.mkdirSync(ASSETS, { recursive: true });
fs.cpSync(pack, dest, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(manifestSrc, 'utf8'));
const missing = Object.values(manifest.sheets).filter((f) => !fs.existsSync(path.join(ASSETS, f)));
fs.writeFileSync(path.join(ASSETS, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log('Copied ' + pack + ' -> ' + path.relative(ROOT, dest));
console.log('Installed ' + path.relative(ROOT, manifestSrc) + ' -> assets/manifest.json');
if (missing.length) {
  console.warn('Warning: these sheets from the manifest were not found, so the placeholder art will be used:\n  ' + missing.join('\n  '));
  process.exit(2);
}
console.log('Done. Reload the page (restart not needed).');
