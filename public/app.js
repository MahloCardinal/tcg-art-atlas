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
  const standardCodes = new Set(cards.filter(card => !card.isAlternative).map(card => `${card.game}:${card.code}`));
  const result = cards.filter(card =>
    (filters.game === 'all' || card.game === filters.game) &&
    (!filters.illustrator || normalize(card.illustrator || '').trim() === normalize(filters.illustrator).trim()) &&
    matchesAny(filters.categories, [card.category]) &&
    matchesAny(filters.sets ?? filters.set, (card.setIds || [card.setId]).map(set => `${card.game}:${set}`)) &&
    (!filters.art || filters.art === 'all' || card.isAlternative === (filters.art === 'alternative') || (filters.art === 'standard' && !standardCodes.has(`${card.game}:${card.code}`))) &&
    matchesAny(filters.rarities ?? filters.rarity, card.rarities || [card.rarity]) &&
    (matchesAny(filters.traits, cardTraits(card)) || (card.game === 'onepiece' && card.category === 'DON!!' && filters.categories?.includes('DON!!'))) &&
    (!filters.onlyFavorites || favorites.includes(card.id)) &&
    query.every(word => normalize([card.name, card.code, ...(card.codes || []), ...(card.numbers || []), card.setName, card.setId, card.illustrator, card.artwork, card.variantLabel].join(' ')).includes(word))
  );
  if (filters.sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'it') || a.id.localeCompare(b.id));
  if (filters.sort === 'recent') result.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  if (filters.sort === 'oldest') result.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
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
function resolveAlias(id, aliases = {}) {
  const seen = new Set();
  while (aliases[id] && !seen.has(id)) { seen.add(id); id = aliases[id]; }
  return id;
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
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5m13-5v5h-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.cards}</svg>`;
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

const state = { game: 'pokemon', view: 'catalog', illustrator: '', artistGame: 'all', query: '', sets: [], categories: [], art: 'standard', rarities: [], traits: [], sort: 'index', page: 1, pageSize: 200, size: 'medium' };
let catalog;
let collection = emptyCollection();
let results = [];
let currentCardId;
let filteredCardIds = [];
let filteredCardIndex = 0;
let toastTimer;
let storageAvailable = true;
const imageLanguages = new Map();
const languageName = code => ({ en: 'Inglese', ja: 'Giapponese', it: 'Italiano', und: 'Non verificata' }[code] || code.toUpperCase());
const gameName = value => value === 'pokemon' ? 'Pokémon' : 'One Piece';
const finishName = value => ({ normal: 'Non holo', holo: 'Holo', reverse: 'Reverse holo' }[value] || value);
const favoriteIds = () => [...new Set(collection.favorites.map(id => resolveAlias(id, catalog.aliases)))];
const knownFavorites = () => catalog.cards.filter(card => favoriteIds().includes(card.id));
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
  const sets = catalog.sets.filter(set => set.game === state.game).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  const cards = catalog.cards.filter(card => card.game === state.game);
  const rarities = orderedRarities(cards.flatMap(card => card.rarities || [card.rarity]), state.game);
  const traits = [...new Set(cards.flatMap(cardTraits))].sort((a, b) => (traitNames[a] || a).localeCompare(traitNames[b] || b, 'it'));
  const checkbox = (key, value, label) => `<label class="check-option"><input type="checkbox" data-filter="${key}" value="${esc(value)}"/><span>${esc(label)}</span></label>`;
  for (const [id, key, options] of [
    ['set-filter', 'sets', sets.map(set => [`${set.game}:${set.id}`, set.game === 'pokemon' ? set.name : `${set.name} (${set.id})`])],
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
  $('#back-to-top').hidden = state.view === 'expansions' || !results.length || window.scrollY < 240 || $('.catalog-toolbar').getBoundingClientRect().bottom > 0;
}
window.addEventListener('scroll', syncBackToTop, { passive: true });
function renderExpansions() {
  const sets = catalog.sets.filter(set => set.game === state.game).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  $('#expansions-title').textContent = `Espansioni ${gameName(state.game)}`;
  $('#expansions-grid').innerHTML = sets.map(set => `<a class="expansion-tile" href="#catalogo/${set.game}/${encodeURIComponent(set.id)}"><div class="expansion-art"><img src="${esc(set.image)}" alt="${esc(set.name)}" width="720" height="400"/></div><div class="expansion-caption"><h3>${esc(set.name)}</h3><span class="expansion-code">${esc(set.game === 'pokemon' ? set.seriesName || set.id : set.id)}</span><time datetime="${esc(set.releaseDate)}">${dateLabel(set.releaseDate)}${set.language ? ` · ${esc(languageName(set.language))}` : ''}</time></div></a>`).join('');
}
function navigate(view, game = state.game, setId) {
  const route = `${view === 'expansions' ? 'espansioni' : view === 'favorites' ? 'preferiti' : 'catalogo'}/${game}${setId ? '/' + encodeURIComponent(setId) : ''}`;
  if (location.hash.slice(1) === route) readRoute(); else location.hash = route;
}
function readRoute() {
  closeFilterPanels();
  $('#game-picker').open = false;
  if ($('#image-dialog').open) $('#image-dialog').close();
  if ($('#card-dialog').open) $('#card-dialog').close();
  const [view, game, rawSet] = location.hash.slice(1).split('/');
  state.view = view === 'illustratore' ? 'illustrator' : view === 'espansioni' ? 'expansions' : view === 'preferiti' ? 'favorites' : 'catalog';
  if (state.view !== 'illustrator' && ['pokemon', 'onepiece'].includes(game)) state.game = game;
  try { state.illustrator = state.view === 'illustrator' ? decodeURIComponent(game || '') : ''; } catch { state.illustrator = ''; }
  state.artistGame = 'all';
  let setId;
  try { setId = decodeURIComponent(rawSet || ''); } catch { setId = ''; }
  Object.assign(state, { query: '', sets: state.view !== 'illustrator' && catalog.sets.some(set => set.game === state.game && set.id === setId) ? [`${state.game}:${setId}`] : [], categories: [], rarities: [], traits: [], art: ['illustrator', 'favorites'].includes(state.view) ? 'all' : 'standard', sort: 'index', page: 1 });
  populateFilters(); render();
  window.scrollTo({ top: 0 });
}
function favoriteMarkup(card, detail = false) {
  const on = favoriteIds().includes(card.id);
  return `<button class="${detail ? 'detail-favorite primary-button' : 'favorite-button'} ${on ? 'is-favorite' : ''}" data-favorite="${esc(card.id)}" aria-label="${on ? 'Rimuovi dai' : 'Aggiungi ai'} preferiti: ${esc(card.name)} — ${esc(card.code)} — ${esc(card.variantLabel)}" aria-pressed="${on}">${icon('heart')}${detail ? `<span>${on ? 'Nei preferiti' : 'Aggiungi ai preferiti'}</span>` : ''}</button>`;
}
function tile(card, index) {
  return `<article class="card-tile"><div class="card-art"><button class="art-open" data-open-card="${esc(card.id)}" aria-label="Apri ${esc(card.name)} — ${esc(card.code)} — ${esc(card.variantLabel)}"><img src="${card.image}" alt="${esc(card.name)} — ${esc(card.variantLabel)}" width="${card.imageWidth}" height="${card.imageHeight}" loading="${index < 12 ? 'eager' : 'lazy'}" decoding="async"/></button>${favoriteMarkup(card)}</div><div class="card-caption"><button class="card-name" data-open-card="${esc(card.id)}">${esc(card.name)}</button></div></article>`;
}
function render() {
  if (!catalog) return;
  $$('[data-game]').forEach(button => { const active = button.dataset.game === state.game; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
  $$('[data-view]').forEach(button => { const active = button.dataset.view === state.view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#favorite-count').textContent = knownFavorites().length;
  $('#home-link').href = `#catalogo/${state.game}`;
  $('#home-link').setAttribute('aria-label', `TCG Art Atlas — Catalogo ${gameName(state.game)}`);
  $('#current-game-logo').src = new URL(`logos/${state.game}_logo.webp`, assetBase).href;
  $('#current-game-logo').alt = state.game === 'pokemon' ? 'Pokémon Trading Card Game' : 'One Piece Card Game';
  const expansions = state.view === 'expansions';
  const artist = state.view === 'illustrator';
  $('#expansions-page').hidden = !expansions;
  $('#cards-page').hidden = expansions;
  $('#filters').hidden = expansions || artist;
  $('.layout').classList.toggle('show-expansions', expansions || artist);
  $('#illustrator-heading').hidden = !artist;
  if (expansions) { renderExpansions(); syncBackToTop(); return; }
  results = groupCardResults(filterCards(catalog.cards, { ...state, game: artist ? state.artistGame : state.game, illustrator: artist ? state.illustrator : '', onlyFavorites: state.view === 'favorites' }, favoriteIds()));
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
      const label = key === 'sets' ? catalog.sets.find(set => `${set.game}:${set.id}` === value)?.name || value : key === 'categories' ? categoryNames[value] || value : key === 'traits' ? traitNames[value] || value : value;
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
  const on = favoriteIds().includes(id);
  collection.favorites = on ? collection.favorites.filter(value => resolveAlias(value, catalog.aliases) !== id) : [...collection.favorites, id];
  persist(); render();
  if ($('#card-dialog').open) $('.detail-favorite').outerHTML = favoriteMarkup(catalog.cards.find(card => card.id === currentCardId), true);
  if (storageAvailable) toast(on ? 'Rimosso dai preferiti' : 'Aggiunto ai preferiti');
}
function openCard(id, mode = 'card') {
  id = resolveAlias(id, catalog.aliases);
  const card = catalog.cards.find(card => card.id === id);
  if (!card) return;
  const previous = catalog.cards.find(card => card.id === currentCardId);
  const variantScroll = previous?.variantGroup === card.variantGroup && $('#card-dialog').open ? $('.variant-list')?.scrollLeft || 0 : 0;
  currentCardId = id;
  const dialog = $('#card-dialog');
  if (mode === 'card') {
    filteredCardIds = results.map(card => card.id);
    filteredCardIndex = Math.max(0, filteredCardIds.indexOf(id));
  }
  dialog.classList.toggle('instant-version', mode === 'variant');
  const variants = catalog.cards.filter(other => other.game === card.game && other.code === card.code);
  const versions = languageImages(card);
  const image = versions.find(version => version.language === imageLanguages.get(id)) || versions[0];
  imageLanguages.set(id, image.language);
  const prints = card.printings || [{ code: card.code, number: card.number, rarity: card.rarity, finishes: card.finishes }];
  const facts = [
    ['Espansione', `<button class="text-button" data-open-set="${esc(card.setId)}" data-set-game="${card.game}">${esc(card.setName)}</button>`, true],
    [card.game === 'pokemon' ? 'Numero' : 'Codice', esc(numbersLabel(card)), true],
    ['Rarità', (card.rarities || [card.rarity]).join(' / ')],
    ...(card.illustrator ? [['Illustratore', `<a href="#illustratore/${encodeURIComponent(card.illustrator)}" data-illustrator="${esc(card.illustrator)}">${esc(card.illustrator)}</a>`, true]] : []),
    ...(card.game === 'onepiece' ? [['Uscita set', dateLabel(card.releaseDate)]] : []),
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
      <dl class="detail-facts">${facts.map(([name, value, markup]) => `<div><dt>${esc(name)}</dt><dd${name === 'Numero' || name === 'Codice' ? ' class="card-number"' : ''}>${markup ? value : esc(value)}</dd></div>`).join('')}
        <div class="language-row"><dt>${versions.length > 1 ? '<label for="image-language">Lingua</label>' : 'Lingua'}</dt><dd>${versions.length > 1 ? `<select id="image-language">${versions.map(version => `<option value="${esc(version.language)}" ${version.language === image.language ? 'selected' : ''}>${esc(languageName(version.language))}</option>`).join('')}</select>` : `<span>${esc(languageName(image.language))}</span>`}</dd></div>
      </dl>
      ${favoriteMarkup(card, true)}
        ${variants.length > 1 || printVersions.length ? `<section class="variants" aria-label="Versioni della carta"><h3>Versioni</h3>${printVersions.length ? `<ul class="print-versions">${printVersions.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : ''}${variants.length > 1 ? `<div class="variant-list" tabindex="0" aria-label="Artwork disponibili">${variants.map(other => `<button class="variant-thumb ${other.id === id ? 'selected' : ''}" data-variant="${esc(other.id)}" title="${esc(other.variantLabel)}" aria-label="${esc(other.variantLabel)} — ${esc(other.code)}" aria-pressed="${other.id === id}"><img src="${esc(other.image)}" alt="" loading="lazy"/><span>${esc(other.variantLabel)}</span></button>`).join('')}</div>` : ''}</section>` : ''}
      ${card.artworkOrigin?.status === 'unverified' || card.reviewNote ? `<aside class="review-note" aria-label="Note temporanee di verifica"><h3>NOTE</h3><p>${esc(card.reviewNote || 'Illustrazione presente nell’archivio immagini, ma non ancora associata a una pubblicazione ufficiale verificabile. Provenienza in verifica.')}</p></aside>` : ''}
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
  const extra = favoriteIds().length - knownFavorites().length;
  $('#backup-summary').textContent = `${favoriteIds().length} preferiti.${extra ? ` ${extra} fuori dai set attuali restano nel backup.` : ''}`;
  $('#backup-dialog').showModal();
}

document.addEventListener('click', event => {
  const enlarge = event.target.closest('[data-enlarge-image]');
  if (enlarge && window.matchMedia('(max-width: 700px)').matches) {
    event.preventDefault();
    const image = $('#detail-image');
    $('#fullscreen-image').src = image.src;
    $('#fullscreen-image').alt = image.alt;
    $('#image-dialog').showModal();
    return;
  }
  const artist = event.target.closest('[data-illustrator]');
  if (artist) {
    event.preventDefault();
    state.game = catalog.cards.find(card => card.id === currentCardId)?.game || state.game;
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
    const target = $('#filters').hidden ? $('.catalog-toolbar') : $('#search');
    target.focus({ preventScroll: true });
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    return;
  }
  if (button.dataset.favorite) return toggleFavorite(button.dataset.favorite);
  if (button.dataset.variant) return openCard(button.dataset.variant, 'variant');
  if (button.dataset.openCard) return openCard(button.dataset.openCard);
  if (button.dataset.game) return navigate(state.view === 'illustrator' ? 'catalog' : state.view, button.dataset.game);
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
    const version = languageImages(card).find(version => version.language === input.value);
    if (!version) return;
    imageLanguages.set(card.id, version.language);
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
  const extra = favoriteIds().length - knownFavorites().length;
  $('#backup-summary').textContent = `${favoriteIds().length} preferiti.${extra ? ` ${extra} fuori dai set attuali restano nel backup.` : ''}`;
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
    const setNames = new Map(catalogData.sets.map(set => [`${set.game}:${set.id}`, set.name]));
    catalog = { ...catalogData, cards: catalogData.cards.map(card => ({
      ...card,
      setName: setNames.get(`${card.game}:${card.setId}`),
      image: new URL(card.image.replace(/^\//, ''), assetBase).href,
      imageVersions: card.imageVersions?.map(version => ({ ...version, image: new URL(version.image.replace(/^\//, ''), assetBase).href })),
    })), sets: catalogData.sets.map(set => ({ ...set, image: new URL(set.image.replace(/^\//, ''), assetBase).href })) };
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
