# Fonti Pokémon e One Piece — EN / JP

Verifica del **24 novembre 2026**. Questa fase riguardava solo le fonti. Nel successivo aggiornamento dell'interfaccia otto scansioni Tier One JP qui individuate sono state collegate ai popup come versioni lingua dello stesso artwork. Stato corrente in [STATO.md](STATO.md); il rapporto numerico sottostante conserva lo snapshot della ricerca.

## Scelta per il progetto

| Ambito | Inventario | Immagini e integrazioni |
| --- | --- | --- |
| Pokémon EN | CardCorpus, confronto con Bulbapedia e TCG Collector | TCGdex, PkmnCards, CardCorpus |
| Pokémon JP | CardCorpus, confronto con Bulbapedia e TCG Collector JP | Pokellector JP, CardCorpus, sito ufficiale per le uscite recenti |
| One Piece EN | Bandai EN; Koala Kollect come dataset di confronto | OPPP, scansioni fisiche EN per le lacune |
| One Piece JP | Bandai JP; Koala Kollect come dataset di confronto | Scansioni fisiche JP, fra cui Tier One; DON verificati separatamente |

**Nessuna fonte unica è stata verificata completa e interamente priva di Sample in entrambe le lingue.** La combinazione proposta permette di misurare e colmare le lacune. Espansioni, starter, promo, premi evento, ristampe e DON richiedono controlli distinti. La pubblicazione online di una carta non prova che sia già uscita: verificare le date regionali.

## Verifica Pokémon

### CardCorpus: base strutturata EN e JP

