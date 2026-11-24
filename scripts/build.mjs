import { cp, mkdir, readFile, writeFile, stat, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareLocal } from './prepare-local.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(await readFile(path.join(root, 'public/data/catalog.json'), 'utf8'));
const ids = new Set();
const imagePaths = new Set();
for (const card of catalog.cards) {
  if (!card.id || ids.has(card.id)) throw new Error(`ID mancante o duplicato: ${card.id}`);
  ids.add(card.id);
  for (const version of [card, ...(card.imageVersions || [])]) for (const field of ['image', 'thumbnail']) {
    if (!/^\/images\/cards\/[a-zA-Z0-9_.-]+\.webp$/.test(version[field])) throw new Error(`Percorso immagine non valido: ${version[field]}`);
    const file = path.join(root, 'public', version[field]);
    imagePaths.add(file);
    const buffer = await readFile(file);
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`WebP non valido: ${file}`);
  }
  if (!catalog.sets.some(set => set.id === card.setId && set.game === card.game)) throw new Error(`Espansione mancante: ${card.id}`);
}
for (const set of catalog.sets) {
  if (!/^\/images\/sets\/[a-zA-Z0-9_.-]+\.webp$/.test(set.image)) throw new Error(`Immagine set mancante: ${set.id}`);
  const file = path.join(root, 'public', set.image);
  const buffer = await readFile(file);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`WebP non valido: ${file}`);
  imagePaths.add(file);
}
for (const game of ['pokemon', 'onepiece']) {
  const file = path.join(root, 'public', 'images', 'games', `${game}.webp`);
  const buffer = await readFile(file);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') throw new Error(`Logo WebP non valido: ${file}`);
  imagePaths.add(file);
}
const dist = path.join(root, 'dist');
await prepareLocal();
// Remove only this project's resolved output directory, after validating inputs.
if (path.dirname(path.resolve(dist)) !== root || path.basename(dist) !== 'dist') throw new Error('Output directory outside workspace');
try { if ((await lstat(dist)).isSymbolicLink()) throw new Error('Output directory must not be a symlink'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'public'), dist, { recursive: true });
await cp(path.join(root, 'src'), path.join(dist, 'src'), { recursive: true });
const html = await readFile(path.join(root, 'index.html'), 'utf8');
await writeFile(path.join(dist, 'index.html'), html.replaceAll('./public/', './'), 'utf8');
let imageBytes = 0;
for (const file of imagePaths) imageBytes += (await stat(file)).size;
console.log(`Build completata: ${catalog.cards.length} artwork, ${catalog.sets.length} espansioni, ${(imageBytes / 1024 / 1024).toFixed(2)} MB di immagini WebP.\nOutput: ${dist}`);
