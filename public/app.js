const STORAGE_KEY = 'tcg-art-atlas.collection.v1';
const LEGACY_STORAGE_KEYS = ['tcg-art-collector.collection.v1', 'clist.collection.v1'];
const emptyCollection = () => ({ schemaVersion: 1, favorites: [], notes: {} });
const normalize = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const traitNames = { Grass: 'Erba', Fire: 'Fuoco', Water: 'Acqua', Lightning: 'Elettro', Psychic: 'Psico', Fighting: 'Lotta', Darkness: 'Buio', Metal: 'Acciaio', Dragon: 'Drago', Fairy: 'Folletto', Colorless: 'Incolore', Trainer: 'Allenatore', Energy: 'Energia', Red: 'Rosso', Green: 'Verde', Blue: 'Blu', Purple: 'Viola', Black: 'Nero', Yellow: 'Giallo' };
const categoryNames = { LEADER: 'Leader', CHARACTER: 'Personaggio', EVENT: 'Evento', STAGE: 'Stage', 'DON!!': 'DON!!' };
const onepieceRarityNames = { C: 'Common', UC: 'Uncommon', R: 'Rare', SR: 'Super Rare', SEC: 'Secret Rare', 'SP CARD': 'Special Card', TR: 'Treasure Rare', L: 'Leader' };
const rarityOrders = {
  pokemon: ['Common', 'Uncommon', 'Rare', 'Holo Rare', 'Shining Rare', 'Promo', 'Unknown'],
  onepiece: ['C', 'UC', 'R', 'SR', 'SEC', 'SP CARD', 'TR', 'L', 'DON!!'],
};
function orderedRarities(values, game) {
  const order = rarityOrders[game] || [];
  const rank = value => order.includes(value) ? order.indexOf(value) : order.length;
  return [...new Set(values)].sort((a, b) => rank(a) - rank(b));
}
function cardTraits(card) {
  return card.game === 'pokemon' ? card.types?.length ? card.types : [card.category === 'Trainer' ? 'Trainer' : card.category === 'Energy' ? 'Energy' : 'Unknown'] : card.category === 'DON!!' ? [] : card.colors?.length ? card.colors : ['Unknown'];
}
function languageImages(card) {
  const versions = card.imageVersions?.length ? card.imageVersions : [{ language: card.imageLanguage || 'und', image: card.image }];
  return versions.map(version => ({ ...version, language: ({ jp: 'ja', jap: 'ja', ita: 'it', eng: 'en', source: 'und' }[String(version.language).toLowerCase()] || String(version.language).toLowerCase()) }));
}
const matchesAny = (selected, values) => !selected || selected === 'all' || (Array.isArray(selected) ? !selected.length || selected.some(value => values.includes(value)) : values.includes(selected));

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
    matchesAny(filters.rarities ?? filters.rarity, card.rarities || [card.rarity]) &&
    (matchesAny(filters.traits, cardTraits(card)) || (card.game === 'onepiece' && card.category === 'DON!!' && filters.categories?.includes('DON!!'))) &&
    (!filters.onlyFavorites || favoriteSet.has(card.id)) &&
    query.every(word => normalize([card.name, card.code, ...(card.codes || []), ...(card.numbers || []), card.setName, card.setId, card.illustrator, card.artwork, card.variantLabel].join(' ')).includes(word))
  );
  if (filters.sort === 'index' && filters.game === 'onepiece' && filters.sets?.length === 1) result.sort((a, b) => a.code.localeCompare(b.code, 'en', {numeric:true}) || Number(a.isAlternative) - Number(b.isAlternative));
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
    const products = other.game === 'onepiece' ? other.productVersions || [{ setId: other.setId }] : [{ setId: other.setId }];
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
function setPreviewTitle(set) {
  if (set.game !== 'onepiece') return set.name;
  let name = set.name.replace(/^(?:Extra|Premium)\s+Booster\b\s*[:–-]?\s*/i, '');
  if (/^ST\d{2}(?:_PRE)?$/.test(set.id)) name = name.replace(/^(?:(?:red|green|blue|purple|black|yellow)(?:\/(?:red|green|blue|purple|black|yellow))*)\s+/i, '');
  name = name.replace(/(^|\s)-+|-+(?=\s|$)/g, '$1').trim();
  return /^(?:(?:OP|EB|PRB|ST|LD|SD)\d{2}(?:_PRE)?|P)$/.test(set.id) ? `[${set.id.replace('_PRE', ' PRE')}] ${name}` : name;
}
function setFullLabel(set) {
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
  const rows = releaseDateRows(set);
  return rows.length === 1 ? [...rows, { empty: true }] : rows;
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
  for (const set of sets) {
    const name = set.group || set.seriesName || 'Altre espansioni';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(set);
  }
  return [...groups].map(([name, items]) => ({ name, sets: items.sort(compareExpansionDates) }))
    .sort((a, b) => Math.min(...a.sets.map(set => set.groupOrder ?? 999)) - Math.min(...b.sets.map(set => set.groupOrder ?? 999)));
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
function loadCollection(storage) {
  const current = storage.getItem(STORAGE_KEY);
  const legacy = current ? null : LEGACY_STORAGE_KEYS.map(key => storage.getItem(key)).find(Boolean);
  return { collection: current || legacy ? validateCollection(JSON.parse(current || legacy)) : emptyCollection(), needsMigration: !current && !!legacy };
}


function startApp(catalogData, assetBase) {
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shapes = {
  cards: '<rect x="6" y="3" width="13" height="18" rx="2"/><path d="M3 6v14a2 2 0 0 0 2 2"/><path d="m10 10 2-3 3 3-3 4Z"/>',
  layers: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  up: '<path d="m5 15 7-7 7 7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  reset: '<path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/>',
  artists: '<path d="m15 4 5 5M4 20l4-1 12-12-4-4L4 15v5Z"/><path d="M3 22h18"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5m13-5v5h-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.cards}</svg>`;
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

const state = { game: 'pokemon', view: 'catalog', illustrator: '', artistGame: 'all', artistQuery: '', artistFilter: 'all', expansionQuery: '', expansionLanguage: 'all', expansionCategory: 'expansion', query: '', sets: [], categories: [], art: 'standard', rarities: [], traits: [], sort: 'index', page: 1, pageSize: 200, size: 'medium' };
let catalog;
let collection = emptyCollection();
let favoriteIndex = { ids: new Set(), known: [] };
let setLabels = new Map();
let illustratorIndex = [];
let expansionCategories = new Map();
let results = [];
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
  const sets = catalog.sets.filter(set => set.game === state.game).sort(compareExpansionDates);
  const cards = catalog.cards.filter(card => card.game === state.game);
  const rarities = orderedRarities(cards.flatMap(card => card.rarities || [card.rarity]), state.game);
  const traits = [...new Set(cards.flatMap(cardTraits))].sort((a, b) => (traitNames[a] || a).localeCompare(traitNames[b] || b, 'it'));
  const checkbox = (key, value, label) => `<label class="check-option"><input type="checkbox" data-filter="${key}" value="${esc(value)}"/><span>${esc(label)}</span></label>`;
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
function closeFilterPanels(except) {
  $$('.multi-filter[open]').forEach(panel => { if (panel !== except) panel.open = false; });
}
function positionFilterPanel(filter) {
  const anchor = $('summary', filter).getBoundingClientRect();
  const panel = $('.filter-options', filter);
  const availableWidth = window.innerWidth - 20;
  Object.assign(panel.style, { width: 'max-content', maxWidth: `${availableWidth}px` });
  const width = Math.min(availableWidth, Math.max(220, Math.ceil(panel.getBoundingClientRect().width)));
  const below = window.innerHeight - anchor.bottom - 16;
  const above = anchor.top - 16;
  const upward = below < 170 && above > below;
  const maxHeight = Math.max(80, Math.min(300, upward ? above : below));
  Object.assign(panel.style, { width: `${width}px`, left: `${Math.max(10, Math.min(anchor.left, window.innerWidth - width - 10))}px`, maxHeight: `${maxHeight}px`, top: 'auto', bottom: 'auto' });
  if (upward) panel.style.bottom = `${window.innerHeight - anchor.top + 5}px`;
  else panel.style.top = `${anchor.bottom + 5}px`;
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
window.addEventListener('resize', () => closeFilterPanels());
window.addEventListener('scroll', event => {
  if (!(event.target instanceof Element) || !event.target.closest('.filter-options')) closeFilterPanels();
}, true);
function syncBackToTop() {
  $('#back-to-top').hidden = ['expansions', 'illustrators'].includes(state.view) || !results.length || window.scrollY < 240 || $('.catalog-toolbar').getBoundingClientRect().bottom > 0;
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
  return releaseDateRows(set).map(row => `<span class="regional-date">${row.region ? `<span class="region-code">${esc(row.region)}:</span>` : ''}${row.date ? `<time datetime="${esc(row.date)}">${dateLabel(row.date)}</time>` : '<span>N.D.</span>'}</span>`).join('');
}
function renderExpansions() {
  const pokemon = state.game === 'pokemon';
  const sets = filterExpansionSets(catalog.sets, { game: state.game, query: pokemon ? state.expansionQuery : '', language: pokemon ? state.expansionLanguage : 'all', category: pokemon ? state.expansionCategory : 'all' }, expansionCategories)
    .sort((a, b) => (a.groupOrder ?? 999) - (b.groupOrder ?? 999) || compareExpansionDates(a, b));
  $('#expansions-page').dataset.game = state.game;
  $('#expansions-title').textContent = `Espansioni ${gameName(state.game)}`;
  $('#expansion-filters').hidden = !pokemon;
  if ($('#expansion-search').value !== state.expansionQuery) $('#expansion-search').value = state.expansionQuery;
  $('#expansion-language').value = state.expansionLanguage;
  $('#expansion-category').value = state.expansionCategory;
  $('#expansions-empty').hidden = !!sets.length;
  $('#expansions-grid').innerHTML = groupExpansionSets(sets).map((group, index) => `<section class="expansion-group" aria-labelledby="set-group-${index}"><h3 id="set-group-${index}" class="expansion-group-title">${esc(group.name)}</h3><div class="expansions-grid">${group.sets.map(set => `<a class="expansion-tile" data-set-game="${set.game}" href="#catalogo/${set.game}/${encodeURIComponent(set.id)}" title="${esc(setPreviewTitle(set))}"><div class="expansion-art">${expansionArtwork(set)}</div><div class="expansion-caption"><div class="expansion-name">${set.symbol ? `<img class="set-symbol" src="${esc(set.symbol)}" alt="" width="22" height="22" loading="lazy"/>` : ''}<h4>${esc(setPreviewTitle(set))}</h4></div><div class="expansion-meta">${expansionDatesMarkup(set)}</div></div></a>`).join('')}</div></section>`).join('');
  loadProductImages();
}
function navigate(view, game = state.game, setId) {
  const route = `${view === 'expansions' ? 'espansioni' : view === 'illustrators' ? 'illustratori' : view === 'favorites' ? 'preferiti' : 'catalogo'}/${game}${setId ? '/' + encodeURIComponent(setId) : ''}`;
  if (location.hash.slice(1) === route) readRoute(); else location.hash = route;
}
function readRoute() {
  closeFilterPanels();
  $('#game-picker').open = false;
  if ($('#image-dialog').open) $('#image-dialog').close();
  if ($('#card-dialog').open) $('#card-dialog').close();
  const [view, game, rawSet] = location.hash.slice(1).split('/');
  state.view = view === 'illustratore' ? 'illustrator' : view === 'illustratori' ? 'illustrators' : view === 'espansioni' ? 'expansions' : view === 'preferiti' ? 'favorites' : 'catalog';
  if (state.view !== 'illustrator' && ['pokemon', 'onepiece'].includes(game)) state.game = game;
  try { state.illustrator = state.view === 'illustrator' ? decodeURIComponent(game || '') : ''; } catch { state.illustrator = ''; }
  state.artistGame = 'all';
  let setId;
  try { setId = decodeURIComponent(rawSet || ''); } catch { setId = ''; }
  const setKey = resolveAlias(`${state.game}:${setId}`, catalog.setAliases);
  setId = setKey.slice(state.game.length + 1);
  Object.assign(state, { query: '', sets: state.view !== 'illustrator' && catalog.sets.some(set => set.game === state.game && set.id === setId) ? [`${state.game}:${setId}`] : [], categories: [], rarities: [], traits: [], art: ['illustrator', 'favorites'].includes(state.view) ? 'all' : 'standard', sort: 'index', page: 1 });
  populateFilters(); render();
  window.scrollTo({ top: 0 });
}
function favoriteMarkup(card, detail = false) {
  const on = favoriteIds().has(card.id);
  return `<button class="${detail ? 'detail-favorite primary-button' : 'favorite-button'} ${on ? 'is-favorite' : ''}" data-favorite="${esc(card.id)}" aria-label="${on ? 'Rimuovi dai' : 'Aggiungi ai'} preferiti: ${esc(card.name)} — ${esc(card.code)} — ${esc(card.variantLabel)}" aria-pressed="${on}">${icon('heart')}${detail ? `<span>${on ? 'Nei preferiti' : 'Aggiungi ai preferiti'}</span>` : ''}</button>`;
}
function tile(card, index) {
  const images = cardProductImages(card, cardDisplaySet(card, state.sets, catalog.sets).id);
  const image = images.find(image => image.language === card.imageLanguage) || images[0];
  return `<article class="card-tile" data-card-game="${card.game}"><div class="card-art"><button class="art-open" data-open-card="${esc(card.id)}" aria-label="Apri ${esc(card.name)} — ${esc(card.code)} — ${esc(card.variantLabel)}"><img src="${image.image}" alt="${esc(card.name)} — ${esc(card.variantLabel)}" width="${card.imageWidth}" height="${card.imageHeight}" loading="${index < 12 ? 'eager' : 'lazy'}" decoding="async"/></button>${favoriteMarkup(card)}</div><div class="card-caption"><button class="card-name" data-open-card="${esc(card.id)}">${esc(card.name)}</button></div></article>`;
}
function render() {
  if (!catalog) return;
  favoriteIndex = indexFavorites(catalog.cards, collection.favorites, catalog.aliases);
  $$('[data-game]').forEach(button => { const active = button.dataset.game === state.game; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
  $$('[data-view]').forEach(button => { const active = button.dataset.view === state.view || (state.view === 'illustrator' && button.dataset.view === 'illustrators'); button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#favorite-count').textContent = knownFavorites().length;
  $('#home-link').href = `#catalogo/${state.game}`;
  $('#home-link').setAttribute('aria-label', `TCG Art Atlas — Catalogo ${gameName(state.game)}`);
  $('#current-game-logo').src = new URL(`logos/${state.game}_logo.webp`, assetBase).href;
  $('#current-game-logo').alt = state.game === 'pokemon' ? 'Pokémon Trading Card Game' : 'One Piece Card Game';
  const expansions = state.view === 'expansions';
  const artist = state.view === 'illustrator';
  const directory = state.view === 'illustrators';
  $('#illustrators-page').hidden = !directory;
  $('#expansions-page').hidden = !expansions;
  $('#cards-page').hidden = expansions || directory;
  $('#filters').hidden = expansions || artist || directory;
  $('.layout').classList.toggle('show-expansions', expansions || artist || directory);
  $('#illustrator-heading').hidden = !artist;
  if (directory) { renderIllustrators(); syncBackToTop(); return; }
  if (expansions) { renderExpansions(); syncBackToTop(); return; }
  results = groupCardResults(filterCards(catalog.cards, { ...state, game: artist ? state.artistGame : state.game, illustrator: artist ? state.illustrator : '', onlyFavorites: state.view === 'favorites' }, favoriteIds()));
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
  $('#page-info').textContent = $('#page-info-bottom').textContent = `${state.page}/${pages}`;
  $$('[data-page]').forEach(button => { button.disabled = Number(button.dataset.page) < 0 ? state.page <= 1 : state.page >= pages; });
  $('#page-bottom').hidden = pages < 2;
  $('#empty-state').hidden = !!results.length;
  if (!results.length) $('#empty-state').innerHTML = `<p>${state.view === 'favorites' && !knownFavorites().length ? 'Nessun preferito nei set attuali.' : 'Nessuna carta trovata.'}</p><button class="secondary-button" data-action="reset">Azzera filtri</button>`;
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
  $('#filter-chips').hidden = !items.length;
  $('#filter-chips').innerHTML = items.map(([key, value, label]) => `<button class="filter-chip" data-remove-filter="${key}" data-filter-value="${esc(value)}" aria-label="Rimuovi filtro: ${esc(label)}">${esc(label)}${icon('close')}</button>`).join('');
}

function resetFilters() {
  Object.assign(state, { query: '', sets: [], categories: [], art: 'standard', rarities: [], traits: [], sort: 'index', page: 1 });
  populateFilters(); render();
}
function toggleFavorite(id) {
  const on = favoriteIds().has(id);
  collection.favorites = on ? collection.favorites.filter(value => resolveAlias(value, catalog.aliases) !== id) : [...collection.favorites, id];
  persist(); render();
  if ($('#card-dialog').open) $('.detail-favorite').outerHTML = favoriteMarkup(catalog.cards.find(card => card.id === currentCardId), true);
  if (storageAvailable) toast(on ? 'Rimosso dai preferiti' : 'Aggiunto ai preferiti');
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
    [card.game === 'pokemon' ? 'Numero' : 'Codice', esc(numbersLabel(card)), true],
    ['Rarità', (card.rarities || [card.rarity]).join(' / ')],
    ['Illustratore', card.illustrator ? `<a href="#illustratore/${encodeURIComponent(card.illustrator)}" data-illustrator="${esc(card.illustrator)}">${esc(card.illustrator)}</a>` : 'N.D.', true],
  ];
  const printVersions = card.game === 'pokemon' ? [
    ...prints.filter(print => prints.length > 1 || print.finishes.some(finish => finish !== 'normal')).map(print => `${prints.length > 1 ? '#' + print.number + ' · ' : print.finishes.length ? 'Standard · ' : ''}${print.finishes.map(finishName).join(' / ') || 'Standard'}`),
    ...(card.editions || []).map(value => value === 'firstEdition' ? 'Prima edizione' : 'W Promo'),
  ] : [];
  dialog.innerHTML = `
    <button class="detail-close icon-button" data-close="card-dialog" aria-label="Chiudi carta">${icon('close')}</button>
    <div class="detail-body">
    <div class="detail-art"><div class="detail-image-frame"><a class="detail-image-open" data-enlarge-image href="${esc(image.image)}" target="_blank" rel="noopener" aria-label="Mostra a schermo intero: ${esc(card.name)}"><img id="detail-image" src="${esc(image.image)}" width="${card.imageWidth}" height="${card.imageHeight}" alt="${esc(card.name)} — ${esc(card.code)} — ${esc(languageName(image.language))}"/></a><a class="detail-fullscreen" data-enlarge-image href="${esc(image.image)}" target="_blank" rel="noopener">${icon('expand')}Mostra a schermo intero</a></div></div>
    <div class="detail-info"><div class="detail-info-content">
      <header class="detail-heading"><h2 id="detail-title">${esc(card.name)}</h2></header>
      <dl class="detail-facts">${facts.map(([name, value, markup]) => `<div><dt>${esc(name)}</dt><dd${name === 'Numero' || name === 'Codice' ? ' class="card-number"' : ''}>${markup ? factValue(value) : esc(factValue(value))}</dd></div>`).join('')}
        <div class="language-row"><dt>${versions.length > 1 ? '<label for="image-language">Lingua</label>' : 'Lingua'}</dt><dd>${versions.length > 1 ? `<select id="image-language">${versions.map(version => `<option value="${esc(version.language)}" ${version.language === image.language ? 'selected' : ''}>${esc(languageName(version.language))}</option>`).join('')}</select>` : `<span>${esc(languageName(image.language))}</span>`}</dd></div>
        ${card.game === 'onepiece' ? popupReleaseDateRows(displaySet).map(row => row.empty ? '<div class="release-date-row release-date-spacer" aria-hidden="true"><dt></dt><dd></dd></div>' : `<div class="release-date-row"><dt>${row.region ? `Uscita ${esc(row.region)}` : 'Uscita set'}</dt><dd>${row.date ? dateLabel(row.date) : 'N.D.'}</dd></div>`).join('') : ''}
      </dl>
      ${favoriteMarkup(card, true)}
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
function openBackup() {
  const extra = favoriteIds().size - knownFavorites().length;
  $('#backup-summary').textContent = `${favoriteIds().size} preferiti.${extra ? ` ${extra} fuori dai set attuali restano nel backup.` : ''}`;
  $('#backup-dialog').showModal();
}

document.addEventListener('click', event => {
  const enlarge = event.target.closest('[data-enlarge-image]');
  if (enlarge && window.matchMedia('(max-width: 700px)').matches) {
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
    const target = $('#filters').hidden ? $('.catalog-toolbar') : $('#search');
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
  if (button.dataset.page) { state.page += Number(button.dataset.page); render(); $('.catalog-toolbar').scrollIntoView({ block: 'start' }); return; }
  if (button.dataset.step) return stepCard(Number(button.dataset.step));
  if (button.id === 'reset-filters' || button.dataset.action === 'reset') return resetFilters();
  if (button.id === 'backup-open') return openBackup();
  if (button.id === 'export-backup') {
    const blob = new Blob([JSON.stringify({ ...collection, exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `tcg-art-atlas-preferiti-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Backup esportato');
  }
});
$('#illustrator-search').addEventListener('input', event => { state.artistQuery = event.target.value; renderIllustrators(); });
$('#expansion-search').addEventListener('input', event => { state.expansionQuery = event.target.value; renderExpansions(); });
$('#expansion-language').addEventListener('change', event => { state.expansionLanguage = event.target.value; renderExpansions(); });
$('#expansion-category').addEventListener('change', event => { state.expansionCategory = event.target.value; renderExpansions(); });
$('#reset-expansion-filters').addEventListener('click', () => { state.expansionQuery = ''; state.expansionLanguage = 'all'; state.expansionCategory = 'all'; renderExpansions(); });
$('#search').addEventListener('input', event => { state.query = event.target.value; state.page = 1; render(); });
$('#home-link').addEventListener('click', event => { event.preventDefault(); navigate('catalog'); });
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
    $('#detail-image').alt = `${card.name} — ${card.code} — ${languageName(version.language)}`;
    $$('[data-enlarge-image]').forEach(link => { link.href = version.image; });
  }
});
$('#import-backup').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file || !catalog) return;
  try {
    if (file.size > 2_000_000) throw new Error('Il backup supera i 2 MB.');
    const incoming = validateCollection(JSON.parse(await file.text()));
    collection = mergeCollections(collection, incoming); persist(); render();
    if (storageAvailable) { openBackupSummary(); toast('Backup importato'); }
  } catch (error) { toast(error instanceof SyntaxError ? 'JSON non valido.' : error.message); }
  event.target.value = '';
});
function openBackupSummary() {
  const extra = favoriteIds().size - knownFavorites().length;
  $('#backup-summary').textContent = `${favoriteIds().size} preferiti.${extra ? ` ${extra} fuori dai set attuali restano nel backup.` : ''}`;
}
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
});
document.addEventListener('keydown', event => {
  if ($('#image-dialog').open) return;
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (event.key === '/' && ['catalog', 'favorites'].includes(state.view) && !editing && !$$('dialog[open]').length) { event.preventDefault(); $('#search').focus(); }
  if ($('#card-dialog').open && !editing && !document.activeElement.closest('.variant-list') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); stepCard(event.key === 'ArrowRight' ? 1 : -1); }
  if (event.key === 'Escape') {
    const openFilter = $('.multi-filter[open]');
    if (openFilter) { closeFilterPanels(); $('summary', openFilter).focus(); }
    else if ($('#game-picker').open) $('#game-picker').open = false;
  }
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !catalog) return;
  try { collection = event.newValue ? validateCollection(JSON.parse(event.newValue)) : emptyCollection(); render(); if ($('#card-dialog').open) openCard(currentCardId, 'refresh'); }
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
