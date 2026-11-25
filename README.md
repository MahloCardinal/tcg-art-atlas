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
- Filtri orizzontali: ricerca per nome/codice/artista, espansione, rarità, tipo Pokémon o colore One Piece, categoria One Piece, artwork, ordinamento e dimensione carte. Selezioni multiple in OR nello stesso filtro, AND tra filtri. DON!! ignora il colore quando selezionato esplicitamente. I nomi delle espansioni Pokémon non hanno codici tra parentesi. Ogni menu si dimensiona sulla propria voce più larga, con minimo 220 px e limite dello schermo, indipendentemente dal selettore. In One Piece, Leader precede Personaggio e le rarità hanno nome esteso con sigla (es. Common (C)); i valori interni restano invariati. La barra separa ricerca e selettori, con indicatori delle selezioni e chip rimovibili. Azzera filtri è un comando discreto; Torna su conserva bordo e testo rossi. Su mobile i selettori scorrono orizzontalmente e i menu restano in sovrimpressione.
- Toolbar: solo numero di codici carta filtrati a sinistra; a destra Carte per pagina (100/200/300, predefinito 200) e freccia precedente, N/M, freccia successiva. Stessa paginazione in fondo e nelle pagine illustratore. Il cambio pagina torna alla toolbar; Torna su, bianco con bordo e testo rosso in grassetto, torna a scrollY=0 includendo i filtri.
- Pagina Espansioni: due espansioni per riga su mobile. Gli illustratori nel popup aprono una pagina con corrispondenza esatta del nome, senza distinguere maiuscole/accenti, e selettore del gioco.
- Griglia: una voce per gioco e codice stampato; codici diversi restano carte diverse. Le immagini non hanno contorno o pannello di sfondo. Con mouse o focus si sollevano di 6 px con ombra sottostante; rispettare le preferenze di movimento ridotto.
- Popup: espansione e numero/codice sono le prime informazioni; il preferito appartiene al singolo artwork. Le frecce e il contatore seguono esclusivamente i risultati filtrati memorizzati all'apertura, anche oltre la pagina corrente. `filteredCardIds` e `filteredCardIndex` rappresentano quella posizione; `currentCardId` è l'artwork visualizzato. I pulsanti `data-variant` cambiano solo quest'ultimo, senza alterare la navigazione né applicare transizioni (`instant-version`). Non ricavare la posizione delle frecce dall'ID della variante.
- Desktop: Mostra a schermo intero è sovrapposto all'immagine e apre il WebP corrente in una nuova scheda con solo l'immagine. Mobile (<=700px): quel pulsante è nascosto; toccare l'immagine apre `image-dialog`, con X in alto a destra per tornare al popup preservato. Anche Escape chiude il visualizzatore. La lingua selezionata aggiorna sia l'immagine sia i link di apertura.
- Animazioni brevi per popup, menu, espansioni e Torna su; disabilitarle con `prefers-reduced-motion`, incluso il backdrop. I cambi di variante devono rimanere immediati.
- Preferiti e note usano `tcg-art-atlas.collection.v1` in localStorage e `schemaVersion: 1`. Le chiavi legacy `tcg-art-collector.collection.v1` e `clist.collection.v1` rimangono solo per migrare automaticamente i dati al primo avvio, se manca la nuova chiave. Conservarle per compatibilità: il cambio di nome non deve perdere preferiti o note. Esportazione/importazione JSON uniscono i preferiti e preservano anche ID non presenti nel catalogo. Non rinominare gli ID esistenti. Quando una duplicazione viene eliminata, `catalog.aliases` collega il vecchio ID a quello conservato: risolverlo per visualizzazione e preferiti, preservando comunque gli ID grezzi nei backup.

## Catalogo e immagini

Il catalogo include i primi 13 set principali inglesi Pokémon e i primi 13 giapponesi, più OP01–OP13 in inglese e giapponese. Le varianti della stessa carta sono raccolte nel popup. Totale verificato: **4.032 codici carta, 4.988 artwork, 39 espansioni visualizzate e 7.245 immagini WebP (975,33 MB)**. Pokémon: 2.455 carte regionali; One Piece: 1.577 codici e 2.533 artwork. Il formato di `catalog.js` è un'assegnazione JSON compatta con `schemaVersion: 3`, `cards` e `sets`, caricata prima di `app.js` con script `defer`. Non aggiungere una copia JSON o incorporare nuovamente i dati nell'app.

