export const STORAGE_KEY = 'clist.collection.v1';
export const emptyCollection = () => ({ schemaVersion: 1, favorites: [], notes: {} });
export const normalize = (text) => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export const traitNames = { Grass: 'Erba', Fire: 'Fuoco', Water: 'Acqua', Lightning: 'Elettro', Psychic: 'Psico', Fighting: 'Lotta', Darkness: 'Buio', Metal: 'Acciaio', Dragon: 'Drago', Fairy: 'Folletto', Colorless: 'Incolore', Trainer: 'Allenatore', Energy: 'Energia', Red: 'Rosso', Green: 'Verde', Blue: 'Blu', Purple: 'Viola', Black: 'Nero', Yellow: 'Giallo' };
export const categoryNames = { CHARACTER: 'Personaggio', EVENT: 'Evento', STAGE: 'Stage', LEADER: 'Leader', 'DON!!': 'DON!!' };
export const rarityOrders = {
  pokemon: ['Common', 'Uncommon', 'Rare'],
  onepiece: ['C', 'UC', 'R', 'SR', 'SEC', 'SP CARD', 'L', 'DON!!'],
};
export function orderedRarities(values, game) {
  const order = rarityOrders[game] || [];
  const rank = value => order.includes(value) ? order.indexOf(value) : order.length;
  return [...new Set(values)].sort((a, b) => rank(a) - rank(b));
}
export function cardTraits(card) {
  return card.game === 'pokemon' ? card.types?.length ? card.types : [card.category === 'Trainer' ? 'Trainer' : card.category === 'Energy' ? 'Energy' : 'Unknown'] : card.category === 'DON!!' ? [] : card.colors?.length ? card.colors : ['Unknown'];
}
export function languageImages(card) {
  const versions = card.imageVersions?.length ? card.imageVersions : [{ language: card.imageLanguage || 'und', image: card.image, thumbnail: card.thumbnail }];
  return versions.map(version => ({ ...version, language: version.language === 'jp' ? 'ja' : version.language === 'source' ? 'und' : version.language }));
}
const matchesAny = (selected, values) => !selected || selected === 'all' || (Array.isArray(selected) ? !selected.length || selected.some(value => values.includes(value)) : values.includes(selected));

export function filterCards(cards, filters, favorites = []) {
  const query = normalize(filters.query || '').trim().split(/\s+/).filter(Boolean);
  const result = cards.filter(card =>
    (filters.game === 'all' || card.game === filters.game) &&
    (!filters.illustrator || normalize(card.illustrator || '').trim() === normalize(filters.illustrator).trim()) &&
    matchesAny(filters.categories, [card.category]) &&
    matchesAny(filters.sets ?? filters.set, (card.setIds || [card.setId]).map(set => `${card.game}:${set}`)) &&
    (!filters.art || filters.art === 'all' || card.isAlternative === (filters.art === 'alternative')) &&
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

export function validateCollection(value, knownIds) {
  if (!value || value.schemaVersion !== 1 || !Array.isArray(value.favorites) || value.favorites.some(x => typeof x !== 'string') || !value.notes || typeof value.notes !== 'object' || Array.isArray(value.notes)) {
    throw new Error('Questo file non è un backup CList valido.');
  }
  const ids = knownIds ? new Set(knownIds) : null;
  const notes = {};
  for (const [id, note] of Object.entries(value.notes)) {
    if (typeof note !== 'string' || note.length > 5000) throw new Error('Il backup contiene note non valide (massimo 5.000 caratteri).');
    if (!ids || ids.has(id)) notes[id] = note;
  }
  return { schemaVersion: 1, favorites: [...new Set(value.favorites)].filter(id => !ids || ids.has(id)), notes };
}

export function mergeCollections(current, incoming) {
  return { schemaVersion: 1, favorites: [...new Set([...current.favorites, ...incoming.favorites])], notes: { ...current.notes, ...incoming.notes } };
}
