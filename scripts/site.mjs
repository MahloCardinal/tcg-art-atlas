import http from 'node:http';
import path from 'node:path';
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Script, createContext, runInContext } from 'node:vm';
import assert from 'node:assert/strict';
import {handleObservationRequest,saveObservation} from './review-notes.mjs';

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
  const audit = JSON.parse(await readFile(path.join(root, 'CARD_REVIEW.json'), 'utf8'));
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
    for (const key of ['reviewNote', 'artworkOrigin', 'imageHasSample', 'sourceUrl', 'sourceImageUrl', 'printSources', 'catalogReference', 'illustratorAttribution']) assert.ok(!(key in card), `Metadato interno nel frontend: ${card.id}/${key}`);
    if (card.imageVersions?.length) {
      const languages = card.imageVersions.map(image => image.language);
      assert.equal(new Set(languages).size, languages.length, `Lingua duplicata: ${card.id}`);
      assert.ok(card.imageVersions.some(image => image.image === card.image), `Immagine principale fuori dalle versioni: ${card.id}`);
    }
    if (card.productVersions) {
      assert.equal(card.game, 'onepiece');
      const products = new Set();
      for (const version of card.productVersions) {
        assert.ok(!products.has(version.setId), `Prodotto duplicato: ${card.id}/${version.setId}`);
        products.add(version.setId);
        assert.ok((card.setIds || [card.setId]).includes(version.setId), `Edizione senza appartenenza: ${card.id}/${version.setId}`);
        assert.ok(!sets.get(`${card.game}:${version.setId}`).collection, `Raccolta trattata come edizione fisica: ${card.id}`);
        assert.ok(version.languages.length && new Set(version.languages).size === version.languages.length);
        const sources = audit.cards[card.id].metadata.printSources;
        for (const language of version.languages) {
          assert.ok((card.imageVersions || [{language:card.imageLanguage}]).some(image => image.language === language), `Lingua immagine mancante: ${card.id}`);
          assert.ok(sources.some(source => source.setId === version.setId && source.region === language), `Lingua prodotto non verificata: ${card.id}/${version.setId}/${language}`);
        }
      }
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
    if (set.image) images.add(set.image);
    if (set.symbol) images.add(set.symbol);
    if (set.imageFit) {
      const { viewBox: [x, y, width, height], width: canvasWidth, height: canvasHeight } = set.imageFit;
      assert.ok([x, y, width, height, canvasWidth, canvasHeight].every(Number.isFinite), `Riquadro immagine non valido: ${set.id}`);
      assert.ok(x >= 0 && y >= 0 && width > 0 && height > 0 && x + width <= canvasWidth && y + height <= canvasHeight, `Riquadro fuori dall’immagine: ${set.id}`);
    }
    assert.ok(set.group, `Gruppo mancante: ${set.id}`);
    const members = catalog.cards.filter(card => card.game === set.game && (card.setIds || [card.setId]).includes(set.id));
    assert.ok(members.length, `Anteprima mancante: ${set.game}/${set.id}`);
    const codes = new Set(members.filter(card => card.category !== 'DON!!').flatMap(card => card.codes || [card.code]));
    const inventory = audit.sets[`${set.game}:${set.id}`];
    if (inventory.preview) assert.equal(members.length, 1, `Il set di anteprima deve contenere solo la prima carta: ${set.id}`);
    if (inventory.expectedCodeList) for (const code of inventory.expectedCodeList) assert.ok(codes.has(code), `Codice mancante in ${set.id}: ${code}`);
    else if (inventory.expectedCodes) assert.equal(codes.size, inventory.expectedCodes, `Set incompleto: ${set.id}`);
  }
  for (const [alias, target] of Object.entries(catalog.aliases || {})) {
    assert.ok(!ids.has(alias), `Alias ancora presente come carta: ${alias}`);
    const visited = new Set([alias]); let resolved = target;
    while (catalog.aliases[resolved]) { assert.ok(!visited.has(resolved), `Ciclo alias: ${alias}`); visited.add(resolved); resolved = catalog.aliases[resolved]; }
    assert.ok(ids.has(resolved), `Destinazione alias mancante: ${alias}`);
  }
  for (const [alias, target] of Object.entries(catalog.setAliases || {})) {
    assert.ok(!setKeys.has(alias), `Alias set ancora pubblicato: ${alias}`);
    assert.ok(setKeys.has(target), `Destinazione alias set mancante: ${alias}`);
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
  return { catalog, app, audit };
}

