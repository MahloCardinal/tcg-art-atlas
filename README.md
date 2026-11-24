# TCG Art Atlas — riferimento per gli aggiornamenti IA

Sito statico personale per consultare carte Pokémon e One Piece. Tutta la logica gira nel browser: nessun database, backend, account, dipendenza JavaScript o chiamata ad API esterne a runtime. I file in `public/` sono direttamente pubblicabili e funzionano anche aprendo `public/index.html` con doppio clic.

## Struttura e comandi

```text
public/index.html      Struttura, navigazione, filtri e dialog
public/style.css       Tema scuro, responsive, animazioni
public/app.js          Unica sorgente della logica e dei filtri
public/catalog.js      Unica sorgente dei dati: globalThis.TCG_ART_ATLAS_CATALOG={...};
public/cards/          Gioco/set/immagine: un WebP per artwork e lingua disponibile
public/logos/          Loghi di giochi ed espansioni
public/favicon.svg    Icona vettoriale, Poké Ball su carta gialla senza bordo
scripts/site.mjs       Server locale, controlli strutturali e regressioni essenziali
package.json          Comandi Node senza dipendenze
vercel.json           Hosting statico con output public/
```

`npm run dev` avvia `http://127.0.0.1:5300`; `npm test` verifica ricerca, filtri, set, lingue e backup; `npm run build` controlla sintassi, riferimenti, immagini inutilizzate e annidamento. La build non genera copie o bundle: si pubblica direttamente `public/`. Node >=20 serve solo per questi comandi, non al sito pubblicato. Non occorre `npm install`.

Mantenere al massimo una sottocartella dentro ogni cartella della root, con eccezione di `public/cards/`, che organizza le immagini per gioco e set e può avere ulteriori annidamenti. Conservare un solo README. Non creare `.agents`, altri documenti, copie di immagini, cartelle di output o script di importazione permanenti senza una nuova richiesta dell'utente. La cartella `temp/` è un'area di ingresso ignorata da Git: spostare o convertire gli elementi utili nelle destinazioni definitive, aggiornare i riferimenti e svuotare sempre `temp/` al termine, lasciando la cartella esistente.

## Comportamento da preservare

- Header con il solo logo TCG Art Atlas (`logos/tcg_art_atlas_logo.webp`) su sfondo trasparente al posto della precedente coppia icona/nome. Seguono scelta Pokémon/One Piece e sottosezioni Catalogo, Espansioni, Preferiti. Il logo home torna al catalogo del gioco corrente e azzera i filtri. La freccia del gioco è separata visivamente, ma tutto il selettore è cliccabile. La favicon è una carta gialla senza bordo esterno nero con una Poké Ball stilizzata inclinata, senza scritte. Logo e favicon riprendono il giallo #FFE05A della sottosezione selezionata.
- Filtri orizzontali: ricerca per nome/codice/artista, espansione, rarità, tipo Pokémon o colore One Piece, categoria One Piece, artwork, ordinamento e dimensione carte. Selezioni multiple in OR nello stesso filtro, AND tra filtri. DON!! ignora il colore quando selezionato esplicitamente. I nomi delle espansioni Pokémon non hanno codici tra parentesi. Ogni menu si dimensiona sulla propria voce più larga, con minimo 220 px e limite dello schermo, indipendentemente dal selettore. In One Piece, Leader precede Personaggio e le rarità hanno nome esteso con sigla (es. Common (C)); i valori interni restano invariati. Azzera filtri condivide bordo spesso, testo rosso e sfondo bianco con Torna su.
- Toolbar: solo numero di elementi filtrati a sinistra; a destra Carte per pagina (100/200/300, predefinito 200) e freccia precedente, N/M, freccia successiva. Stessa paginazione in fondo e nelle pagine illustratore. Il cambio pagina torna alla toolbar; Torna su, bianco con bordo e testo rosso in grassetto, torna a scrollY=0 includendo i filtri.
- Pagina Espansioni: due espansioni per riga su mobile. Gli illustratori nel popup aprono una pagina con corrispondenza esatta del nome, senza distinguere maiuscole/accenti, e selettore del gioco.
- Popup: espansione e numero/codice sono le prime informazioni; il preferito appartiene al singolo artwork. Le frecce e il contatore seguono esclusivamente i risultati filtrati memorizzati all'apertura, anche oltre la pagina corrente. `filteredCardIds` e `filteredCardIndex` rappresentano quella posizione; `currentCardId` è l'artwork visualizzato. I pulsanti `data-variant` cambiano solo quest'ultimo, senza alterare la navigazione né applicare transizioni (`instant-version`). Non ricavare la posizione delle frecce dall'ID della variante.
- Desktop: Mostra a schermo intero è sovrapposto all'immagine e apre il WebP corrente in una nuova scheda con solo l'immagine. Mobile (<=700px): quel pulsante è nascosto; toccare l'immagine apre `image-dialog`, con X in alto a destra per tornare al popup preservato. Anche Escape chiude il visualizzatore. La lingua selezionata aggiorna sia l'immagine sia i link di apertura.
- Animazioni brevi per popup, menu, espansioni e Torna su; disabilitarle con `prefers-reduced-motion`, incluso il backdrop. I cambi di variante devono rimanere immediati.
- Preferiti e note usano `tcg-art-atlas.collection.v1` in localStorage e `schemaVersion: 1`. Le chiavi legacy `tcg-art-collector.collection.v1` e `clist.collection.v1` rimangono solo per migrare automaticamente i dati al primo avvio, se manca la nuova chiave. Conservarle per compatibilità: il cambio di nome non deve perdere preferiti o note. Esportazione/importazione JSON uniscono i preferiti e preservano anche ID non presenti nel catalogo. Non rinominare gli ID esistenti.

