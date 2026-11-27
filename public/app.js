const STORAGE_KEY = 'tcg-art-atlas.collection.v1';
const LEGACY_STORAGE_KEYS = ['tcg-art-collector.collection.v1', 'clist.collection.v1'];
const emptyCollection = () => ({ schemaVersion: 1, favorites: [], notes: {} });
const emptyLibrary = () => ({ schemaVersion: 2, lists: [{ id: 'preferiti', name: 'Preferiti', favorites: [], notes: {} }], defaultListId: null });
const normalize = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const traitNames = { Grass: 'Erba', Fire: 'Fuoco', Water: 'Acqua', Lightning: 'Elettro', Psychic: 'Psico', Fighting: 'Lotta', Darkness: 'Buio', Metal: 'Acciaio', Dragon: 'Drago', Fairy: 'Folletto', Colorless: 'Incolore', Trainer: 'Addestramento', Stadium: 'Stadio', Energy: 'Energia', Red: 'Rosso', Green: 'Verde', Blue: 'Blu', Purple: 'Viola', Black: 'Nero', Yellow: 'Giallo' };
const categoryNames = { LEADER: 'Leader', CHARACTER: 'Personaggio', EVENT: 'Evento', STAGE: 'Stage', 'DON!!': 'DON!!' };
const onepieceRarityNames = { C: 'Common', UC: 'Uncommon', R: 'Rare', SR: 'Super Rare', SEC: 'Secret Rare', 'SP CARD': 'Special Card', TR: 'Treasure Rare', L: 'Leader' };
const rarityOrders = {
  pokemon: ['Common', 'Uncommon', 'Rare', 'Holo Rare', 'Double Rare', 'Super Rare', 'Ultra Rare', 'Prism Rare', 'LEGEND', 'Shining Rare', 'Gold Star', 'Promo', 'Unknown'],
  onepiece: ['C', 'UC', 'R', 'SR', 'SEC', 'SP CARD', 'TR', 'L', 'DON!!'],
};
const pokemonRarityAliases = {'Common (C)':'Common','Uncommon (U)':'Uncommon','Rare (R)':'Rare','Double Rare (RR)':'Double Rare','Super Rare (SR)':'Super Rare','Ultra Rare (UR)':'Ultra Rare'};
const canonicalRarity = (value, game) => game === 'pokemon' ? pokemonRarityAliases[value] || value : value;
const cardRarities = card => [...new Set((card.rarities || [card.rarity]).map(value => canonicalRarity(value,card.game)))];
const traitColors = {Grass:'#8bd58b',Fire:'#ff9878',Water:'#82bfff',Lightning:'#ffe05a',Psychic:'#d9a1ec',Fighting:'#e8a17b',Darkness:'#b7a9d2',Metal:'#b9cbd5',Dragon:'#d8bd74',Fairy:'#f2accf',Colorless:'#e1e3e8',Trainer:'#b9c5de',Stadium:'#9ccdb2',Energy:'#e9d497',Unknown:'#a6adbf',Red:'#ff8585',Green:'#88d59c',Blue:'#82bfff',Purple:'#c6a2f4',Black:'#20232d',Yellow:'#ffe05a'};
function orderedTraits(values, game) {
  const last = game === 'pokemon' ? ['Trainer','Stadium','Energy','Unknown'] : ['Unknown'];
  const rank = value => last.includes(value) ? last.indexOf(value) + 1 : 0;
  return [...new Set(values.filter(value => value && value !== 'DON!!'))].sort((a,b) => rank(a)-rank(b) || (traitNames[a] || a).localeCompare(traitNames[b] || b,'it'));
}
function hasCatalogFilters(filters) {
  return !!(filters.query?.trim() || ['sets','categories','rarities','traits'].some(key=>filters[key]?.length) || (filters.art && filters.art !== 'standard'));
}
function hasExpansionFilters(filters) {
  return !!(filters.expansionQuery?.trim() || filters.expansionLanguage !== 'en' || filters.expansionCategory !== 'expansion');
}
const validListName = name => typeof name === 'string' && /^[\p{L}\p{N}_.,-]{1,15}$/u.test(name);

function orderedRarities(values, game) {
  const order = rarityOrders[game] || [];
  const rank = value => order.includes(value) ? order.indexOf(value) : order.length;
  return [...new Set(values.filter(value => typeof value === 'string' && value.trim()).map(value => canonicalRarity(value,game)))].sort((a, b) => rank(a) - rank(b));
}
function cardTraits(card) {
  return card.game === 'pokemon' ? card.types?.length ? card.types : [card.category === 'Trainer' ? 'Trainer' : card.category === 'Energy' ? 'Energy' : 'Unknown'] : card.category === 'DON!!' ? [] : card.colors?.length ? card.colors : ['Unknown'];
}
function languageImages(card) {
  const versions = card.imageVersions?.length ? card.imageVersions : [{ language: card.imageLanguage || 'und', image: card.image }];
  return versions.map(version => ({ ...version, language: ({ jp: 'ja', jap: 'ja', ita: 'it', eng: 'en', source: 'und' }[String(version.language).toLowerCase()] || String(version.language).toLowerCase()) }));
}
const matchesAny = (selected, values) => !selected || selected === 'all' || (Array.isArray(selected) ? !selected.length || selected.some(value => values.includes(value)) : values.includes(selected));

function pageNumber(value, pages, current = 1) {
  if (!/^\d+$/.test(String(value))) return current;
  const number = Number(value);
  return Number.isSafeInteger(number) ? Math.max(1, Math.min(number, Math.max(1, pages))) : current;
}
function listExportFilename(name) {
  return String(name).trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') + '_TCGArtAtlas.json';
}

function filterCards(cards, filters, favorites = []) {
  const query = normalize(filters.query || '').trim().split(/\s+/).filter(Boolean);
  const favoriteSet = favorites instanceof Set ? favorites : new Set(favorites);
  const standardCodes = new Set(cards.filter(card => !card.isAlternative && (card.game !== 'onepiece' || matchesAny(filters.sets ?? filters.set, (card.setIds || [card.setId]).map(set => `${card.game}:${set}`)))).map(card => `${card.game}:${card.code}`));
  const result = cards.filter(card =>
    (filters.game === 'all' || card.game === filters.game) &&
    (!filters.illustrator || illustratorKey(card.illustrator) === illustratorKey(filters.illustrator)) &&
    matchesAny(filters.categories, [card.category]) &&
    matchesAny(filters.sets ?? filters.set, (card.setIds || [card.setId]).map(set => `${card.game}:${set}`)) &&
    (!filters.art || filters.art === 'all' || card.isAlternative === (filters.art === 'alternative') || (filters.art === 'standard' && !standardCodes.has(`${card.game}:${card.code}`))) &&
    matchesAny((filters.rarities ?? filters.rarity)?.map?.(value=>canonicalRarity(value,card.game)) || canonicalRarity(filters.rarities ?? filters.rarity,card.game), cardRarities(card)) &&
    matchesAny(filters.traits, cardTraits(card)) &&
    (!filters.onlyFavorites || favoriteSet.has(card.id)) &&
    query.every(word => normalize([card.name, card.code, ...(card.codes || []), card.number, ...(card.numbers || []), card.illustrator].join(' ')).includes(word))
  );
  if (filters.sort === 'index' && filters.game === 'onepiece' && filters.sets?.length === 1) {
    const direction = filters.sets[0] === 'onepiece:P' ? -1 : 1;
    result.sort((a, b) => direction * a.code.localeCompare(b.code, 'en', {numeric:true}) ||
      (direction < 0 ? (b.releaseDate || '').localeCompare(a.releaseDate || '') : 0) || Number(a.isAlternative) - Number(b.isAlternative));
  }
  if (filters.sort === 'index-desc') result.sort((a, b) => {
    const number = card => String(card.game === 'onepiece' ? card.code : card.printedNumber || card.number || card.code);
    return number(b).localeCompare(number(a), 'en', {numeric:true}) || b.code.localeCompare(a.code, 'en', {numeric:true}) || Number(a.isAlternative) - Number(b.isAlternative);
  });
  if (filters.sort === 'name-desc') result.sort((a, b) => b.name.localeCompare(a.name, 'it') || a.id.localeCompare(b.id));
  if (filters.sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'it') || a.id.localeCompare(b.id));
  if (filters.sort === 'recent') result.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''));
  if (filters.sort === 'oldest') result.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''));
  // Keep resource cards after playable cards, regardless of the selected sort.
  result.sort((a, b) => Number(a.game === 'onepiece' && a.category === 'DON!!') - Number(b.game === 'onepiece' && b.category === 'DON!!'));
  return result;
}

