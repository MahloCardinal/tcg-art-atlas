# TCG Art Atlas — riferimento per gli aggiornamenti IA

Catalogo statico di carte Pokémon e One Piece. Tutto gira nel browser: nessun database, account, dipendenza JavaScript o API a runtime. Si pubblica `public/`; `public/index.html` funziona anche da file locale.

## Struttura e comandi

```text
public/index.html    Header, filtri, pagine e dialog
public/style.css     Tema, layout responsive, immagini e animazioni
public/app.js        Unica sorgente di logica e filtri
public/catalog.js    Unica sorgente dati per il sito
public/cards/        Gioco/set/immagine, un WebP per scansione necessaria
public/logos/        Loghi, simboli dei set e immagini ufficiali dei prodotti
public/favicon.svg  Favicon vettoriale
scripts/site.mjs     Server, controlli strutturali e test
CARD_REVIEW.json     Registro interno per l’IA, escluso dal frontend
```

`npm run dev` avvia http://127.0.0.1:5300. `npm test` verifica filtri, lingue, gruppi, anteprime, backup e alias; `npm run build` controlla sintassi, catalogo e immagini. Nessun bundle o copia generata: hosting con output `public/`, configurato in `vercel.json`. Node >=20 serve solo agli strumenti; non occorre `npm install`.

Non creare `.agents`. Un solo README; `CARD_REVIEW.json` è l’unico documento di manutenzione aggiuntivo, richiesto dall’utente. Al massimo una sottocartella dentro le cartelle della root, tranne `public/cards/`, che può organizzarsi per gioco e set. Non conservare importer, cache, originali o copie ridimensionate. Usare `temp/` durante il lavoro e lasciarla vuota alla fine. Non committare, fare push o pubblicare salvo richiesta.

## Comportamento da preservare

- Header con logo TCG Art Atlas; selettore del gioco interamente cliccabile, freccia separata e opzioni con spazio tra i loghi. Sottosezioni Catalogo, Espansioni, Preferiti. Home torna al catalogo del gioco e azzera i filtri.
- Ricerca separata dai selettori, chip rimovibili e conteggio dei filtri. Selezioni multiple in OR nello stesso filtro, AND tra filtri. DON!! ignora il colore se selezionato esplicitamente. Menu larghi quanto la loro voce più lunga, minimo 220 px e limite dello schermo; su mobile la barra scorre orizzontalmente. In One Piece Leader precede Personaggio; le rarità hanno nome e sigla. I valori dei filtri restano codici. Testo dei pulsanti, dei summary e delle opzioni non selezionabile con click ripetuti; ricerca e campi di testo restano selezionabili/modificabili.
- Griglia: una voce per gioco e codice stampato, tramite `groupCardResults`. Art alternativi solo nel popup; una carta senza standard resta visibile nel filtro Standard. Immagini senza pannello o contorno; angoli arrotondati in proporzione al gioco, anche in popup, miniature e visualizzatore mobile. Hover/focus solleva la carta con ombra; rispettare `prefers-reduced-motion`.
- Toolbar con numero di carte a sinistra, Carte per pagina (100/200/300, default 200), freccia precedente, N/M e freccia successiva a destra. Stessa struttura in fondo e nelle pagine illustratore.
- Torna su: bianco con testo e bordo rossi, inizialmente al centro del catalogo. Pressione e trascinamento spostano solo X entro i bordi del contenuto; il trascinamento sopprime il click e il ridimensionamento conserva la posizione relativa. Il click torna a scrollY=0, filtri inclusi. Larghezza `max-content` per evitare ritorni a capo ai bordi.
- Popup: X spostata a sinistra della scrollbar. La riga Lingua occupa sempre 34 px, anche con lingua unica. Immagine vicina al bordo superiore, stessa dimensione; Mostra a schermo intero è sotto l’immagine senza coprirla. Desktop: apre la scansione in nuova scheda. Mobile <=700 px: il pulsante è nascosto; toccare l’immagine apre `image-dialog`, con X/Escape per tornare al popup preservato. Frecce più distanti dal contatore, soprattutto su mobile.
- Navigazione popup: `filteredCardIds` e `filteredCardIndex` sono lo snapshot dei risultati all’apertura; `currentCardId` è l’art visualizzato. `data-variant` cambia solo quest’ultimo, senza transizioni (`instant-version`) né alterare le frecce. La lingua aggiorna immagine e link.
- Espansioni: gruppi Pokémon per era/serie come Pokellector/PokéCardex. Set One Piece separati in Espansioni classiche, Extra Booster, Premium Booster, Mazzi Starter, Set di mazzi, Carte promozionali, Altri prodotti, Mazzi dimostrativi. Sfondo dei pulsanti trasparente; nome sotto l’immagine, simbolo Pokémon prima del nome quando disponibile, data e regione sotto. Niente etichetta del gruppo o badge OPX sulle singole tessere. Per i prodotti One Piece usare le immagini ufficiali standard dalle sezioni Bandai `subcategory=boosters` e `subcategory=decks`; `imageFit` inquadra il prodotto escludendo soltanto i margini trasparenti tramite SVG, senza ritagliare o duplicare i file. Caricare anche questi SVG in modo lazy. Due set per riga su mobile.
- Gli illustratori aprono una pagina per nome esatto, ignorando maiuscole/accenti, con scelta del gioco. Preferiti riferiti al singolo artwork.