## Catalogo e immagini

Il catalogo attuale contiene 865 artwork in sei espansioni: Pokémon Base Set, Jungle, Fossil; One Piece OP01, OP02, OP03. Il formato di `catalog.js` è un'assegnazione JSON compatta con `schemaVersion: 3`, `cards` e `sets`, caricata prima di `app.js` con script `defer`. Non aggiungere una copia JSON o incorporare nuovamente i dati nell'app.

Carte: `id`, `game`, `name`, `code`, `number`, `setId`, `releaseDate`, `rarity`, `category`, `isAlternative`, `variantGroup`, `variantLabel`, `image`, `imageWidth`, `imageHeight`, `imageLanguage`. Campi multipli `codes`, `numbers`, `setIds`, `rarities` sono opzionali e hanno fallback ai campi singoli. `setName` si ricava dai set all'inizializzazione. `types`/`colors`, `illustrator`, `finishes`, `editions` e `printings` descrivono gli attributi disponibili. `imageVersions`, quando presente, contiene lingue realmente disponibili dello stesso artwork, con `language` e `image`; non inventare traduzioni o versioni. `sourceUrl` e `artworkOrigin` conservano la provenienza essenziale.

Set: `id`, `game`, `name`, `folder`, `releaseDate`, `image`, eventuali `seriesName`, `sourceUrl`, `expectedCodes`. `folder` è il nome esplicito della cartella immagini, separato dall'ID storico della fonte. `expectedCodes` conta i codici distinti, non gli artwork. Jungle e Fossil uniscono le coppie holo/non-holo nella stessa carta con numeri e finiture multiple. Le Special di OP03 includono codici di altri set attraverso `setIds`: non assegnare l'espansione solo dal prefisso del codice.

Usare esclusivamente underscore singoli come separatori nei nomi delle immagini, senza trattini, doppi separatori o la parola `standard`. Cartelle gioco: `pokemon`, `onepiece`; cartelle set e nomi delle carte in maiuscolo ASCII, salvo l'estensione `.webp`. Gli ID storici delle carte e delle fonti restano invariati per i preferiti e i riferimenti: non vanno interpretati come nomi delle espansioni o riutilizzati per nominare i file.

Pokémon: `cards/pokemon/{folder}/{numero}[_A01][_ITA|_JAP|_UND].webp`, con almeno tre cifre per il numero. Le espansioni attuali sono Base Set, Jungle, Fossil: cartelle `BASE`, `JUNGLE`, `FOSSIL`. `BASE_2` è riservato all'espansione Base Set 2, attualmente assente. Esempi: `cards/pokemon/BASE/001.webp`, `cards/pokemon/JUNGLE/001.webp`, `cards/pokemon/FOSSIL/001_JAP.webp` per una futura scansione giapponese realmente disponibile. Non chiamare Jungle "Base Set 2".