// One grid entry per printed card code; artworks remain individually addressable.
function groupCardResults(cards) {
  const groups = new Map();
  for (const card of cards) {
    const key = `${card.game}:${card.code}`;
    const previous = groups.get(key);
    if (!previous || (previous.isAlternative && !card.isAlternative)) groups.set(key, card);
  }
  return [...groups.values()];
}
function visibleCardResults(cards, art = 'standard') {
  return art === 'standard' ? groupCardResults(cards) : cards;
}
function cardVariants(cards, card) {
  return cards.filter(other => other.game === card.game && other.code === card.code)
    .sort((a, b) => Number(a.isAlternative) - Number(b.isAlternative) || (a.releaseDate || '').localeCompare(b.releaseDate || '') || a.id.localeCompare(b.id));
}
// A scan can be reused by several products without hiding those product editions.
function cardProductImages(card, setId) {
  const images = languageImages(card);
  const product = card.productVersions?.find(version => version.setId === setId);
  return product ? images.filter(image => product.languages.includes(image.language)) : images;
}
function cardPopupVersions(cards, card, sets) {
  return cardVariants(cards, card).flatMap(other => {
    const products = other.game === 'onepiece' && other.category !== 'DON!!' ? other.productVersions || [{ setId: other.setId }] : [{ setId: other.setId }];
    return products.map(product => {
      const set = sets.find(set => set.game === other.game && set.id === product.setId);
      const images = cardProductImages(other, product.setId);
      const image = images.find(image => image.language === other.imageLanguage) || images[0];
      const label = other.game === 'onepiece' && (product.setId !== other.setId || !other.variantLabel || other.variantLabel === 'Standard') && set ? setPreviewTitle(set) : other.variantLabel;
      return { ...other, setId: product.setId, versionKey: `${other.id}:${product.setId}`, variantLabel: label, imageVersions: images, image: image.image };
    });
  });
}
function selectPopupVersion(versions, cardId, setId) {
  return versions.find(version => version.id === cardId && version.setId === setId) || versions.find(version => version.id === cardId);
}
function cardDisplaySet(card, selectedSets, sets) {
  const memberships = card.setIds || [card.setId];
  const selected = (Array.isArray(selectedSets) ? selectedSets : selectedSets && selectedSets !== 'all' ? [selectedSets] : [])
    .find(key => key.startsWith(`${card.game}:`) && memberships.includes(key.slice(card.game.length + 1)) && !sets.find(set => `${set.game}:${set.id}` === key)?.collection);
  const id = selected ? selected.slice(card.game.length + 1) : card.setId;
  return sets.find(set => set.game === card.game && set.id === id);
}
function resolveAlias(id, aliases = {}) {
  const seen = new Set();
  while (aliases[id] && !seen.has(id)) { seen.add(id); id = aliases[id]; }
  return id;
}
function indexFavorites(cards, favorites, aliases = {}) {
  const ids = new Set(favorites.map(id => resolveAlias(id, aliases)));
  return { ids, known: ids.size ? cards.filter(card => ids.has(card.id)) : [] };
}
function setDisplayLabels(sets) {
  const counts = new Map();
  for (const set of sets) {
    const key = `${set.game}:${normalize(set.name)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return new Map(sets.map(set => {
    const region = set.region || ({ en: 'Internazionale', ja: 'Giappone', jp: 'Giappone', it: 'Italia' }[set.language] || '');
    const duplicate = counts.get(`${set.game}:${normalize(set.name)}`) > 1;
    return [`${set.game}:${set.id}`, duplicate && region ? `${set.name} · ${region}` : set.name];
  }));
}
function formatSetName(name, game) {
  if (game === 'onepiece') {
    const collections = { 'carte da prodotti speciali': 'Carte da prodotti speciali', 'carte da eventi e campagne': 'Carte da eventi e campagne', 'carte promozionali giapponesi': 'Carte Promo Giapponesi', 'carte promo giapponesi': 'Carte Promo Giapponesi', 'prodotti speciali giapponesi': 'Prodotti speciali Giapponesi' };
    const collection = collections[String(name).trim().toLocaleLowerCase('it')];
    if (collection) return collection;
  }
  const acronyms = new Set(['EX','GX','XY','HGSS','HS','BW','DP','SM','SV','VMAX','VSTAR','V','ME','TCG','OP','EB','ST','PRB','VS','ADV','PCG','JP','CMT','ADP','FTW','SWSH','SP','SVG','POP','GO','3D2Y']);
  let title = String(name).replaceAll('Pok�', 'Poké').replace(/pre[-‐‑‒–— ]release/gi, 'Prerelease');
  if (game === 'onepiece') title = title.replace(/^(?:(?:red|green|blue|purple|black|yellow)(?:\/(?:red|green|blue|purple|black|yellow))*)(?=\s)/i, color => color.toUpperCase());
  return title.split(/([\s\-(/:.]+)/).map(part => {
    if (!/\p{L}/u.test(part)) return part;
    if (/^\d+(?:st|nd|rd|th)$/i.test(part)) return part.toLowerCase();
    if (/^(RED|GREEN|BLUE|PURPLE|BLACK|YELLOW)$/.test(part) || acronyms.has(part)) return part;
    if (/[a-zà-ÿ]/.test(part) && /[A-ZÀ-Þ]/.test(part)) return part[0].toUpperCase() + part.slice(1);
    return part.toLocaleLowerCase('en').replace(/\p{L}/u, letter => letter.toLocaleUpperCase('en'));
  }).join('');
}
function prereleaseSetCode(set) {
  return set.game === 'onepiece' ? /^(OP\d{2}|ST\d{2}|EB\d{2}|PRB\d{2})_(?:PRE|RELEASE)$/.exec(set.id)?.[1] : undefined;
}
function setPreviewTitle(set) {
  const prerelease = prereleaseSetCode(set);
  if (prerelease) return `[${prerelease}] ${set.name.replace(/\s*\([^)]*\)\s*$/, '')} (Prerelease)`;
  if (set.game !== 'onepiece') return set.name;
  let name = set.name.replace(/^(?:Extra|Premium)\s+Booster\b\s*[:–-]?\s*/i, '');
  if (/^ST\d{2}(?:_PRE)?$/.test(set.id)) name = name.replace(/^(?:(?:red|green|blue|purple|black|yellow)(?:\/(?:red|green|blue|purple|black|yellow))*)\s+/i, '');
  name = name.replace(/(^|\s)-+|-+(?=\s|$)/g, '$1').trim();
  return /^(?:(?:OP|EB|PRB|ST|LD|SD)\d{2}(?:_PRE)?|P)$/.test(set.id) ? `[${set.id.replace('_PRE', ' PRE')}] ${name}` : name;
}
function setFullLabel(set) {
  if (prereleaseSetCode(set)) return setPreviewTitle(set);
  return set.game === 'onepiece' && /^(?:(?:OP|EB|PRB|ST|LD|SD)\d{2}(?:_PRE)?|P)$/.test(set.id) ? `[${set.id.replace('_PRE', ' PRE')}] ${set.name}` : set.name;
}
function setFilterLabel(set, labels = new Map()) {
  return set.game === 'onepiece' ? setPreviewTitle(set) : labels.get(`${set.game}:${set.id}`) || set.name;
}
function releaseDateRows(set) {
  if (!set.releaseDates) return [{ region: '', date: set.releaseDate || '' }];
  const rows = [['ja','JAP'],['en','INT']].filter(([key]) => Object.prototype.hasOwnProperty.call(set.releaseDates, key))
    .map(([key, region]) => ({ region, date: set.releaseDates[key] || '' }));
  if (rows.length === 2 && rows[0].date && rows[0].date === rows[1].date) return [{ region: '', date: rows[0].date }];
  return rows.length ? rows : [{ region: '', date: '' }];
}
function popupReleaseDateRows(set) {
  return releaseDateRows(set);
}
function factValue(value) {
  const text = String(value ?? '').trim();
  return !text || /^(unknown|undefined|null)$/i.test(text) ? 'N.D.' : text;
}
function compareExpansionDates(a, b) {
  return (b.releaseDate || '').localeCompare(a.releaseDate || '') ||
    (a.game === 'onepiece' && b.game === 'onepiece' ? b.id.localeCompare(a.id, 'en', {numeric:true}) : a.name.localeCompare(b.name));
}
const expansionCategoryNames = {
  expansion: 'Espansioni normali', special: 'Espansioni speciali', deck: 'Mazzi',
  'world-deck': 'Mazzi World Championships', 'trainer-kit': 'Trainer Kit',
  box: 'Collezioni e Box', promo: 'Carte promozionali e premi', collaboration: 'Collaborazioni', energy: 'Energie', other: 'Altro',
};
function expansionCategoryMap(sets) {
  const counts = new Map();
  for (const set of sets) counts.set(set.category || 'other', (counts.get(set.category || 'other') || 0) + 1);
  return new Map(sets.map(set => [`${set.game}:${set.id}`, (counts.get(set.category || 'other') || 0) > 2 ? set.category || 'other' : 'other']));
}
// A directory shortcut selects the real products; inventories remain separate.
function expansionTiles(sets) {
  const packs = sets.filter(set => set.game === 'onepiece' && /^DP\d+$/.test(set.id));
  if (!packs.length) return sets;
  const lead = packs[0];
  return [...sets.filter(set => !packs.includes(set)), { ...lead, id: 'DOUBLE_PACKS', name: 'Double Pack Set', setIds: packs.map(set => set.id) }];
}
function catalogSetSelections(game, setId, sets, aliases = {}) {
  if (game === 'onepiece' && setId === 'DOUBLE_PACKS') return sets.filter(set => set.game === game && /^DP\d+$/.test(set.id)).map(set => `${game}:${set.id}`);
  const key = resolveAlias(`${game}:${setId}`, aliases);
  return sets.some(set => `${set.game}:${set.id}` === key) ? [key] : [];
}
function filterExpansionSets(sets, filters, categories = expansionCategoryMap(sets.filter(set => set.game === filters.game))) {
  const words = normalize(filters.query || '').trim().split(/\s+/).filter(Boolean);
  return sets.filter(set => set.game === filters.game && words.every(word => normalize(`${set.name} ${set.id}`).includes(word)) &&
    (!filters.language || filters.language === 'all' || (set.languages || [set.language]).includes(filters.language)) &&
    (!filters.category || filters.category === 'all' || categories.get(`${set.game}:${set.id}`) === filters.category));
}
const illustratorKey = name => normalize(name || '').trim().replace(/\s+/g, ' ');
function indexIllustrators(cards) {
  const artists = new Map();
  for (const card of cards) {
    const name = String(card.illustrator || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    const key = illustratorKey(name);
    if (!artists.has(key)) artists.set(key, { name, games: new Map() });
    const artist = artists.get(key);
    if (!artist.games.has(card.game)) artist.games.set(card.game, new Set());
    artist.games.get(card.game).add(card.code);
  }
  return [...artists.values()].map(artist => ({ name: artist.name, games: Object.fromEntries([...artist.games].map(([game, codes]) => [game, codes.size])) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }));
}
function filterIllustrators(artists, query, game = 'all') {
  const words = illustratorKey(query).split(/\s+/).filter(Boolean);
  return artists.filter(artist => (game === 'all' || artist.games[game] > 0) && words.every(word => illustratorKey(artist.name).includes(word)));
}
function groupExpansionSets(sets) {
  const groups = new Map();
  for (const set of [...sets].sort((a, b) => (a.groupOrder ?? 999) - (b.groupOrder ?? 999) || compareExpansionDates(a, b))) {
    const name = set.group || set.seriesName || 'Altre espansioni';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(set);
  }
  return [...groups].map(([name, items]) => ({ name, sets: items.sort(compareExpansionDates) }))
    .sort((a, b) => Math.min(...a.sets.map(set => set.groupOrder ?? 999)) - Math.min(...b.sets.map(set => set.groupOrder ?? 999)));
}

function portableList(list, cards, aliases = {}) {
  const byId = new Map(cards.map(card=>[card.id,card]));
  const ids = [...new Set(list.favorites.map(id=>resolveAlias(id,aliases)))];
  return {name:list.name,cards:ids.map(id=>({code:byId.get(id)?.code || null,variant:id}))};
}
function portableContent(value, cards, aliases = {}) {
  if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.length>80 || !Array.isArray(value.cards) || value.cards.length>50000) throw new Error('JSON della lista non valido.');
  const byId = new Map(cards.map(card=>[card.id,card]));
  const favorites = value.cards.map(entry=>{
    if (!entry || typeof entry !== 'object' || (entry.code!==null && (typeof entry.code!=='string' || !entry.code || entry.code.length>200))) throw new Error('Codice carta non valido.');
    if (entry.variant !== undefined) {
      if (typeof entry.variant !== 'string' || !entry.variant || entry.variant.length>200) throw new Error('Variante non valida.');
      const id=resolveAlias(entry.variant,aliases),card=byId.get(id);
      if (card && entry.code!==null && ![card.code,...(card.codes || [])].includes(entry.code)) throw new Error('Codice e variante non corrispondono.');
      return id;
    }
    const matches=cards.filter(card=>[card.code,...(card.codes || [])].includes(entry.code));
    if (!matches.length || new Set(matches.map(card=>card.game)).size>1) throw new Error('Codice mancante o ambiguo: '+entry.code);
    return (matches.find(card=>!card.isAlternative) || matches[0]).id;
  });
  return {schemaVersion:1,favorites:[...new Set(favorites)],notes:{}};
}

function validateCollection(value, knownIds) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.favorites) || value.favorites.some(x => typeof x !== 'string') || !value.notes || typeof value.notes !== 'object' || Array.isArray(value.notes)) {
    throw new Error('Questo file non è un backup TCG Art Atlas valido.');
  }
  const ids = knownIds ? new Set(knownIds) : null;
  const notes = {};
  for (const [id, note] of Object.entries(value.notes)) {
    if (typeof note !== 'string' || note.length > 5000) throw new Error('Il backup contiene note non valide (massimo 5.000 caratteri).');
    if (!ids || ids.has(id)) notes[id] = note;
  }
  return { schemaVersion: 1, favorites: [...new Set(value.favorites)].filter(id => !ids || ids.has(id)), notes };
}

function mergeCollections(current, incoming) {
  return { schemaVersion: 1, favorites: [...new Set([...current.favorites, ...incoming.favorites])], notes: { ...current.notes, ...incoming.notes } };
}
function validateLibrary(value) {
  if (value?.schemaVersion === 1) {
    const content = validateCollection(value);
    const library = emptyLibrary();
    Object.assign(library.lists[0], { favorites: content.favorites, notes: content.notes });
    return library;
  }
  if (value?.schemaVersion !== 2 || !Array.isArray(value.lists) || !value.lists.length) throw new Error('Liste preferiti non valide.');
  const ids = new Set();
  const lists = value.lists.map(list => {
    if (!list || typeof list.id !== 'string' || !list.id || ids.has(list.id) || typeof list.name !== 'string' || !list.name.trim() || list.name.trim().length > 80) throw new Error('Lista preferiti non valida.');
    ids.add(list.id);
    const content = validateCollection({ schemaVersion: 1, favorites: list.favorites, notes: list.notes });
    return { id: list.id, name: list.name.trim(), favorites: content.favorites, notes: content.notes };
  });
  return { schemaVersion: 2, lists, defaultListId: ids.has(value.defaultListId) ? value.defaultListId : null };
}
function listContent(list) {
  return validateCollection({ schemaVersion: 1, favorites: list.favorites, notes: list.notes });
}
function importListContent(library, listId, value, cards = [], aliases = {}) {
  const incoming = Array.isArray(value?.cards) ? portableContent(value,cards,aliases) : validateCollection(value);
  if (!library.lists.some(list => list.id === listId)) throw new Error('La lista scelta non è più disponibile.');
  return { ...library, lists: library.lists.map(list => {
    if (list.id !== listId) return list;
    const merged = mergeCollections(list, incoming);
    return { ...list, favorites: merged.favorites, notes: merged.notes };
  }) };
}
function assignFavoriteLists(library, cardId, listIds, aliases = {}) {
  const selected = new Set(listIds);
  const id = resolveAlias(cardId, aliases);
  return { ...library, lists: library.lists.map(list => {
    const exists = list.favorites.some(value => resolveAlias(value, aliases) === id);
    const favorites = selected.has(list.id) ? exists ? list.favorites : [...list.favorites, id] : list.favorites.filter(value => resolveAlias(value, aliases) !== id);
    return { ...list, favorites };
  }) };
}
function loadCollection(storage) {
  const current = storage.getItem(STORAGE_KEY);
  const legacy = current ? null : LEGACY_STORAGE_KEYS.map(key => storage.getItem(key)).find(Boolean);
  const value = current || legacy ? JSON.parse(current || legacy) : null;
  return { collection: value ? validateLibrary(value) : emptyLibrary(), needsMigration: !!value && (!current || value.schemaVersion === 1) };
}


function startApp(catalogData, assetBase) {
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shapes = {
  cards: '<rect x="3" y="5" width="14" height="16" rx="2"/><path d="M7 2h12a2 2 0 0 1 2 2v13M6 15h8M6 18h5"/><circle cx="10" cy="10" r="2.5"/>',
  layers: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  artists: '<path d="m15 4 5 5M4 20l4-1 12-12-4-4L4 15v5Z"/><path d="M3 22h18"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5m13-5v5h-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.cards}</svg>`;
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

const state = { game: 'pokemon', view: 'expansions', illustrator: '', artistGame: 'all', artistQuery: '', artistFilter: 'pokemon', expansionQuery: '', expansionLanguage: 'en', expansionCategory: 'expansion', query: '', sets: [], categories: [], art: 'standard', rarities: [], traits: [], sort: 'index', page: 1, pageSize: 200, size: 'medium' };
let catalog;
let collection = emptyLibrary();
let activeListId = collection.lists[0].id;
let pendingFavoriteId;
let pendingListAction;
let favoriteIndex = { ids: new Set(), known: [] };
let setLabels = new Map();
let illustratorIndex = [];
let expansionCategories = new Map();
const collapsedExpansionGroups = new Set();
let results = [];
const reviewDrafts = new Map();
let reviewFileHandle;
let currentCardId;
let currentCardSetId;
let filteredCardIds = [];
let filteredCardIndex = 0;
let toastTimer;
let storageAvailable = true;
const imageLanguages = new Map();
const backTop = $('#back-to-top');
let backTopPosition = .5;
let backTopHold;
let backTopDragging = false;
let backTopSuppressClick = false;
let backTopOffset = 0;
let backTopPointer;
let backTopStartX = 0;
function positionBackTop(clientX) {
  const box = $('.catalog').getBoundingClientRect();
  const half = backTop.offsetWidth / 2;
  const left = Math.max(half + 10, box.left + half + 10);
  const right = Math.min(innerWidth - half - 10, box.right - half - 10);
  const x = Math.max(left, Math.min(right, clientX ?? left + (right - left) * backTopPosition));
  if (right > left) backTopPosition = (x - left) / (right - left);
  backTop.style.left = `${x}px`;
}
backTop.addEventListener('pointerdown', event => {
  if (!event.isPrimary || event.button !== 0) return;
  backTopSuppressClick = false;
  backTopPointer = event.pointerId;
  backTopStartX = event.clientX;
  backTopOffset = event.clientX - (backTop.getBoundingClientRect().left + backTop.offsetWidth / 2);
  backTop.setPointerCapture(event.pointerId);
  backTopHold = setTimeout(() => {
    backTopDragging = true;
    backTopSuppressClick = true;
    backTop.classList.add('dragging');
  }, 260);
});
backTop.addEventListener('pointermove', event => {
  if (backTopPointer !== event.pointerId) return;
  if (!backTopDragging && Math.abs(event.clientX - backTopStartX) > 6) {
    clearTimeout(backTopHold);
    backTopDragging = true;
    backTopSuppressClick = true;
    backTop.classList.add('dragging');
  }
  if (backTopDragging) positionBackTop(event.clientX - backTopOffset);
});
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) backTop.addEventListener(type, () => {
  clearTimeout(backTopHold);
  backTopDragging = false;
  backTopPointer = undefined;
  backTop.classList.remove('dragging');
});
window.addEventListener('resize', () => { if (!backTop.hidden) positionBackTop(); });
const languageName = code => ({ en: 'Inglese', ja: 'Giapponese', it: 'Italiano', und: 'N.D.' }[code] || code.toUpperCase());
const gameName = value => value === 'pokemon' ? 'Pokémon' : 'One Piece';
const finishName = value => ({ normal: 'Non holo', holo: 'Holo', reverse: 'Reverse holo' }[value] || value);
const favoriteIds = () => favoriteIndex.ids;
const knownFavorites = () => favoriteIndex.known;
const numbersLabel = card => card.game === 'pokemon' ? Object.hasOwn(card, 'printedNumber') ? card.printedNumber ? '#' + card.printedNumber : 'Senza numero' : '#' + (card.numbers || [card.number]).join(' / ') : card.code;
const dateLabel = date => new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
const shortDateLabel = (date, year = 'numeric') => new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', year, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));

