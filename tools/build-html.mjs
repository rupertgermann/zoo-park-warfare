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

writeFileSync(out, html);
rmSync(dir, { recursive: true });
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