One Piece: `cards/onepiece/{folder}/{codice}[_A01][_ITA|_JAP|_UND].webp`. Esempi: `cards/onepiece/OP01/OP01_001.webp`, `cards/onepiece/OP01/OP01_001_A01_UND.webp`, `cards/onepiece/OP03/OP03_007_JAP.webp`, `cards/onepiece/OP03/ST01_012_A06.webp`. La cartella identifica il set della stampa; il nome conserva il codice originale anche nelle ristampe con prefisso diverso. DON!! usa `DON` come codice. Le appartenenze multiple restano nel catalogo: non duplicare la stessa immagine in più set.

Inglese: nessun suffisso lingua. Italiano: `_ITA`; giapponese: `_JAP`. `_UND` indica una lingua non ancora verificata, non una lingua inventata: 296 immagini alternative importate sono ancora in questa condizione. Non assegnare loro `_JAP` o `_ITA` senza verificarle. Il catalogo usa i codici lingua `en`, `it`, `ja` (con compatibilità per le precedenti forme `jp`/`source`). Per le varianti usare `_A01`, `_A02`, ecc., mantenendo stabili i numeri già assegnati.

Loghi: `logos/{gioco}_logo.webp`, `logos/{gioco}_{folder}_logo.webp`, `logos/tcg_art_atlas_logo.webp`. Conservare un solo file per immagine effettiva e ridimensionarlo via CSS in griglia, popup e selettore delle varianti. Niente `thumbnail`, `srcset` con duplicati o immagini inutilizzate. Gli originali delle carte sono stati mantenuti senza ricompressione; caricamento lazy e cache condivisa evitano download di tutte le immagini e duplicati tra viste. La favicon è un unico SVG scalabile senza limite di risoluzione; il logo è un WebP con alfa.

Fonti dei dati esistenti: TCGdex per Pokémon; OPPP per One Piece, con TCGplayer/OPlayTCG per DON!! e Tier One per otto scansioni giapponesi. `artworkOrigin.status` conserva i casi non verificati: `op-OP01-001AA`, `op-OP01-001AA4`, `op-OP01-016AA9`. Non trasformarli in attribuzioni certe. Le URL conservate nel catalogo sono riferimenti per gli aggiornamenti, non chiamate del frontend.

Per aggiunte: seguire le direttive dell'utente, mantenere ID stabili, verificare artwork/lingua/provenienza, aggiungere solo i WebP necessari e aggiornare `catalog.js`. Eseguire `npm test` e `npm run build`, quindi verificare nel browser filtri, pagina mobile, navigazione tra carte e varianti, visualizzazione a schermo intero e backup. Non pubblicare, committare o fare push salvo richiesta.

## Grafica

Il colore principale è `--accent: #ffe05a`, lo stesso della sottosezione selezionata. La favicon è un unico SVG con `viewBox="0 0 512 512"` e `sizes="any"`: carta gialla a tutta superficie con angoli arrotondati, nessun bordo esterno nero, Poké Ball nera stilizzata inclinata di 18 gradi e trasparenza negli angoli. Non generare copie raster a diverse dimensioni. Il logo rimane un WebP con alfa, modificato con imagegen integrato; conservare testo, carte e proporzioni.

Prompt dell'ultima modifica del logo:
```text
Use case: precise-object-edit. Edit target: existing transparent TCG ART ATLAS logo. Change only the yellow fill in every card and letter to solid HEX #FFE05A (RGB 255,224,90), the website selected navigation tab color. Keep the exact TCG ART ATLAS wording, three cards, black lettering and outlines, geometry, proportions and layout unchanged. Remove yellow gradients and texture. All yellow areas must be the same flat #FFE05A. Preserve true alpha transparency outside the logo; do not add any background rectangle or new elements. Corrective cleanup: remove all outer glow, halos, shadows, paper texture and mottling. Clean transparent cutout with razor-sharp flat vector-like black and #FFE05A fills only. Preserve the logo text and layout.
```
