# Stato salvato — 24 novembre 2026

La ricerca delle fonti EN/JP è documentata in `FONTI.md` e `verifica-fonti.json`. Successivamente l'utente ha richiesto apertura diretta da index e modifiche a filtri, espansioni e popup: implementate senza importare nuovi set.

## Interfaccia attuale

- Ultima revisione: header con menu dei giochi e loghi ufficiali locali WebP, voci di navigazione accanto. Nessun conteggio carte nel selettore. Home torna al catalogo del gioco corrente, anche dopo filtri o visite a un'espansione.
- Popup con nome, poi Espansione e Numero/Codice come prime due righe. Footer dentro `.detail-info`, separato dal suo contenuto scorrevole; verificato su desktop e schermo 390×844. La scrollbar verticale della pagina resta visibile: larghezza della pagina e posizione della griglia immutate aprendo il popup.
- Scorrimento orizzontale conservato cambiando variante dello stesso gruppo (verificato Nami: 1011 px prima e dopo nella revisione precedente). Pokémon Standard / Non holo omesso; conservate altre finiture e versioni di edizione.
- Griglia con solo nome sotto la carta; paginazione 30/60/120, iniziale 60. Nessuna intestazione gioco/set o riga tipo/colore, edizioni o finiture aggregate One Piece nel popup. Le edizioni Pokémon sono etichette in Versioni; non sono state inventate scansioni o combinazioni di edizione/finitura.
- Artwork iniziale Standard; ordine Standard, Alternativi, Tutti. Rarità Pokémon Common/Uncommon/Rare; One Piece C/UC/R/SR/SEC/SP CARD, poi L e DON!! (classificazioni che non rappresentano una scala di rarità). Tipi One Piece nell'ordine Personaggio, Evento, Stage, Leader, DON!!.
- Filtri richiudibili anche su desktop; la griglia occupa lo spazio recuperato, senza azzerare selezioni. Cambio pagina in entrambe le direzioni porta la toolbar a 80 px dal bordo superiore, sotto l'header da 65 px.
- Pagina illustratore raggiungibile dal nome nel popup, con route dedicata, tutte le immagini dell'artista e scelta del gioco. Verificati Ken Sugimori (67 immagini), ricaricamento della route e filtro Pokémon; test con dati sintetici controlla lo stesso artista in entrambi i giochi. Nessun illustratore One Piece è ancora presente nei metadati.
- Espansioni e relativo filtro ordinati dalle più nuove. Verificati Fossil/Jungle/Base Set e OP03/OP02/OP01.
- Tipo One Piece dopo Espansione: Personaggio, Evento, Stage, Leader e DON!!. DON esclusi dai colori; quando Tipo include DON!!, non vengono esclusi dai colori scelti. Verificati uno Standard e quattro DON con Artwork Tutti e colore Blu.
- Elettro sostituisce Lampo. Espansioni senza conteggi; badge Pokémon Base Set Series secondo Pokellector.
- Origini artwork: 303 voci riviste in `data/artwork-origins.json` (299 alternative e 4 DON). Tre restano esplicitamente non verificate. Le altre carte standard hanno il riferimento del prodotto nel catalogo. Vedi FONTI per metodo e limiti; nessuna immagine di ricerca ufficiale con Sample aggiunta al frontend.
- Lingua singola mostrata come testo; selettore 150 px / font 13 px solo per più lingue. Footer del popup separato dal contenuto scorrevole e sempre in basso, verificato anche su mobile con contenuto più lungo dello spazio disponibile.
- Dropdown dei filtri fissi in sovrimpressione, un elenco aperto alla volta, chiusura con clic esterno/Esc. Verificati su desktop e con clic reali su mobile: altezza del filtro, posizione dei controlli e scorrimento restano invariati all'apertura.
- Espansioni, rarità e tipi Pokémon/colori One Piece hanno checkbox multiple: OR nello stesso elenco, AND fra filtri. I metadati provengono dalle risposte TCGdex/Bandai già in cache.
- Lista Espansioni apre una pagina per il gioco selezionato: loghi Pokémon locali e immagini WebP OP01/OP02/OP03, date e collegamenti alle carte. Rimossa la lista in fondo alla barra.
- Popup senza note, fonti o dimensioni tecniche; data set tolta per Pokémon e disponibile nella pagina Espansioni. Immagini in riquadro uniforme fino a 420×588 su desktop, adattabile allo schermo, senza ritagli o modifiche agli originali.
- Selettore lingua per artwork: otto carte One Piece hanno EN e JP. Le altre espongono solo le immagini disponibili; le lingue delle scansioni non verificate sono indicate come tali. Le otto coppie sono state confrontate visivamente in `data/qa/language-pairs.jpg` e sono registrate in `data/image-versions.json`.
- Le note precedenti restano nei backup, senza essere mostrate o cancellate. Nessuna preferenza di prova è stata aggiunta durante questo aggiornamento.
- Catalogo sempre di 865 artwork; otto versioni JP aggiuntive e sei immagini dei set. `scripts/enrich_catalog.py` aggiorna i metadati e viene usato anche dall'importatore completo.

