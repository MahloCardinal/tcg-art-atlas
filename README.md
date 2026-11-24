# CList — Carte da amare

Database visivo personale di carte Pokémon e One Piece, statico e locale. **865 artwork in sei set**: Pokémon Base Set, Jungle, Fossil; One Piece OP01, OP02, OP03. Interfaccia compatta con filtri e preferiti.

Il catalogo è prevalentemente inglese; due DON hanno scansioni giapponesi e otto carte One Piece permettono già lo scambio EN/JP nel popup. Non contiene ancora due cataloghi EN/JP completi. Restano **14 immagini inglesi One Piece con Sample da correggere**: stato in [docs/STATO.md](docs/STATO.md).

Il 24 novembre è stata completata la ricerca delle fonti EN/JP, senza nuove importazioni: [rapporto delle fonti](docs/FONTI.md) e [conteggi/lacune verificati](docs/verifica-fonti.json). Il progetto non è ancora un archivio completo di tutte le carte.

## Avvio

**Apri `index.html` con doppio clic dalla cartella CList.** Catalogo, filtri, immagini e preferiti funzionano senza server e senza connessione. Mantieni insieme `index.html`, `src/` e `public/`.

Per consultare il catalogo non serve Node.js. I file pronti per l'apertura diretta sono già inclusi. Dopo modifiche al codice o ai dati, lo sviluppo usa Node.js 20 o successivo per aggiornare il pacchetto locale:

```powershell
npm run prepare:local
```

Il comando viene eseguito anche dalla build, prima dell'avvio del server e al termine di un'importazione. Non ci sono dipendenze npm da installare.

Il server resta un'opzione per lo sviluppo:

```powershell
npm run dev
```