Carte: `id`, `game`, `name`, `code`, `number`, `setId`, `releaseDate`, `rarity`, `category`, `isAlternative`, `variantGroup`, `variantLabel`, `image`, `imageWidth`, `imageHeight`, `imageLanguage`. Campi multipli `codes`, `numbers`, `setIds`, `rarities` sono opzionali e hanno fallback ai campi singoli. `setName` si ricava dai set all'inizializzazione. `types`/`colors`, `illustrator`, `finishes`, `editions` e `printings` descrivono gli attributi disponibili. `imageVersions`, quando presente, contiene lingue realmente disponibili dello stesso artwork, con `language` e `image`; non inventare traduzioni o versioni. `sourceUrl` e `artworkOrigin` conservano la provenienza essenziale.

Set: `id`, `game`, `name`, `folder`, `releaseDate`, `image`, eventuali `seriesName`, `sourceUrl`, `expectedCodes`. `folder` è il nome esplicito della cartella immagini, separato dall'ID storico della fonte. `expectedCodes` conta i codici distinti, non gli artwork. Le coppie Pokémon holo/non-holo con codice diverso restano carte distinte, condividendo il file se l’illustrazione è identica. Finiture diverse con lo stesso codice non duplicano l’immagine. Le Special di OP03 includono codici di altri set attraverso `setIds`: non assegnare l'espansione solo dal prefisso del codice.

Usare esclusivamente underscore singoli come separatori nei nomi delle immagini, senza trattini, doppi separatori o la parola `standard`. Cartelle gioco: `pokemon`, `onepiece`; cartelle set e nomi delle carte in maiuscolo ASCII, salvo l'estensione `.webp`. Gli ID storici delle carte e delle fonti restano invariati per i preferiti e i riferimenti: non vanno interpretati come nomi delle espansioni o riutilizzati per nominare i file.

Pokémon: `cards/pokemon/{folder}/{numero}[_A01][_ITA|_JAP|_UND].webp`, con almeno tre cifre per il numero. Le cartelle `BASE`, `JUNGLE`, `FOSSIL`, `BASE_2` e successive identificano i set inglesi; i set giapponesi hanno cartelle dedicate con `_JP`. Esempi: `cards/pokemon/BASE/001.webp`, `cards/pokemon/JUNGLE/001.webp`, `cards/pokemon/FOSSIL/001_JAP.webp` per una scansione giapponese verificata. Non chiamare Jungle "Base Set 2".

One Piece: `cards/onepiece/{folder}/{codice}[_A01][_ITA|_JAP|_UND].webp`. Esempi: `cards/onepiece/OP01/OP01_001.webp`, `cards/onepiece/OP01/OP01_001_A01_UND.webp`, `cards/onepiece/OP03/OP03_007_JAP.webp`, `cards/onepiece/OP03/ST01_012_A06.webp`. La cartella identifica il set della stampa; il nome conserva il codice originale anche nelle ristampe con prefisso diverso. DON!! usa `DON` come codice. Le appartenenze multiple restano nel catalogo: non duplicare la stessa immagine in più set.

Inglese: nessun suffisso lingua. Italiano: `_ITA`; giapponese: `_JAP`. `_UND` indica una lingua non ancora verificata, non una lingua inventata per le scansioni la cui lingua non è stata ancora verificata. Non assegnare loro `_JAP` o `_ITA` senza verificarle. Il catalogo usa i codici lingua `en`, `it`, `ja` (con compatibilità per le precedenti forme `jp`/`source`). Per le varianti usare `_A01`, `_A02`, ecc., mantenendo stabili i numeri già assegnati.

Loghi: `logos/{gioco}_logo.webp`, `logos/{gioco}_{folder}_logo.webp`, `logos/tcg_art_atlas_logo.webp`. Conservare un solo file per immagine effettiva e ridimensionarlo via CSS in griglia, popup e selettore delle varianti. Niente `thumbnail`, `srcset` con duplicati o immagini inutilizzate. I WebP preesistenti ancora utilizzati sono riusati senza ricompressione; i nuovi originali PNG/JPG/AVIF sono convertiti in WebP; caricamento lazy e cache condivisa evitano download di tutte le immagini e duplicati tra viste. La favicon è un unico SVG scalabile senza limite di risoluzione; il logo è un WebP con alfa.