## Esito della ricerca EN / JP

- Pokémon: CardCorpus offre indici statici ampi con stampe e finiture. Verificati integralmente 324 gruppi EN e 449 JP; 7 e 151 record sono senza riferimento immagine, elencati nel rapporto JSON. I sei set iniziali hanno tutti i riferimenti. TCGdex contiene i primi tre JP, ma senza immagini; Pokellector ha fornito tre originali campione.
- One Piece: Bandai EN/JP è il riferimento primario. Koala Kollect coincide esattamente con gli identificativi delle sei liste OP01–OP03; lo snapshot è del 22 ottobre, da confrontare con le nuove uscite. Le immagini collegate hanno Sample. OPPP è una fonte aggiuntiva, non una garanzia di completezza/pulizia.
- Le otto scansioni Tier One JP inizialmente candidate sono ora disponibili come versioni alternative di lingua nel popup. Non sostituiscono silenziosamente le immagini EN.
- CardCorpus usa AVIF: un campione risponde 200, ma il Pillow installato non lo decodifica. Risolvere la conversione prima dell'importazione. La data Fossil JP differisce di un giorno da Bulbapedia/Pokellector.
- Il frontend resta a 865 artwork, senza catalogo JP completo separato. Il rapporto di ricerca conserva l'hash dello snapshot precedente ai nuovi tipi/colori e alle versioni lingua.

## File da cui riprendere

- `public/data/catalog.json` è l'ultimo catalogo importato integralmente: **865 immagini**, **6 set**, **596 codici carta distinti**. Non esiste un `catalog.tmp.json` pendente.
- Pokémon: Base Set 102 numeri / 102 immagini; Jungle 64 numeri / 48 immagini; Fossil 62 numeri / 47 immagini. Le 31 coppie holo/non holo sono accorpate, con numeri e finiture nei metadati.
- One Piece: OP01, OP02, OP03. Inclusi i quattro Special di OP03 con codici precedenti, i DON e gli artwork collegati da OPPP. Il DON generico è condiviso tra i tre set; le scansioni Shanks/Sanji DON pulite sono giapponesi, provenienti da OPlayTCG.
- `src/` e `index.html` contengono la nuova interfaccia compatta: filtri laterali, griglia, paginazione, preferiti e dettaglio. Rimossi hero e testi decorativi.
- Preferiti e note restano nel browser; le voci fuori dai set attuali vengono preservate nel backup.
- Repository GitHub scelta dall'utente: `https://github.com/MahloCardinal/collector-card-list`, branch `main`. Collegamento della cartella locale e primo caricamento; esclusi `dist/`, cache originali e file temporanei. Vercel non è stato collegato e il sito non è pubblicato.

## Verifiche eseguite e limiti

