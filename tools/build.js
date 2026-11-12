// Builds the app from src/: src/gen.js, src/sim.js and src/app.js go inside src/page.html.
//   docs/index.html          the website (GitHub Pages serves the docs folder)
//   robot-code-builder.html  the same page without <html>/<head>, for hosts that add their own
// Usage: node tools/build.js
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const page = read('src/page.html');
const parts = { gen: read('src/gen.js'), sim: read('src/sim.js'), app: read('src/app.js') };

Object.entries(parts).forEach(([name, js]) => {
  if (/<\/script/i.test(js)) throw new Error(`src/${name}.js contains "</script", which would end the script tag early.`);
  if (!page.includes(`<!-- @${name} -->`)) throw new Error(`src/page.html has no <!-- @${name} --> marker.`);
});

// A function replacement keeps "$1" and friends inside the scripts from being treated as patterns.
let out = page;
Object.entries(parts).forEach(([name, js]) => {
  out = out.replace(`<!-- @${name} -->`, () => `<script>\n${js}</script>`);
});

const target = path.join(root, 'robot-code-builder.html');
fs.writeFileSync(target, out);
console.log(`Wrote robot-code-builder.html (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB)`);

// A copy wrapped in the same skeleton the Artifact host adds, for testing on a local server.
const skeleton = '<!doctype html><html><head><meta charset=utf8>' +
  '<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}' +
  'body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>' +
  '</head><body>' + out + '</body></html>';
fs.mkdirSync(path.join(root, '.preview'), { recursive: true });
fs.writeFileSync(path.join(root, '.preview', 'index.html'), skeleton);

// The website: a complete HTML document. Everything before the top bar belongs in <head>.
const cut = out.indexOf('<header class="topbar">');
if (cut < 0) throw new Error('src/page.html has no <header class="topbar">.');
const icon = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
  '<rect width="32" height="32" rx="7" fill="#16202a"/><rect x="7" y="11" width="18" height="4" rx="2" fill="#dda900"/>' +
  '<rect x="7" y="17" width="18" height="4" rx="2" fill="#21934b"/></svg>');
const site = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' +
  '<meta name="description" content="Fill in what is on your FRC robot and get WPILib 2026 Java code: subsystems, buttons, autos with PathPlanner, AprilTag vision and a simulator that runs in the browser.">\n' +
  `<link rel="icon" href="${icon}">\n` +
  out.slice(0, cut).replace(/<meta name="claude:[^>]*>\n?/g, '') +
  '</head>\n<body>\n' + out.slice(cut) + '</body>\n</html>\n';
fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs', 'index.html'), site);
// No Jekyll on GitHub Pages: the site is one finished page.
fs.writeFileSync(path.join(root, 'docs', '.nojekyll'), '');
console.log(`Wrote docs/index.html (${(Buffer.byteLength(site) / 1024).toFixed(1)} KB)`);