### Copertura e provenienza

Pokémon EN, in ordine di uscita: Base Set, Jungle, Fossil, Base Set 2, Team Rocket, Gym Heroes, Gym Challenge, Neo Genesis, Neo Discovery, Neo Revelation, Neo Destiny, Legendary Collection, Expedition Base Set. Sono presenti anche i primi 13 set principali giapponesi, inclusi VS e Web. I cataloghi regionali non coincidono: Base Set 2 e Legendary Collection sono prodotti inglesi; non creare edizioni giapponesi fittizie. Gli abbinamenti di lingua sono basati sull’identità dell’illustrazione CardCorpus, conservando il vero set di provenienza del file giapponese, anche per scansioni provenienti da mazzi e promo. Alcune carte rimangono disponibili in una sola lingua perché non è stata trovata una scansione corrispondente verificabile. Nei set giapponesi storici `inventoryNumber` identifica il file, mentre `printedNumber` contiene il numero effettivamente stampato o è vuoto per carte senza numero.

One Piece: 26 inventari regionali OP01–OP13 verificati contro Bandai, 4020 righe ufficiali (2014 EN, 2006 JP), oltre a illustrazioni di ristampe/promo dei codici già importati e 14 disegni DON!! in entrambe le lingue. Le celle di una stessa pagina del PDF DON!! non sono la stessa illustrazione: identificarle per disegno, senza raggruppare dalla URL della pagina. Il prodotto di una stampa può differire dal prefisso del codice. `setIds` conserva le appartenenze e `printSources` tutte le provenienze quando ristampe, foil o timbri condividono la stessa illustrazione. I suffissi `_pN` ufficiali EN/JP non garantiscono la stessa immagine: abbinare solo confronti verificati. Sfondi diversi, manga ed estensioni realmente diverse rimangono varianti distinte.

La qualità preferita è: scansione pulita adeguata, poi immagine ufficiale di buona qualità con SAMPLE, infine una scansione pulita scadente. Non ritoccare watermark per creare immagini apparentemente ufficiali. Per alternative senza provenienza: ignorare l’immagine già presente; se l’illustrazione è nuova, conservarla con `artworkOrigin.status: "unverified"` e `reviewNote`, mostrati nella casella temporanea NOTE. Le 1.947 candidate pulite dei dieci nuovi set sono state classificate: 1.114 associate a stampe documentate, 693 ripetizioni ignorate, 140 illustrazioni nuove con NOTE. Altri casi storici con localizzazione cinese non confermata hanno una NOTE specifica senza inventare una stampa fisica inglese. I due artwork Zoro `op-OP01-001AA` e `op-OP01-001AA4` restano da chiarire. Nami `op-OP01-016AA9` è stata invece ricondotta a Heroines Edition Vol. 2 / EB05.

### Fonti di riferimento

Le URL sono riferimenti per gli aggiornamenti: nessuna viene richiesta dal frontend durante l’uso.