- Il 24 novembre aggiunto l'avvio diretto da `index.html`: script classico con catalogo incorporato, immagini e stile con percorsi relativi. `public/app.js` è generato da `npm run prepare:local`, dalla build e dopo l'importazione. Nessuna richiesta fetch è necessaria per il catalogo.
- `npm test`: 17 test passati, inclusi ordine delle rarità, illustratori su più giochi, DON con filtri di tipo/colore, provenienze delle varianti, filtri multipli e versioni lingua. `npm run build` completata: 865 artwork, sei espansioni, 111,84 MB di immagini; valida anche i due loghi dei giochi WebP. Pacchetti locali della radice e di `dist/` verificati con base file locale dopo la generazione.
- Il browser di verifica integrato blocca `file://`; la verifica visiva viene svolta via HTTP, senza cambiare le protezioni del browser. Il doppio clic nel browser dell'utente non è stato verificato tramite questo strumento.
- Nel browser verificati griglia desktop, ricerca per codice accorpato, holo/non holo nel dettaglio, preferiti e note dopo ricaricamento, paginazione, artwork alternativi e Special OP03.
- Dopo l'avvio senza server, ripetuta via HTTP la verifica di immagini, ricerca `base2-17`, dettaglio Clefable holo/non holo, preferito mantenuto dopo reload e passaggio a One Piece (668 artwork). Il preferito di prova è stato rimosso. Verificato programmaticamente anche `dist/index.html` con base file locale.
- Verificati via HTTP filtri combinati, loghi, apertura delle carte dal set, popup senza righe rimosse, cambio EN/JP con dimensioni immutate, layout mobile e filtri mobili. Nessun errore JavaScript rilevato.
- Ultima verifica locale: eseguito il pacchetto generato in VM con base `file://`, sia dalla radice sia da `dist/`; 865 artwork incorporati e tutti i riferimenti immagine risolti a file esistenti. Nessun errore JavaScript nel browser HTTP. Server di verifica arrestato a fine lavoro.
- `dist/` è stata rigenerata con il catalogo attuale e l'avvio senza server. La build controlla che il percorso resti nel progetto prima di rigenerare l'output.
- **OCR insufficiente:** `data/sample-check.json` non ha riconosciuto watermark chiaramente visibili. Non usarlo come prova di assenza di Sample. Le tavole di controllo sono in `data/qa/`.
- README aggiornato all'interfaccia. FONTI e il rapporto JSON documentano la precedente ricerca, non una certificazione delle immagini attualmente presenti.

## Immagini ancora da correggere

OPPP non è interamente privo di Sample. Nel catalogo attuale sono state individuate visivamente queste voci da sostituire o accorpare con la stessa illustrazione pulita, senza rimuovere il watermark tramite ritocco:

```text
op-OP01-005AA2
op-OP01-014AA
op-OP01-017AA5
op-OP01-021AA2
op-OP02-097
op-OP03-007
op-OP03-084
op-OP03-086AA
op-OP03-095
op-OP03-099
op-OP03-104
op-OP03-105
op-OP03-116AA
op-OP03-117
```

Per Jinbe, Robin, Franky e Spandam esistono già candidati puliti nella stessa fonte: verificare la corrispondenza prima dell'accorpamento. Verificare inoltre i duplicati che differiscono solo per finitura.

Per Namule sono state trovate scansioni fisiche pulite in `data/sources/namule-chaos.image`, `namule-jaq.image` e `namule-tier.image`; non sono ancora state adottate nel catalogo. La scansione Chaos è inglese, quella Tier One giapponese. Provenienza e confronti sono in `data/qa/physical-candidates.jpg` e nella cronologia di questa chat.

Le nuove immagini DON con Sample provenienti dal CDN TCGplayer sono già state sostituite nel catalogo con scansioni pulite OPlayTCG. Le copie di ricerca in `data/qa/` possono ancora contenere Sample e non fanno parte del frontend.

## Apertura locale

Aprire direttamente `index.html` dalla cartella CList con doppio clic, mantenendo `src/` e `public/` al loro posto. Non serve avviare processi o usare Node.js per consultarlo.

Il server di sviluppo è facoltativo: `npm run dev`, porta predefinita 5300. Le porte 5173/5174 risultano riservate da Windows in questa sessione. File locale e indirizzi HTTP hanno preferiti separati; usare Backup per trasferirli. Python serve solo per le nuove importazioni.
