#!/usr/bin/env node
// Vercel build: gathers the static site into dist/. Your art pack in assets/ is
// copied too when you deploy from your own PC with `vercel --prod`; the GitHub
// repo never contains it, so a build from git runs on placeholder art.
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist');
fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'public'), OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'shared'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'shared', 'reducer.js'), path.join(OUT, 'shared', 'reducer.js'));
fs.mkdirSync(path.join(OUT, 'lib'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'lib', 'demo.js'), path.join(OUT, 'lib', 'demo.js'));
const assets = path.join(ROOT, 'assets');
if (fs.existsSync(path.join(assets, 'manifest.json'))) {
  fs.cpSync(assets, path.join(OUT, 'assets'), { recursive: true });
  console.log('build: included your art pack from assets/');
} else {
  console.log('build: no assets/manifest.json, the site will use placeholder art');
}
