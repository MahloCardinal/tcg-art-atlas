import { readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Script } from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// A classic script can load from file:// without fetch or module CORS access.
// Keep catalog.json and the source modules as the editable source of truth.
export async function prepareLocal() {
  const [core, app, data] = await Promise.all([
    readFile(path.join(root, 'src/core.js'), 'utf8'),
    readFile(path.join(root, 'src/app.js'), 'utf8'),
    readFile(path.join(root, 'public/data/catalog.json'), 'utf8'),
  ]);
  const catalog = JSON.parse(data);
  if (!Array.isArray(catalog.cards) || !Array.isArray(catalog.sets)) throw new Error('Catalogo non valido');
  const importLine = /^import \{[^\n]+\} from '\.\/core\.js';\r?\n/m;
  if (!importLine.test(app)) throw new Error('Import core.js non riconosciuto');
  const sources = [core, app.replace(importLine, '')].map(source => source.replace(/^export (?=(?:const|function)\b)/gm, ''));
  if (sources.some(source => /^\s*(?:import|export)\b/m.test(source))) throw new Error('Modulo non supportato nel bundle locale');
  const bundle = `// Generato da npm run prepare:local. Modificare src/ e public/data/catalog.json.\n(() => {\n'use strict';\n${sources.join('\n')}\nstartApp(${JSON.stringify(catalog)}, new URL(document.currentScript.dataset.assets, document.baseURI));\n})();\n`;
  new Script(bundle, { filename: 'app.js' });
  const target = path.join(root, 'public/app.js');
  let previous;
  try { previous = await readFile(target, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (previous !== bundle) {
    await writeFile(`${target}.tmp`, bundle, 'utf8');
    await rename(`${target}.tmp`, target);
  }
  return catalog.cards.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Apertura diretta pronta: ${await prepareLocal()} artwork. Apri index.html.`);
}
