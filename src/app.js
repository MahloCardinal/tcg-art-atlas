import { STORAGE_KEY, emptyCollection, filterCards, validateCollection, mergeCollections, cardTraits, traitNames, categoryNames, orderedRarities, languageImages } from './core.js';

export function startApp(catalogData, assetBase) {
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const shapes = {
  cards: '<rect x="6" y="3" width="13" height="18" rx="2"/><path d="M3 6v14a2 2 0 0 0 2 2"/><path d="m10 10 2-3 3 3-3 4Z"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  upload: '<path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  left: '<path d="m15 5-7 7 7 7"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>',
  expand: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5m13-5v5h-5"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shapes[name] || shapes.cards}</svg>`;
$$('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });

const state = { game: 'pokemon', view: 'catalog', illustrator: '', artistGame: 'all', filtersCollapsed: false, query: '', sets: [], categories: [], art: 'standard', rarities: [], traits: [], sort: 'index', page: 1, pageSize: 60, size: 'medium' };
let catalog;
let collection = emptyCollection();
let results = [];
let currentCardId;
let toastTimer;
let storageAvailable = true;
const imageLanguages = new Map();
const languageName = code => ({ en: 'Inglese', ja: 'Giapponese', und: 'Non verificata' }[code] || code.toUpperCase());
const gameName = value => value === 'pokemon' ? 'Pokémon' : 'One Piece';
const finishName = value => ({ normal: 'Non holo', holo: 'Holo', reverse: 'Reverse holo' }[value] || value);
const knownFavorites = () => catalog.cards.filter(card => collection.favorites.includes(card.id));
const numbersLabel = card => card.game === 'pokemon' ? '#' + (card.numbers || [card.number]).join(' / ') : card.code;
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
    ['set-filter', 'sets', sets.map(set => [`${set.game}:${set.id}`, `${set.name} (${set.id})`])],
    ['category-filter', 'categories', Object.entries(categoryNames).filter(([value]) => cards.some(card => card.category === value))],
    ['rarity-filter', 'rarities', rarities.map(value => [value, value])],
    ['type-filter', 'traits', traits.map(value => [value, traitNames[value] || 'Non indicato'])],
  ]) {
    $('.filter-options', document.getElementById(id)).innerHTML = checkbox(key, 'all', 'Tutti') + options.map(([value, label]) => checkbox(key, value, label)).join('');
  }
  $('#type-filter-label').textContent = state.game === 'pokemon' ? 'Tipo' : 'Colore';
  $('#category-filter').hidden = state.game !== 'onepiece';
  $('#type-filter .filter-options').setAttribute('aria-label', state.game === 'pokemon' ? 'Tipi Pokémon' : 'Colori One Piece');
  $('#expansion-list-link').href = `#espansioni/${state.game}`;
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
  }
}
function closeFilterPanels(except) {
  $$('.multi-filter[open]').forEach(panel => { if (panel !== except) panel.open = false; });
}
function positionFilterPanel(filter) {
  const anchor = $('summary', filter).getBoundingClientRect();
  const panel = $('.filter-options', filter);
  const width = Math.min(280, Math.max(220, anchor.width), window.innerWidth - 20);
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
function setFiltersOpen(open) {
  closeFilterPanels();
  if (window.matchMedia('(max-width: 700px)').matches) $('#filters').classList.toggle('open', open);
  else state.filtersCollapsed = !open;
  syncFilterPanel();
}
function syncFilterPanel() {
  const mobile = window.matchMedia('(max-width: 700px)').matches;
  const visible = mobile ? $('#filters').classList.contains('open') : !state.filtersCollapsed;
  $('.layout').classList.toggle('filters-collapsed', state.filtersCollapsed);
  $('#filters-open').setAttribute('aria-expanded', String(visible));
  $('#filters-open').hidden = state.view === 'illustrator' || (!mobile && visible);
}
window.addEventListener('resize', syncFilterPanel);
window.addEventListener('resize', () => closeFilterPanels());
window.addEventListener('scroll', event => {
  if (!(event.target instanceof Element) || !event.target.closest('.filter-options')) closeFilterPanels();
}, true);
function renderExpansions() {
  const sets = catalog.sets.filter(set => set.game === state.game).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  $('#expansions-title').textContent = `Espansioni ${gameName(state.game)}`;
  $('#expansions-grid').innerHTML = sets.map(set => `<a class="expansion-tile" href="#catalogo/${set.game}/${encodeURIComponent(set.id)}"><div class="expansion-art"><img src="${esc(set.image)}" alt="${esc(set.name)}" width="720" height="400"/></div><div class="expansion-caption"><h3>${esc(set.name)}</h3><span class="expansion-code">${esc(set.game === 'pokemon' ? set.seriesName || set.id : set.id)}</span><time datetime="${esc(set.releaseDate)}">${dateLabel(set.releaseDate)}</time></div></a>`).join('');
}
function navigate(view, game = state.game, setId) {
  const route = `${view === 'expansions' ? 'espansioni' : view === 'favorites' ? 'preferiti' : 'catalogo'}/${game}${setId ? '/' + encodeURIComponent(setId) : ''}`;
  if (location.hash.slice(1) === route) readRoute(); else location.hash = route;
}
function readRoute() {
  closeFilterPanels();
  $('#game-picker').open = false;
  if ($('#card-dialog').open) $('#card-dialog').close();
  const [view, game, rawSet] = location.hash.slice(1).split('/');
  state.view = view === 'illustratore' ? 'illustrator' : view === 'espansioni' ? 'expansions' : view === 'preferiti' ? 'favorites' : 'catalog';
  if (state.view !== 'illustrator' && ['pokemon', 'onepiece'].includes(game)) state.game = game;
  try { state.illustrator = state.view === 'illustrator' ? decodeURIComponent(game || '') : ''; } catch { state.illustrator = ''; }
  state.artistGame = 'all';
  let setId;
  try { setId = decodeURIComponent(rawSet || ''); } catch { setId = ''; }
  Object.assign(state, { query: '', sets: state.view !== 'illustrator' && catalog.sets.some(set => set.game === state.game && set.id === setId) ? [`${state.game}:${setId}`] : [], categories: [], rarities: [], traits: [], art: state.view === 'illustrator' ? 'all' : 'standard', sort: 'index', page: 1 });
  $('#filters').classList.remove('open');
  $('#filters-open').setAttribute('aria-expanded', 'false');
  populateFilters(); render();
  window.scrollTo({ top: 0 });
}
function favoriteMarkup(card, detail = false) {
  const on = collection.favorites.includes(card.id);
  return `<button class="${detail ? 'detail-favorite primary-button' : 'favorite-button'} ${on ? 'is-favorite' : ''}" data-favorite="${esc(card.id)}" aria-label="${on ? 'Rimuovi dai' : 'Aggiungi ai'} preferiti: ${esc(card.name)} — ${esc(card.code)} — ${esc(card.variantLabel)}" aria-pressed="${on}">${icon('heart')}${detail ? `<span>${on ? 'Nei preferiti' : 'Aggiungi ai preferiti'}</span>` : ''}</button>`;
}
function tile(card, index) {
  return `<article class="card-tile"><div class="card-art"><button class="art-open" data-open-card="${esc(card.id)}" aria-label="Apri ${esc(card.name)} — ${esc(card.code)} — ${esc(card.variantLabel)}"><img src="${card.thumbnail}" alt="${esc(card.name)} — ${esc(card.variantLabel)}" width="${card.imageWidth}" height="${card.imageHeight}" loading="${index < 12 ? 'eager' : 'lazy'}" decoding="async"/></button>${favoriteMarkup(card)}</div><div class="card-caption"><button class="card-name" data-open-card="${esc(card.id)}">${esc(card.name)}</button></div></article>`;
}
function render() {
  if (!catalog) return;
  $$('[data-game]').forEach(button => { const active = button.dataset.game === state.game; button.classList.toggle('active', active); button.setAttribute('aria-pressed', active); });
  $$('[data-view]').forEach(button => { const active = button.dataset.view === state.view; button.classList.toggle('active', active); if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current'); });
  $('#favorite-count').textContent = knownFavorites().length;
  $('#home-link').href = `#catalogo/${state.game}`;
  $('#home-link').setAttribute('aria-label', `CList — Catalogo ${gameName(state.game)}`);
  $('#current-game-logo').src = new URL(`images/games/${state.game}.webp`, assetBase).href;
  $('#current-game-logo').alt = state.game === 'pokemon' ? 'Pokémon Trading Card Game' : 'One Piece Card Game';
  const expansions = state.view === 'expansions';
  const artist = state.view === 'illustrator';
  $('#expansions-page').hidden = !expansions;
  $('#cards-page').hidden = expansions;
  $('#filters').hidden = expansions || artist;
  $('.layout').classList.toggle('show-expansions', expansions || artist);
  $('#illustrator-heading').hidden = !artist;
  syncFilterPanel();
  if (expansions) { renderExpansions(); return; }
  results = filterCards(catalog.cards, { ...state, game: artist ? state.artistGame : state.game, illustrator: artist ? state.illustrator : '', onlyFavorites: state.view === 'favorites' }, collection.favorites);
  if (artist) {
    $('#illustrator-title').textContent = state.illustrator || 'Illustratore';
    const all = filterCards(catalog.cards, { game: 'all', illustrator: state.illustrator });
    const games = ['all', ...['pokemon', 'onepiece'].filter(game => all.some(card => card.game === game))];
    $('#illustrator-games').innerHTML = games.map(game => `<button class="secondary-button ${state.artistGame === game ? 'active' : ''}" data-artist-game="${game}" aria-pressed="${state.artistGame === game}">${game === 'all' ? 'Tutti i giochi' : gameName(game)} <span>${game === 'all' ? all.length : all.filter(card => card.game === game).length}</span></button>`).join('');
  }
  const pages = Math.max(1, Math.ceil(results.length / state.pageSize));
  state.page = Math.max(1, Math.min(state.page, pages));
  const start = (state.page - 1) * state.pageSize;
  const page = results.slice(start, start + state.pageSize);
  const codes = new Set(results.flatMap(card => card.codes || [card.code]));
  $('#results-count').innerHTML = `<strong>${results.length}</strong> ${results.length === 1 ? 'immagine' : 'immagini'} <span class="results-secondary">· ${codes.size} ${codes.size === 1 ? 'numero carta' : 'numeri carta'}${state.view === 'favorites' ? ' · Preferiti' : ''}</span>`;
  $('#gallery').dataset.size = state.size;
  $('#gallery').innerHTML = page.map((card, index) => `${artist && (index === 0 || page[index - 1].game !== card.game) ? `<h3 class="gallery-game-heading">${esc(gameName(card.game))}</h3>` : ''}${tile(card, index)}`).join('');
  $('#page-info').textContent = results.length ? `${start + 1}–${Math.min(start + state.pageSize, results.length)} / ${results.length}` : '0';
  $('#page-info-bottom').textContent = `${state.page} / ${pages}`;
  $$('[data-page]').forEach(button => { button.disabled = Number(button.dataset.page) < 0 ? state.page <= 1 : state.page >= pages; });
  $('#page-bottom').hidden = pages < 2;
  $('#empty-state').hidden = !!results.length;
  if (!results.length) $('#empty-state').innerHTML = `<p>${state.view === 'favorites' && !knownFavorites().length ? 'Nessun preferito nei set attuali.' : 'Nessuna carta trovata.'}</p><button class="secondary-button" data-action="reset">Azzera filtri</button>`;
}
function resetFilters() {
  Object.assign(state, { query: '', sets: [], categories: [], art: 'standard', rarities: [], traits: [], sort: 'index', page: 1 });
  populateFilters(); render();
}
function toggleFavorite(id) {
  const on = collection.favorites.includes(id);
  collection.favorites = on ? collection.favorites.filter(value => value !== id) : [...collection.favorites, id];
  persist(); render();
  if ($('#card-dialog').open) $('.detail-favorite').outerHTML = favoriteMarkup(catalog.cards.find(card => card.id === currentCardId), true);
  if (storageAvailable) toast(on ? 'Rimosso dai preferiti' : 'Aggiunto ai preferiti');
}
function openCard(id) {
  const card = catalog.cards.find(card => card.id === id);
  if (!card) return;
  const previous = catalog.cards.find(card => card.id === currentCardId);
  const variantScroll = previous?.variantGroup === card.variantGroup && $('#card-dialog').open ? $('.variant-list')?.scrollLeft || 0 : 0;
  currentCardId = id;
  const dialog = $('#card-dialog');
  const variants = catalog.cards.filter(other => other.variantGroup === card.variantGroup);
  const versions = languageImages(card);
  const image = versions.find(version => version.language === imageLanguages.get(id)) || versions[0];
  imageLanguages.set(id, image.language);
  const prints = card.printings || [{ code: card.code, number: card.number, rarity: card.rarity, finishes: card.finishes }];
  const position = results.findIndex(other => other.id === id);
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
    <div class="detail-art"><div class="detail-image-frame"><img id="detail-image" src="${esc(image.image)}" width="420" height="588" alt="${esc(card.name)} — ${esc(card.code)} — ${esc(languageName(image.language))}"/></div></div>
    <div class="detail-info"><div class="detail-info-content">
      <header class="detail-heading"><h2 id="detail-title">${esc(card.name)}</h2></header>
      <dl class="detail-facts">${facts.map(([name, value, markup]) => `<div><dt>${esc(name)}</dt><dd${name === 'Numero' || name === 'Codice' ? ' class="card-number"' : ''}>${markup ? value : esc(value)}</dd></div>`).join('')}
        <div class="language-row"><dt>${versions.length > 1 ? '<label for="image-language">Lingua</label>' : 'Lingua'}</dt><dd>${versions.length > 1 ? `<select id="image-language">${versions.map(version => `<option value="${esc(version.language)}" ${version.language === image.language ? 'selected' : ''}>${esc(languageName(version.language))}</option>`).join('')}</select>` : `<span>${esc(languageName(image.language))}</span>`}</dd></div>
      </dl>
      ${favoriteMarkup(card, true)}
        ${variants.length > 1 || printVersions.length ? `<section class="variants" aria-label="Versioni della carta"><h3>Versioni</h3>${printVersions.length ? `<ul class="print-versions">${printVersions.map(value => `<li>${esc(value)}</li>`).join('')}</ul>` : ''}${variants.length > 1 ? `<div class="variant-list" tabindex="0" aria-label="Artwork disponibili">${variants.map(other => `<button class="variant-thumb ${other.id === id ? 'selected' : ''}" data-open-card="${esc(other.id)}" title="${esc(other.variantLabel)}" aria-label="${esc(other.variantLabel)} — ${esc(other.code)}" aria-pressed="${other.id === id}"><img src="${esc(other.thumbnail)}" alt="" loading="lazy"/><span>${esc(other.variantLabel)}</span></button>`).join('')}</div>` : ''}</section>` : ''}
    </div><footer class="detail-navigation"><button class="secondary-button" data-step="-1" ${results.length < 2 ? 'disabled' : ''}>Precedente</button><span>${position >= 0 ? `${position + 1} / ${results.length}` : 'Artwork correlato'}</span><button class="secondary-button" data-step="1" ${results.length < 2 ? 'disabled' : ''}>Successiva</button></footer></div></div>`;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  $('.detail-info-content').scrollTop = 0;
  if ($('.variant-list')) $('.variant-list').scrollLeft = variantScroll;
  $('.detail-close').focus({ preventScroll: true });
}
function stepCard(delta) {
  if (!results.length) return;
  const index = results.findIndex(card => card.id === currentCardId);
  openCard(results[(index + delta + results.length) % results.length].id);
}
function openBackup() {
  const extra = collection.favorites.length - knownFavorites().length;
  $('#backup-summary').textContent = `${collection.favorites.length} preferiti.${extra ? ` ${extra} fuori dai set attuali restano nel backup.` : ''}`;
  $('#backup-dialog').showModal();
}

document.addEventListener('click', event => {
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
  if (button.id === 'filters-open' || button.id === 'filters-close') return setFiltersOpen(button.id === 'filters-open');
  if (!catalog) return;
  if (button.dataset.favorite) return toggleFavorite(button.dataset.favorite);
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
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `clist-preferiti-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Backup esportato');
  }
});
$('#search').addEventListener('input', event => { state.query = event.target.value; state.page = 1; render(); });
$('#home-link').addEventListener('click', event => { event.preventDefault(); navigate('catalog'); });
$('#page-size').addEventListener('change', event => {
  const size = Number(event.target.value);
  if ([30, 60, 120].includes(size)) { state.pageSize = size; state.page = 1; render(); }
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
  const extra = collection.favorites.length - knownFavorites().length;
  $('#backup-summary').textContent = `${collection.favorites.length} preferiti.${extra ? ` ${extra} fuori dai set attuali restano nel backup.` : ''}`;
}
$$('dialog').forEach(dialog => {
  dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
});
document.addEventListener('keydown', event => {
  const editing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (event.key === '/' && ['catalog', 'favorites'].includes(state.view) && !editing && !$$('dialog[open]').length) { event.preventDefault(); setFiltersOpen(true); $('#search').focus(); }
  if ($('#card-dialog').open && !editing && !document.activeElement.closest('.variant-list') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); stepCard(event.key === 'ArrowRight' ? 1 : -1); }
  if (event.key === 'Escape') {
    const openFilter = $('.multi-filter[open]');
    if (openFilter) { closeFilterPanels(); $('summary', openFilter).focus(); }
    else if ($('#game-picker').open) $('#game-picker').open = false;
    else if (window.matchMedia('(max-width: 700px)').matches) setFiltersOpen(false);
  }
});
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || !catalog) return;
  try { collection = event.newValue ? validateCollection(JSON.parse(event.newValue)) : emptyCollection(); render(); if ($('#card-dialog').open) openCard(currentCardId); }
  catch { toast('Impossibile leggere la selezione aggiornata.'); }
});
window.addEventListener('hashchange', () => { if (catalog && location.hash !== '#gallery') readRoute(); });
function initialize() {
  try {
    catalog = { ...catalogData, cards: catalogData.cards.map(card => ({
      ...card,
      image: new URL(card.image.replace(/^\//, ''), assetBase).href,
      thumbnail: new URL(card.thumbnail.replace(/^\//, ''), assetBase).href,
      imageVersions: card.imageVersions?.map(version => ({ ...version, image: new URL(version.image.replace(/^\//, ''), assetBase).href, thumbnail: new URL((version.thumbnail || version.image).replace(/^\//, ''), assetBase).href })),
    })), sets: catalogData.sets.map(set => ({ ...set, image: new URL(set.image.replace(/^\//, ''), assetBase).href })) };
    try { const value = localStorage.getItem(STORAGE_KEY); if (value) collection = validateCollection(JSON.parse(value)); }
    catch { toast('Preferiti non leggibili. Puoi ripristinare un backup.'); }
    readRoute();
  } catch (error) {
    $('#results-count').textContent = 'Catalogo non disponibile'; $('#empty-state').hidden = false;
    $('#empty-state').innerHTML = '<p>Impossibile leggere il catalogo. Riapri index.html dalla cartella CList completa.</p>'; console.error(error);
  }
}
initialize();
}