function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 4500);
}
function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(collection)); storageAvailable = true; }
  catch { storageAvailable = false; toast('Salvataggio non disponibile. Esporta un backup prima di chiudere.'); }
}
function populateFilters() {
  const sets = groupExpansionSets(catalog.sets.filter(set => set.game === state.game)).flatMap(group => group.sets);
  const cards = catalog.cards.filter(card => card.game === state.game);
  const rarities = orderedRarities(cards.flatMap(cardRarities), state.game);
  const traits = orderedTraits(cards.flatMap(cardTraits),state.game);
  const checkbox = (key, value, label) => `<label class="check-option"${key === 'traits' && value !== 'all' ? ` data-trait="${esc(value)}" style="--trait-color:${traitColors[value] || traitColors.Unknown}"` : ''}><input type="checkbox" data-filter="${key}" value="${esc(value)}"/><span>${esc(label)}</span></label>`;
  for (const [id, key, options] of [
    ['set-filter', 'sets', sets.map(set => [`${set.game}:${set.id}`, setFilterLabel(set, setLabels)])],
    ['category-filter', 'categories', Object.entries(categoryNames).filter(([value]) => cards.some(card => card.category === value))],
    ['rarity-filter', 'rarities', rarities.map(value => [value, state.game === 'onepiece' && onepieceRarityNames[value] ? `${onepieceRarityNames[value]} (${value})` : value])],
    ['type-filter', 'traits', traits.map(value => [value, traitNames[value] || 'Non indicato'])],
  ]) {
    $('.filter-options', document.getElementById(id)).innerHTML = checkbox(key, 'all', 'Tutti') + options.map(([value, label]) => checkbox(key, value, label)).join('');
  }
  $('#type-filter-label').textContent = state.game === 'pokemon' ? 'Tipo' : 'Colore';
  $('#category-filter').hidden = state.game !== 'onepiece';
  $('#type-filter .filter-options').setAttribute('aria-label', state.game === 'pokemon' ? 'Tipi Pokémon' : 'Colori One Piece');
  syncFilters();
  $('#art-filter').value = state.art;
  $('#sort').value = state.sort;
  $('#search').value = state.query;
}
function syncFilters() {
  for (const [id, key] of [['set-filter', 'sets'], ['category-filter', 'categories'], ['rarity-filter', 'rarities'], ['type-filter', 'traits']]) {
    const root = document.getElementById(id);
    $$('input', root).forEach(input => { input.checked = input.value === 'all' ? !state[key].length : state[key].includes(input.value); });
    const count = state[key].length;
    const masculine = key === 'traits' || key === 'categories';
    const suffix = masculine ? count === 1 ? 'o' : 'i' : count === 1 ? 'a' : 'e';
    $('.filter-value', root).textContent = count ? `${count} selezionat${suffix}` : masculine ? 'Tutti' : 'Tutte';
    root.classList.toggle('has-selection', count > 0);
  }
}
const mobileFilterMedia = window.matchMedia('(max-width: 700px)');
let mobileFiltersOpen = false;
function currentFilterPanel() {
  if (state.view === 'expansions') return state.game === 'pokemon' ? $('#expansion-filters') : null;
  return state.view === 'catalog' ? $('#filters') : null;
}
function syncMobileFilters() {
  const headerBottom = Math.max(0, $('.app-header').getBoundingClientRect().bottom);
  document.documentElement.style.setProperty('--filter-header-height', `${headerBottom}px`);
  const panel = currentFilterPanel();
  const available = mobileFilterMedia.matches && !!panel;
  if (!available) mobileFiltersOpen = false;
  const open = available && mobileFiltersOpen;
  const toggle = $('#mobile-filter-toggle');
  toggle.hidden = !available;
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Chiudi filtri' : 'Apri filtri');
  if (panel) toggle.setAttribute('aria-controls', panel.id);
  $('#mobile-filter-backdrop').hidden = !open;
  document.documentElement.classList.toggle('mobile-filters-open', open);
  for (const candidate of [$('#filters'), $('#expansion-filters')]) {
    candidate.classList.toggle('mobile-drawer-open', open && candidate === panel);
    candidate.inert = mobileFilterMedia.matches && (!open || candidate !== panel);
    if (mobileFilterMedia.matches && (!open || candidate !== panel)) candidate.setAttribute('aria-hidden', 'true');
    else candidate.removeAttribute('aria-hidden');
  }
}
function setMobileFiltersOpen(open) {
  mobileFiltersOpen = open;
  if (!open) closeFilterPanels();
  syncMobileFilters();
}
function toggleMobileFilters(focusSearch = false) {
  if (!currentFilterPanel()) return;
  // Stop momentum before locking the page, then open on the initial touch.
  if (!mobileFiltersOpen) window.scrollTo({top:window.scrollY,behavior:'instant'});
  setMobileFiltersOpen(!mobileFiltersOpen);
  if (mobileFiltersOpen && focusSearch) $('input[type="search"]', currentFilterPanel()).focus({preventScroll:true});
}
let mobileTogglePointerHandled = false;
$('#mobile-filter-toggle').addEventListener('pointerdown', event => {
  mobileTogglePointerHandled = event.isPrimary && event.button === 0 && event.pointerType !== 'mouse';
  if (!mobileTogglePointerHandled) return;
  event.preventDefault();
  toggleMobileFilters();
});
$('#mobile-filter-toggle').addEventListener('click', event => {
  if (mobileTogglePointerHandled && event.detail) { mobileTogglePointerHandled = false; return; }
  toggleMobileFilters(event.detail === 0);
});
$('#mobile-filter-backdrop').addEventListener('click', () => setMobileFiltersOpen(false));
mobileFilterMedia.addEventListener('change', () => setMobileFiltersOpen(false));
function closeFilterPanels(except) {
  $$('.multi-filter[open]').forEach(panel => { if (panel !== except) panel.open = false; });
}
function positionFilterPanel(filter) {
  const anchor = $('.filter-value', filter).getBoundingClientRect();
  const panel = $('.filter-options', filter);
  const mobile = mobileFilterMedia.matches;
  const filterBox = filter.getBoundingClientRect();
  const headerBottom = Math.max(0, $('.app-header').getBoundingClientRect().bottom);
  const below = window.innerHeight - anchor.bottom - 12;
  const above = anchor.top - headerBottom - 12;
  const upward = below < 170 && above > below;
  const maxHeight = Math.max(40, Math.min(260, upward ? above : below));
  Object.assign(panel.style, {
    position: mobile ? 'absolute' : 'fixed', width: `${anchor.width}px`, maxWidth: `${anchor.width}px`,
    left: mobile ? '0px' : `${anchor.left}px`, maxHeight: `${maxHeight}px`, top: 'auto', bottom: 'auto',
  });
  if (upward) panel.style.bottom = `${mobile ? filterBox.bottom - anchor.top + 5 : window.innerHeight - anchor.top + 5}px`;
  else panel.style.top = `${mobile ? anchor.bottom - filterBox.top + 5 : anchor.bottom + 5}px`;
}
$$('.multi-filter').forEach(filter => filter.addEventListener('toggle', () => {
  if (!filter.open) return;
  closeFilterPanels(filter);
  positionFilterPanel(filter);
}));
document.addEventListener('click', event => {
  if (!event.target.closest('.multi-filter')) closeFilterPanels();
  if (!event.target.closest('.game-picker')) $('#game-picker').open = false;
});
window.addEventListener('resize', () => { closeFilterPanels(); syncMobileFilters(); });
window.addEventListener('scroll', event => {
  if (!(event.target instanceof Element) || !event.target.closest('.filter-options')) closeFilterPanels();
}, true);
function syncBackToTop() {
  const expansions = state.view === 'expansions';
  backTop.hidden = state.view === 'illustrators' || window.scrollY < 240 || (expansions ? !$('#expansions-empty').hidden : !results.length || $('.catalog-toolbar').getBoundingClientRect().bottom > 0);
  if (!backTop.hidden) positionBackTop();
}
window.addEventListener('scroll', syncBackToTop, { passive: true });
let productImageObserver;
function expansionArtwork(set) {
  if (!set.image) return `<span class="expansion-wordmark">${esc(set.name)}</span>`;
  if (set.imageFit) return `<svg class="expansion-product" viewBox="${set.imageFit.viewBox.join(' ')}" role="img" aria-label="${esc(set.name)}" focusable="false"><image data-src="${esc(set.image)}" width="${set.imageFit.width}" height="${set.imageFit.height}"/></svg>`;
  return `<img src="${esc(set.image)}" alt="${esc(set.name)}" width="720" height="400" loading="lazy"/>`;
}
function loadProductImages() {
  productImageObserver?.disconnect();
  const products = $$('.expansion-product', $('#expansions-grid'));
  const load = product => { const image = $('image', product); image.setAttribute('href', image.dataset.src); image.removeAttribute('data-src'); };
  if (!('IntersectionObserver' in window)) return products.forEach(load);
  productImageObserver = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) { load(entry.target); productImageObserver.unobserve(entry.target); }
  }, { rootMargin: '300px' });
  products.forEach(product => productImageObserver.observe(product));
}
function renderIllustrators() {
  const artists = filterIllustrators(illustratorIndex, state.artistQuery, state.artistFilter);
  if ($('#illustrator-search').value !== state.artistQuery) $('#illustrator-search').value = state.artistQuery;
  $$('[data-illustrator-game]').forEach(button => { const active = button.dataset.illustratorGame === state.artistFilter; button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active)); });
  $('#illustrators-count').textContent = `${artists.length} ${artists.length === 1 ? 'illustratore' : 'illustratori'}`;
  $('#illustrators-grid').innerHTML = artists.map(artist => `<button class="illustrator-tile" data-illustrator="${esc(artist.name)}"><span class="illustrator-name">${esc(artist.name)}</span><span class="illustrator-pills">${['pokemon','onepiece'].filter(game => artist.games[game]).map(game => `<span class="illustrator-pill"><strong>${artist.games[game]}</strong> ${gameName(game)}</span>`).join('')}</span></button>`).join('');
  $('#illustrators-empty').hidden = !!artists.length;
}
function expansionDatesMarkup(set) {
  return releaseDateRows(set).map(row => `<span class="regional-date">${row.region ? `<span class="region-code">${esc(row.region)}:</span>` : ''}${row.date ? `<time datetime="${esc(row.date)}" title="${esc(dateLabel(row.date))}">${shortDateLabel(row.date, '2-digit')}</time>` : '<span>N.D.</span>'}</span>`).join('');
}
function renderExpansions() {
  const pokemon = state.game === 'pokemon';
  const sets = filterExpansionSets(catalog.sets, { game: state.game, query: pokemon ? state.expansionQuery : '', language: pokemon ? state.expansionLanguage : 'all', category: pokemon ? state.expansionCategory : 'all' }, expansionCategories)
    .sort((a, b) => (a.groupOrder ?? 999) - (b.groupOrder ?? 999) || compareExpansionDates(a, b));
  $('#expansions-page').dataset.game = state.game;
  $('#expansions-title').textContent = `Espansioni ${gameName(state.game)}`;
  $('#expansion-filters').hidden = !pokemon;
  if ($('#expansion-search').value !== state.expansionQuery) $('#expansion-search').value = state.expansionQuery;
  $$('[data-expansion-language]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.expansionLanguage === state.expansionLanguage)));
  $('#expansion-category').value = state.expansionCategory;
  $('#reset-expansion-filters').disabled = !hasExpansionFilters(state);
  $('#expansions-empty').hidden = !!sets.length;
  $('#expansions-grid').innerHTML = groupExpansionSets(expansionTiles(sets)).map((group, index) => {
    const key = `${state.game}:${group.name}`;
    const collapsed = collapsedExpansionGroups.has(key);
    const gridId = `set-group-grid-${index}`;
    const toggle = `<button class="expansion-group-toggle" data-expansion-group="${esc(key)}" aria-expanded="${!collapsed}" aria-controls="${gridId}" aria-label="${collapsed ? 'Espandi' : 'Comprimi'} ${esc(group.name)}">${icon('up')}</button>`;
    return `<section class="expansion-group" aria-labelledby="set-group-${index}"><h3 id="set-group-${index}" class="expansion-group-title">${toggle}<span class="expansion-group-name">${esc(group.name)}</span></h3><div id="${gridId}" class="expansions-grid" ${collapsed ? 'hidden' : ''}>${group.sets.map(set => `<a class="expansion-tile" data-set-game="${set.game}" href="#catalogo/${set.game}/${encodeURIComponent(set.id)}" title="${esc(setPreviewTitle(set))}"><div class="expansion-art">${expansionArtwork(set)}</div><div class="expansion-caption"><div class="expansion-name">${set.symbol ? `<img class="set-symbol" src="${esc(set.symbol)}" alt="" width="22" height="22" loading="lazy"/>` : ''}<h4>${esc(setPreviewTitle(set))}</h4></div><div class="expansion-meta">${expansionDatesMarkup(set)}</div></div></a>`).join('')}</div></section>`;
  }).join('');
  loadProductImages();
  syncBackToTop();
}
function navigate(view, game = state.game, setId) {
  const route = `${view === 'expansions' ? 'espansioni' : view === 'illustrators' ? 'illustratori' : view === 'favorites' ? 'preferiti' : 'catalogo'}/${game}${setId ? '/' + encodeURIComponent(setId) : ''}`;
  if (location.hash.slice(1) === route) readRoute(); else location.hash = route;
}
function readRoute() {
  setMobileFiltersOpen(false);
  closeFilterPanels();
  $('#game-picker').open = false;
  if ($('#image-dialog').open) $('#image-dialog').close();
  if ($('#card-dialog').open) $('#card-dialog').close();
  const [view, game, rawSet] = location.hash.slice(1).split('/');
  state.view = view === 'illustratore' ? 'illustrator' : view === 'illustratori' ? 'illustrators' : view === 'espansioni' ? 'expansions' : view === 'preferiti' ? 'favorites' : view === 'catalogo' ? 'catalog' : 'expansions';
  if (state.view !== 'illustrator' && ['pokemon', 'onepiece'].includes(game)) state.game = game;
  try { state.illustrator = state.view === 'illustrator' ? decodeURIComponent(game || '') : ''; } catch { state.illustrator = ''; }
  state.artistGame = 'all';
  let setId;
  try { setId = decodeURIComponent(rawSet || ''); } catch { setId = ''; }
  const selectedSets = catalogSetSelections(state.game, setId, catalog.sets, catalog.setAliases);
  Object.assign(state, { query: '', sets: state.view !== 'illustrator' ? selectedSets : [], categories: [], rarities: [], traits: [], art: ['illustrator', 'favorites'].includes(state.view) || (state.game === 'onepiece' && setId === 'DOUBLE_PACKS') ? 'all' : 'standard', sort: 'index', page: 1 });
  populateFilters(); render();
  window.scrollTo({ top: 0 });
}
function favoriteMarkup(card, detail = false) {
  const on = favoriteIds().has(card.id);
  const remove = state.view === 'favorites' && on;
  const label = remove ? `Rimuovi da ${activeList().name}` : on ? 'Gestisci liste' : 'Aggiungi ai preferiti';
  return `<button class="${detail ? 'detail-favorite icon-button' : 'favorite-button'} ${on ? 'is-favorite' : ''}" data-favorite="${esc(card.id)}" aria-label="${esc(label)}: ${esc(card.name)} — ${esc(card.code)} — ${esc(card.variantLabel)}" aria-pressed="${on}">${icon('heart')}</button>`;
}
function tile(card, index) {
  const images = cardProductImages(card, cardDisplaySet(card, state.sets, catalog.sets).id);
  const image = images.find(image => image.language === card.imageLanguage) || images[0];
  return `<article class="card-tile" data-card-game="${card.game}"><div class="card-art"><button class="art-open" data-open-card="${esc(card.id)}" aria-label="Apri ${esc(card.name)} — ${esc(card.code)} — ${esc(card.variantLabel)}"><img src="${image.image}" alt="${esc(card.name)} — ${esc(card.variantLabel)}" width="${card.imageWidth}" height="${card.imageHeight}" loading="${index < 12 ? 'eager' : 'lazy'}" decoding="async"/></button>${favoriteMarkup(card)}</div><div class="card-caption"><button class="card-name" data-open-card="${esc(card.id)}">${esc(card.name)}</button></div></article>`;
}
function render() {
  if (!catalog) return;
  const allFavorites = indexFavorites(catalog.cards, collection.lists.flatMap(list => list.favorites), catalog.aliases);
  favoriteIndex = state.view === 'favorites' ? indexFavorites(catalog.cards, activeList().favorites, catalog.aliases) : allFavorites;
  $$('[data-game]').forEach(button => { const active = button.dataset.game === state.game; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
  $$('[data-view]').forEach(button => { const active = button.dataset.view === state.view || (state.view === 'illustrator' && button.dataset.view === 'illustrators'); button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#home-link').href = `#espansioni/${state.game}`;
  $('#home-link').setAttribute('aria-label', `TCG Art Atlas — Espansioni ${gameName(state.game)}`);
  $('#current-game-logo').src = new URL(`logos/${state.game}_logo.webp`, assetBase).href;
  $('#current-game-logo').alt = state.game === 'pokemon' ? 'Pokémon Trading Card Game' : 'One Piece Card Game';
  const expansions = state.view === 'expansions';
  const artist = state.view === 'illustrator';
  const directory = state.view === 'illustrators';
  const favorites = state.view === 'favorites';
  $('#illustrators-page').hidden = !directory;
  $('#expansions-page').hidden = !expansions;
  $('#cards-page').hidden = expansions || directory;
  $('#filters').hidden = expansions || artist || directory || favorites;
  $('.layout').classList.toggle('show-expansions', expansions || artist || directory || favorites);
  $('.app-header').classList.toggle('directory-header', expansions || artist || directory || favorites);
  syncMobileFilters();
  $('#illustrator-heading').hidden = !artist;
  $('#favorites-heading').hidden = state.view !== 'favorites';
  if (state.view === 'favorites') renderFavoriteLists();
  if (directory) { renderIllustrators(); syncBackToTop(); return; }
  if (expansions) { renderExpansions(); syncBackToTop(); return; }
  const filters = favorites ? {game:state.game,art:'all',sort:'index',onlyFavorites:true} : {...state,game:artist ? state.artistGame : state.game,illustrator:artist ? state.illustrator : ''};
  results = visibleCardResults(filterCards(catalog.cards, filters, favoriteIds()), filters.art);
  if (artist && state.artistGame === 'all') results.sort((a, b) => Number(a.game === 'onepiece') - Number(b.game === 'onepiece'));
  if (artist) {
    $('#illustrator-title').textContent = state.illustrator || 'Illustratore';
    const all = groupCardResults(filterCards(catalog.cards, { game: 'all', illustrator: state.illustrator }));
    const games = ['all', ...['pokemon', 'onepiece'].filter(game => all.some(card => card.game === game))];
    $('#illustrator-games').innerHTML = games.map(game => `<button class="secondary-button ${state.artistGame === game ? 'active' : ''}" data-artist-game="${game}" aria-pressed="${state.artistGame === game}">${game === 'all' ? 'Tutti i giochi' : gameName(game)} <span>${game === 'all' ? all.length : all.filter(card => card.game === game).length}</span></button>`).join('');
  }
  const pages = Math.max(1, Math.ceil(results.length / state.pageSize));
  state.page = Math.max(1, Math.min(state.page, pages));
  const start = (state.page - 1) * state.pageSize;
  const page = results.slice(start, start + state.pageSize);
  $('#results-count').innerHTML = `<strong>${results.length}</strong> ${results.length === 1 ? 'carta' : 'carte'}`;
  $('#gallery').dataset.size = state.size;
  $('#gallery').innerHTML = page.map((card, index) => `${artist && (index === 0 || page[index - 1].game !== card.game) ? `<h3 class="gallery-game-heading">${esc(gameName(card.game))}</h3>` : ''}${tile(card, index)}`).join('');
  $$('[data-page-jump]').forEach(input => { input.value = state.page; input.disabled = pages < 2; input.style.width = `${Math.max(2, String(pages).length) + 1}ch`; });
  $$('[data-page-total]').forEach(total => { total.textContent = pages; });
  $$('[data-page]').forEach(button => { button.disabled = Number(button.dataset.page) < 0 ? state.page <= 1 : state.page >= pages; });
  $('#page-bottom').hidden = pages < 2;
  $('#empty-state').hidden = !!results.length;
  if (!results.length) $('#empty-state').innerHTML = `<p>${state.view === 'favorites' && !knownFavorites().length ? 'Nessuna carta di questa lista nel gioco selezionato.' : 'Nessuna carta trovata.'}</p>${favorites ? '' : `<button class="secondary-button filter-reset" data-action="reset" ${hasCatalogFilters(state) ? '' : 'disabled'}>${icon('reset')}<span>Azzera filtri</span></button>`}`;
  renderFilterChips();
  syncBackToTop();
}
function renderFilterChips() {
  const items = [];
  if (state.query.trim()) items.push(['query', '', `Ricerca: ${state.query.trim()}`]);
  for (const [key, values] of [['sets', state.sets], ['categories', state.categories], ['rarities', state.rarities], ['traits', state.traits]]) {
    for (const value of values) {
      const set = key === 'sets' ? catalog.sets.find(set => `${set.game}:${set.id}` === value) : null;
      const label = key === 'sets' ? set ? setFilterLabel(set, setLabels) : value : key === 'categories' ? categoryNames[value] || value : key === 'traits' ? traitNames[value] || value : value;
      items.push([key, value, label]);
    }
  }
  if (state.art !== 'standard') items.push(['art', '', state.art === 'all' ? 'Tutti gli artwork' : 'Artwork alternativi']);
  $('#filter-count').textContent = items.length ? `${items.length} ${items.length === 1 ? 'filtro attivo' : 'filtri attivi'}` : 'Nessun filtro attivo';
  $('#filter-count').classList.toggle('active', !!items.length);
  $('#reset-filters').disabled = !hasCatalogFilters(state);
  $('#filter-chips').hidden = !items.length;
  $('#filter-chips').innerHTML = items.map(([key, value, label]) => `<button class="filter-chip" data-remove-filter="${key}" data-filter-value="${esc(value)}" aria-label="Rimuovi filtro: ${esc(label)}">${esc(label)}${icon('close')}</button>`).join('');
}

function goToPage(value) {
  const page = pageNumber(value, Math.ceil(results.length / state.pageSize), state.page);
  if (page === state.page) { $$('[data-page-jump]').forEach(input => { input.value = state.page; }); return; }
  state.page = page;
  render();
  $('.catalog-toolbar').scrollIntoView({block:'start',behavior:'instant'});
}
document.addEventListener('input', event => {
  if (event.target.matches('[data-page-jump]')) event.target.value = event.target.value.replace(/[^0-9]/g, '');
});
document.addEventListener('change', event => {
  if (event.target.matches('[data-page-jump]')) goToPage(event.target.value);
});
document.addEventListener('keydown', event => {
  if (event.target.matches('[data-page-jump]') && event.key === 'Enter') { event.preventDefault(); goToPage(event.target.value); }
});

function resetFilters() {
  if (!hasCatalogFilters(state)) return;
  Object.assign(state, { query: '', sets: [], categories: [], art: 'standard', rarities: [], traits: [], sort: 'index', page: 1 });
  populateFilters(); render();
}
function activeList() {
  return collection.lists.find(list => list.id === activeListId) || collection.lists[0];
}
function memberLists(id) {
  return collection.lists.filter(list => list.favorites.some(value => resolveAlias(value, catalog.aliases) === id)).map(list => list.id);
}
function renderFavoriteLists() {
  activeListId = activeList().id;
  const options = collection.lists.map(list => `<option value="${esc(list.id)}">${esc(list.name)} (${indexFavorites(catalog.cards, list.favorites, catalog.aliases).ids.size})</option>`).join('');
  $('#favorite-list').innerHTML = $('#default-favorite-list').innerHTML = options;
  $('#favorite-list').value = activeListId;
  $('#default-favorite-list').value = collection.defaultListId || activeListId;
  $('#auto-save-list').checked = !!collection.defaultListId;
  $('#delete-list').disabled = collection.lists.length === 1;
}
function refreshFavorites(message) {
  persist(); render();
  if ($('#card-dialog').open) $('.detail-favorite').outerHTML = favoriteMarkup(catalog.cards.find(card => card.id === currentCardId), true);
  if (storageAvailable && message) toast(message);
}
function renderFavoriteChoices(selected = memberLists(pendingFavoriteId)) {
  $('#favorite-list-choices').innerHTML = collection.lists.map(list => `<label class="check-option"><input type="checkbox" name="favorite-list-choice" value="${esc(list.id)}" ${selected.includes(list.id) ? 'checked' : ''}/><span>${esc(list.name)}</span></label>`).join('');
}
function toggleFavorite(id) {
  const memberships = memberLists(id);
  const target = state.view === 'favorites' && memberships.includes(activeList().id) ? activeList().id : collection.defaultListId;
  if (target) {
    const on = memberships.includes(target);
    collection = assignFavoriteLists(collection, id, on ? memberships.filter(value => value !== target) : [...memberships, target], catalog.aliases);
    refreshFavorites(`${on ? 'Rimosso da' : 'Aggiunto a'} ${collection.lists.find(list => list.id === target).name}`);
    return;
  }
  pendingFavoriteId = id;
  const card = catalog.cards.find(card => card.id === id);
  $('#favorite-card-label').textContent = `${card.name} · ${card.code}`;
  renderFavoriteChoices();
  $('#favorite-dialog').showModal();
}
function openListName(action) {
  pendingListAction = action;
  $('#list-name-form button[type="submit"]').textContent = action === 'rename' ? 'Aggiorna nome' : 'Crea lista';
  $('#list-name-title').textContent = action === 'rename' ? 'Rinomina lista' : 'Nuova lista';
  $('#list-name').value = action === 'rename' ? activeList().name : '';
  $('#list-name-error').textContent = '';
  $('#list-name-dialog').showModal();
  $('#list-name').focus();
}
function openCard(id, mode = 'card', productSetId) {
  id = resolveAlias(id, catalog.aliases);
  const card = catalog.cards.find(card => card.id === id);
  if (!card) return;
  const previous = catalog.cards.find(card => card.id === currentCardId);
  const variantScroll = previous?.game === card.game && previous?.code === card.code && $('#card-dialog').open ? $('.variant-list')?.scrollLeft || 0 : 0;
  currentCardId = id;
  const dialog = $('#card-dialog');
  dialog.dataset.cardGame = card.game;
  if (mode === 'card') {
    filteredCardIds = results.map(card => card.id);
    filteredCardIndex = Math.max(0, filteredCardIds.indexOf(id));
  }
  dialog.classList.toggle('instant-version', mode === 'variant');
  const variants = cardPopupVersions(catalog.cards, card, catalog.sets);
  const preferredSetId = productSetId || (mode === 'refresh' ? currentCardSetId : '') || cardDisplaySet(card, state.sets, catalog.sets).id;
  const activeVersion = selectPopupVersion(variants, id, preferredSetId);
  currentCardSetId = activeVersion.setId;
  const displaySet = catalog.sets.find(set => set.game === card.game && set.id === currentCardSetId);
  const versions = activeVersion.imageVersions;
  const image = versions.find(version => version.language === imageLanguages.get(activeVersion.versionKey)) || versions[0];
  imageLanguages.set(activeVersion.versionKey, image.language);
  const prints = card.printings || [{ code: card.code, number: card.number, rarity: card.rarity, finishes: card.finishes }];
  const facts = [
    ['Espansione', `<button class="text-button" data-open-set="${esc(displaySet.id)}" data-set-game="${card.game}">${esc(setFullLabel(displaySet))}</button>`, true],
    ['Illustratore', card.illustrator ? `<a href="#illustratore/${encodeURIComponent(card.illustrator)}" data-illustrator="${esc(card.illustrator)}">${esc(card.illustrator)}</a>` : 'N.D.', true],
  ];
  const printVersions = card.game === 'pokemon' ? [
    ...prints.filter(print => prints.length > 1 || print.finishes.some(finish => finish !== 'normal')).map(print => `${prints.length > 1 ? '#' + print.number + ' · ' : print.finishes.length ? 'Standard · ' : ''}${print.finishes.map(finishName).join(' / ') || 'Standard'}`),
    ...(card.editions || []).map(value => value === 'firstEdition' ? 'Prima edizione' : 'W Promo'),
  ] : [];
  dialog.innerHTML = `
    <button class="detail-close icon-button" data-close="card-dialog" aria-label="Chiudi carta">${icon('close')}</button>
    <div class="detail-body">
    <div class="detail-art"><div class="detail-image-frame"><button class="detail-image-open" data-enlarge-image aria-label="Schermo intero: ${esc(card.name)}"><img id="detail-image" src="${esc(image.image)}" width="${card.imageWidth}" height="${card.imageHeight}" alt="${esc(card.name)} — ${esc(card.code)} — ${esc(languageName(image.language))}"/></button><div class="detail-image-actions"><button class="detail-fullscreen" data-enlarge-image>${icon('expand')}Schermo intero</button><a class="detail-new-tab" data-image-tab href="${esc(image.image)}" target="_blank" rel="noopener">Immagine in una nuova scheda${icon('external')}</a></div></div></div>
    <div class="detail-info"><div class="detail-info-content">
      <header class="detail-heading">${favoriteMarkup(card, true)}<h2 id="detail-title">${esc(card.name)}</h2></header>
      <dl class="detail-facts">${facts.map(([name, value, markup], index) => `<div><dt>${esc(name)}</dt><dd>${markup ? factValue(value) : esc(factValue(value))}</dd></div>${index === 0 ? `<div class="card-identity-row"><dt>${card.game === 'pokemon' ? 'Numero' : 'Codice'} / Rarità</dt><dd class="inline-facts"><span class="card-number">${esc(numbersLabel(card))}</span><span>${esc(factValue(cardRarities(card).join(' / ')))}</span></dd></div>` : ''}`).join('')}
        <div class="language-row"><dt>${versions.length > 1 ? '<label for="image-language">Lingua</label>' : 'Lingua'}</dt><dd>${versions.length > 1 ? `<select id="image-language">${versions.map(version => `<option value="${esc(version.language)}" ${version.language === image.language ? 'selected' : ''}>${esc(languageName(version.language))}</option>`).join('')}</select>` : `<span>${esc(languageName(image.language))}</span>`}</dd></div>
        <div class="release-date-row"><dt>Uscita</dt><dd class="inline-facts release-date-values">${popupReleaseDateRows(displaySet).map(row => `<span>${row.region ? `<span class="region-code">${esc(row.region)}:</span> ` : ''}${row.date ? `<time datetime="${esc(row.date)}" title="${esc(dateLabel(row.date))}">${shortDateLabel(row.date)}</time>` : 'N.D.'}</span>`).join('')}</dd></div>
      </dl>
      <form class="card-observation-form" data-card-id="${esc(card.id)}" data-product-set="${esc(currentCardSetId)}" data-version-key="${esc(activeVersion.versionKey)}" data-language="${esc(image.language)}"><label for="card-observation">Osservazioni</label><div class="observation-fields"><textarea id="card-observation" name="text" maxlength="5000" rows="2" placeholder="Segnala un problema della carta o di questa variante…" required>${esc(reviewDrafts.get(activeVersion.versionKey)?.text || '')}</textarea><button type="submit" class="secondary-button">Invia</button></div><p class="observation-status" role="status" aria-live="polite"></p></form>
        ${variants.length > 1 || printVersions.length ? `<section class="variants" aria-label="Versioni della carta"><h3>Versioni</h3>${printVersions.length ? `<ul class="print-versions">${printVersions.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : ''}${variants.length > 1 ? `<div class="variant-list" tabindex="0" aria-label="Versioni disponibili">${variants.map(other => `<button class="variant-thumb ${other.versionKey === activeVersion.versionKey ? 'selected' : ''}" data-variant="${esc(other.id)}" data-variant-set="${esc(other.setId)}" title="${esc(other.variantLabel)}" aria-label="${esc(other.variantLabel)} — ${esc(other.code)}" aria-pressed="${other.versionKey === activeVersion.versionKey}"><img src="${esc(other.image)}" alt="" loading="lazy"/><span>${esc(other.variantLabel)}</span></button>`).join('')}</div>` : ''}</section>` : ''}
    </div><nav class="detail-navigation page-controls" aria-label="Navigazione carte filtrate"><button class="icon-button" data-step="-1" aria-label="Carta precedente" ${filteredCardIds.length < 2 ? 'disabled' : ''}>${icon('left')}</button><span aria-live="polite">${filteredCardIndex + 1}/${filteredCardIds.length}</span><button class="icon-button" data-step="1" aria-label="Carta successiva" ${filteredCardIds.length < 2 ? 'disabled' : ''}>${icon('right')}</button></nav></div></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  $('.detail-info-content').scrollTop = 0;
  if ($('.variant-list')) $('.variant-list').scrollLeft = variantScroll;
  (mode === 'variant' ? $('.variant-thumb.selected') : $('.detail-close')).focus({ preventScroll: true });
}
function stepCard(delta) {
  if (filteredCardIds.length < 2) return;
  filteredCardIndex = (filteredCardIndex + delta + filteredCardIds.length) % filteredCardIds.length;
  openCard(filteredCardIds[filteredCardIndex], 'step');
}
document.addEventListener('click', event => {
  const enlarge = event.target.closest('[data-enlarge-image]');
  if (enlarge) {
    event.preventDefault();
    const image = $('#detail-image');
    $('#image-dialog').dataset.cardGame = $('#card-dialog').dataset.cardGame;
    $('#fullscreen-image').src = image.src;
    $('#fullscreen-image').alt = image.alt;
    $('#image-dialog').showModal();
    return;
  }
  const artist = event.target.closest('[data-illustrator]');
  if (artist) {
    event.preventDefault();
    if (artist.closest('#card-dialog')) state.game = catalog.cards.find(card => card.id === currentCardId)?.game || state.game;
    const hash = `#illustratore/${encodeURIComponent(artist.dataset.illustrator)}`;
    if (location.hash === hash) readRoute(); else location.hash = hash;
    return;
  }
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.close) return document.getElementById(button.dataset.close).close();
  if (!catalog) return;
  if (button.dataset.removeFilter) {
    const key = button.dataset.removeFilter;
    if (key === 'query') state.query = '';
    else if (key === 'art') state.art = 'standard';
    else if (['sets', 'categories', 'rarities', 'traits'].includes(key)) state[key] = state[key].filter(value => value !== button.dataset.filterValue);
    state.page = 1; populateFilters(); render(); return;
  }
  if (button.id === 'back-to-top') {
    if (backTopSuppressClick) { backTopSuppressClick = false; if (event.detail) return; }
    const target = state.view === 'expansions' ? $('#expansions-page') : $('#filters').hidden ? $('.catalog-toolbar') : $('#search');
    target.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    return;
  }
  if (button.dataset.favorite) return toggleFavorite(button.dataset.favorite);
  if (button.dataset.variant) return openCard(button.dataset.variant, 'variant', button.dataset.variantSet);
  if (button.dataset.openCard) return openCard(button.dataset.openCard);
  if (button.dataset.game) return navigate(state.view === 'illustrator' ? 'catalog' : state.view, button.dataset.game);
  if (button.dataset.illustratorGame) { state.artistFilter = button.dataset.illustratorGame; renderIllustrators(); return; }
  if (button.dataset.artistGame) { state.artistGame = button.dataset.artistGame; state.page = 1; render(); return; }
  if (button.dataset.view) return navigate(button.dataset.view);
  if (button.dataset.openSet) { $('#card-dialog').close(); navigate('catalog', button.dataset.setGame, button.dataset.openSet); return; }
  if (button.dataset.page) return goToPage(state.page + Number(button.dataset.page));
  if (button.dataset.step) return stepCard(Number(button.dataset.step));
  if (button.id === 'reset-filters' || button.dataset.action === 'reset') return resetFilters();
  if (button.hasAttribute('data-new-list')) return openListName('create');
  if (button.id === 'rename-list') return openListName('rename');
  if (button.id === 'delete-list' && collection.lists.length > 1) {
    pendingListAction = activeList().id;
    $('#delete-list-message').textContent = `Eliminare “${activeList().name}”? Le carte salvate nelle altre liste rimangono disponibili.`;
    $('#delete-list-dialog').showModal();
    return;
  }
  if (button.id === 'confirm-delete-list') {
    if (collection.lists.length > 1) {
      collection.lists = collection.lists.filter(list => list.id !== pendingListAction);
      if (collection.defaultListId === pendingListAction) collection.defaultListId = null;
      activeListId = activeList().id;
      state.page = 1;
      refreshFavorites('Lista eliminata');
    }
    $('#delete-list-dialog').close();
  }
  if (button.id === 'export-list') {
    const blob = new Blob([JSON.stringify(portableList(activeList(),catalog.cards,catalog.aliases), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = listExportFilename(activeList().name); a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Contenuto della lista esportato');
  }
});
$('#illustrator-search').addEventListener('input', event => { state.artistQuery = event.target.value; renderIllustrators(); });
$('#expansions-grid').addEventListener('click', event => {
  const button = event.target.closest('[data-expansion-group]');
  if (!button) return;
  const collapsed = button.getAttribute('aria-expanded') === 'true';
  const key = button.dataset.expansionGroup;
  if (collapsed) collapsedExpansionGroups.add(key); else collapsedExpansionGroups.delete(key);
  button.setAttribute('aria-expanded', String(!collapsed));
  const name = $('.expansion-group-name', button.closest('.expansion-group-title')).textContent;
  button.setAttribute('aria-label', `${collapsed ? 'Espandi' : 'Comprimi'} ${name}`);
  document.getElementById(button.getAttribute('aria-controls')).hidden = collapsed;
});
$('#expansion-search').addEventListener('input', event => { state.expansionQuery = event.target.value; renderExpansions(); });
$('#expansion-languages').addEventListener('click', event => {
  const button = event.target.closest('[data-expansion-language]');
  if (!button) return;
  state.expansionLanguage = button.dataset.expansionLanguage; renderExpansions();
});
$('#expansion-category').addEventListener('change', event => { state.expansionCategory = event.target.value; renderExpansions(); });
$('#reset-expansion-filters').addEventListener('click', () => { if (!hasExpansionFilters(state)) return; state.expansionQuery = ''; state.expansionLanguage = 'en'; state.expansionCategory = 'expansion'; renderExpansions(); });
$('#search').addEventListener('input', event => { state.query = event.target.value; state.page = 1; render(); });
$('#home-link').addEventListener('click', event => { event.preventDefault(); navigate('expansions'); });
$('#page-size').addEventListener('change', event => {
  const size = Number(event.target.value);
  if ([100, 200, 300].includes(size)) { state.pageSize = size; state.page = 1; render(); }
});
for (const [id, key] of [['art-filter', 'art'], ['sort', 'sort'], ['card-size', 'size']]) {
  document.getElementById(id).addEventListener('change', event => { state[key] = event.target.value; state.page = 1; render(); });
}
document.addEventListener('change', event => {
  const input = event.target;
  if (input.dataset.filter) {
    const key = input.dataset.filter;
    if (!['sets', 'categories', 'rarities', 'traits'].includes(key)) return;
    state[key] = input.value === 'all' ? [] : input.checked ? [...new Set([...state[key], input.value])] : state[key].filter(value => value !== input.value);
    state.page = 1; syncFilters(); render();
  }
  if (input.id === 'image-language') {
    const card = catalog.cards.find(card => card.id === currentCardId);
    const version = cardProductImages(card, currentCardSetId).find(version => version.language === input.value);
    if (!version) return;
    imageLanguages.set(`${card.id}:${currentCardSetId}`, version.language);
    $('#detail-image').src = version.image;
    $('.card-observation-form').dataset.language = version.language;
    $('#detail-image').alt = `${card.name} — ${card.code} — ${languageName(version.language)}`;
    $$('[data-image-tab]').forEach(link => { link.href = version.image; });
  }
});
document.addEventListener('input', event => {
  if (event.target.id !== 'card-observation') return;
  const key = event.target.form.dataset.versionKey;
  reviewDrafts.set(key, {text:event.target.value, id:crypto.randomUUID()});
});
document.addEventListener('submit', async event => {
  const form=event.target;
  if (!form.matches('.card-observation-form')) return;
  event.preventDefault();
  const text=$('textarea',form).value.trim();
  if (!text) return;
  const key=form.dataset.versionKey;
  const draft=reviewDrafts.get(key) || {text,id:crypto.randomUUID()};
  reviewDrafts.set(key,draft);
  const payload={id:draft.id,cardId:form.dataset.cardId,setId:form.dataset.productSet,language:form.dataset.language,text};
  const submit=$('button[type="submit"]',form),status=$('.observation-status',form);
  submit.disabled=true;status.textContent='Salvataggio…';
  try {
    let savedLocally = false;
    if (location.protocol==='http:' && ['localhost','127.0.0.1'].includes(location.hostname)) {
      const response=await fetch(new URL('api/card-observations',assetBase),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if (![404,405].includes(response.status)) {
        const result=await response.json().catch(()=>({error:'Risposta del server non valida.'}));
        if (!response.ok) throw new Error(result.error || 'Salvataggio non riuscito.');
        if (result.status!=='saved' || result.id!==payload.id) throw new Error('Il server non ha confermato la scrittura in CARD_REVIEW.json.');
        savedLocally=true;
      }
    }
    if (!savedLocally) {
      if (!window.showOpenFilePicker) throw new Error('Per scrivere in CARD_REVIEW.json avvia il sito con npm run dev.');
      if (!reviewFileHandle) [reviewFileHandle]=await window.showOpenFilePicker({multiple:false,types:[{description:'CARD_REVIEW.json del progetto',accept:{'application/json':['.json']}}]});
      const file=await reviewFileHandle.getFile();
      if (file.name!=='CARD_REVIEW.json') {reviewFileHandle=undefined;throw new Error('Seleziona il file CARD_REVIEW.json del progetto.');}
      const registry=JSON.parse(await file.text());
      const entry=globalThis.TCG_REVIEW_NOTES.createObservation(catalog,payload);
      globalThis.TCG_REVIEW_NOTES.appendObservation(registry,entry);
      const writable=await reviewFileHandle.createWritable();
      await writable.write(JSON.stringify(registry,null,2)+'\n');await writable.close();
    }
    const unchanged=reviewDrafts.get(key)?.id===draft.id;
    if (unchanged) reviewDrafts.delete(key);
    if (form.isConnected) { if (unchanged) $('textarea',form).value='';status.textContent='Salvato in CARD_REVIEW.json.'; }
  } catch(error) {
    if (error.name==='AbortError') status.textContent='Salvataggio annullato. Il testo resta disponibile.';
    else status.textContent=error.message || 'Salvataggio non riuscito. Il testo resta disponibile.';
  } finally {submit.disabled=false;}
});
$('#favorite-list').addEventListener('change', event => {
  activeListId = event.target.value; state.page = 1; render();
});
$('#auto-save-list').addEventListener('change', event => {
  collection.defaultListId = event.target.checked ? $('#default-favorite-list').value : null;
  persist();
});
$('#default-favorite-list').addEventListener('change', event => {
  if ($('#auto-save-list').checked) { collection.defaultListId = event.target.value; persist(); }
});
$('#favorite-form').addEventListener('submit', event => {
  event.preventDefault();
  const selected = $$('#favorite-list-choices input:checked').map(input => input.value);
  collection = assignFavoriteLists(collection, pendingFavoriteId, selected, catalog.aliases);
  $('#favorite-dialog').close();
  refreshFavorites(selected.length ? 'Liste aggiornate' : 'Carta rimossa dalle liste');
});
$('#list-name-form').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#list-name').value.trim();
  if (!validListName(name)) { $('#list-name-error').textContent = 'Usa da 1 a 15 lettere o numeri. Sono ammessi anche - _ . ,'; return; }
  const current = pendingListAction === 'rename' ? activeList() : null;
  if (collection.lists.some(list => list.id !== current?.id && normalize(list.name) === normalize(name))) {
    $('#list-name-error').textContent = 'Esiste già una lista con questo nome.'; return;
  }
  if (current) current.name = name;
  else {
    const id = crypto.randomUUID();
    collection.lists.push({ id, name, favorites: [], notes: {} });
    activeListId = id;
    state.page = 1;
    if ($('#favorite-dialog').open) renderFavoriteChoices([...$$('#favorite-list-choices input:checked').map(input => input.value), id]);
  }
  $('#list-name-dialog').close();
  refreshFavorites(current ? 'Lista rinominata' : 'Lista creata');
});
$('#import-list').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || !catalog) return;
  const targetId = activeList().id;
  try {
    if (file.size > 2_000_000) throw new Error('Il backup supera i 2 MB.');
    collection = importListContent(collection, targetId, JSON.parse(await file.text()),catalog.cards,catalog.aliases);
    refreshFavorites(`Contenuto importato in ${collection.lists.find(list => list.id === targetId).name}`);
  } catch (error) { toast(error instanceof SyntaxError ? 'JSON non valido.' : error.message); }
  event.target.value = '';
});
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
});
document.addEventListener('keydown', event => {
  if ($$('dialog[open]').some(dialog => dialog.id !== 'card-dialog')) return;
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (event.key === '/' && state.view === 'catalog' && !editing && !$$('dialog[open]').length) { event.preventDefault(); $('#search').focus(); }
  if ($('#card-dialog').open && !editing && !document.activeElement.closest('.variant-list') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); stepCard(event.key === 'ArrowRight' ? 1 : -1); }
  if (event.key === 'Escape') {
    if (mobileFiltersOpen) { setMobileFiltersOpen(false); $('#mobile-filter-toggle').focus(); return; }
    const openFilter = $('.multi-filter[open]');
    if (openFilter) { closeFilterPanels(); $('summary', openFilter).focus(); }
    else if ($('#game-picker').open) $('#game-picker').open = false;
  }
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !catalog) return;
  try {
    collection = event.newValue ? validateLibrary(JSON.parse(event.newValue)) : emptyLibrary();
    render();
    if ($('#favorite-dialog').open) renderFavoriteChoices();
    if ($('#card-dialog').open) openCard(currentCardId, 'refresh');
  }
  catch { toast('Impossibile leggere la selezione aggiornata.'); }
});
window.addEventListener('hashchange', () => { if (catalog && location.hash !== '#gallery') readRoute(); });
function initialize() {
  try {
    const displaySets = catalogData.sets.map(set => ({ ...set, name: formatSetName(set.name, set.game) }));
    setLabels = setDisplayLabels(displaySets);
    illustratorIndex = indexIllustrators(catalogData.cards);
    expansionCategories = expansionCategoryMap(displaySets.filter(set => set.game === 'pokemon'));
    const categories = new Set(expansionCategories.values());
    $('#expansion-category').innerHTML = '<option value="all">Tutte le categorie</option>' + Object.entries(expansionCategoryNames).filter(([key]) => categories.has(key)).map(([key, name]) => `<option value="${key}">${esc(name)}</option>`).join('');
    catalog = { ...catalogData, cards: catalogData.cards.map(card => ({
      ...card,
      setName: setLabels.get(`${card.game}:${card.setId}`),
      image: new URL(card.image.replace(/^\//, ''), assetBase).href,
      imageVersions: card.imageVersions?.map(version => ({ ...version, image: new URL(version.image.replace(/^\//, ''), assetBase).href })),
    })), sets: displaySets.map(set => ({ ...set, image: set.image ? new URL(set.image.replace(/^\//, ''), assetBase).href : '', symbol: set.symbol ? new URL(set.symbol, assetBase).href : '' })) };
    try { const saved = loadCollection(localStorage); collection = saved.collection; if (saved.needsMigration) persist(); }
    catch { toast('Preferiti non leggibili. Puoi ripristinare un backup.'); }
    readRoute();
  } catch (error) {
    $('#results-count').textContent = 'Catalogo non disponibile'; $('#empty-state').hidden = false;
    $('#empty-state').innerHTML = '<p>Impossibile leggere il catalogo. Riapri index.html dalla cartella public di TCG Art Atlas.</p>'; console.error(error);
  }
}
initialize();
}

if (typeof document !== 'undefined') {
  startApp(globalThis.TCG_ART_ATLAS_CATALOG, new URL('./', document.currentScript.src));
  delete globalThis.TCG_ART_ATLAS_CATALOG;
}