Il [dataset pubblico CardCorpus](https://github.com/cardcorpus/pokemon-card-dataset) offre JSON statici di carte, stampe, finiture e collegamenti fra lingue/illustrazioni. Snapshot controllato: **21 novembre 2026**. Nessuna chiave API. Le immagini sono separate, in AVIF fino a 960 px di larghezza, da convertire in WebP.

Ho letto integralmente gli indici dei set e delle carte:

| Catalogo | Gruppi/set | Record carta | Nella lingua richiesta | Senza riferimento immagine frontale |
| --- | ---: | ---: | ---: | ---: |
| English | 324 | 25.335 | 25.319 EN | 7 |
| Japanese | 449 | 28.359 | 28.350 JP | 151 |

I cataloghi includono alcune carte in altre lingue: filtrare `language`. I conteggi per set coincidono con gli indici. **Record, varianti e artwork unici sono quantità diverse.** Le 158 lacune sono elencate in [verifica-fonti.json](verifica-fonti.json). Un riferimento immagine non certifica download e qualità visiva.

Un campione AVIF risponde HTTP 200, ma il Pillow installato non lo decodifica: compatibilità da risolvere prima dell'importazione. Discrepanza rilevata: Fossil JP è datato 20/06/1997, contro 21/06/1997 in [Bulbapedia](https://bulbapedia.bulbagarden.net/wiki/Fossil_(TCG)) e [Pokellector](https://jp.pokellector.com/Mystery-of-the-Fossils-Expansion/).

### Primi tre set: confronto effettivo

| Set regionale | Carte CardCorpus | Riferimenti immagine CardCorpus | Carte TCGdex | Riferimenti immagine TCGdex |
| --- | ---: | ---: | ---: | ---: |
| EN Base Set | 102 | 102 | 102 | 102 |
| EN Jungle | 64 | 64 | 64 | 64 |
| EN Fossil | 62 | 62 | 62 | 62 |
| JP Expansion Pack | 102 | 102 | 102 | **0** |
| JP Pokémon Jungle | 48 | 48 | 48 | **0** |
| JP Mystery of the Fossils | 48 | 48 | 48 | **0** |

Le edizioni JP non sono traduzioni dei set EN: Fossil JP include Mew e ha 48 carte, contro 62 numeri EN. Gli indici sintetici delle prime carte JP non vanno scambiati per numeri di collezione stampati sull'originale.

### TCGdex: utile, ma insufficiente da solo

Gli endpoint [EN](https://api.tcgdex.net/v2/en/sets) e [JA](https://api.tcgdex.net/v2/ja/sets) restituiscono **221 e 204 set**. I primi tre JP sono presenti come `PMCG1`, `PMCG2`, `PMCG3`, pur senza immagini. Nel controllo moderno, `SV2a` ha 210 carte e 210 riferimenti immagine; `M5` ha 118 carte e nessun riferimento. La [pagina di stato](https://tcgdex.dev/status) avverte che il completamento varia per lingua.

Le [immagini high](https://tcgdex.dev/assets) supportano PNG/JPG/WebP, normalmente 600×825. TCGdex resta utile per l'inglese già importato e i set JP verificati, non come unica fonte completa EN/JP.

### Controlli e integrazioni

- **Bulbapedia:** [espansioni EN](https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_Trading_Card_Game_expansions), [JP](https://bulbapedia.bulbagarden.net/wiki/List_of_Japanese_Pok%C3%A9mon_Trading_Card_Game_expansions), pagine carta e promo. Riferimento editoriale per le eccezioni. Il [link Archives fornito dall'utente](https://archives.bulbagarden.net/media/upload/1/1c/EnergySearchScarletViolet172.jpg) è un percorso diretto corretto, ma ha restituito HTTP 403 in questo ambiente.
- **TCG Collector:** indici [EN](https://www.tcgcollector.com/sets/intl) e [JP](https://www.tcgcollector.com/sets/jp), con espansioni storiche, mazzi e promo. Verificati i primi tre JP: 102/48/48. Non è stata verificata un'API pubblica per il download massivo.
- **Pokellector:** indici [EN](https://www.pokellector.com/sets) e [JP](https://jp.pokellector.com/sets). Le tre pagine iniziali JP espongono 102/48/48 immagini. Scaricato un originale campione per pagina: 567×800, 567×800, 570×794. L'indice JP ha però lacune storiche visibili, per esempio nella sezione DP: non usarlo come unico inventario.
- **PkmnCards:** fonte aggiuntiva per scansioni EN. La [pagina About](https://pkmncards.com/about/) dichiara assenza di API/dump e contempla il download personale delle immagini. Non verificato come archivio JP completo.
- **Scrydex:** la [documentazione](https://scrydex.com/docs/pokemon/api-reference) dichiara espansioni principali EN/JA; promo e prodotti secondari sono ancora in ampliamento. Richiede chiave e team ID. Nessun account attivato né dataset autenticato verificato: alternativa da valutare, non fonte certificata. Le [indicazioni sulle immagini](https://scrydex.com/docs/getting-started/best-practices) prevedono cache locali.

## Verifica One Piece

### Bandai EN e JP: inventario primario

I cataloghi ufficiali [EN](https://en.onepiece-cardgame.com/cardlist/) e [JP](https://www.onepiece-cardgame.com/cardlist/) sono inventari separati. Includono parallel e ristampe: conservare gli identificativi delle immagini. `_p1` non garantisce la stessa illustrazione fra regioni.

Scaricate e confrontate le sei liste iniziali:

| Set | Serie EN / JP | Voci immagine EN / JP | Codici distinti EN / JP |
| --- | --- | ---: | ---: |
| OP01 | 569101 / 550101 | 154 / 154 | 121 / 121 |
| OP02 | 569102 / 550102 | 154 / 154 | 121 / 121 |
| OP03 | 569103 / 550103 | 154 / 154 | 127 / 127 |

OP03 comprende 123 codici OP03 e quattro Special con codici precedenti: cercare solo il prefisso perde carte del prodotto. Questi conteggi non includono DON o artwork di ristampe successive. Le immagini ufficiali controllate contengono **Sample** e non soddisfano la richiesta estetica.

### Koala Kollect: dataset di confronto

Il [repository](https://github.com/hotavocado/koala-kollect-data) contiene dati EN/JP, prodotti e provenienza. Il [manifesto](https://github.com/hotavocado/koala-kollect-data/blob/main/manifest.json) scaricato è del **22 ottobre 2026**, non del giorno della verifica, nonostante il README descriva aggiornamenti giornalieri.

Gli identificativi delle stampe associate ai sei prodotti coincidono esattamente con Bandai: 154 ciascuno, nessuna mancanza/voce extra. Verificati gli hash SHA-256 dei sei JSONL scaricati. Buona base di confronto, da riallineare alle nuove uscite.

Le immagini rimandano a Bandai e mantengono Sample. Il [contratto](https://github.com/hotavocado/koala-kollect-data/blob/main/CONTRACT.md) documenta limiti su DON, immagini mancanti e collegamenti fra illustrazioni. Non è un archivio completo di scansioni pulite JP. Per i DON consultare anche la [lista ufficiale JP in PDF](https://www.onepiece-cardgame.com/pdf/don-cardlist.pdf) e le pagine prodotto/evento.

### Immagini pulite: OPPP e scansioni aggiuntive

[OPPP](https://oppp.online/proxies/one-piece) fornisce molte immagini EN e alternative, ma **non è interamente privo di Sample**. Nel frontend sono state individuate 14 voci da sostituire/accorpare: elenco in [STATO.md](STATO.md). Inoltre raggruppa spesso per codice originario: OP03 mostra 123 codici, non 127. Non usarlo per certificare l'appartenenza di ogni parallel al booster originale.

Scansioni fisiche trovate, senza nuova importazione:

- **EN:** [Chaos Cards, Namule OP03-007](https://www.chaoscards.co.uk/prod/one-piece-card-game-single-cards/namule-op03-007-pillars-of-strength-one-piece-single-card), pulita 580×800. Altri codici mancanti risultano indicizzati: verificare ogni immagine.
- **JP:** [Tier One, Namule OP03-007](https://tier-one-onepiece.jp/view/item/000000000486), 995×1385. Scaricati candidati anche per OP02-097 e OP03-084/095/099/104/105/117. Tavola locale `data/qa/tier-replacements.jpg`. Il negozio non è stato certificato completo.
- **DON JP:** [OPlayTCG Shanks](https://oplaytcg.com/en/dons/op02-shanks) e [Sanji](https://oplaytcg.com/en/dons/op03-sanji) hanno fornito le scansioni già presenti. Le controparti EN controllate avevano Sample: non etichettare inglese una scansione JP.

I campioni mancanti controllati su TCGplayer, Limitless, OnePieceDB e DotGG hanno ancora Sample, talvolta poco visibile. [TCGCSV](https://tcgcsv.com/docs) è utile come catalogo aggiuntivo EN per DON/finiture; non verificato come archivio JP completo. [Vegapull Records](https://github.com/coko7/vegapull-records) dichiara snapshot EN 2025 e JP 2024 e problemi nei dati JP: non lo sceglierei come riferimento aggiornato principale.

## Applicazione alla futura importazione

### Loghi del selettore del gioco

Loghi scaricati dai siti ufficiali e convertiti in WebP con trasparenza, senza modificare la grafica: [Pokémon TCG](https://tcg.pokemon.com/assets/img/global/logos/en-us/tcg-logo-2x.png) (originale 250×128) e [One Piece Card Game](https://en.onepiece-cardgame.com/renewal/images/common/logo_op.png) (562×145). URL conservati in `data/game-logos.json`; file locali in `public/images/games/`. Durante l'uso non vengono richiesti ai server esterni.

### Etichette delle varianti già caricate — 24 novembre 2026

Per le 299 alternative One Piece già presenti sono state confrontate le immagini con gli inventari ufficiali EN/JP e, per le eccezioni, CN, tramite i riferimenti Koala Kollect. Le promo mancanti sono state confrontate con il [catalogo TCGCSV delle Promotion Cards](https://tcgcsv.com/tcgplayer/68/17675/products), che collega ogni immagine al relativo prodotto TCGplayer. Le tavole di confronto restano nella cache esclusa dalla build; `scripts/match_artwork_origins.py` genera candidati, **non modifica il catalogo e non certifica automaticamente un'origine**. Richiede Pillow e NumPy.

Il registro rivisto `data/artwork-origins.json` contiene 303 voci, compresi quattro DON, con etichetta, stato e URL di supporto; viene riapplicato dall'importatore. Le etichette descrivono un prodotto o una distribuzione documentata della **stessa illustrazione**, non tutte le sue ristampe e non l'autenticità o la lingua fisica della scansione OPPP. Alcune illustrazioni di prodotti CN sono presenti su OPPP con testo inglese: l'origine non trasforma queste immagini in stampe inglesi ufficiali. Gli ID e i preferiti restano invariati.

Esempi: Uta OP01-005 AA corrisponde a Premium Card Collection — Uta; AA1 all'illustrazione distribuita anche in Gift Collection 2023; AA2 a Film Red — Finale Set. Hatchan OP03-033 AA2 è Winner Pack Vol. 6. I confronti considerano anche timbri Winner/Championship, evitando di attribuirli al normale booster dal solo codice.

[Cardmarket](https://www.cardmarket.com/en/OnePiece/Cards/Uta-OP01-005/Versions) è stato consultato come richiesto: le pagine dirette hanno restituito 403, mentre alcuni risultati indicizzati e lo screenshot dell'utente rendono leggibili categorie come Premium Bandai Products e Unnumbered Promos. Per le etichette sono stati preferiti i nomi specifici dei prodotti documentati e confrontati visivamente. I gruppi Pokémon sono invece verificati nell'[indice Pokellector](https://www.pokellector.com/sets): i tre set presenti appartengono a **Base Set Series**.

Tre immagini non hanno una corrispondenza affidabile nei riferimenti confrontati: `op-OP01-001AA`, `op-OP01-001AA4`, `op-OP01-016AA9`. Rimangono disponibili con etichetta **OPPP · Origine non verificata**. Non sono state attribuite a prodotti ufficiali né classificate come fan art senza una prova. Nessuna nuova carta o immagine è stata importata nel frontend durante questo aggiornamento.

1. Inventari regionali distinti, lingua stampata e provenienza esplicite; niente sostituzioni silenziose EN/JP.
2. Una voce visiva per illustrazione **e lingua**; holo/non holo nei metadati se cambia solo la finitura. Non importare ogni variante fisica come artwork separato.
3. Corrispondenze verificate, non dedotte dal solo nome, numero o suffisso.
4. Registro di immagini mancanti, Sample, qualità insufficiente e discrepanze. Cercare le eccezioni singolarmente. L'OCR locale non è una prova affidabile di assenza di watermark.
5. Download in piccoli lotti con cache; conversione WebP, dimensioni native, hash e miniature. Durante l'uso, il frontend continua a leggere solo file locali.

Conteggi, lacune e hash sono in [verifica-fonti.json](verifica-fonti.json). Le risposte originali restano nella cache locale esclusa dalla build. Non sono state scaricate o verificate visivamente tutte le immagini degli archivi completi.