| Fonte | Utilizzo e limiti |
| --- | --- |
| [Bandai EN](https://en.onepiece-cardgame.com/cardlist/) e [Bandai JP](https://www.onepiece-cardgame.com/cardlist/) | Fonte primaria One Piece: codici, prodotti, colori, categorie, rarità e immagini ufficiali; molte includono SAMPLE. |
| [Bandai DON!!](https://www.onepiece-cardgame.com/pdf/don-cardlist.pdf) | Verifica dei disegni DON!! e della distribuzione giapponese. |
| [Koala Kollect Data](https://github.com/hotavocado/koala-kollect-data) | Snapshot del 22 ottobre 2026 con inventari, stampe e prodotti EN/JP; hash dei dati verificati e tutte le 26 liste confrontate con le pagine Bandai attuali. |
| [OPPP](https://oppp.online/proxies/one-piece) | Scansioni/proxy pulite; verificare l’effettiva illustrazione e origine, senza attribuire un prodotto dal suffisso AA. |
| [Cardmarket One Piece](https://www.cardmarket.com/it/OnePiece) | Controllo secondario delle categorie e distribuzioni delle alternative. Accesso diretto talvolta bloccato; non presumere una verifica se non consultabile. |
| [TCGdex](https://tcgdex.dev/) | Catalogazione e metadati Pokémon EN/JP, tipi, artisti, finiture e numerazioni. |
| [CardCorpus Pokémon](https://github.com/cardcorpus/pokemon-card-dataset) | Inventari regionali, identificativi delle illustrazioni e scansioni AVIF convertite in WebP. Gli abbinamenti EN/JP richiedono identico painting ID. |
| [Bulbapedia espansioni](https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_Trading_Card_Game_expansions) | Cronologia, gruppi e differenze regionali Pokémon. |
| [Bulbagarden Archives](https://archives.bulbagarden.net/) | File immagine diretti, per esempio `media/upload/.../EnergySearchScarletViolet172.jpg`; preferirli alle pagine media quando servono scansioni mancanti. |
| [Pokellector](https://www.pokellector.com/sets) | Elenchi set EN/JP, gruppi e loghi delle espansioni Pokémon. |
| [Pooka](https://pooka.app/) | Archivio secondario Pokémon EN/JP per controlli e immagini mancanti. |
| [PKMN.gg](https://www.pkmn.gg/) | Riferimento Pokémon e grafica; accesso automatico limitato durante questo aggiornamento, non usato come inventario completo. |
| [TCG Collector](https://www.tcgcollector.com/) e [PkmnCards](https://pkmncards.com/) | Fonti secondarie Pokémon per inventari regionali e scansioni da controllare. |
| [TCGCSV](https://tcgcsv.com/) / [TCGplayer](https://www.tcgplayer.com/) | Catalogazione e immagini DON!! inglesi; nessun prezzo caricato nell’interfaccia. |
| [OPlayTCG](https://www.oplaytcg.com/), [Tier One](https://www.tier-one.jp/), [Chaos Cards](https://www.chaoscards.co.uk/) | Scansioni aggiuntive verificate, incluse DON!! e otto vecchie immagini giapponesi. |

`importAudit` conserva nel catalogo la data dei controlli, la copertura degli inventari e le limitazioni delle fonti. La ricerca/importazione avviene fuori dal progetto: nessuno script temporaneo, dipendenza di conversione o originale PNG/AVIF deve finire nel sito.

Per aggiunte: seguire le direttive dell'utente, mantenere ID stabili, verificare artwork/lingua/provenienza, aggiungere solo i WebP necessari e aggiornare `catalog.js`. Eseguire `npm test` e `npm run build`, quindi verificare nel browser filtri, pagina mobile, navigazione tra carte e varianti, visualizzazione a schermo intero e backup. Non pubblicare, committare o fare push salvo richiesta.

## Grafica

Il colore principale è `--accent: #ffe05a`, lo stesso della sottosezione selezionata. La favicon è un unico SVG con `viewBox="0 0 512 512"` e `sizes="any"`: carta gialla a tutta superficie con angoli arrotondati, nessun bordo esterno nero, Poké Ball nera stilizzata inclinata di 18 gradi e trasparenza negli angoli. Non generare copie raster a diverse dimensioni. Il logo rimane un WebP con alfa, modificato con imagegen integrato; conservare testo, carte e proporzioni.

Prompt dell'ultima modifica del logo:
```text
Use case: precise-object-edit. Edit target: existing transparent TCG ART ATLAS logo. Change only the yellow fill in every card and letter to solid HEX #FFE05A (RGB 255,224,90), the website selected navigation tab color. Keep the exact TCG ART ATLAS wording, three cards, black lettering and outlines, geometry, proportions and layout unchanged. Remove yellow gradients and texture. All yellow areas must be the same flat #FFE05A. Preserve true alpha transparency outside the logo; do not add any background rectangle or new elements. Corrective cleanup: remove all outer glow, halos, shadows, paper texture and mottling. Clean transparent cutout with razor-sharp flat vector-like black and #FFE05A fills only. Preserve the logo text and layout.
```