async function test() {
  const { catalog, app, audit } = await check();
  const context = createContext({ URL, Intl });
  new Script(app).runInContext(context);
  const { cardArtworkKey, canonicalRarity, cardRarities, orderedTraits, hasCatalogFilters, hasExpansionFilters, validListName, portableList, pageNumber, listExportFilename, filterCards, groupCardResults, cardVariants, cardProductImages, cardPopupVersions, selectPopupVersion, cardDisplaySet, groupExpansionSets, formatSetName, setFilterLabel, setPreviewTitle, setFullLabel, releaseDateRows, popupReleaseDateRows, factValue, compareExpansionDates, filterExpansionSets, expansionTiles, catalogSetSelections, prereleaseSetCode, expansionCategoryMap, indexIllustrators, filterIllustrators, indexFavorites, setDisplayLabels, resolveAlias, validateCollection, mergeCollections, emptyCollection, languageImages, loadCollection, validateLibrary, emptyLibrary, listContent, importListContent, assignFavoriteLists, visibleCardResults, orderedRarities, STORAGE_KEY, LEGACY_STORAGE_KEYS } = runInContext('({cardArtworkKey,canonicalRarity,cardRarities,orderedTraits,hasCatalogFilters,hasExpansionFilters,validListName,portableList,pageNumber,listExportFilename,filterCards,groupCardResults,cardVariants,cardProductImages,cardPopupVersions,selectPopupVersion,cardDisplaySet,groupExpansionSets,formatSetName,setFilterLabel,setPreviewTitle,setFullLabel,releaseDateRows,popupReleaseDateRows,factValue,compareExpansionDates,filterExpansionSets,expansionTiles,catalogSetSelections,prereleaseSetCode,expansionCategoryMap,indexIllustrators,filterIllustrators,indexFavorites,setDisplayLabels,resolveAlias,validateCollection,mergeCollections,emptyCollection,languageImages,loadCollection,validateLibrary,emptyLibrary,listContent,importListContent,assignFavoriteLists,visibleCardResults,orderedRarities,STORAGE_KEY,LEGACY_STORAGE_KEYS})', context);
  // Compact lists keep exact artworks in portable JSON and validate names only on edit.
  for (const name of ['Preferiti','Pokemon-1','A_B.C,D','Pokémon']) assert.ok(validListName(name));
  for (const name of ['', 'Due parole','1234567890123456','A/B','A!']) assert.ok(!validListName(name));
  const portableCards=[{id:'pk-a',game:'pokemon',code:'A-1'},{id:'pk-b',game:'pokemon',code:'A-1',isAlternative:true}];
  const portable=portableList({name:'Belle',favorites:['pk-b','old-b','pending'],notes:{}},portableCards,{'old-b':'pk-b'});
  assert.deepEqual(JSON.parse(JSON.stringify(portable)),{name:'Belle',cards:[{code:'A-1',variant:'pk-b'},{code:null,variant:'pending'}]});
  const portableLibrary={schemaVersion:2,lists:[{id:'target',name:'Target',favorites:[],notes:{keep:'original'}}],defaultListId:null};
  const restoredPortable=importListContent(portableLibrary,'target',portable,portableCards,{'old-b':'pk-b'});
  assert.deepEqual(Array.from(restoredPortable.lists[0].favorites),['pk-b','pending']);
  assert.equal(restoredPortable.lists[0].name,'Target');
  assert.equal(restoredPortable.lists[0].notes.keep,'original');
  assert.equal(importListContent(restoredPortable,'target',portable,portableCards).lists[0].favorites.length,2);
  assert.throws(()=>importListContent(portableLibrary,'target',{name:'X',cards:[{code:'wrong',variant:'pk-a'}]},portableCards));
  assert.deepEqual(Array.from(orderedRarities(['Common','Common (C)','Uncommon (U)','Uncommon','Double Rare (RR)','Double Rare'],'pokemon')),['Common','Uncommon','Double Rare']);
  assert.equal(filterCards([{id:'x',game:'pokemon',rarity:'Common (C)'}],{game:'pokemon',rarities:['Common']}).length,1);
  assert.deepEqual(Array.from(orderedTraits(['Energy','Unknown','Trainer','Fire','Stadium','Water'],'pokemon')),['Water','Fire','Trainer','Stadium','Energy','Unknown']);
  assert.equal(hasCatalogFilters({query:' ',art:'standard',sets:[],sort:'name'}),false);
  for (const filter of [{query:'x'},{art:'all'},{sets:['x']},{rarities:['Common']}]) assert.equal(hasCatalogFilters(filter),true);
  assert.equal(hasExpansionFilters({expansionQuery:' ',expansionLanguage:'en',expansionCategory:'expansion'}),false);
  assert.equal(hasExpansionFilters({expansionQuery:'',expansionLanguage:'ja',expansionCategory:'expansion'}),true);
  const resetState={query:'',sets:[],categories:[],rarities:[],traits:[],art:'standard',sort:'name',page:3};
  const resetContext=createContext({state:resetState,hasCatalogFilters,populateFilters(){throw new Error('Reset senza modifiche');},render(){throw new Error('Render non necessario');}});
  new Script(app.slice(app.indexOf('function resetFilters()'),app.indexOf('function activeList()'))).runInContext(resetContext);
  runInContext('resetFilters()',resetContext);assert.equal(resetState.page,3);assert.equal(resetState.sort,'name');
  // Favorites render independently of hidden catalog filters, including alternate art.
  const favoriteSamples=[
    {id:'base',game:'pokemon',code:'T-1',name:'Base',setId:'T'},
    {id:'alt',game:'pokemon',code:'T-1',name:'Alternative',setId:'T',isAlternative:true},
    {id:'op',game:'onepiece',code:'OP01-001',name:'One Piece',setId:'OP01'},
  ];
  const selectedList={id:'test',favorites:favoriteSamples.map(card=>card.id)};
  const viewNodes=new Map();
  const viewNode=selector=>{
    if(!viewNodes.has(selector)) viewNodes.set(selector,{classList:{toggle(){}},setAttribute(){},dataset:{}});
    return viewNodes.get(selector);
  };
  const favoriteView=createContext({
    catalog:{cards:favoriteSamples,aliases:{}},collection:{lists:[selectedList]},activeList:()=>selectedList,
    state:{view:'favorites',game:'pokemon',query:'must not match',sets:['pokemon:missing'],rarities:['missing'],traits:['missing'],categories:['missing'],art:'standard',sort:'name',page:1,pageSize:200},
    favoriteIndex:{},indexFavorites,filterCards,visibleCardResults,
    $:viewNode,$$:()=>[],gameName:game=>game,assetBase:'http://localhost/',URL,
    syncMobileFilters(){},renderFavoriteLists(){},renderFilterChips(){},syncBackToTop(){},
    tile:card=>card.id,icon:()=>'',results:[],
  });
  favoriteView.favoriteIds=()=>favoriteView.favoriteIndex.ids;
  favoriteView.knownFavorites=()=>favoriteView.favoriteIndex.known;
  new Script(app.slice(app.indexOf('function render()'),app.indexOf('function renderFilterChips()'))).runInContext(favoriteView);
  runInContext('render()',favoriteView);
  assert.deepEqual(Array.from(favoriteView.results,card=>card.id),['base','alt']);
  assert.equal(viewNode('#filters').hidden,true);
  favoriteView.state.game='onepiece';runInContext('render()',favoriteView);
  assert.deepEqual(Array.from(favoriteView.results,card=>card.id),['op']);
  selectedList.favorites=[];runInContext('render()',favoriteView);
  assert.equal(favoriteView.results.length,0);
  assert.ok(!viewNode('#empty-state').innerHTML.includes('Azzera filtri'));
  // End favorites render regression.
  // Numeric page entry keeps a valid page even for pasted or out-of-range values.
  assert.equal(pageNumber('12',49,3),12);
  assert.equal(pageNumber('999',49,3),49);
  assert.equal(pageNumber('0',49,3),1);
  for (const value of ['', 'abc', '1.5', '-2', '1e2']) assert.equal(pageNumber(value,49,3),3);
  assert.equal(pageNumber('2',0,1),1);
  assert.equal(listExportFilename('Carte preferite'), 'Carte preferite_TCGArtAtlas.json');
  assert.equal(listExportFilename('Mie / Carte'), 'Mie _ Carte_TCGArtAtlas.json');
  assert.deepEqual(Array.from(orderedRarities(['','C',null,'  ','R',undefined,'C'],'onepiece')),['C','R']);
  for (const game of ['pokemon','onepiece']) {
    const samples=[2,10,1].map(number=>({id:String(number),game,code:`X-${number}`,number:String(number),name:({1:'Alpha',2:'Beta',10:'Omega'})[number]}));
    assert.deepEqual(Array.from(filterCards(samples,{game,sort:'index-desc'}),card=>card.number),['10','2','1']);
    assert.deepEqual(Array.from(filterCards(samples,{game,sort:'name-desc'}),card=>card.name),['Omega','Beta','Alpha']);
  }
  // A touch opens the drawer before the synthetic click, including during momentum scrolling.
  const mobileHandlers={};let stoppedMomentum=0,focusedSearch=0,preventedTouch=0;
  const mobileToggleNode={addEventListener:(type,handler)=>{mobileHandlers[type]=handler;}};
  const mobileContext=createContext({
    mobileFiltersOpen:false,
    window:{scrollY:600,scrollTo:options=>{assert.equal(options.top,600);assert.equal(options.behavior,'instant');stoppedMomentum++;}},
    currentFilterPanel:()=>({id:'filters'}),closeFilterPanels(){},syncMobileFilters(){},
    $:selector=>selector==='#mobile-filter-toggle'?mobileToggleNode:{focus(){focusedSearch++;}},
  });
  new Script(app.slice(app.indexOf('function setMobileFiltersOpen('),app.indexOf("$('#mobile-filter-backdrop').addEventListener"))).runInContext(mobileContext);
  const touch=()=>({isPrimary:true,button:0,pointerType:'touch',preventDefault(){preventedTouch++;}});
  mobileHandlers.pointerdown(touch());
  assert.equal(mobileContext.mobileFiltersOpen,true,'Il primo tocco deve aprire, anche senza click successivo');
  assert.equal(stoppedMomentum,1);
  mobileHandlers.click({detail:1});
  assert.equal(mobileContext.mobileFiltersOpen,true,'Il click sintetico non deve richiudere il pannello');
  mobileHandlers.pointerdown(touch());mobileHandlers.click({detail:1});
  assert.equal(mobileContext.mobileFiltersOpen,false);
  mobileHandlers.click({detail:0});
  assert.equal(mobileContext.mobileFiltersOpen,true);
  assert.equal(focusedSearch,1,'Solo attivazione da tastiera porta il focus alla ricerca');
  assert.equal(preventedTouch,2);
  const cards = catalog.cards.map(card => ({ ...card, setName: catalog.sets.find(set => set.game === card.game && set.id === card.setId).name }));
  const labels = setDisplayLabels(catalog.sets);
  for (const game of ['pokemon','onepiece']) {
    const gameLabels = catalog.sets.filter(set => set.game === game).map(set => labels.get(`${game}:${set.id}`));
    assert.equal(new Set(gameLabels).size, gameLabels.length, `Espansioni indistinguibili: ${game}`);
  }
  assert.equal(labels.get('pokemon:cc_shining-legends'), 'Shining Legends · Internazionale');
  assert.equal(labels.get('pokemon:jp_shining-legends'), 'Shining Legends · Giappone');
  for (const deck of ['blastoise','charizard','venusaur']) {
    assert.ok(labels.get(`pokemon:cc_pokemon-tcg-classic-${deck}`).toLowerCase().includes(`(${deck})`));
  }
  assert.equal(formatSetName('THE TIME OF BATTLE'), 'The Time Of Battle');
  assert.equal(formatSetName('Anime 25th Collection'), 'Anime 25th Collection');
  assert.equal(formatSetName('1ST ANNIVERSARY'), '1st Anniversary');
  assert.equal(groupExpansionSets(catalog.sets.filter(set => set.game === 'pokemon'))[0].name, 'Mega Evolution');
  assert.equal(formatSetName('RED/BLACK SABO', 'onepiece'), 'RED/BLACK Sabo');
  assert.equal(formatSetName('Yellow Charlotte Katakuri', 'onepiece'), 'YELLOW Charlotte Katakuri');
  assert.equal(formatSetName('Black & White', 'pokemon'), 'Black & White');
  assert.equal(formatSetName('Pokémon TCG Classic (Blastoise)'), 'Pokémon TCG Classic (Blastoise)');
  assert.equal(formatSetName('HeartGold & SoulSilver'), 'HeartGold & SoulSilver');
  for (const set of catalog.sets) assert.equal(set.name, formatSetName(set.name, set.game), `Maiuscole non uniformi: ${set.id}`);
  const opSet = catalog.sets.find(set => set.game === 'onepiece' && set.id === 'OP18');
  assert.equal(setFilterLabel(opSet), '[OP18] The Dominance Of God');
  const previewDeck = {game:'onepiece',id:'ST35',name:'RED/BLACK Sabo'};
  assert.equal(setPreviewTitle(previewDeck), '[ST35] Sabo');
  assert.equal(setFullLabel(previewDeck), '[ST35] RED/BLACK Sabo');
  assert.equal(setPreviewTitle({game:'onepiece',id:'EB03',name:'Extra Booster One Piece Heroines Edition'}), '[EB03] One Piece Heroines Edition');
  assert.equal(setPreviewTitle({game:'onepiece',id:'FAMILY_DECK_JP',name:'Family Deck Set'}), 'Family Deck Set');
  assert.equal(setFilterLabel(previewDeck), setPreviewTitle(previewDeck));
  assert.equal(JSON.stringify(releaseDateRows({releaseDates:{ja:'2022-07-08',en:'2022-12-02'}})), JSON.stringify([{region:'JAP',date:'2022-07-08'},{region:'INT',date:'2022-12-02'}]));
  assert.equal(JSON.stringify(releaseDateRows({releaseDates:{ja:'2026-01-01',en:'2026-01-01'}})), JSON.stringify([{region:'',date:'2026-01-01'}]));
  assert.equal(JSON.stringify(releaseDateRows({releaseDates:{ja:null,en:'2026-01-01'}})), JSON.stringify([{region:'JAP',date:''},{region:'INT',date:'2026-01-01'}]));
  assert.equal(JSON.stringify(popupReleaseDateRows({releaseDate:'2026-01-01'})), JSON.stringify([{region:'',date:'2026-01-01'}]));
  assert.equal(JSON.stringify(popupReleaseDateRows({releaseDates:{ja:'2026-01-01',en:'2026-01-01'}})), JSON.stringify([{region:'',date:'2026-01-01'}]));
  assert.equal(JSON.stringify(popupReleaseDateRows({})), JSON.stringify([{region:'',date:''}]));
  assert.equal(JSON.stringify(popupReleaseDateRows({releaseDates:{ja:'2025-01-01',en:'2026-01-01'}})), JSON.stringify([{region:'JAP',date:'2025-01-01'},{region:'INT',date:'2026-01-01'}]));
  assert.equal(formatSetName('CARTE DA PRODOTTI SPECIALI','onepiece'), 'Carte da prodotti speciali');
  assert.equal(formatSetName('CARTE DA EVENTI E CAMPAGNE','onepiece'), 'Carte da eventi e campagne');
  const productCollection = catalog.sets.find(set => set.game === 'onepiece' && set.id === 'OTHER');
  assert.equal(productCollection.name, 'Carte da prodotti speciali');
  assert.equal(resolveAlias('onepiece:OTHER_JP', catalog.setAliases), 'onepiece:OTHER');
  assert.ok(!catalog.sets.some(set => set.game === 'onepiece' && set.id === 'OTHER_JP'));
  const mergedYamato = catalog.cards.find(card => card.id === 'op-OTHER-preview-EB01-007_p1');
  assert.equal(resolveAlias('op-OTHER_JP-preview-EB01-007_p1', catalog.aliases), mergedYamato.id);
  assert.equal(JSON.stringify(languageImages(mergedYamato).map(image => image.language).sort()), JSON.stringify(['en','ja']));
  const promoCollection = catalog.sets.find(set => set.game === 'onepiece' && set.id === 'P');
  assert.equal(promoCollection.group, 'Promo');
  assert.equal(promoCollection.image, 'logos/onepiece_promo.webp');
  assert.equal(cards.find(card => card.id === 'op-complete-ja-P-087').name, 'Nico Robin');
  assert.equal(cards.find(card => card.id === 'op-complete-ja-P-134').name, 'Habitual Dine and Dashers');
  assert.ok(cards.filter(card => card.game === 'onepiece').every(card => !/[\u3040-\u30ff\u3400-\u9fff]/.test(card.name)), 'I nomi visualizzati devono essere inglesi anche con scansione solo giapponese');
  const promoOrder = filterCards([
    {id:'older',game:'onepiece',code:'P-9',setId:'P',name:'Old',releaseDate:'2026-01-01'},
    {id:'newer',game:'onepiece',code:'P-100',setId:'P',name:'New'},
    {id:'middle',game:'onepiece',code:'P-20',setId:'P',name:'Middle'},
  ], {game:'onepiece',sets:['onepiece:P'],sort:'index',art:'all'});
  assert.deepEqual(Array.from(promoOrder, card => card.code), ['P-100','P-20','P-9']);
  assert.deepEqual(Array.from(filterCards(promoOrder, {game:'onepiece',sets:['onepiece:P'],sort:'name',art:'all'}), card => card.name), ['Middle','New','Old'], 'L’ordine iniziale di Promo deve rispettare un ordinamento scelto manualmente');
  const orderedSetGroups = groupExpansionSets([
    {id:'EB05',game:'onepiece',name:'Extra',group:'Extra Booster',groupOrder:1,releaseDate:'2027-01-01'},
    {id:'OP01',game:'onepiece',name:'First',group:'Espansioni classiche',groupOrder:0,releaseDate:'2022-01-01'},
    {id:'OP18',game:'onepiece',name:'Last',group:'Espansioni classiche',groupOrder:0,releaseDate:'2026-01-01'},
  ]);
  assert.deepEqual(Array.from(orderedSetGroups, group => Array.from(group.sets, set => set.id)), [['OP18','OP01'],['EB05']], 'Espansioni e filtro devono condividere gruppi e ordine di uscita');
  const promoCards = catalog.cards.filter(card => card.game === 'onepiece' && (card.setIds || [card.setId]).includes('P'));
  assert.ok(promoCards.length > 1 && promoCards.every(card => /^P-\d+$/.test(card.code)));
  for (const card of catalog.cards.filter(card => card.game === 'onepiece' && /^P-\d+$/.test(card.code))) assert.ok(promoCards.includes(card));
  const deckPromo = promoCards.find(card => card.code === 'P-085' && card.setId === 'ST36');
  assert.ok(deckPromo, 'La raccolta Promo deve includere le carte P dei mazzi mantenendo il prodotto originale');
  assert.equal(cardDisplaySet(deckPromo, ['onepiece:P'], catalog.sets).id, 'ST36');
  assert.equal(cardDisplaySet(deckPromo, ['onepiece:ST36','onepiece:P'], catalog.sets).id, 'ST36');
  const campaignCollection = catalog.sets.find(set => set.game === 'onepiece' && set.id === 'PROMO_JP');
  assert.equal(campaignCollection.name, 'Carte da eventi e campagne');
  assert.equal(campaignCollection.group, 'Altri prodotti');
  const pokemonBatch = audit.pokemonCompletionBatches['2002-2003-next-ten'];
  assert.equal(pokemonBatch.coverage.length, 10);
  assert.equal(pokemonBatch.coverage.reduce((count,set) => count + set.sourceCount,0), 1009);
  const importedPokemon = new Set();
  for (const set of pokemonBatch.coverage) {
    const inventory = audit.sets[`pokemon:${set.setId}`];
    assert.equal(inventory.preview, false, `Set rimasto come test: ${set.setId}`);
    assert.equal(set.standardCardIds.length, set.sourceCount);
    const members = cards.filter(card => card.game === 'pokemon' && card.setId === set.setId);
    assert.equal(new Set(members.map(card=>card.code)).size, set.sourceCount, `Inventario Pokemon incompleto: ${set.setId}`);
    for (const [index,id] of set.standardCardIds.entries()) {
      const card = members.find(card=>card.id === id);
      assert.ok(card && !card.isAlternative);
      importedPokemon.add(id);
      const source = audit.cards[id].metadata.catalogReference;
      assert.equal(source.set, set.sourceSet);
      assert.equal(source.card, set.sourceCardIds[index]);
      const languages = languageImages(card).map(image=>image.language);
      assert.ok(languages.every(language=>['en','ja'].includes(language)));
      if (card.category !== 'Energy' || !/^cc_ex-ruby-sapphire-10[4-9]$/.test(card.code)) assert.equal(languages.length,2, `Controparte non verificata: ${id}`);
    }
    for (const card of members) {
      if (card.category === 'Pokemon') assert.ok(card.types.length && audit.cards[card.id].metadata.typeReference, `Tipo Pokemon privo di fonte: ${card.id}`);
      if (card.isAlternative) {
        const variantId = audit.cards[card.id].metadata.variantId;
        const variant = audit.cards[card.id].metadata.variantInventory.find(variant=>variant.id===variantId);
        assert.ok(variant && Object.keys(variant.differsFromStandard || {}).some(key=>['edition','stamp','painting','artwork'].includes(key)), `Variante con sola finitura duplicata: ${card.id}`);
        assert.ok(cardVariants(members,card).some(other=>!other.isAlternative), `Variante senza carta principale: ${card.id}`);
      }
    }
  }
  assert.equal(importedPokemon.size,1009);
  const nidoran = cards.find(card=>card.id==='pk-jp_mysterious-mountains-006');
  assert.equal(languageImages(nidoran).length,2);
  assert.ok(audit.cards[nidoran.id].metadata.counterpart.manualVerification.comparison.endsWith('nidoran-counterparts.jpg'));
  const twentyBatch = audit.pokemonCompletionBatches['2003-2006-next-twenty'];
  assert.equal(twentyBatch.coverage.length,20);
  assert.equal(twentyBatch.coverage.reduce((count,set)=>count+set.sourceCount,0),1965);
  const twentySetIds = new Set(twentyBatch.coverage.map(set=>set.setId));
  const twentyCards = cards.filter(card=>card.game==='pokemon' && twentySetIds.has(card.setId));
  assert.equal(twentyCards.length,2242);
  let bilingualStandards = 0;
  for (const entry of twentyBatch.coverage) {
    const inventory = audit.sets[`pokemon:${entry.setId}`];
    assert.equal(inventory.preview,false);
    assert.equal(inventory.completionBatch,'2003-2006-next-twenty');
    const members=twentyCards.filter(card=>card.setId===entry.setId);
    assert.equal(new Set(members.map(card=>card.code)).size,entry.sourceCount);
    for (const [index,id] of entry.standardCardIds.entries()) {
      const card=members.find(card=>card.id===id);
      assert.ok(card && !card.isAlternative);
      assert.equal(audit.cards[id].metadata.catalogReference.card,entry.sourceCardIds[index]);
      assert.equal(audit.cards[id].metadata.catalogReference.set,entry.sourceSet);
      if (languageImages(card).length===2) bilingualStandards++;
      else assert.equal(card.id,'pk-cc_ex-hidden-legends-57','Solo le immagini della stessa illustrazione vanno collegate fra lingue');
    }
    for (const card of members) {
      if (card.category==='Pokemon') assert.ok(card.types.length && audit.cards[card.id].metadata.typeReference);
      if (card.isAlternative) {
        const metadata=audit.cards[card.id].metadata;
        const variant=metadata.variantInventory.find(variant=>variant.id===metadata.variantId);
        assert.ok(variant && ['edition','stamp','painting','artwork','errorState'].some(key=>Object.hasOwn(variant.differsFromStandard || {},key)),`Variante con sola finitura duplicata: ${card.id}`);
        assert.ok(cardVariants(members,card).some(other=>!other.isAlternative));
      }
    }
  }
  assert.equal(bilingualStandards,1964);
  assert.equal(JSON.stringify(orderedRarities(['Gold Star','Holo Rare','Unknown','Ultra Rare','Common'],'pokemon')),JSON.stringify(['Common','Holo Rare','Ultra Rare','Gold Star','Unknown']));
  const chinchou=twentyCards.find(card=>card.id==='pk-cc_ex-hidden-legends-57');
  assert.equal(languageImages(chinchou).length,1);
  assert.equal(languageImages(chinchou)[0].language,'en');
  assert.ok(audit.cards[chinchou.id].issues.includes('NO_JAPANESE_SAME_ARTWORK'));
  assert.ok(audit.cards[chinchou.id].metadata.counterpartException.sourceUrls.length);
  assert.equal(twentyCards.find(card=>card.id==='pk-jp_rocket-gang-strikes-back-071').types.join(','),'Grass,Darkness');
  const nextBatch = audit.pokemonCompletionBatches['2006-2007-next-ten'];
  assert.equal(nextBatch.coverage.length,10);
  assert.equal(nextBatch.coverage.reduce((count,set)=>count+set.sourceCount,0),1062);
  const nextSetIds = new Set(nextBatch.coverage.map(set=>set.setId));
  const nextCards = cards.filter(card=>card.game==='pokemon' && nextSetIds.has(card.setId));
  assert.equal(nextCards.length,1289);
  for (const entry of nextBatch.coverage) {
    const inventory=audit.sets[`pokemon:${entry.setId}`];
    const members=nextCards.filter(card=>card.setId===entry.setId);
    assert.equal(inventory.preview,false);
    assert.equal(inventory.completionBatch,'2006-2007-next-ten');
    assert.equal(new Set(members.map(card=>card.code)).size,entry.sourceCount);
    assert.equal(members.filter(card=>!card.isAlternative).length,entry.sourceCount);
    for (const [index,id] of entry.standardCardIds.entries()) {
      const card=members.find(card=>card.id===id);
      assert.ok(card && !card.isAlternative);
      assert.equal(audit.cards[id].metadata.catalogReference.card,entry.sourceCardIds[index]);
      assert.equal(audit.cards[id].metadata.catalogReference.set,entry.sourceSet);
      assert.equal(languageImages(card).map(image=>image.language).sort().join(','),'en,ja',`Controparte mancante: ${id}`);
    }
    for (const card of members) {
      if (card.category==='Pokemon') assert.ok(card.types.length && audit.cards[card.id].metadata.typeReference);
      if (card.isAlternative) {
        const metadata=audit.cards[card.id].metadata;
        const variant=metadata.variantInventory.find(variant=>variant.id===metadata.variantId);
        assert.ok(variant && ['edition','stamp','painting','artwork','errorState'].some(key=>Object.hasOwn(variant.differsFromStandard || {},key)));
        assert.ok(cardVariants(members,card).some(other=>!other.isAlternative));
      }
    }
  }
  const sableye=nextCards.find(card=>card.id==='pk-jp_shining-darkness-dpbp-353-v-unlimited-non-holo');
  assert.equal(sableye.imageWidth,500);
  assert.equal(sableye.imageHeight,700);
  assert.equal(audit.cards[sableye.id].metadata.sourceImageUrl,'https://cdn.poketrace.com/cards/56359b25c1a32866.webp');
  assert.ok(audit.cards[sableye.id].versions[0].metadata.sourceImageReference.comparison.endsWith('sableye-unlimited-comparison.jpg'));
  const thirtyBatch=audit.pokemonCompletionBatches['2007-2010-next-thirty'];
  assert.equal(thirtyBatch.coverage.length,30);
  assert.equal(thirtyBatch.coverage.reduce((n,set)=>n+set.sourceCount,0),2839);
  assert.equal(thirtyBatch.coverage.reduce((n,set)=>n+set.rawSourceCount-set.sourceCount,0),16);
  const thirtySets=new Set(thirtyBatch.coverage.map(set=>set.setId));
  const thirtyCards=cards.filter(card=>card.game==='pokemon' && thirtySets.has(card.setId));
  assert.equal(thirtyCards.length,3244);
  let thirtyBilingual=0;
  for (const entry of thirtyBatch.coverage) {
    assert.equal(audit.sets[`pokemon:${entry.setId}`].preview,false);
    const members=thirtyCards.filter(card=>card.setId===entry.setId);
    assert.equal(new Set(members.map(card=>card.code)).size,entry.sourceCount);
    assert.equal(members.filter(card=>!card.isAlternative).length,entry.sourceCount);
    for (const [index,id] of entry.standardCardIds.entries()) {
      const card=members.find(card=>card.id===id);
      assert.ok(card && !card.isAlternative);
      assert.equal(audit.cards[id].metadata.catalogReference.set,entry.sourceSet);
      assert.equal(audit.cards[id].metadata.catalogReference.card,entry.sourceCardIds[index]);
      if(languageImages(card).length===2) thirtyBilingual++;
      else assert.ok(['pk-jp_temple-of-anger-porygon-z-lv-x','pk-jp_reviving-legends-071','pk-jp_reviving-legends-072'].includes(id));
    }
    for (const card of members) if(card.category==='Pokemon') assert.ok(card.types.length && audit.cards[card.id].metadata.typeReference);
  }
  assert.equal(thirtyBilingual,2836);
  const tinyFossil=thirtyCards.find(card=>card.id==='pk-jp_cry-from-the-mysterious-root-fossil-v-unlimited-non-holo');
  assert.ok(audit.cards[tinyFossil.id].issues.includes('LOW_RESOLUTION_SCAN'));
  const newThirtyBatch=audit.pokemonCompletionBatches['2012-2015-next-thirty'];
  assert.equal(newThirtyBatch.coverage.length,30);
  assert.equal(newThirtyBatch.coverage.reduce((n,entry)=>n+entry.sourceCount,0),3002);
  assert.equal(newThirtyBatch.artworkRecords,3692);
  assert.equal(newThirtyBatch.addedCardIds.length,3662);
  const newThirtySets=new Set(newThirtyBatch.coverage.map(entry=>entry.setId));
  const newThirtyCards=cards.filter(card=>card.game==='pokemon' && newThirtySets.has(card.setId));
  for (const entry of newThirtyBatch.coverage) {
    const inventory=audit.sets[`pokemon:${entry.setId}`];
    const members=newThirtyCards.filter(card=>card.setId===entry.setId);
    assert.equal(inventory.preview,false);
    assert.equal(inventory.completionBatch,'2012-2015-next-thirty');
    assert.equal(members.filter(card=>!card.isAlternative).length,entry.sourceCount);
    assert.equal(new Set(members.map(card=>card.code)).size,entry.sourceCount);
    for (const [index,id] of entry.standardCardIds.entries()) {
      const card=members.find(card=>card.id===id);
      assert.ok(card && !card.isAlternative);
      assert.equal(audit.cards[id].metadata.catalogReference.set,entry.sourceSet);
      assert.equal(audit.cards[id].metadata.catalogReference.card,entry.sourceCardIds[index]);
    }
    for (const card of members) {
      if(card.category==='Pokemon') assert.ok(card.types.length && audit.cards[card.id].metadata.typeReference,`Nuovo Pokemon senza tipo verificato: ${card.id}`);
      if(card.isAlternative) {
        const metadata=audit.cards[card.id].metadata;
        const variant=metadata.variantInventory.find(variant=>variant.id===metadata.variantId);
        assert.ok(variant && ['edition','stamp','painting','artwork','errorState'].some(key=>Object.hasOwn(variant.differsFromStandard || {},key)),`Variante duplicata per sola finitura: ${card.id}`);
      }
    }
  }
  const xySunMoonBatch=audit.pokemonCompletionBatches['2015-2017-next-twenty'];
  assert.equal(xySunMoonBatch.coverage.length,20);
  assert.equal(xySunMoonBatch.coverage.reduce((n,entry)=>n+entry.sourceCount,0),1904);
  assert.equal(xySunMoonBatch.artworkRecords,2181);
  assert.equal(xySunMoonBatch.addedCardIds.length,2161);
  const xySunMoonSets=new Set(xySunMoonBatch.coverage.map(entry=>entry.setId));
  const xySunMoonCards=cards.filter(card=>card.game==='pokemon' && xySunMoonSets.has(card.setId));
  let xySunMoonBilingual=0;
  for (const entry of xySunMoonBatch.coverage) {
    const inventory=audit.sets[`pokemon:${entry.setId}`];
    const members=xySunMoonCards.filter(card=>card.setId===entry.setId);
    assert.equal(inventory.preview,false);
    assert.equal(inventory.completionBatch,'2015-2017-next-twenty');
    assert.equal(members.filter(card=>!card.isAlternative).length,entry.sourceCount);
    assert.equal(new Set(members.map(card=>card.code)).size,entry.sourceCount);
    for (const [index,id] of entry.standardCardIds.entries()) {
      const card=members.find(card=>card.id===id);
      assert.ok(card && !card.isAlternative);
      assert.equal(audit.cards[id].metadata.catalogReference.set,entry.sourceSet);
      assert.equal(audit.cards[id].metadata.catalogReference.card,entry.sourceCardIds[index]);
      if(languageImages(card).length===2) xySunMoonBilingual++;
      else assert.ok(audit.cards[id].metadata.counterpartException,`Controparte assente senza motivazione: ${id}`);
    }
    for (const card of members) {
      const metadata=audit.cards[card.id].metadata;
      if(card.category==='Pokemon') assert.ok(card.types.length && metadata.typeReference,`Pokemon XY/SM privo di tipo verificato: ${card.id}`);
      if(card.isAlternative) {
        const variant=metadata.variantInventory.find(variant=>variant.id===metadata.variantId);
        assert.ok(variant && ['edition','stamp','painting','artwork','errorState'].some(key=>Object.hasOwn(variant.differsFromStandard || {},key)),`Variante duplicata per sola finitura: ${card.id}`);
      }
    }
  }
  assert.equal(xySunMoonBilingual,1893);
  const nextFiveBatch=audit.pokemonCompletionBatches['2017-next-five'];
  assert.equal(nextFiveBatch.coverage.length,5);
  assert.equal(nextFiveBatch.coverage.reduce((count,set)=>count+set.sourceCount,0),447);
  assert.equal(nextFiveBatch.artworkRecords,463);
  assert.equal(nextFiveBatch.addedCardIds.length,458);
  let nextFiveBilingual=0;
  for (const entry of nextFiveBatch.coverage) {
    const inventory=audit.sets[`pokemon:${entry.setId}`];
    const members=cards.filter(card=>card.game==='pokemon' && card.setId===entry.setId);
    assert.equal(inventory.preview,false);
    assert.equal(inventory.completionBatch,'2017-next-five');
    assert.equal(members.filter(card=>!card.isAlternative).length,entry.sourceCount);
    assert.equal(new Set(members.map(card=>card.code)).size,entry.sourceCount);
    for (const [index,id] of entry.standardCardIds.entries()) {
      const card=members.find(card=>card.id===id);
      assert.ok(card && !card.isAlternative);
      const metadata=audit.cards[id].metadata;
      assert.equal(metadata.catalogReference.set,entry.sourceSet);
      assert.equal(metadata.catalogReference.card,entry.sourceCardIds[index]);
      if(languageImages(card).length===2) nextFiveBilingual++;
      else assert.ok(metadata.counterpartException,`Controparte assente senza motivazione: ${id}`);
    }
    for (const card of members) {
      const metadata=audit.cards[card.id].metadata;
      if(card.category==='Pokemon') assert.ok(card.types.length && metadata.typeReference,`Nuovo Pokemon privo di tipo verificato: ${card.id}`);
      if(card.isAlternative) {
        const variant=metadata.variantInventory.find(variant=>variant.id===metadata.variantId);
        assert.ok(variant && ['edition','stamp','painting','artwork','errorState'].some(key=>Object.hasOwn(variant.differsFromStandard || {},key)),`Variante duplicata per sola finitura: ${card.id}`);
      }
    }
  }
  assert.equal(nextFiveBilingual,444);
  const unnumberedEnergies=xySunMoonCards.filter(card=>card.printedNumber==='');
  assert.equal(unnumberedEnergies.length,18,'Le 18 Energie prive di numero non devono ereditare la sequenza artificiale della fonte');
  for (const card of unnumberedEnergies) {
    assert.equal(card.category,'Energy');
    assert.equal(card.number,'');
    assert.ok(audit.cards[card.id].metadata.printedIdentityReview?.sha256);
    assert.ok(cardPopupVersions(cards,card,catalog.sets).filter(version=>version.id===card.id).every(version=>version.variantLabel.includes('Senza numero')),'Non esporre il codice interno come numero della stampa');
  }
  assert.equal(cards.find(card=>card.id==='op-OP18-035').illustrator,'22');
  assert.equal(audit.cards['op-OP18-035'].metadata.illustratorAttribution.manualReview,true);
  assert.deepEqual(Array.from(cards.find(card=>card.id==='op-FAMILY_DECK_JP-preview-ST01-001_p1').colors),['Red']);
  assert.equal(audit.manualNotesReview.resolved.length,8);
  const completion = audit.onepieceCompletionAudit;
  const cardsById = new Map(cards.map(card => [card.id, card]));
  assert.equal(completion.officialRows, 10390, 'Snapshot ufficiale EN/JP incompleto');
  const officialKeys = Object.keys(completion.sourceToCard).filter(key => /^(en|ja):/.test(key));
  assert.equal(officialKeys.length, 10389, 'Una stampa è elencata in due prodotti ufficiali');
  const marketKeys = Object.keys(completion.sourceToCard).filter(key => key.startsWith('tcg:'));
  assert.equal(marketKeys.length + completion.unavailableScans.length, completion.tcgSingles, 'Ogni stampa commerciale deve essere importata o avere una foto mancante documentata');
  for (const [key, id] of Object.entries(completion.sourceToCard)) {
    const card = cardsById.get(id);
    assert.ok(card?.game === 'onepiece', `Riferimento senza carta One Piece: ${key}`);
    const references = audit.cards[id].metadata.printSources.filter(source => source.printingId === key);
    assert.ok(references.length, `Provenienza stampa mancante: ${key}`);
    for (const reference of references) {
      assert.ok((card.setIds || [card.setId]).includes(reference.setId), `Appartenenza stampa mancante: ${key}`);
      assert.ok(languageImages(card).some(image => image.language === reference.region), `Lingua riferimento mancante: ${key}`);
    }
  }
  for (const setId of ['PRB01','PRB02','OTHER','PROMO_JP']) {
    const inventory = audit.sets[`onepiece:${setId}`];
    assert.equal(inventory.preview, false);
    for (const row of inventory.completionCoverage) {
      const card = cardsById.get(row.cardId);
      assert.ok(card && (card.setIds || [card.setId]).includes(setId));
      assert.ok(languageImages(card).some(image => image.language === row.language));
    }
  }
  const supplements = completion.supplementalReferences;
  assert.equal(completion.limitlessFullFrameMatches.length + supplements.resolved.length + supplements.pending.length, 9748);
  for (const reference of [...completion.limitlessFullFrameMatches, ...supplements.resolved]) {
    const card = cardsById.get(reference.cardId);
    assert.ok(card && languageImages(card).some(image => image.language === reference.language), `Stampa supplementare senza immagine: ${reference.sourceUrl}`);
  }
  assert.ok(supplements.pending.every(row => row.issue === 'REFERENCE_SCAN_UNAVAILABLE'), 'Restano confronti delle stampe da risolvere');
  assert.equal(completion.tournamentCoverage.rows.length, 693);
  assert.equal(completion.tournamentCoverage.rows.filter(row => row.cardId).length, 683);
  const regionalIds = ['op-TCG482218','op-TCG482219','op-TCG482220','op-TCG483174','op-TCG483176','op-TCG483177'];
  const regionalPrints = regionalIds.map(id => cardsById.get(id));
  assert.ok(regionalPrints.every(card => card?.code === 'OP02-035'));
  assert.equal(new Set(regionalPrints.map(card => card.image)).size, 6, 'Participant, Finalist e Winner Online/Offline devono avere scansioni distinte');
  assert.notEqual(cardsById.get('op-reference-bce39aadb6d4').image, cardsById.get('op-TCG710276').image, 'Champion e 3rd Place non sono la stessa stampa');
  assert.equal(factValue(undefined), 'N.D.');
  assert.equal(factValue('Unknown'), 'N.D.');
  assert.equal(factValue(''), 'N.D.');
  assert.equal(factValue('Common'), 'Common');
  const sameDay = ['ST09','ST36','ST31'].map(id => ({game:'onepiece',id,releaseDate:'2026-07-31'}));
  assert.deepEqual(sameDay.sort(compareExpansionDates).map(set => set.id), ['ST36','ST31','ST09']);
  const pokemonSets = catalog.sets.filter(set => set.game === 'pokemon');
  const categoryMap = expansionCategoryMap(pokemonSets);
  for (const set of pokemonSets) {
    assert.ok(['expansion','special','deck','world-deck','trainer-kit','box','promo','collaboration','energy','other'].includes(set.category), `Categoria non valida: ${set.id}`);
    assert.ok(set.languages.length && set.languages.every(language => ['en','ja'].includes(language)), `Lingue non valide: ${set.id}`);
  }
  const normalSets = filterExpansionSets(catalog.sets, {game:'pokemon',category:'expansion',language:'all'}, categoryMap);
  assert.equal(normalSets.length, 273);
  assert.ok(normalSets.every(set => set.category === 'expansion'));
  const japaneseBase = filterExpansionSets(catalog.sets, {game:'pokemon',query:'base set',language:'ja',category:'expansion'}, categoryMap);
  assert.ok(japaneseBase.some(set => set.id === 'base1'), 'Il Base Set equivalente EN/JP deve comparire anche in giapponese');
  const kits = filterExpansionSets(catalog.sets, {game:'pokemon',category:'trainer-kit',language:'en',query:'latias'}, categoryMap);
  assert.ok(kits.length >= 2 && kits.every(set => set.language === 'en' && set.category === 'trainer-kit'));
  assert.equal(filterExpansionSets(catalog.sets, {game:'pokemon',query:'zz-no-such-set'}).length, 0);
  const rareCategories = expansionCategoryMap([{game:'pokemon',id:'a',category:'one-off'},{game:'pokemon',id:'b',category:'one-off'}]);
  assert.equal(rareCategories.get('pokemon:a'), 'other');
  const artistSamples = [
    {game:'pokemon',code:'A',illustrator:'Ken Sugimori'},
    {game:'pokemon',code:'A',illustrator:' KEN SUGIMORI '},
    {game:'pokemon',code:'B',illustrator:'Ken Sugimori'},
    {game:'onepiece',code:'OP01-001',illustrator:'Ken Sugimori'},
    {game:'onepiece',code:'OP01-001',illustrator:'Ken Sugimori'},
    {game:'pokemon',code:'C'},
    {game:'pokemon',code:'D',illustrator:'Élodie Test'},
  ];
  const sampleIndex = indexIllustrators(artistSamples);
  const ken = sampleIndex.find(artist => artist.name === 'Ken Sugimori');
  assert.equal(ken.games.pokemon, 2);
  assert.equal(ken.games.onepiece, 1);
  assert.equal(filterIllustrators(sampleIndex, 'ELODIE').length, 1);
  assert.equal(filterIllustrators(sampleIndex, 'sugimori ken')[0].name, 'Ken Sugimori');
  assert.equal(filterIllustrators(sampleIndex, 'not an illustrator').length, 0);
  assert.equal(filterIllustrators(sampleIndex, '', 'onepiece').length, 1);
  assert.equal(filterIllustrators(sampleIndex, 'ELODIE', 'onepiece').length, 0);
  assert.equal(filterIllustrators(sampleIndex, 'ELODIE', 'pokemon').length, 1);
  assert.equal(filterIllustrators(sampleIndex, '', 'pokemon').length, 2);
  const resourceOrder = [
    {id:'don-old',game:'onepiece',category:'DON!!',code:'DON!!',name:'A',releaseDate:'2020-01-01'},
    {id:'op-card',game:'onepiece',category:'CHARACTER',code:'OP01-001',name:'Z',releaseDate:'2025-01-01'},
    {id:'pk-card',game:'pokemon',category:'Energy',code:'0',name:'B',releaseDate:'2024-01-01'},
    {id:'don-new',game:'onepiece',category:'DON!!',code:'DON!!',name:'C',releaseDate:'2026-01-01'},
  ];
  for (const sort of ['index','index-desc','name','name-desc','recent','oldest']) {
    const sorted = filterCards(resourceOrder, {game:'all',sort});
    assert.ok(sorted.slice(0,2).every(card => card.category !== 'DON!!'), `DON!! prima delle altre carte: ${sort}`);
    assert.ok(sorted.slice(2).every(card => card.category === 'DON!!'));
    const onlyDon = filterCards(resourceOrder, {game:'onepiece',categories:['DON!!'],sort});
    assert.equal(onlyDon.length, 2);
  }
  const onepieceGroups = groupExpansionSets(catalog.sets.filter(set => set.game === 'onepiece'));
  assert.ok(!onepieceGroups.some(group => ['Set di mazzi','Mazzi dimostrativi'].includes(group.name)));
  const otherProducts = onepieceGroups.find(group => group.name === 'Altri prodotti').sets;
  for (const id of ['OPDD','FAMILY_DECK_JP','LD01','SD01','ST01_PRE','ST02_PRE','ST03_PRE','ST04_PRE']) assert.ok(otherProducts.some(set => set.id === id), `Prodotto fuori dal gruppo Altri prodotti: ${id}`);
  assert.ok(onepieceGroups.find(group => group.name === 'Mazzi Starter').sets.every(set => /^ST\d{2}$/.test(set.id)));
  const kenCatalog = indexIllustrators(cards).find(artist => artist.name === 'Ken Sugimori');
  assert.equal(kenCatalog.games.pokemon, groupCardResults(filterCards(cards, {game:'pokemon',illustrator:'Ken Sugimori',art:'all'})).length);
  const creditedOnePiece = cards.filter(card => card.game === 'onepiece' && card.illustrator);
  assert.ok(creditedOnePiece.length >= 3000, 'Attribuzioni One Piece mancanti');
  for (const card of creditedOnePiece) {
    const attribution = audit.cards[card.id].metadata.illustratorAttribution;
    assert.equal(attribution.name, card.illustrator);
    assert.ok(attribution.evidence.length);
    assert.ok(attribution.evidence.every(source => source.sourceUrl.startsWith('https://onepiece.limitlesstcg.com/cards/') && source.sourceImageUrl.includes('/' + card.code)));
  }
  assert.equal(cards.find(card => card.id === 'op-OP01-025AA1').illustrator, 'AKIRA EGAWA');
  assert.notEqual(cards.find(card => card.id === 'op-OP01-025AA').illustrator, cards.find(card => card.id === 'op-OP01-025AA1').illustrator, 'Gli artwork dello stesso codice non devono ereditare lo stesso illustratore');
  for (const id of ['op-OP02-096','op-OP02-099','op-OP03-102AA']) assert.ok(!cards.find(card => card.id === id).illustrator, `Attribuzione discordante non sospesa: ${id}`);
  const egawa = indexIllustrators(cards).find(artist => artist.name === 'AKIRA EGAWA');
  assert.ok(egawa.games.pokemon && egawa.games.onepiece, 'Artista comune ai due giochi non riunito');
  const rawFavorites = Object.freeze(['old','canonical','unavailable']);
  const indexed = indexFavorites([{id:'canonical'},{id:'other'}], rawFavorites, {old:'intermediate',intermediate:'canonical'});
  assert.deepEqual([...indexed.ids], ['canonical','unavailable']);
  assert.deepEqual(indexed.known.map(card => card.id), ['canonical']);
  assert.equal(rawFavorites.length, 3, 'Gli ID originali del backup non devono cambiare');
  assert.equal(indexFavorites([{id:'canonical'}], [], {}).ids.size, 0);
  let aliasLookups = 0;
  const favoriteAliases = new Proxy({}, { get() { aliasLookups++; } });
  const manyCards = Array.from({length:5000}, (_,index) => ({id:`card-${index}`}));
  const manyFavorites = manyCards.slice(0,2000).map(card => card.id);
  const largeIndex = indexFavorites(manyCards, manyFavorites, favoriteAliases);
  assert.equal(largeIndex.known.length, 2000);
  assert.equal(aliasLookups, 2000, 'Risolvere ogni preferito una volta sola');
  for (const card of manyCards) largeIndex.ids.has(card.id);
  assert.equal(aliasLookups, 2000, 'L’indice deve poter essere riutilizzato senza risolvere altri alias');
  for (const game of ['pokemon','onepiece']) {
    const sample = {id:'scoped-search',game,name:'Pikachu',illustrator:'Atsuko Nishida',code:'XY-007',number:'007',codes:['XY-007','XY-008'],numbers:['007','008'],setName:'Unique Expansion Name',setId:'set-unique-id',variantLabel:'Prize edition',artwork:'Alternate art'};
    for (const query of ['PIKACHU','Atsuko','XY-007','XY-008','008']) assert.equal(filterCards([sample], {game,query}).length, 1, `${game}: ricerca valida ${query}`);
    for (const query of ['Unique Expansion','set-unique-id','Prize','Alternate']) assert.equal(filterCards([sample], {game,query}).length, 0, `${game}: ricerca fuori ambito ${query}`);
  }
  const packKeys = catalogSetSelections('onepiece', 'DOUBLE_PACKS', catalog.sets);
  const packSets = catalog.sets.filter(set => set.game === 'onepiece' && /^DP\d+$/.test(set.id));
  assert.equal(packKeys.length, packSets.length);
  assert.equal(packKeys.length, 11);
  assert.equal(catalogSetSelections('pokemon','DOUBLE_PACKS',catalog.sets).length, 0);
  assert.equal(catalogSetSelections('onepiece','unknown-set',catalog.sets).length, 0);
  assert.equal(JSON.stringify(catalogSetSelections('onepiece','OTHER_JP',catalog.sets,catalog.setAliases)), JSON.stringify(['onepiece:OTHER']));
  const tiles = expansionTiles(catalog.sets);
  assert.equal(tiles.length, catalog.sets.length - packSets.length + 1);
  assert.equal(tiles.filter(set => set.id === 'DOUBLE_PACKS').length, 1);
  assert.ok(!tiles.some(set => set.game === 'onepiece' && /^DP\d+$/.test(set.id)));
  assert.equal(expansionTiles(pokemonSets).length, pokemonSets.length);
  const allPacks = filterCards(cards, {game:'onepiece',sets:packKeys,art:'all'});
  assert.ok(allPacks.length > 0 && allPacks.every(card => card.category === 'DON!!'));
  for (const set of packSets) {
    const members = filterCards(cards,{game:'onepiece',sets:[`onepiece:${set.id}`],art:'all'});
    assert.ok(members.length && members.every(card => allPacks.some(pack => pack.id === card.id)));
  }
  for (const set of catalog.sets.filter(set => prereleaseSetCode(set))) {
    const base = catalog.sets.find(base => base.game === 'onepiece' && base.id === prereleaseSetCode(set));
    for (const [region,date] of Object.entries(set.releaseDates)) {
      const official = base.releaseDates[region];
      assert.equal((Date.parse(official) - Date.parse(date)) / 86400000, 14, `Data convenzionale errata: ${set.id}/${region}`);
    }
    assert.equal(setPreviewTitle(set), `[${base.id}] ${base.name} (Prerelease)`);
    assert.equal(setFullLabel(set), setPreviewTitle(set));
  }
  const standardDon = cards.find(card => card.id === 'op-don-549342');
  assert.equal(standardDon.setId, 'OP01');
  assert.equal(resolveAlias('op-TCG456320',catalog.aliases),standardDon.id);
  assert.ok(!cards.some(card => card.id === 'op-TCG456320'));
  assert.equal(cardPopupVersions(cards,standardDon,catalog.sets).filter(card => card.id === standardDon.id).length, 1, 'Il DON standard deve avere una sola versione, anche con più appartenenze');
  assert.ok(cards.some(card => card.id === 'op-TCG434340'), 'Il DON timbrato Prerelease non deve essere unito allo standard');
  assert.ok(cards.some(card => card.id === 'op-TCG544805'), 'Il DON 3D non deve essere unito allo standard');
  const defaults = { game: 'all', art: 'all', query: '' };
  assert.equal(filterCards(cards, { ...defaults, query: 'MITSUHIRO charizard' })[0].id, 'pk-base1-4');
  assert.equal(filterCards(cards, { ...defaults, query: 'base2-17' }).length, 1);
  assert.ok(filterCards(cards, { ...defaults, game: 'pokemon' }).length >= 228);
  assert.ok(catalog.sets.filter(set => set.game === 'pokemon' && set.language === 'en').length >= 13);
  assert.ok(catalog.sets.filter(set => set.game === 'pokemon' && set.language === 'ja').length >= 13);
  assert.ok(filterCards(cards, { ...defaults, game: 'pokemon' }).filter(card => languageImages(card).some(v => v.language === 'ja')).length > 1000);
  assert.equal(filterCards(cards, { ...defaults, game: 'all', illustrator: 'Ken Sugimori' }).some(card => card.illustrator !== 'Ken Sugimori'), false);
  const filtered = filterCards(cards, { ...defaults, game: 'onepiece', sets: ['onepiece:OP01'], art: 'standard' });
  assert.ok(filtered.length > 0 && filtered.every(card => !card.isAlternative || !cards.some(other => other.game === card.game && other.code === card.code && !other.isAlternative && (other.setIds || [other.setId]).includes('OP01'))));
  assert.ok(catalog.sets.filter(set => set.game === 'onepiece').length >= 13);
  for (const set of catalog.sets.filter(set => set.game === 'onepiece' && audit.sets[`onepiece:${set.id}`].expectedCodesByLanguage)) {
    for (const language of ['en','ja']) {
      const expected = audit.sets[`onepiece:${set.id}`].expectedCodesByLanguage[language];
      assert.ok(expected.length >= (/^OP\d{2}$/.test(set.id) ? 120 : /^ST\d{2}$/.test(set.id) ? 15 : set.id === 'FAMILY_DECK_JP' && language === 'ja' ? 51 : /^EB\d{2}$/.test(set.id) && language === 'ja' ? 60 : 0), `Inventario regionale incompleto: ${set.id}/${language}`);
      const available = new Set(cards.filter(card => card.game === 'onepiece' && (card.setIds || [card.setId]).includes(set.id) && languageImages(card).some(image => image.language === language)).map(card => card.code));
      for (const code of expected) assert.ok(available.has(code), `Immagine regionale mancante: ${set.id}/${language}/${code}`);
    }
  }
  for (const setId of ['OP14','OP15','OP16','OP17','OP18','EB01','EB02','EB03','EB04','EB05',...Array.from({length:36},(_,i) => `ST${String(i+1).padStart(2,'0')}`),'FAMILY_DECK_JP']) {
    const inventory = audit.sets[`onepiece:${setId}`];
    assert.ok(!inventory.preview, `Il set resta in anteprima: ${setId}`);
    for (const language of ['en', 'ja']) {
      const printings = inventory.officialPrintingCoverage.filter(row => row.language === language);
      assert.equal(printings.length, inventory.officialRows[language], `Inventario stampe incompleto: ${setId}/${language}`);
      for (const printing of printings) {
        const card = cards.find(card => card.id === printing.cardId);
        assert.ok(card && (card.setIds || [card.setId]).includes(setId), `Stampa senza carta/set: ${printing.key}`);
        assert.ok(languageImages(card).some(image => image.language === language), `Lingua stampa mancante: ${printing.key}`);
        assert.ok(audit.cards[card.id].metadata.printSources.some(source => source.referenceImageUrl === printing.sourceImageUrl && source.setId === setId), `Fonte stampa mancante: ${printing.key}`);
      }
    }
  }
  for (const [setId, count] of [['LD01',51],['SD01',30],['ST01_PRE',17],['ST02_PRE',17],['ST03_PRE',17],['ST04_PRE',17]]) {
    const inventory = audit.sets[`onepiece:${setId}`];
    assert.equal(inventory.expectedCodeList.length, count, `Codici mancanti: ${setId}`);
    for (const row of inventory.sourcePrintingCoverage) {
      const card = cards.find(card => card.id === row.cardId);
      assert.ok(card && (card.setIds || [card.setId]).includes(setId));
      assert.ok(languageImages(card).some(image => image.language === row.language));
    }
  }
  for (const [setId, count] of [['EB01',80],['EB02',105],['EB03',90],['EB05',96]]) {
    const inventory = audit.sets[`onepiece:${setId}`];
    for (const language of ['en','ja']) assert.equal(inventory.officialRows[language], count, `Copertura Extra Booster incompleta: ${setId}/${language}`);
  }
  const orderedStarter = groupCardResults(filterCards(cards, {...defaults,game:'onepiece',sets:['onepiece:ST36'],sort:'index',art:'standard'}));
  assert.equal(orderedStarter.length, 15);
  assert.equal(orderedStarter[0].code, 'OP10-099', 'Le ristampe del mazzo devono rispettare l’ordine per codice');
  const namiSpecials = groupCardResults(filterCards(cards, {game:'onepiece',sets:['onepiece:OP05'],query:'OP01-016',art:'standard'}));
  assert.equal(namiSpecials.length, 1);
  assert.equal(namiSpecials[0].rarity, 'SP CARD');
  assert.ok(cardVariants(cards, namiSpecials[0]).some(card => card.setId === 'OP01' && !card.isAlternative));
  assert.ok(cardVariants(cards, namiSpecials[0]).some(card => (card.setIds || [card.setId]).includes('EB05')));
  const law = cards.find(card => card.id === 'op-ST02-009');
  const lawVersions = cardPopupVersions(cards, law, catalog.sets);
  assert.equal(lawVersions.length, 4, 'ST02-009 deve includere anche Revision Pack nel popup');
  assert.deepEqual(Array.from(lawVersions, version => version.setId).sort(), ['FAMILY_DECK_JP','REVISION','ST02','ST02_PRE']);
  for (const setId of ['ST02','FAMILY_DECK_JP','ST02_PRE']) {
    const entry = groupCardResults(filterCards(cards, {game:'onepiece',sets:[`onepiece:${setId}`],query:'ST02-009',art:'standard'}))[0];
    assert.ok(entry);
    assert.equal(JSON.stringify(cardPopupVersions(cards, entry, catalog.sets).map(version => version.versionKey)), JSON.stringify(lawVersions.map(version => version.versionKey)), `Popup diverso entrando da ${setId}`);
    assert.equal(selectPopupVersion(lawVersions, entry.id, setId).setId, setId);
  }
  assert.equal(JSON.stringify(cardProductImages(law, 'FAMILY_DECK_JP').map(image => image.language)), JSON.stringify(['ja']));
  assert.equal(JSON.stringify(cardProductImages(law, 'ST02').map(image => image.language)), JSON.stringify(['en','ja']));
  assert.equal(JSON.stringify(selectPopupVersion(lawVersions, 'op-TCG415805', 'ST02_PRE').imageVersions.map(image => image.language)), JSON.stringify(['en']));
  const opFamilies = new Map();
  for (const card of cards.filter(card => card.game === 'onepiece')) {
    if (!opFamilies.has(card.code)) opFamilies.set(card.code, []);
    opFamilies.get(card.code).push(card);
  }
  for (const [code, family] of opFamilies) {
    const versions = cardPopupVersions(family, family[0], catalog.sets);
    const expected = JSON.stringify(versions.map(version => version.versionKey));
    assert.equal(new Set(versions.map(version => version.versionKey)).size, versions.length, `Edizione duplicata nel popup: ${code}`);
    for (const card of family) {
      assert.equal(JSON.stringify(cardPopupVersions(family, card, catalog.sets).map(version => version.versionKey)), expected, `Famiglia popup incompleta: ${card.id}`);
      for (const product of card.category === 'DON!!' ? [{setId:card.setId}] : card.productVersions || [{setId:card.setId}]) assert.ok(versions.some(version => version.id === card.id && version.setId === product.setId), `Prodotto nascosto nel popup: ${card.id}/${product.setId}`);
    }
  }
  for (const set of catalog.sets.filter(set => /_PRE$/.test(set.id))) {
    assert.ok(set.name.endsWith('(Prerelease)'));
    assert.equal(setPreviewTitle(set), `[${set.id.split('_')[0]}] ${set.name}`);
    assert.ok(!/pre[- ]release/i.test(set.name));
  }
  assert.equal(formatSetName('Worst Generation (Super Pre-Release)', 'onepiece'), 'Worst Generation (Super Prerelease)');

  // Exercise the real popup renderer: switch editions of the same artwork,
  // retaining the family, navigation snapshot, language choices and scroll.
  const popupDialog = {open:false, innerHTML:'', dataset:{}, classList:{toggle(){}}, showModal(){this.open=true;}};
  const variantList = {scrollLeft:0};
  const popupNodes = {'#card-dialog':popupDialog,'.variant-list':variantList,'.detail-info-content':{},'.variant-thumb.selected':{focus(){}},'.detail-close':{focus(){}}};
  const popupContext = createContext({
    catalog:{...catalog,cards}, state:{sets:['onepiece:FAMILY_DECK_JP']}, results:[law],
    currentCardId:undefined, currentCardSetId:undefined, filteredCardIds:[], filteredCardIndex:0,
    imageLanguages:new Map(), resolveAlias, cardArtworkKey, cardPopupVersions, selectPopupVersion, cardDisplaySet,
    languageImages, popupReleaseDateRows, factValue, setFullLabel, cardRarities,
    $:selector => popupNodes[selector],
    esc:value => String(value ?? '').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
    icon:() => '', numbersLabel:card => card.code, dateLabel:date => date, shortDateLabel:date => date, finishName:finish => finish,
    languageName:code => ({en:'Inglese',ja:'Giapponese'}[code] || code),
    favoriteMarkup:() => '<button class="detail-favorite">Cuore</button>', reviewDrafts:new Map(),
  });
  new Script(app.slice(app.indexOf('function openCard('), app.indexOf('function stepCard('))).runInContext(popupContext);
  runInContext("openCard('op-ST02-009')", popupContext);
  assert.equal((popupDialog.innerHTML.match(/data-variant=/g) || []).length, 4);
  assert.equal((popupDialog.innerHTML.match(/aria-pressed="true"/g) || []).length, 1);
  assert.equal(runInContext('currentCardSetId', popupContext), 'FAMILY_DECK_JP');
  assert.match(popupDialog.innerHTML, /ST02_009_JAP.webp/);
  assert.ok(!popupDialog.innerHTML.includes('id="image-language"'), 'Il Family Deck non deve offrire una lingua inglese inesistente');
  variantList.scrollLeft = 137;
  assert.equal((popupDialog.innerHTML.match(/class="release-date-row"/g) || []).length, 1);
  assert.ok(!popupDialog.innerHTML.includes('release-date-spacer'));
  runInContext("openCard('op-ST02-009', 'variant', 'ST02')", popupContext);
  assert.equal(runInContext('currentCardSetId', popupContext), 'ST02', 'Il click su ST02 deve prevalere sul filtro Family Deck');
  assert.match(popupDialog.innerHTML, /id="image-language"/);
  assert.match(popupDialog.innerHTML, /ST02_009.webp/);
  const dateLine = popupDialog.innerHTML.match(/<div class="release-date-row">([\s\S]*?)<\/div>/)[1];
  assert.equal((dateLine.match(/<time /g) || []).length, 2, 'Date JAP e INT sulla stessa riga');
  const codeLine = popupDialog.innerHTML.match(/<div class="card-identity-row">([\s\S]*?)<\/div>/)[1];
  assert.ok(codeLine.includes('Codice / Rarità') && codeLine.includes('ST02-009') && codeLine.includes('SR'));
  assert.equal(variantList.scrollLeft, 137);
  assert.equal((popupDialog.innerHTML.match(/aria-pressed="true"/g) || []).length, 1);
  runInContext("openCard('op-TCG415805', 'variant', 'ST02_PRE')", popupContext);
  assert.equal(runInContext('currentCardSetId', popupContext), 'ST02_PRE');
  assert.match(popupDialog.innerHTML, /\(Prerelease\)/);
  assert.match(popupDialog.innerHTML, /2022-11-18/);
  assert.ok(!popupDialog.innerHTML.includes('id="image-language"'));
  assert.equal(variantList.scrollLeft, 137);
  assert.equal(JSON.stringify(runInContext('filteredCardIds', popupContext)), JSON.stringify(['op-ST02-009']));
  runInContext("openCard('op-TCG415805', 'refresh')", popupContext);
  assert.equal(runInContext('currentCardSetId', popupContext), 'ST02_PRE');
  popupContext.state.sets = [];
  runInContext("openCard('pk-base1-4')", popupContext);
  assert.match(popupDialog.innerHTML, /Numero \/ Rarità/);
  assert.equal((popupDialog.innerHTML.match(/class="release-date-row"/g) || []).length, 1, 'Anche Pokémon usa la riga compatta delle date');
  assert.match(popupDialog.innerHTML, /<time /);

  // Exercise routing from the grouped Double Pack directory tile.
  const routeNodes = {'#game-picker':{},'#image-dialog':{open:false},'#card-dialog':{open:false}};
  const routeContext = createContext({catalog, state:{game:'onepiece'}, location:{hash:'#catalogo/onepiece/DOUBLE_PACKS'}, window:{scrollTo(){}}, $:selector=>routeNodes[selector], closeFilterPanels(){}, setMobileFiltersOpen(){}, populateFilters(){}, render(){}, catalogSetSelections});
  new Script(app.slice(app.indexOf('function readRoute()'),app.indexOf('function favoriteMarkup('))).runInContext(routeContext);
  runInContext('readRoute()',routeContext);
  assert.equal(JSON.stringify(routeContext.state.sets),JSON.stringify(packKeys));
  assert.equal(routeContext.state.view,'catalog');
  assert.equal(routeContext.state.art,'all', 'La raccolta Double Pack deve mostrare subito tutti i disegni DON');
  assert.equal(routeContext.state.query,'');
  routeContext.location.hash='';
  runInContext('readRoute()',routeContext);
  assert.equal(routeContext.state.view,'expansions','La homepage senza hash deve aprire Espansioni');
  routeContext.location.hash='#catalogo/pokemon/base1';
  runInContext('readRoute()',routeContext);
  assert.equal(routeContext.state.view,'catalog','I link diretti al catalogo devono continuare a funzionare');
  assert.equal(JSON.stringify(routeContext.state.sets),JSON.stringify(['pokemon:base1']));
  // Review notes are appended atomically, isolated from collection notes and card metadata.
  const noteRoot=path.join(root,'temp','review-notes-tests');
  await mkdir(noteRoot,{recursive:true});
  const noteFixture={cards:{'pk-base1-4':{issues:['KEEP_ME']},'op-ST02-009':{issues:[]},'op-OP01-001AA':{issues:[]}},userObservations:{schemaVersion:1,entries:[]},sets:{'pokemon:base1':{marker:'unchanged'}},marker:'preserve'};
  await writeFile(path.join(noteRoot,'CARD_REVIEW.json'),JSON.stringify(noteFixture));
  const notePayload={cardId:'pk-base1-4',setId:'base1',language:'en',text:'Prima osservazione'};
  const firstNote=await saveObservation(noteRoot,catalog,notePayload);
  await Promise.all(['Seconda osservazione','Terza osservazione'].map(text=>saveObservation(noteRoot,catalog,{...notePayload,text})));
  await saveObservation(noteRoot,catalog,{...notePayload,id:firstNote.id});
  let noteRegistry=JSON.parse(await readFile(path.join(noteRoot,'CARD_REVIEW.json'),'utf8'));
  assert.equal(noteRegistry.userObservations.entries.length,3,'Nessuna nota persa nei salvataggi concorrenti o duplicata al retry');
  assert.deepEqual(noteRegistry.cards,noteFixture.cards);
  assert.deepEqual(noteRegistry.sets,noteFixture.sets);
  assert.equal(noteRegistry.marker,'preserve');
  assert.equal(Object.keys(noteRegistry).at(-1),'userObservations','Le osservazioni devono essere l’ultima sezione anche se esistevano già');
  for (const change of [{cardId:'missing'},{setId:'missing'},{language:'xx'},{text:' '},{text:'x'.repeat(5001)}]) await assert.rejects(()=>saveObservation(noteRoot,catalog,{...notePayload,...change}));
  const noteServer=http.createServer((req,res)=>handleObservationRequest(req,res,noteRoot,async()=>catalog));
  await new Promise(resolve=>noteServer.listen(0,'127.0.0.1',resolve));
  try {
    const origin=`http://127.0.0.1:${noteServer.address().port}`;
    const post=(originHeader,text)=>fetch(origin+'/api/card-observations',{method:'POST',headers:{Origin:originHeader,'Content-Type':'application/json'},body:JSON.stringify({...notePayload,text})});
    assert.equal((await post('https://unrelated.example','Rejected')).status,403);
    assert.equal((await post(origin,'Osservazione via endpoint locale')).status,201);
    noteRegistry=JSON.parse(await readFile(path.join(noteRoot,'CARD_REVIEW.json'),'utf8'));
    assert.equal(noteRegistry.userObservations.entries.length,4);
  } finally {await new Promise(resolve=>noteServer.close(resolve));}
  const selectedEdition=await saveObservation(noteRoot,catalog,{cardId:'op-ST02-009',setId:'FAMILY_DECK_JP',language:'ja',text:'Controlla questa ristampa'});
  assert.equal(selectedEdition.versionKey,'op-ST02-009:FAMILY_DECK_JP');
  assert.equal(selectedEdition.cardSnapshot.setId,'FAMILY_DECK_JP');
  assert.equal(selectedEdition.cardSnapshot.imageLanguage,'ja');
  assert.deepEqual(selectedEdition.cardSnapshot.imageVersions.map(image=>image.language),['ja']);
  assert.equal(selectedEdition.cardSnapshot.releaseDate,catalog.sets.find(set=>set.game==='onepiece' && set.id==='FAMILY_DECK_JP').releaseDate);
  assert.equal(selectedEdition.cardSnapshot.releaseDates?.ja || selectedEdition.cardSnapshot.releaseDate,'2023-04-29');
  assert.equal(selectedEdition.variantLabel,'Family Deck Set');
  assert.ok(selectedEdition.image.endsWith('_JAP.webp'));
  assert.equal(catalog.cards.find(card=>card.id==='op-ST02-009').setId,'ST02','Lo snapshot non deve modificare il catalogo');
  const activeAlternative=catalog.cards.find(card=>card.id==='op-OP01-001AA');
  const selectedAlternative=await saveObservation(noteRoot,catalog,{cardId:activeAlternative.id,setId:activeAlternative.setId,language:activeAlternative.imageLanguage,text:'Controlla solo questo artwork',cardSnapshot:{id:'wrong'}});
  assert.equal(selectedAlternative.cardId,activeAlternative.id);
  assert.equal(selectedAlternative.cardSnapshot.id,activeAlternative.id);
  assert.equal(selectedAlternative.cardSnapshot.isAlternative,true,'Registrare l’artwork attivo, senza sostituirlo con la carta standard');
  noteRegistry=JSON.parse(await readFile(path.join(noteRoot,'CARD_REVIEW.json'),'utf8'));
  noteRegistry.laterMaintenance={keep:true};
  await writeFile(path.join(noteRoot,'CARD_REVIEW.json'),JSON.stringify(noteRegistry));
  await saveObservation(noteRoot,catalog,{...notePayload,id:firstNote.id});
  noteRegistry=JSON.parse(await readFile(path.join(noteRoot,'CARD_REVIEW.json'),'utf8'));
  assert.equal(noteRegistry.userObservations.entries.length,6);
  assert.equal(Object.keys(noteRegistry).at(-1),'userObservations');
  assert.equal(noteRegistry.laterMaintenance.keep,true);
  // Dropdowns match the visible field, using local coordinates inside a mobile drawer.
  const optionPanel = {style:{}};
  const filterAnchor = {top:200,bottom:240,left:15,width:270};
  const filterBox = {top:180,bottom:240};
  const filterPositionContext=createContext({
    window:{innerHeight:844},mobileFilterMedia:{matches:true},
    $:selector=>selector==='.filter-value'?{getBoundingClientRect:()=>filterAnchor}:selector==='.filter-options'?optionPanel:{getBoundingClientRect:()=>({bottom:108})},
  });
  new Script(app.slice(app.indexOf('function positionFilterPanel('),app.indexOf("$$('.multi-filter').forEach"))).runInContext(filterPositionContext);
  filterPositionContext.filter={getBoundingClientRect:()=>filterBox};
  runInContext('positionFilterPanel(filter)',filterPositionContext);
  assert.equal(optionPanel.style.width,'270px');
  assert.equal(optionPanel.style.left,'0px');
  assert.equal(optionPanel.style.top,'65px');
  assert.equal(optionPanel.style.position,'absolute');
  filterPositionContext.mobileFilterMedia.matches=false;
  runInContext('positionFilterPanel(filter)',filterPositionContext);
  assert.equal(optionPanel.style.width,'270px');
  assert.equal(optionPanel.style.left,'15px');
  assert.equal(optionPanel.style.top,'245px');
  assert.equal(optionPanel.style.position,'fixed');
  filterPositionContext.mobileFilterMedia.matches=true;
  Object.assign(filterAnchor,{top:720,bottom:760});
  Object.assign(filterBox,{top:700,bottom:760});
  runInContext('positionFilterPanel(filter)',filterPositionContext);
  assert.equal(optionPanel.style.bottom,'45px');
  assert.equal(optionPanel.style.top,'auto');
  const crossSetCards = [
    {id:'original',game:'onepiece',code:'OP01-016',setId:'OP01',isAlternative:false},
    {id:'special',game:'onepiece',code:'OP01-016',setId:'OP05',rarity:'SP CARD',isAlternative:true},
    {id:'unrelated',game:'onepiece',code:'OP01-017',setId:'OP05',isAlternative:false},
    {id:'other-game',game:'pokemon',code:'OP01-016',setId:'base1',isAlternative:false},
  ];
  const setSpecial = groupCardResults(filterCards(crossSetCards, {game:'onepiece',sets:['onepiece:OP05'],art:'standard'}));
  assert.deepEqual(Array.from(setSpecial, card => card.id), ['special','unrelated']);
  assert.deepEqual(Array.from(cardVariants(crossSetCards, setSpecial[0]), card => card.id), ['original','special']);
  assert.deepEqual(Array.from(groupCardResults(filterCards(crossSetCards, {game:'onepiece',sets:['onepiece:OP01'],art:'standard'})), card => card.id), ['original']);
  assert.equal(cardDisplaySet({...crossSetCards[1],setIds:['OP01','OP05']}, ['onepiece:OP05'], catalog.sets).id, 'OP05');
  assert.equal(cardDisplaySet(crossSetCards[0], ['onepiece:OP05'], catalog.sets).id, 'OP01');
  const alternativeOnly = [{id:'special',game:'onepiece',code:'ST99-001',setId:'OP13',isAlternative:true}];
  assert.equal(filterCards(alternativeOnly, {game:'onepiece',art:'standard'}).length, 1);
  const favorites = ['op-OP01-001AA'];
  assert.equal(filterCards(cards, { ...defaults, onlyFavorites: true }, favorites)[0].id, favorites[0]);
  assert.equal(filterCards(cards, { ...defaults, onlyFavorites: true }, new Set(favorites))[0].id, favorites[0]);
  for (const id of ['op-OP01-051AA2', 'op-ST01-012AA5', 'op-ST03-009AA', 'op-ST04-003AA6']) assert.ok(filterCards(cards, { ...defaults, sets: ['onepiece:OP03'] }).some(card => card.id === resolveAlias(id, catalog.aliases)));
  const dons = filterCards(cards, { ...defaults, game: 'onepiece', categories: ['DON!!'] });
  assert.equal(dons.length, cards.filter(card => card.game === 'onepiece' && card.category === 'DON!!').length);
  for (const color of ['Red','Green','Blue','Purple','Black','Yellow']) {
    assert.equal(filterCards(cards, {...defaults,game:'onepiece',categories:['DON!!'],traits:[color]}).length,0,'I DON non appartengono a nessun colore');
    assert.ok(filterCards(cards, {...defaults,game:'onepiece',traits:[color]}).every(card=>card.category!=='DON!!'));
  }
  const originalDonIds = new Set(['op-don-549342','op-don-456059','op-don-482273','op-don-498519','op-don-OP04','op-don-OP05','op-don-OP06','op-don-OP07','op-don-OP08','op-don-OP09','op-don-OP10','op-don-OP11','op-don-OP12','op-don-OP13','op-don-672185','op-don-672188','op-don-686650','op-don-698313','op-don-712747','op-don-712748','op-don-712749','op-don-712750','op-don-735288','op-don-677560','op-don-677566','op-don-677568','op-don-677570','op-don-728077','op-don-725205','op-don-EB02','op-TCG434340']);
  const originalDons = dons.filter(card => originalDonIds.has(card.id));
  assert.equal(originalDons.length, originalDonIds.size, 'Gli ID DON!! dei preferiti esistenti vanno conservati');
  const previousDons = originalDons.filter(card => /^OP(?:0[1-9]|1[0-3])$/.test(card.setId));
  assert.equal(previousDons.length, 14);
  for (const language of ['en','ja']) {
    const designs = originalDons.map(card => languageImages(card).find(image => image.language === language));
    assert.equal(designs.filter(Boolean).length, 30, `Lingua DON!! mancante: ${language}`);
    assert.equal(new Set(designs.filter(Boolean).map(image => image.image)).size, 30, `Disegno DON!! duplicato: ${language}`);
  }
  for (const card of originalDons) {
    const versions = languageImages(card);
    if (!versions.some(image => image.language === 'en')) assert.ok(audit.cards[card.id].issues.includes('MISSING_ENGLISH_SCAN'), `Scansione DON!! inglese non documentata: ${card.id}`);
    assert.ok(versions.some(image => image.language === 'ja') || audit.cards[card.id].issues.includes('NO_JAPANESE_PRODUCT'), `Lingua DON!! mancante: ${card.id}/ja`);
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
  assert.ok(migrated.needsMigration && migrated.collection.lists[0].favorites.includes('legacy'));
  assert.equal(migrated.collection.lists[0].notes.legacy, 'Conservare');
  saved.clear();
  saved.set(LEGACY_STORAGE_KEYS[1], JSON.stringify(backup));
  assert.ok(loadCollection(storage).collection.lists[0].favorites.includes('legacy'));
  saved.set(STORAGE_KEY, JSON.stringify({ schemaVersion: 1, favorites: ['current'], notes: {} }));
  const current = loadCollection(storage);
  assert.ok(current.needsMigration && current.collection.lists[0].favorites.includes('current'));
  const library = validateLibrary({schemaVersion:2,lists:[
    {id:'first',name:'Lista personale',favorites:['legacy','unavailable'],notes:{legacy:'Nota conservata',unavailable:'Fuori catalogo'}},
    {id:'second',name:'Da cercare',favorites:[],notes:{}}
  ],defaultListId:'second'});
  const assigned = assignFavoriteLists(library, 'canonical', ['first','second'], {legacy:'canonical'});
  assert.equal(assigned.lists[0].favorites.length, 2, 'Non duplicare un alias nella stessa lista');
  assert.ok(assigned.lists[1].favorites.includes('canonical'));
  assert.equal(library.lists[1].favorites.length, 0, 'Non alterare lo stato di origine');
  const removed = assignFavoriteLists(assigned, 'canonical', ['second'], {legacy:'canonical'});
  assert.deepEqual(Array.from(removed.lists[0].favorites), ['unavailable']);
  assert.ok(removed.lists[1].favorites.includes('canonical'), 'Rimuovere da una lista non deve toccare le altre');
  const exported = listContent(assigned.lists[0]);
  assert.ok(!('name' in exported) && !('id' in exported) && !('defaultListId' in exported));
  assert.equal(exported.notes.unavailable, 'Fuori catalogo');
  const imported = importListContent(assigned, 'second', {...exported,name:'Nome da ignorare'});
  assert.equal(imported.lists[1].name, 'Da cercare');
  assert.ok(imported.lists[1].favorites.includes('unavailable'));
  assert.equal(imported.lists[1].notes.legacy, 'Nota conservata');
  assert.equal(imported.defaultListId, 'second');
  assert.equal(importListContent(imported, 'second', exported).lists[1].favorites.length, imported.lists[1].favorites.length);
  assert.throws(() => importListContent(imported, 'missing', exported));
  assert.equal(validateLibrary({...library,defaultListId:'deleted'}).defaultListId, null);
  assert.throws(() => validateLibrary({...library,lists:[]}));
  assert.throws(() => validateLibrary({...library,lists:[library.lists[0],library.lists[0]]}));
  saved.set(STORAGE_KEY, JSON.stringify(imported));
  const restored = loadCollection(storage);
  assert.ok(!restored.needsMigration);
  assert.equal(restored.collection.defaultListId, 'second');
  assert.equal(restored.collection.lists[1].name, 'Da cercare');
  assert.equal(emptyLibrary().lists.length, 1);
  for (const game of ['pokemon','onepiece']) {
    const artworkSamples = [
      {id:'normal',game,code:'001',isAlternative:false},
      {id:'alt1',game,code:'001',isAlternative:true},
      {id:'alt2',game,code:'001',isAlternative:true},
    ];
    const view = art => visibleCardResults(filterCards(artworkSamples,{game,art}),art);
    assert.deepEqual(Array.from(view('all'),card=>card.id), ['normal','alt1','alt2'], game+' Tutti deve mostrare ogni artwork');
    assert.deepEqual(Array.from(view('alternative'),card=>card.id), ['alt1','alt2']);
    assert.deepEqual(Array.from(view('standard'),card=>card.id), ['normal']);
    const actual = cards.filter(card => card.game === game);
    const expectedArtworkCount=game==='pokemon' ? new Set(actual.map(card=>card.artworkGroup || card.id)).size : actual.length;
    assert.equal(visibleCardResults(filterCards(cards,{game,art:'all'}),'all').length, expectedArtworkCount);
  }
  const grouped = groupCardResults([{id:'a',game:'onepiece',code:'OP01-003',isAlternative:true},{id:'b',game:'onepiece',code:'OP01-003',isAlternative:false},{id:'c',game:'onepiece',code:'OP01-004',isAlternative:false}]);
  assert.equal(grouped.length, 2);
  assert.equal(grouped[0].id, 'b');
  const reprints=[
    {id:'print-a',game:'pokemon',name:'Alakazam',code:'A-1',number:'1',setId:'A',artworkGroup:'drawing-one',isAlternative:false,image:'a.webp',imageLanguage:'en'},
    {id:'print-b',game:'pokemon',name:'Alakazam',code:'B-7',number:'7',setId:'B',artworkGroup:'drawing-one',isAlternative:false,image:'b.webp',imageLanguage:'ja'},
    {id:'different-drawing',game:'pokemon',name:'Alakazam',code:'C-2',number:'2',setId:'C',artworkGroup:'drawing-two',isAlternative:false,image:'c.webp',imageLanguage:'en'},
  ];
  assert.deepEqual(Array.from(visibleCardResults(reprints,'all'),card=>card.id),['print-a','different-drawing'],'Riunire soltanto le ristampe della stessa illustrazione');
  assert.deepEqual(Array.from(cardVariants(reprints,reprints[1]),card=>card.id),['print-a','print-b']);
  assert.deepEqual(Array.from(cardVariants(reprints,reprints[2]),card=>card.id),['different-drawing'],'Stesso nome non significa stessa illustrazione');
  const filteredReprint=visibleCardResults(filterCards(reprints,{game:'pokemon',sets:['pokemon:B'],art:'all'}),'all');
  assert.deepEqual(Array.from(filteredReprint,card=>card.id),['print-b'],'Il filtro del set deve conservare la stampa e il codice selezionati');
  assert.equal(cardVariants(reprints,filteredReprint[0]).length,2,'Il popup deve includere le ristampe degli altri set');
  const printOptions=cardPopupVersions(reprints,reprints[0],[{game:'pokemon',id:'A',name:'Expansion A'},{game:'pokemon',id:'B',name:'Expansion B'},{game:'pokemon',id:'C',name:'Expansion C'}]);
  assert.deepEqual(Array.from(printOptions,card=>card.variantLabel),['Expansion A · 1','Expansion B · 7']);
  assert.equal(selectPopupVersion(printOptions,'print-b','B').image,'b.webp');
  const savedPrint=visibleCardResults(filterCards(reprints,{game:'pokemon',art:'all',onlyFavorites:true},['print-b']),'all');
  assert.deepEqual(Array.from(savedPrint,card=>card.id),['print-b'],'I preferiti devono restare legati alla singola stampa');
  assert.deepEqual(Array.from(visibleCardResults(reprints.map(card=>({...card,game:'onepiece'})),'all'),card=>card.id),reprints.map(card=>card.id),'I premi One Piece non devono essere riuniti dal nuovo criterio Pokemon');
  const typeReview=audit.pokemonTypeObservationReview;
  assert.equal(typeReview.resolved.length,36);
  for (const resolved of typeReview.resolved) {
    const card=cards.find(card=>card.id===resolved.cardId);
    assert.deepEqual(card.types,resolved.types);
    assert.ok(!audit.cards[card.id].issues.includes('MISSING_TYPES'));
    const note=audit.userObservations.entries.find(note=>note.id===resolved.noteId);
    assert.equal(note.status,'resolved');
    assert.equal(note.cardId,card.id);
    if (/Terra/i.test(note.text)) assert.deepEqual(card.types,['Fighting']);
  }
  const artworkAudit=audit.pokemonArtworkGrouping;
  const grassReview=audit.pokemonGrassListTypeReview;
  assert.equal(grassReview.resolved.length,99);
  assert.equal(new Set(grassReview.resolved.map(item=>item.cardId)).size,99);
  assert.match(grassReview.sourceList.sha256,/^[a-f0-9]{64}$/);
  for (const proof of grassReview.resolved) {
    const card=cards.find(card=>card.id===proof.cardId);
    assert.equal(card?.game,'pokemon');
    assert.equal(card.category,'Pokemon');
    assert.deepEqual(card.types,['Grass']);
    assert.deepEqual(proof.previousTypes,[]);
    assert.deepEqual(proof.types,['Grass']);
    assert.match(proof.sha256,/^[a-f0-9]{64}$/);
    assert.ok(proof.comparison && audit.cards[card.id].metadata.typeReference);
    assert.ok(!audit.cards[card.id].issues.includes('MISSING_TYPES'));
    assert.ok(!audit.pokemonDeferredVariantAssociation.cardIds.includes(card.id));
  }
  const groupedPrintIds=new Set();
  const actualCards=new Map(cards.map(card=>[card.id,card]));
  const meadowJP=actualCards.get('pk-jp_collection-x-008-vivillon-v1');
  const meadowEN=actualCards.get('pk-cc_xy-base-set-17-vivillon');
  const elegantJP=actualCards.get('pk-jp_collection-x-008-vivillon-v2');
  const highPlainsEN=actualCards.get('pk-cc_xy-base-set-17-vivillon-high-plains-orange');
  assert.equal(cardArtworkKey(meadowJP),cardArtworkKey(meadowEN),'Collegare le stampe Meadow con la stessa illustrazione');
  assert.equal(new Set([meadowJP,elegantJP,highPlainsEN].map(cardArtworkKey)).size,3,'Stesso nome, numero e posa non devono unire motivi alari diversi di Vivillon');
  assert.deepEqual(elegantJP.types,['Grass']);
  assert.deepEqual(Array.from(languageImages(elegantJP),image=>image.language),['ja']);
  assert.deepEqual(Array.from(languageImages(highPlainsEN),image=>image.language),['en']);
  assert.equal(meadowJP.imageWidth,742);
  assert.equal(meadowJP.imageHeight,1044);
  assert.equal(cardArtworkKey(actualCards.get('pk-jp_plasma-gale-076')),cardArtworkKey(actualCards.get('pk-cc_boundaries-crossed-149')),'Riunire Skyla tramite confronto documentato anche se i paintingId sorgente sono diversi');
  assert.equal(cardArtworkKey(actualCards.get('pk-jp_hail-blizzard-054')),cardArtworkKey(actualCards.get('pk-cc_dark-explorers-106')),'Collegare Groudon-EX al set precedente senza cambiare gli ID');
  const professorStamp=actualCards.get('pk-cc_xy-base-set-122-v-crosshatch-holo-professor-program-stamp');
  assert.equal(professorStamp.imageWidth,720);
  assert.equal(professorStamp.imageHeight,1000);
  assert.equal(cardArtworkKey(professorStamp),cardArtworkKey(actualCards.get('pk-cc_xy-base-set-122')),'Il timbro resta una stampa selezionabile della stessa illustrazione');
  assert.equal(artworkAudit.pendingImageComparisons.length,0);
  assert.equal(artworkAudit.batches['2012-2015-next-thirty'].importedCardIds.length,3692);
  assert.equal(artworkAudit.batches['2015-2017-next-twenty'].importedCardIds.length,2181);
  assert.equal(artworkAudit.batches['2017-next-five'].importedCardIds.length,463);
  const clefairyBase=actualCards.get('pk-base1-5');
  const clefairyEvolutions=actualCards.get('pk-cc_evolutions-63');
  assert.equal(cardArtworkKey(clefairyBase),cardArtworkKey(clefairyEvolutions),'La ristampa Evolutions mantiene la stessa illustrazione del Base Set');
  assert.deepEqual(clefairyBase.types,['Colorless']);
  assert.deepEqual(clefairyEvolutions.types,['Fairy'],'Condividere un’illustrazione non autorizza a copiare il tipo fra ristampe');
  assert.deepEqual(Array.from(visibleCardResults(filterCards([clefairyBase,clefairyEvolutions],{game:'pokemon',art:'all',traits:['Fairy']}),'all'),card=>card.id),[clefairyEvolutions.id]);
  assert.equal(cardArtworkKey(actualCards.get('pk-base1-4')),cardArtworkKey(actualCards.get('pk-cc_evolutions-11')),'Charizard Evolutions condivide il popup con l’illustrazione originale');
  const newAlakazam=xySunMoonCards.filter(card=>card.category==='Pokemon' && /alakazam/i.test(card.name));
  assert.equal(visibleCardResults(newAlakazam,'all').length,5,'Conservare le cinque diverse illustrazioni dei nuovi Alakazam-EX');
  for (const [jp,en] of [['023','25'],['024','26'],['080','117'],['081','118'],['088','125']]) assert.equal(cardArtworkKey(actualCards.get(`pk-jp_awakening-psychic-king-${jp}`)),cardArtworkKey(actualCards.get(`pk-cc_fates-collide-${en}`)));
  assert.equal(cardArtworkKey(actualCards.get('pk-cc_sun-moon-164')),cardArtworkKey(actualCards.get('pk-jp_enhanced-expansion-pack-sun-moon-069')),'Riunire l’illustrazione dell’Energia 2017 nelle lingue verificate');
  assert.notEqual(cardArtworkKey(actualCards.get('pk-cc_sun-moon-164')),cardArtworkKey(actualCards.get('pk-cc_evolutions-91')),'Le Energie con simbolo uguale e illustrazione diversa rimangono separate');
  assert.deepEqual(actualCards.get('pk-jp_facing-a-new-trial-032').types,['Fighting']);
  assert.deepEqual(actualCards.get('pk-jp_cruel-traitor-010').types,['Fire','Grass']);
  for (const group of artworkAudit.groups) {
    assert.ok(group.cardIds.length>1);
    for (const id of group.cardIds) {
      assert.ok(!groupedPrintIds.has(id),`Stampa in più gruppi: ${id}`);
      groupedPrintIds.add(id);
      assert.equal(actualCards.get(id)?.game,'pokemon');
      assert.equal(actualCards.get(id).artworkGroup,group.id);
    }
  }
  for (const card of cards.filter(card=>card.artworkGroup)) assert.ok(groupedPrintIds.has(card.id));
  const alakazam=cards.filter(card=>card.game==='pokemon' && /alakazam/i.test(card.name) && card.releaseDate<'2012-01-01');
  assert.equal(alakazam.length,27,'Conservare tutti gli ID delle stampe di Alakazam');
  assert.equal(visibleCardResults(alakazam,'all').length,9,'Le nove illustrazioni di Alakazam devono restare separate');
  const expedition=cardVariants(cards,actualCards.get('pk-ecard1-1'));
  assert.deepEqual(new Set(expedition.map(card=>card.id)),new Set(['pk-ecard1-1','pk-ecard1-33','pk-jp-E1-084','pk-jp-E1-116','pk-cc_e-card-box-toppers-1']));
  const skyridge=cardVariants(cards,actualCards.get('pk-cc_skyridge-h1'));
  assert.equal(skyridge.length,5);
  assert.ok(skyridge.every(card=>!expedition.some(print=>print.id===card.id)),'Expedition e Skyridge hanno illustrazioni diverse');
  assert.equal(cardVariants(cards,actualCards.get('pk-base1-1')).length,3,'Riunire la ristampa Base Set 2 e Legendary Collection con il Base Set');
  assert.equal(resolveAlias('legacy', {legacy:'duplicate', duplicate:'canonical'}), 'canonical');
  for (const game of ['pokemon','onepiece']) {
    const groups = groupExpansionSets(catalog.sets.filter(set => set.game === game));
    assert.equal(groups.flatMap(group => group.sets).length, catalog.sets.filter(set => set.game === game).length);
    assert.equal(new Set(groups.map(group => group.name)).size, groups.length);
  }
  for (const [legacy, target] of Object.entries(catalog.aliases)) assert.ok(catalog.cards.some(card => card.id === resolveAlias(target, catalog.aliases)), `Preferito senza destinazione: ${legacy}`);
  console.log('Test funzionali superati: ricerca, set, filtri, artwork, lingue, backup e migrazione dei preferiti.');
}

if (process.argv.includes('--check')) await check();
else if (process.argv.includes('--test')) await test();
else {
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 5300);
  const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' };
  const server = http.createServer(async (request, response) => {
    if (request.url?.split('?')[0]==='/api/card-observations') return handleObservationRequest(request,response,root,readCatalog);
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