## Dati e aggiornamenti

Snapshot del 25 novembre 2026: **832 set (765 Pokémon, 67 One Piece), 5567 artwork, 9194 WebP (1102.87 MB)**. I set storici già completi restano popolati; 795 set di panoramica contengono soltanto la prima carta. Non confondere l’anteprima con l’importazione completa. I controlli delle coperture complete e i flag `preview` stanno nel registro interno.

`catalog.js` contiene `globalThis.TCG_ART_ATLAS_CATALOG={...};`, `schemaVersion: 3`, `cards`, `sets`, `aliases`; è caricato prima di app.js con `defer`. Campi runtime delle carte: identità/codice/set, data, rarità/categoria, artwork, immagini/lingue e dimensioni, tipi/colori/artista, finiture/edizioni, eventuali `printedNumber`, `printings`, `setIds`, `codes`, `numbers`, `rarities`. `setName` viene ricavato dai set. `imageVersions` contiene solo scansioni realmente disponibili, con lingua, percorso e dimensioni. Campi dei set: `id`, `game`, `name`, `folder`, `releaseDate` se nota, `image`/`symbol` se esistono, eventuale `imageFit` per il riquadro visibile del prodotto, `group`, `groupOrder`, `region`, `language`.

Conservare un solo set inglese quando l’equivalenza completa è verificata, mantenendo le scansioni giapponesi come lingue. I set regionali con inventari distinti restano separati. Otto coppie Pokémon sono state unite sulla base delle equivalenze CardCorpus e delle illustrazioni; Base Set e Neo Destiny giapponesi sono ora coperti dal set inglese. I vecchi ID diventano alias; non perdere preferiti. Le raccolte promo e i prodotti esclusivi giapponesi restano separati. EB04 è Egghead Crisis, prodotto giapponese del 31 gennaio 2026: le sue carte inglesi sono distribuite tra OP14-EB04 e OP15-EB04, non esiste un prodotto inglese standalone identico.

`CARD_REVIEW.json` contiene provenienza, inventari attesi, audit, equivalenze, alias storici e problemi per carta/lingua/immagine: `REPLACE_SAMPLE`, `CHECK_SAMPLE`, `VERIFY_LANGUAGE`, `VERIFY_PRINT_ORIGIN`, campi mancanti e risorse dei set non disponibili. Contiene anche le 798 sostituzioni SAMPLE verificate tramite OnePiece.gg. Restano correzioni da fare: consultare questo file, non il frontend. Non mostrare NOTE, verifiche, fonti o etichette di provenienza nell’interfaccia; non reinserire `reviewNote`, `artworkOrigin`, `imageHasSample`, `printSources`, URL delle fonti o `importAudit` nei dati pubblici. Il server e l’hosting espongono solo `public/`. Una risorsa mancante non autorizza a inventare simboli, date, lingue o stampe.

Preferiti e note dei backup usano `tcg-art-atlas.collection.v1`, `schemaVersion: 1`. `tcg-art-collector.collection.v1` e `clist.collection.v1` servono solo alla migrazione. Risolvere `catalog.aliases` per visualizzazione e rimozione, preservando gli ID originali e le note nei backup. Non confondere le note private dei backup con le vecchie NOTE di verifica delle carte.

