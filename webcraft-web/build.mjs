// Bundles the client into one self-contained HTML file: dist/index.html
// Usage: node build.mjs   (needs: npm i esbuild three)
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const result = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  legalComments: 'eof',
  // The built-in texture pack (texturen.zip) and the pixel font go into the page, so it looks right on any server
  loader: { '.zip': 'base64', '.ttf': 'base64' },
});
const js = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/index.html', 'utf8').replace('<!-- WC_SCRIPT -->', () => `<script>${js}</script>`);
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log('dist/index.html', (html.length / 1024).toFixed(0) + ' KB');
