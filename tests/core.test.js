import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterCards, validateCollection, mergeCollections, emptyCollection, cardTraits, languageImages, orderedRarities } from '../src/core.js';

const { cards, sets } = JSON.parse(await readFile(new URL('../public/data/catalog.json', import.meta.url), 'utf8'));
const defaults = { game: 'all', set: 'all', art: 'all', sort: 'curated', query: '' };

test('le rarità seguono la progressione comune, non l’alfabeto', () => {
  assert.deepEqual(orderedRarities(['Rare', 'Common', 'Uncommon', 'Common'], 'pokemon'), ['Common', 'Uncommon', 'Rare']);
  assert.deepEqual(orderedRarities(['SEC', 'L', 'SR', 'R', 'UC', 'SP CARD', 'C', 'DON!!'], 'onepiece'), ['C', 'UC', 'R', 'SR', 'SEC', 'SP CARD', 'L', 'DON!!']);
});

test('la pagina illustratore cerca lo stesso nome in più giochi, senza includere omonimi parziali', () => {
  const fixtures = [
    { id: 'pk', game: 'pokemon', illustrator: 'Mitsuhiro Arita', isAlternative: false },
    { id: 'op', game: 'onepiece', illustrator: 'MITSUHIRO ARITA', isAlternative: true },
    { id: 'other', game: 'pokemon', illustrator: 'Mitsuhiro Arita Jr.' },
    { id: 'missing', game: 'onepiece' },
  ];
  assert.deepEqual(filterCards(fixtures, { game: 'all', illustrator: 'Mitsuhiro Arita' }).map(c => c.id), ['pk', 'op']);
  assert.deepEqual(filterCards(fixtures, { game: 'onepiece', illustrator: 'Mitsuhiro Arita' }).map(c => c.id), ['op']);
  assert.equal(filterCards(fixtures, { game: 'all', illustrator: 'Artista assente' }).length, 0);
});
test('sei set completi: ogni numero previsto è coperto, comprese le Special OP03', () => {
  assert.equal(sets.length, 6);
  for (const set of sets) {
    const members = cards.filter(c => c.game === set.game && (c.setIds || [c.setId]).includes(set.id));
    const codes = new Set(members.flatMap(c => c.codes));
    assert.equal(codes.size, set.expectedCodes, set.id);
    if (set.expectedCodeList) assert.deepEqual([...codes].sort(), set.expectedCodeList, set.id);
    assert.equal(members.length, set.artworkCount);
    assert.ok(set.complete);
  }
  assert.equal(cards.filter(c => c.game === 'pokemon').length, 197);
  assert.equal(new Set(cards.map(c => c.id)).size, cards.length);
  assert.equal(sets.find(s => s.id === 'OP03').expectedCodes, 127);
});
test('One Piece usa OPPP e TCGplayer per i DON, mantenendo gli artwork separati', () => {
  assert.ok(cards.filter(c => c.game === 'onepiece').every(c => c.category === 'DON!!' ? /https:\/\/(tcgplayer-cdn.tcgplayer.com|cards.oplaytcg.com)\//.test(c.sourceImageUrl) : c.sourceImageUrl.startsWith('https://oppp.online/')));
  assert.equal(cards.filter(c => c.category === 'DON!!').length, 4);
  assert.ok(cards.filter(c => c.game === 'onepiece' && c.category !== 'DON!!').every(c => c.finishes.length && c.finishScope === 'card-code'));
  const zoro = cards.filter(c => c.code === 'OP01-001');
  assert.ok(zoro.length > 1);
  assert.equal(new Set(zoro.map(c => c.imageSha256)).size, zoro.length);
  assert.equal(new Set(zoro.map(c => c.variantGroup)).size, 1);
});
test('Jungle e Fossil uniscono solo le coppie holo/non-holo, conservando numeri e finiture', () => {
  assert.equal(cards.filter(c => c.game === 'pokemon' && c.printings.length === 2).length, 31);
  const clefable = cards.find(c => c.id === 'pk-base2-1');
  assert.deepEqual(clefable.codes, ['base2-1', 'base2-17']);
  assert.ok(clefable.finishes.includes('holo') && clefable.finishes.includes('normal'));
  assert.equal(filterCards(cards, { ...defaults, query: 'base2-17' }).length, 1);
  assert.deepEqual(cards.find(c => c.id === 'pk-base3-1').codes, ['base3-1', 'base3-16']);
});
test('ricerca per artista e parole multiple, senza sensibilità ad accenti o maiuscole', () => {
  assert.equal(filterCards(cards, { ...defaults, query: 'MITSUHIRO charizard' })[0].id, 'pk-base1-4');
  assert.equal(filterCards(cards, { ...defaults, query: 'pokémon impossibile' }).length, 0);
  assert.ok(filterCards(cards, { ...defaults, query: 'zoró' }).some(c => c.code === 'OP01-001'));
});
test('i filtri si combinano e un preferito appartiene al singolo artwork', () => {
  const id = 'op-OP01-001AA';
  const selected = filterCards(cards, { ...defaults, game: 'onepiece', set: 'onepiece:OP01', art: 'alternative', onlyFavorites: true }, [id]);
  assert.deepEqual(selected.map(c => c.id), [id]);
  assert.equal(filterCards(cards, { ...defaults, game: 'pokemon', set: 'onepiece:OP01' }).length, 0);
});
test('le quattro Special sono raggiungibili dal filtro OP03, anche con codice di altri set', () => {
  const selected = filterCards(cards, { ...defaults, game: 'onepiece', set: 'onepiece:OP03' });
  for (const id of ['op-OP01-051AA2', 'op-ST01-012AA5', 'op-ST03-009AA', 'op-ST04-003AA6']) assert.ok(selected.some(c => c.id === id), id);
});
test('ordinamento cronologico senza mutare il catalogo', () => {
  const before = cards.map(c => c.id);
  const sorted = filterCards(cards, { ...defaults, sort: 'recent' });
  assert.ok(sorted.every((c, i) => i === 0 || sorted[i - 1].releaseDate >= c.releaseDate));
  assert.deepEqual(cards.map(c => c.id), before);
});
test('backup validato, deduplicato e limitato alle carte note', () => {
  const ids = cards.map(c => c.id);
  const a = ids[0], b = ids[1];
  const imported = validateCollection({ schemaVersion: 1, favorites: [a, a, 'unknown'], notes: { [a]: 'La luce è bellissima', unknown: 'x' } }, ids);
  assert.deepEqual(imported.favorites, [a]);
  assert.deepEqual(Object.keys(imported.notes), [a]);
  const merged = mergeCollections({ ...emptyCollection(), favorites: [a, b], notes: { [b]: 'Da conservare' } }, imported);
  assert.deepEqual(merged.favorites, [a, b]);
  assert.equal(merged.notes[b], 'Da conservare');
});
test('backup malformati rifiutati senza accettare dati corrotti', () => {
  for (const bad of [null, {}, { schemaVersion: 2, favorites: [], notes: {} }, { schemaVersion: 1, favorites: [12], notes: {} }, { schemaVersion: 1, favorites: [], notes: [] }, { schemaVersion: 1, favorites: [], notes: { x: 'x'.repeat(5001) } }]) {
    assert.throws(() => validateCollection(bad, cards.map(c => c.id)));
  }
});
test('il caricamento locale preserva preferiti di carte fuori dai sei set attuali', () => {
  const old = { schemaVersion: 1, favorites: ['pk-swsh7-215'], notes: { 'pk-swsh7-215': 'Da conservare' } };
  assert.deepEqual(validateCollection(old), old);
});

test('scelte multiple: OR nello stesso filtro, AND fra espansioni, rarità e tipi', () => {
  const fixtures = [
    { id: 'fire', game: 'pokemon', setId: 'a', rarity: 'Rare', types: ['Fire'] },
    { id: 'water', game: 'pokemon', setId: 'b', rarity: 'Common', types: ['Water'] },
    { id: 'grass', game: 'pokemon', setId: 'b', rarity: 'Rare', types: ['Grass'] },
    { id: 'other', game: 'pokemon', setId: 'c', rarity: 'Rare', types: ['Fire'] },
  ];
  const filters = { game: 'pokemon', sets: ['pokemon:a', 'pokemon:b'], rarities: ['Rare', 'Common'], traits: ['Fire', 'Water'] };
  assert.deepEqual(filterCards(fixtures, filters).map(c => c.id), ['fire', 'water']);
  assert.deepEqual(filterCards(fixtures, { ...filters, rarities: ['Rare'] }).map(c => c.id), ['fire']);
  assert.equal(filterCards(fixtures, { game: 'all', sets: [], rarities: [], traits: [] }).length, 4);
});

test('colori multipli One Piece e metadati per carte non Pokémon', () => {
  const zoro = cards.find(c => c.id === 'op-OP01-001');
  assert.deepEqual(cardTraits(zoro), ['Red']);
  assert.ok(cards.filter(c => c.game === 'onepiece' && c.category !== 'DON!!').every(c => c.colors.length));
  assert.deepEqual(cardTraits(cards.find(c => c.game === 'pokemon' && c.category === 'Trainer')), ['Trainer']);
  assert.deepEqual(cardTraits(cards.find(c => c.category === 'DON!!')), []);
  const dual = cards.find(c => c.game === 'onepiece' && c.colors.length > 1);
  assert.ok(dual);
  for (const color of dual.colors) assert.ok(filterCards(cards, { ...defaults, traits: [color] }).some(c => c.id === dual.id));
});

test('il selettore lingua usa solo immagini dello stesso artwork, senza inventare traduzioni', () => {
  const namule = cards.find(c => c.id === 'op-OP03-007');
  const versions = languageImages(namule);
  assert.deepEqual(versions.map(v => v.language), ['en', 'ja']);
  assert.notEqual(versions[0].image, versions[1].image);
  assert.deepEqual(languageImages(cards.find(c => c.id === 'pk-base1-4')).map(v => v.language), ['en']);
  assert.ok(cards.filter(c => c.imageVersions?.length === 2).length === 8);
  assert.deepEqual(languageImages({ imageLanguage: 'source', image: '/unknown.webp' }).map(v => v.language), ['und']);
});

test('il tipo DON ignora il colore selezionato, rispettando gli altri filtri', () => {
  const expected = cards.filter(c => c.game === 'onepiece' && c.category === 'DON!!').map(c => c.id);
  for (const traits of [[], ['Red'], ['Blue', 'Black']]) {
    assert.deepEqual(filterCards(cards, { ...defaults, game: 'onepiece', categories: ['DON!!'], traits }).map(c => c.id), expected);
  }
  assert.ok(filterCards(cards, { ...defaults, game: 'onepiece', traits: ['Red'] }).every(c => c.category !== 'DON!!'));
  const mixed = filterCards(cards, { ...defaults, game: 'onepiece', categories: ['DON!!', 'CHARACTER'], traits: ['Blue'] });
  assert.ok(mixed.every(c => c.category === 'DON!!' || (c.category === 'CHARACTER' && c.colors.includes('Blue'))));
  assert.equal(filterCards(cards, { ...defaults, categories: ['EVENT'] }).every(c => c.category === 'EVENT'), true);
});

test('le varianti One Piece hanno provenienze tracciate e distinguono i casi irrisolti', () => {
  const onepiece = cards.filter(c => c.game === 'onepiece');
  assert.ok(onepiece.every(c => c.artworkOrigin?.sourceUrl && c.variantLabel === c.artworkOrigin.label));
  assert.ok(onepiece.every(c => !/^(Alternativa|Alt\.)\s*\d/.test(c.variantLabel)));
  assert.deepEqual(onepiece.filter(c => c.artworkOrigin.status === 'unverified').map(c => c.id), ['op-OP01-001AA', 'op-OP01-001AA4', 'op-OP01-016AA9']);
  assert.match(cards.find(c => c.id === 'op-OP01-005AA').variantLabel, /Uta/);
  assert.match(cards.find(c => c.id === 'op-OP03-033AA2').variantLabel, /Winner Pack Vol\. 6/);
});
