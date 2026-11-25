import http from 'node:http';
import path from 'node:path';
import { readFile, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script, createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'public');
const prefix = 'globalThis.TCG_ART_ATLAS_CATALOG=';

async function readCatalog() {
  const source = (await readFile(path.join(site, 'catalog.js'), 'utf8')).trim();
  assert.ok(source.startsWith(prefix) && source.endsWith(';'), 'Formato catalog.js non valido');
  return JSON.parse(source.slice(prefix.length, -1));
}

async function check() {
  const catalog = await readCatalog();
  const app = await readFile(path.join(site, 'app.js'), 'utf8');
  new Script(app, { filename: 'app.js' });
  const ids = new Set();
  const images = new Set(['logos/pokemon_logo.webp', 'logos/onepiece_logo.webp', 'logos/tcg_art_atlas_logo.webp']);
  const setKeys = new Set(catalog.sets.map(set => `${set.game}:${set.id}`));
  const sets = new Map(catalog.sets.map(set => [`${set.game}:${set.id}`, set]));
  for (const card of catalog.cards) {
    assert.ok(card.id && !ids.has(card.id), `ID mancante o duplicato: ${card.id}`);
    ids.add(card.id);
    assert.ok(setKeys.has(`${card.game}:${card.setId}`), `Set mancante: ${card.id}`);
    assert.ok(card.imageWidth > 0 && card.imageHeight > 0, `Dimensioni mancanti: ${card.id}`);
    assert.ok(!('assetPath' in card), `Percorso temporaneo nel catalogo: ${card.id}`);
    assert.ok(!('thumbnail' in card), `Miniatura duplicata: ${card.id}`);
    if (card.imageVersions?.length) {
      const languages = card.imageVersions.map(image => image.language);
      assert.equal(new Set(languages).size, languages.length, `Lingua duplicata: ${card.id}`);
      assert.ok(card.imageVersions.some(image => image.image === card.image), `Immagine principale fuori dalle versioni: ${card.id}`);
    }
    for (const version of [card, ...(card.imageVersions || [])]) {
      assert.ok(version.image.startsWith(`cards/${card.game}/`), `Cartella gioco errata: ${version.image}`);
      const language = String(version.language || card.imageLanguage || 'und').toLowerCase();
      const languageSuffix = ['en', 'eng'].includes(language) ? '' : ['ja', 'jp', 'jap'].includes(language) ? '_JAP' : ['it', 'ita'].includes(language) ? '_ITA' : '_UND';
      // A verified translation may come from a regional set with different numbering.
      // Exact reused scans are shared, including distinct holo/non-holo card codes.
      assert.match(path.basename(version.image), /^[A-Z0-9]+(?:_[A-Z0-9]+)*\.webp$/, `Nome immagine non conforme: ${version.image}`);
      assert.ok(languageSuffix ? path.basename(version.image).endsWith(languageSuffix + '.webp') : !/_(JAP|ITA|UND)\.webp$/.test(version.image), `Lingua e file non corrispondono: ${version.image}`);
      images.add(version.image);
    }
  }
  for (const set of catalog.sets) {
    assert.match(set.folder, /^[A-Z0-9]+(?:_[A-Z0-9]+)*$/);
    images.add(set.image);
    const members = catalog.cards.filter(card => card.game === set.game && (card.setIds || [card.setId]).includes(set.id));
    const codes = new Set(members.filter(card => card.category !== 'DON!!').flatMap(card => card.codes || [card.code]));
    if (set.expectedCodeList) for (const code of set.expectedCodeList) assert.ok(codes.has(code), `Codice mancante in ${set.id}: ${code}`);
    else if (set.expectedCodes) assert.equal(codes.size, set.expectedCodes, `Set incompleto: ${set.id}`);
  }
  for (const [alias, target] of Object.entries(catalog.aliases || {})) {
    assert.ok(!ids.has(alias), `Alias ancora presente come carta: ${alias}`);
    const visited = new Set([alias]); let resolved = target;
    while (catalog.aliases[resolved]) { assert.ok(!visited.has(resolved), `Ciclo alias: ${alias}`); visited.add(resolved); resolved = catalog.aliases[resolved]; }
    assert.ok(ids.has(resolved), `Destinazione alias mancante: ${alias}`);
  }
  for (const card of catalog.cards.filter(card => card.game === 'onepiece')) {
    if (card.artworkOrigin?.status === 'unverified') assert.ok(card.reviewNote, `NOTE mancanti: ${card.id}`);
  }
  let imageBytes = 0;
  for (const image of images) {
    assert.match(image, /^(?:cards\/(?:pokemon|onepiece)\/[A-Z0-9]+(?:_[A-Z0-9]+)*\/[A-Z0-9]+(?:_[A-Z0-9]+)*|logos\/[a-zA-Z0-9]+(?:_[a-zA-Z0-9]+)*)\.webp$/);
    const buffer = await readFile(path.join(site, image));
    assert.equal(buffer.toString('ascii', 0, 4), 'RIFF', image);
    assert.equal(buffer.toString('ascii', 8, 12), 'WEBP', image);
    imageBytes += buffer.length;
  }
  async function listFiles(relative = '') {
    const files = [];
    for (const entry of await readdir(path.join(site, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        assert.ok(!relative || name.startsWith('cards/'), `Annidamento eccessivo fuori da cards/: public/${name}`);
        files.push(...await listFiles(name));
      } else {
        assert.ok(entry.isFile(), `File non regolare: public/${name}`);
        files.push(name);
      }
    }
    return files;
  }
  const files = await listFiles();
  for (const file of files.filter(file => file.endsWith('.webp'))) assert.ok(images.has(file), `Immagine inutilizzata: ${file}`);
  for (const file of ['index.html', 'style.css']) await stat(path.join(site, file));
  const favicon = await readFile(path.join(site, 'favicon.svg'), 'utf8');
  assert.ok(favicon.startsWith('<svg ') && favicon.includes('viewBox="0 0 512 512"'), 'Favicon SVG non valida');
  console.log(`Verifica completata: ${catalog.cards.length} artwork, ${catalog.sets.length} espansioni, ${images.size} immagini (${(imageBytes / 1024 / 1024).toFixed(2)} MB). Nessun bundle o immagine duplicata.`);
  return { catalog, app };
}

async function test() {
  const { catalog, app } = await check();
  const context = createContext({ URL, Intl });
  new Script(app).runInContext(context);
  const { filterCards, groupCardResults, resolveAlias, validateCollection, mergeCollections, emptyCollection, languageImages, loadCollection, STORAGE_KEY, LEGACY_STORAGE_KEYS } = runInContext('({filterCards,groupCardResults,resolveAlias,validateCollection,mergeCollections,emptyCollection,languageImages,loadCollection,STORAGE_KEY,LEGACY_STORAGE_KEYS})', context);
  const cards = catalog.cards.map(card => ({ ...card, setName: catalog.sets.find(set => set.game === card.game && set.id === card.setId).name }));
  const defaults = { game: 'all', art: 'all', query: '' };
  assert.equal(filterCards(cards, { ...defaults, query: 'MITSUHIRO charizard' })[0].id, 'pk-base1-4');
  assert.equal(filterCards(cards, { ...defaults, query: 'base2-17' }).length, 1);
  assert.ok(filterCards(cards, { ...defaults, game: 'pokemon' }).length >= 228);
  assert.ok(catalog.sets.filter(set => set.game === 'pokemon' && set.language === 'en').length >= 13);
  assert.ok(catalog.sets.filter(set => set.game === 'pokemon' && set.language === 'ja').length >= 13);
  assert.ok(filterCards(cards, { ...defaults, game: 'pokemon' }).filter(card => languageImages(card).some(v => v.language === 'ja')).length > 1000);
  assert.equal(filterCards(cards, { ...defaults, game: 'all', illustrator: 'Ken Sugimori' }).some(card => card.illustrator !== 'Ken Sugimori'), false);
  const filtered = filterCards(cards, { ...defaults, game: 'onepiece', sets: ['onepiece:OP01'], art: 'standard' });
  assert.ok(filtered.length > 0 && filtered.every(card => !card.isAlternative || !cards.some(other => other.game === card.game && other.code === card.code && !other.isAlternative)));
  assert.equal(catalog.sets.filter(set => set.game === 'onepiece').length, 13);
  for (const set of catalog.sets.filter(set => set.game === 'onepiece')) {
    for (const language of ['en','ja']) {
      const expected = set.expectedCodesByLanguage[language];
      assert.ok(expected.length >= 120, `Inventario regionale incompleto: ${set.id}/${language}`);
      const available = new Set(cards.filter(card => card.game === 'onepiece' && (card.setIds || [card.setId]).includes(set.id) && languageImages(card).some(image => image.language === language)).map(card => card.code));
      for (const code of expected) assert.ok(available.has(code), `Immagine regionale mancante: ${set.id}/${language}/${code}`);
    }
  }
  const alternativeOnly = [{id:'special',game:'onepiece',code:'ST99-001',setId:'OP13',isAlternative:true}];
  assert.equal(filterCards(alternativeOnly, {game:'onepiece',art:'standard'}).length, 1);
  const favorites = ['op-OP01-001AA'];
  assert.equal(filterCards(cards, { ...defaults, onlyFavorites: true }, favorites)[0].id, favorites[0]);
  for (const id of ['op-OP01-051AA2', 'op-ST01-012AA5', 'op-ST03-009AA', 'op-ST04-003AA6']) assert.ok(filterCards(cards, { ...defaults, sets: ['onepiece:OP03'] }).some(card => card.id === resolveAlias(id, catalog.aliases)));
  const dons = filterCards(cards, { ...defaults, game: 'onepiece', categories: ['DON!!'], traits: ['Blue'] });
  assert.equal(dons.length, 14);
  for (const language of ['en','ja']) {
    const designs = dons.map(card => languageImages(card).find(image => image.language === language));
    assert.ok(designs.every(Boolean), `Lingua DON!! mancante: ${language}`);
    assert.equal(new Set(designs.map(image => image.image)).size, 14, `Disegno DON!! duplicato: ${language}`);
  }
  assert.ok(dons.every(card => card.category === 'DON!!'));
  assert.ok(['en', 'ja'].every(language => languageImages(cards.find(card => card.id === 'op-OP03-007')).some(v => v.language === language)));
  assert.ok(['en', 'ja'].every(language => languageImages(cards.find(card => card.id === 'pk-base1-4')).some(v => v.language === language)));
  assert.equal(languageImages({ imageLanguage: 'ITA', image: '001_ITA.webp' })[0].language, 'it');
  assert.equal(languageImages({ imageLanguage: 'JAP', image: '001_JAP.webp' })[0].language, 'ja');
  const backup = validateCollection({ schemaVersion: 1, favorites: ['legacy', 'legacy'], notes: { legacy: 'Conservare' } });
  assert.equal(backup.favorites.length, 1);
  assert.ok(mergeCollections(emptyCollection(), backup).favorites.includes('legacy'));
  assert.throws(() => validateCollection({ schemaVersion: 1, favorites: [], notes: { x: 'x'.repeat(5001) } }));
  const saved = new Map([[LEGACY_STORAGE_KEYS[0], JSON.stringify(backup)]]);
  const storage = { getItem: key => saved.get(key) || null };
  const migrated = loadCollection(storage);
  assert.ok(migrated.needsMigration && migrated.collection.favorites.includes('legacy'));
  assert.equal(migrated.collection.notes.legacy, 'Conservare');
  saved.clear();
  saved.set(LEGACY_STORAGE_KEYS[1], JSON.stringify(backup));
  assert.ok(loadCollection(storage).collection.favorites.includes('legacy'));
  saved.set(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, favorites: ['current'], notes: {} }));
  const current = loadCollection(storage);
  assert.ok(!current.needsMigration && current.collection.favorites.includes('current'));
  const grouped = groupCardResults([{id:'a',game:'onepiece',code:'OP01-003',isAlternative:true},{id:'b',game:'onepiece',code:'OP01-003',isAlternative:false},{id:'c',game:'onepiece',code:'OP01-004',isAlternative:false}]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].id, 'b');
  assert.equal(resolveAlias('legacy', {legacy:'duplicate', duplicate:'canonical'}), 'canonical');
  console.log('Test funzionali superati: ricerca, set, filtri, artwork, lingue, backup e migrazione dei preferiti.');
}

if (process.argv.includes('--check')) await check();
else if (process.argv.includes('--test')) await test();
else {
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 5300);
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.includes('\0') || pathname.includes('\\')) throw new Error('Invalid path');
      const target = path.resolve(site, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!target.startsWith(site + path.sep) || !(await stat(target)).isFile()) throw new Error('Not found');
      const data = await readFile(target);
      response.writeHead(200, { 'Content-Type': mime[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Risorsa non trovata'); }
  });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`TCG Art Atlas: http://127.0.0.1:${port}\nCtrl+C per terminare.`));
}
