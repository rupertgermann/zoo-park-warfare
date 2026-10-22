// Builds the game as one self-contained HTML file: dist/zoo-park-warfare.html.
// Everything is procedural (no textures, models or sound files), so inlining the JS and CSS bundle
// is all it takes. The file plays from GitHub Pages and from a double-click on file://.
import { build } from 'vite';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';

const out = 'dist/zoo-park-warfare.html';
await build({ base: './', logLevel: 'warn', build: { outDir: 'dist/bundle', emptyOutDir: true, assetsInlineLimit: Infinity, chunkSizeWarningLimit: 2000 } });

const dir = 'dist/bundle';
let html = readFileSync(`${dir}/index.html`, 'utf8');
const file = src => readFileSync(`${dir}/${src.replace(/^\.\//, '')}`, 'utf8');
let scripts = 0, styles = 0;
html = html.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, (_, src) => {
  scripts++;
  return `<script type="module">${file(src).replaceAll('</script', '<\\/script')}</script>`;
});
html = html.replace(/<link rel="stylesheet" crossorigin href="([^"]+)">/g, (_, href) => { styles++; return `<style>${file(href)}</style>`; });
if (scripts !== 1 || styles !== 1 || /(src|href)="\.\/assets\//.test(html)) throw new Error(`inlining failed: ${scripts} scripts, ${styles} styles inlined`);

// the game's own MIT license plus three.js's, whose header the bundle drops; MIT requires both notices in every copy
const license = f => readFileSync(f, 'utf8').trim().replaceAll('--', '- -');
// after <meta charset>, which browsers only honour within the first 1024 bytes
html = html.replace(/<meta charset=[^>]*>/i, m => `${m}\n<!--\nZoo Park Warfare\n\n${license('LICENSE')}\n\n\nThis file bundles three.js (https://github.com/mrdoob/three.js).\n\n${license('node_modules/three/LICENSE')}\n-->`);
if (!html.includes('This file bundles three.js')) throw new Error('license notice not inserted');
writeFileSync(out, html);
rmSync(dir, { recursive: true });
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