## Immagini e fonti

Underscore singoli, mai trattini o `standard` nei nomi dei file. Inglese senza suffisso, italiano `_ITA`, giapponese `_JAP`; `_UND` solo per lingua non verificata. Cartelle di gioco `pokemon` e `onepiece`, set e file in ASCII maiuscolo. I nomi delle cartelle possono usare codici specifici del gioco; gli ID storici non vanno rinominati. Esempi: `cards/pokemon/BASE/001.webp`, `cards/pokemon/JUNGLE/001.webp`, `cards/pokemon/BLACK_COLLECTION_JP/001_JAP.webp`, `cards/onepiece/OP13/OP13_118_A01.webp`. Varianti `_A01`, `_A02`, ecc. Restano compatibili gli indici più lunghi già presenti. `BASE_2` è il vero Base Set 2, non Jungle.

Condividere lo stesso file se la scansione è identica; non duplicarlo per set o dimensione. Gli inventari possono avere numerazioni regionali diverse: il percorso non si deduce dall’ID. Le scansioni originali sono mantenute quando riusabili; gli originali AVIF/PNG/JPG nuovi sono convertiti in WebP. Applicare il raggio degli angoli nel CSS, senza modificare le scansioni. Caricamento lazy, nessun download di tutte le immagini all’avvio.

- [CardCorpus](https://github.com/cardcorpus/pokemon-card-dataset), dati CC BY 4.0: inventari EN/JP, illustrazioni, equivalenze e scansioni. Credit: CardCorpus, https://cardcorpus.com. Indice live https://pokemon.cardcorpus.com/v1/index.json. Limitarsi a equivalenze verificate; stessa illustrazione non implica sempre stessa stampa.
- [TCGdex](https://tcgdex.dev/): metadati Pokémon; [Pokellector](https://www.pokellector.com/sets) e [PokéCardex](https://www.pokecardex.com/en/series): gruppi, panoramica e riferimenti. Non inventare edizioni regionali.
- [Bandai EN](https://en.onepiece-cardgame.com/cardlist/), [Bandai JP](https://www.onepiece-cardgame.com/cardlist/) e pagine ufficiali dei prodotti: inventari, caratteristiche, date e immagini dei set.
- [OnePiece.gg](https://onepiece.gg/sets/): scansioni pulite confrontate con le immagini esistenti; i suffissi dei file non bastano per identificare un artwork. [OPPP](https://oppp.online/proxies/one-piece), Koala Kollect, TCGCSV/TCGplayer, OPlayTCG, Tier One e Chaos Cards restano fonti delle importazioni precedenti, documentate nel registro.

Non rimuovere SAMPLE o watermark tramite ritocco: cercare una scansione autentica migliore della stessa carta e lingua. Dopo ogni aggiornamento eseguire test/build e verificare nel browser popup, varianti, lingua, schermo intero, trascinamento Torna su, gruppi/set e layout mobile.

## Grafica

Il colore principale è `--accent: #ffe05a`, lo stesso della sottosezione selezionata. La favicon è un unico SVG con `viewBox="0 0 512 512"` e `sizes="any"`: carta gialla a tutta superficie con angoli arrotondati, nessun bordo esterno nero, Poké Ball nera stilizzata inclinata di 18 gradi e trasparenza negli angoli. Non generare copie raster a diverse dimensioni. Il logo rimane un WebP con alfa, modificato con imagegen integrato; conservare testo, carte e proporzioni.

Prompt dell'ultima modifica del logo:
```text
Use case: precise-object-edit. Edit target: existing transparent TCG ART ATLAS logo. Change only the yellow fill in every card and letter to solid HEX #FFE05A (RGB 255,224,90), the website selected navigation tab color. Keep the exact TCG ART ATLAS wording, three cards, black lettering and outlines, geometry, proportions and layout unchanged. Remove yellow gradients and texture. All yellow areas must be the same flat #FFE05A. Preserve true alpha transparency outside the logo; do not add any background rectangle or new elements. Corrective cleanup: remove all outer glow, halos, shadows, paper texture and mottling. Clean transparent cutout with razor-sharp flat vector-like black and #FFE05A fills only. Preserve the logo text and layout.
```