Apri [http://localhost:5300](http://localhost:5300). Per scegliere una porta diversa:

```powershell
npm run dev -- --port 5301
```

Preferiti e note dipendono dal browser e dall'indirizzo: il file locale, `localhost` e `127.0.0.1` hanno archivi separati. Per trasferirli fra modalità usa **Backup**. Per l'apertura diretta conserva lo stesso percorso e browser.

## Funzionalità

- Griglia compatta con dimensioni regolabili e pagine da 30, 60 o 120 artwork (60 iniziali).
- Header con menu dei giochi e loghi ufficiali locali in WebP; Catalogo, Espansioni e Preferiti accanto al menu. Home torna al catalogo del gioco selezionato e azzera i filtri.
- Ricerca per nome, codice, espansione, artista e tipo di artwork. Premi `/` per raggiungere la ricerca nel catalogo.
- Espansioni, rarità e tipi Pokémon/colori One Piece selezionabili con più checkbox. Le scelte nello stesso filtro si uniscono; filtri diversi si combinano.
- One Piece ha anche Tipo: Personaggio, Evento, Stage, DON!! e Leader. Se Tipo include DON!!, i DON ignorano il colore selezionato. Pokémon usa il nome italiano Elettro.
- Artwork parte da Standard, seguito da Alternativi e Tutti. Rarità in progressione comune → rara; i tipi One Piece seguono Personaggio, Evento, Stage, Leader, DON!!.
- Pannello filtri richiudibile e riapribile anche su desktop, senza perdere le selezioni. Il cambio pagina torna all'inizio della toolbar.
- Gli elenchi dei filtri si aprono in sovrimpressione, senza modificare l'altezza dei controlli. Si chiudono cliccando fuori o con Esc.
- Pagina Espansioni con loghi Pokémon e immagini OP01/OP02/OP03, date di uscita e accesso al catalogo del set, dalle più recenti alle più vecchie. I badge Pokémon riportano il gruppo Pokellector (Base Set Series per i tre set attuali), senza conteggi di caricamento.
- Dettaglio compatto con immagine in un riquadro standard (420×588 su desktop, adattabile allo schermo), senza ritagli. Selettore delle lingue effettivamente caricate, con stesso artwork e stesso preferito.
- Sotto le immagini della griglia compare solo il nome. Nel popup espansione e numero/codice sono le prime due informazioni sotto il nome; tipi e colori restano nei filtri. La lingua è testo semplice quando unica, un selettore quando sono caricate più versioni. Il footer Precedente/Successiva resta in fondo alla colonna delle informazioni anche scorrendola. La scrollbar della pagina rimane visibile all'apertura del popup.
- Gli illustratori sono cliccabili: la pagina `#illustratore/Nome` mostra tutte le loro carte e artwork, raggruppate per gioco, con scelta Tutti i giochi o singolo gioco. La corrispondenza del nome è esatta, senza distinguere maiuscole e accenti. I metadati attuali degli artisti sono presenti solo per Pokémon.
- Le edizioni Pokémon sono raggruppate in Versioni, senza creare immagini o selettori per scansioni non caricate. Le finiture One Piece aggregate per codice restano nei dati e non sono mostrate come proprietà dell'immagine.
- Varianti One Piece collegate per codice e nominate in base al prodotto o alla distribuzione dell'illustrazione. Lo scorrimento orizzontale resta fermo quando cambia l'artwork. Tre immagini OPPP hanno origine non verificata, dichiarata nell'etichetta e documentata nel rapporto fonti.
- Le coppie holo/non holo di Jungle e Fossil con la stessa illustrazione sono accorpate, preservando numeri e finiture nelle informazioni. La versione Pokémon Standard / Non holo è sottintesa.
- Preferiti per singolo artwork, salvati in `localStorage`. La sezione note è stata rimossa; i dati dei backup precedenti vengono conservati.
- Backup JSON esportabile e importabile; unisce la selezione e preserva anche i riferimenti a carte fuori dal catalogo attuale.
- Navigazione da tastiera nel dettaglio: frecce sinistra/destra, `Esc` per chiudere.

I preferiti non si sincronizzano fra dispositivi. La cancellazione dei dati del browser li elimina: usa **Backup** per conservarli. Catalogo e immagini sono file locali; durante l'uso l'app non contatta API, CDN, font esterni o servizi di analisi. La provenienza delle immagini resta nei metadati e nella documentazione.

## Struttura

```text
index.html                   Struttura dell'interfaccia
src/app.js                   Interazioni e viste
src/core.js                  Ricerca, filtri e validazione backup
src/style.css                Stile e adattamento ai dispositivi
public/app.js                Pacchetto generato con codice e catalogo, apribile senza server
public/data/catalog.json     Metadati statici e provenienza
public/images/cards/         Originali e miniature, solo WebP
data/artwork-origins.json    Provenienze delle varianti One Piece riviste
scripts/import_cards.py      Importazione dei sei set attuali
scripts/build.mjs            Validazione e build statica
scripts/prepare-local.mjs    Generazione del pacchetto per index.html
scripts/serve.mjs            Server HTTP locale, solo loopback
tests/core.test.js           Test di filtri, varianti e backup
docs/FONTI.md                Verifica fonti e piano di copertura
docs/verifica-fonti.json     Conteggi, lacune e hash della ricerca EN/JP
docs/STATO.md                Checkpoint e lavoro ancora pendente
vercel.json                  Configurazione per il futuro deploy
```

Ogni artwork ha un ID stabile, un gruppo di variante, lingua, espansione, numero carta, rarità, artista se disponibile, URL dei metadati, URL originale dell'immagine, dimensioni e hash SHA-256. Non importiamo prezzi o dati di mercato.

## Immagini e nuova importazione

I file necessari sono già inclusi. Python serve **solo** per le importazioni, non per avviare il sito. Non è necessario rilanciare l'importatore per consultare il catalogo.

```powershell
python -m pip install -r requirements.txt
npm run import:cards
```

L'importatore attuale usa TCGdex per Pokémon, Bandai per i metadati One Piece, OPPP per le immagini e fonti aggiuntive per DON/finiture. Conserva la risoluzione nativa e converte in WebP qualità 92, con miniature entro 300×420, qualità 86. Preserva la trasparenza e il rapporto d'aspetto. Le immagini OPPP non sono tutte pulite: consultare il checkpoint prima di rilanciare un'importazione.

Le risposte originali vengono memorizzate in `data/sources/`, esclusa da Git e dalla build. Gli identificativi sono letti dalle fonti, senza inventare suffissi. L'importatore non integra ancora CardCorpus, Koala Kollect o un inventario JP separato: la ricerca delle fonti è documentata, ma queste integrazioni sono rinviate alla fase successiva.

## Verifica e build

```powershell
npm test
npm run build
npm run preview
```

La build verifica ID univoci, collegamenti alle espansioni e presenza/firma WebP di tutte le immagini. Rigenera il pacchetto locale e copia in `dist/` solo HTML, CSS, JavaScript, JSON e immagini. Anche `dist/index.html` è apribile direttamente e supporta hosting in sottocartelle. Il server di anteprima usa la stessa porta del server di sviluppo: ferma prima quest'ultimo o aggiungi `-- --port 5301`.

## GitHub e Vercel

Repository: [MahloCardinal/collector-card-list](https://github.com/MahloCardinal/collector-card-list), branch `main`. Contiene sorgenti, catalogo JSON, pacchetto per l'apertura diretta e immagini WebP; `dist/`, cache di ricerca e file temporanei sono esclusi.

Il sito non è ancora pubblicato su Vercel. La configurazione è pronta per un progetto statico: comando di build `npm run build`, cartella di output `dist`, nessuna variabile d'ambiente e nessun database.

L'architettura può restare statica ampliando il catalogo. La griglia è già paginata; per molte migliaia di immagini andranno divisi anche i metadati per gioco/espansione e caricati a richiesta. Il peso totale dei file andrà misurato prima di importare tutto.

Carte e illustrazioni appartengono ai rispettivi titolari. Progetto personale non affiliato a Pokémon, TCGdex o Bandai.
