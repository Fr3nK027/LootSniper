# LootSniper · occasioni gaming in locale

Cerca, salva e confronta portatili gaming usati su **Vinted, eBay e Subito**, dal tuo PC. Il programma apre una dashboard nel browser e conserva gli archivi sul dispositivo.

**Questa versione si esegue esclusivamente in locale.** GitHub distribuisce il progetto e la guida: non devi attivare GitHub Pages, configurare Supabase o inserire chiavi API. Per cercare nuovi annunci serve una connessione Internet; l’archivio già salvato si può consultare anche senza connessione.

![Dashboard LootSniper con ricerca, filtri e statistiche](docs/images/dashboard.png)

*Le schermate di questa guida usano annunci sintetici di test, non offerte reali.*

## Installazione semplice per Windows

[⬇️ **Scarica LootSniper per Windows**](https://github.com/Fr3nK027/LootSniper/archive/refs/heads/main.zip)

1. Estrai completamente lo ZIP scaricato.
2. Apri la cartella estratta e fai doppio clic su **Installa LootSniper.cmd**.
3. Attendi il messaggio **Installazione completata**: si aprirà la dashboard e troverai **LootSniper** sul desktop e nel menu Start.

Non servono privilegi di amministratore, Python, pip o Node.js. L’installer:

- installa il programma in `%LOCALAPPDATA%\Programs\LootSniper`;
- scarica una copia privata e isolata di Python 3.14.7 dal sito ufficiale Python;
- controlla il file scaricato con l’hash SHA-256 pubblicato da Python.org prima di estrarlo;
- crea i collegamenti con l’icona LootSniper;
- avvia dashboard e server senza lasciare finestre CMD nella barra delle applicazioni.

Il runtime rimane dentro l’installazione di LootSniper: non modifica il Python già presente sul PC e non aggiunge variabili di sistema. I componenti dell’app usano soltanto la libreria standard, quindi non vengono scaricati pacchetti da fonti aggiuntive. Dettagli: [pacchetto Python incorporabile](https://docs.python.org/3/using/windows.html#the-embeddable-package) e [Python 3.14.7](https://www.python.org/downloads/release/python-3147/).

![Installazione e avvio automatici di LootSniper](docs/images/avvio.svg)

Windows può mostrare un avviso perché lo script non è firmato digitalmente. Verifica che lo ZIP provenga dal repository `Fr3nK027/LootSniper`; quindi apri **Ulteriori informazioni → Esegui comunque** se l’avviso compare.

## Primo avvio

La prima apertura mostra una guida in tre passaggi. Inserisci cosa cerchi e, se vuoi, il budget: LootSniper prepara automaticamente i link per Vinted, eBay e Subito. La guida rimane sempre disponibile con **Guida rapida**.

![Avvio guidato di LootSniper](docs/images/guida.png)

In seguito avvia il programma dal collegamento **LootSniper** sul desktop o nel menu Start. La dashboard è disponibile su [http://127.0.0.1:8765](http://127.0.0.1:8765); in alto deve apparire **Server connesso**.

Per chiudere subito premi **Arresta LootSniper** nella barra laterale. Chiudendo tutte le schede della dashboard, il server termina automaticamente dopo circa 45 secondi; se il browser si arresta senza avvisare, la pulizia avviene dopo circa 3 minuti. Non rimane un CMD da chiudere.

### Uso portatile e avvio dal terminale

Se preferisci non installare il programma, serve Python 3.10 o successivo. Estrai lo ZIP e fai doppio clic su **avvia radar.vbs**, oppure apri un terminale nella cartella:

```powershell
py -3 launcher.py --background
```

In alternativa:

```text
python launcher.py --background
```

Su macOS e Linux puoi usare `python3 launcher.py --background` con Python 3.10+; installer, VBS e BAT sono specifici per Windows. I controlli effettuati per questa distribuzione sono su Windows.

Per la diagnostica con terminale visibile usa `python launcher.py` e chiudi con **Ctrl+C**. Per avviare soltanto il server usa `python server.py`: l’arresto alla chiusura delle schede è attivo solo con `--auto-stop`. Il pulsante **Arresta LootSniper** funziona anche in modalità manuale.

## Esegui una ricerca

1. Nel campo **Cosa stai cercando?** scrivi, per esempio, `laptop RTX 4070`.
2. Premi **Genera i tre link dalla ricerca**.
3. Se vuoi filtri specifici, apri il marketplace, imposta i filtri sul sito e copia l’URL nel campo Vinted, eBay o Subito corrispondente.
4. Lascia vuoti i campi delle piattaforme che non vuoi interrogare. Se cambi nuovamente la ricerca rapida, i link possono essere rigenerati.
5. In **Impostazioni → Ricerca** attiva **Più pagine** per leggere fino a 20 pagine per sito.
6. Premi **Esegui ricerca** e segui il messaggio di stato. Il riquadro **Attività** contiene i dettagli tecnici.
7. Per fermare il lavoro premi **Interrompi ricerca**: quanto raccolto rimane salvato.

LootSniper seleziona portatili con hardware riconosciuto e prezzo inizialmente entro il 95% della stima indicativa. Per questo gli annunci analizzati possono essere più numerosi delle opportunità aggiunte.

Alcuni marketplace possono bloccare la lettura diretta o caricare gli annunci soltanto nel browser. In questi casi usa l’estensione descritta al passo 6.

### Salva una ricerca

1. Prepara i link.
2. Scrivi un nome in **Nome della ricerca**.
3. Premi **Salva**.
4. In seguito premi il nome per ricaricare i link, **▶** per eseguirli o **×** per eliminare la ricerca.

Le ricerche salvate sono condivise con l’estensione attraverso il server locale.

## Valuta, filtra e confronta

- Cerca un modello o una caratteristica nei risultati.
- Filtra per marketplace, budget massimo e differenza minima.
- Premi la **stella** sulla scheda per salvarla nei preferiti.
- Usa **Solo preferiti** per restringere l’archivio.
- Scegli l’ordinamento; **Mostra altri 60 annunci** carica le schede successive.
- Premi **Apri annuncio** per verificare l’offerta originale sul marketplace.
- Leggi **Perché è nel radar** e apri **Cosa verificare prima di comprare**: LootSniper distingue i dati riconosciuti nel testo da quelli ancora mancanti.

Per confrontare due o tre portatili:

1. Seleziona **Confronta** sulle rispettive schede.
2. Premi il pulsante **Confronta** nella barra in basso.
3. Leggi la tabella e chiudila con **×** oppure **Esc**.

![Confronto di due annunci dimostrativi nella dashboard](docs/images/confronto.png)

**Stime e indice hardware sono indicativi:** non sono quotazioni aggiornate, benchmark o una garanzia di rivendita. Controlla prezzo, configurazione, condizioni, spedizione e commissioni nell’annuncio originale. I rialzi e ribassi mostrati si basano sui prezzi osservati da LootSniper, non su uno storico completo del marketplace.

## Installa l’estensione locale

L’estensione è facoltativa: serve per importare gli annunci visibili nelle pagine dei marketplace e controllare le ricerche salvate.

![Schema di installazione dell’estensione e importazione in LootSniper](docs/images/estensione.svg)

1. Avvia LootSniper e lascia aperta la dashboard.
2. Su Chrome apri `chrome://extensions`; su Edge apri `edge://extensions`.
3. Attiva **Modalità sviluppatore**.
4. Premi **Carica estensione non pacchettizzata** o **Carica decompressa**, secondo il browser.
5. Seleziona la cartella **browser-bridge** del progetto, quella che contiene `manifest.json`.
6. Apri una ricerca su Vinted.it, eBay.it o Subito.it e attendi che gli annunci siano caricati.
7. Dal menu delle estensioni del browser apri **LootSniper Bridge**.
8. Verifica **Server connesso**, poi premi **Importa questa pagina**.
9. Torna alla dashboard: gli annunci importati vengono controllati periodicamente e le opportunità aggiornate compaiono nell’archivio.

Non devi esportare un file dalla pagina del marketplace: questa estensione invia gli annunci direttamente al server locale. Se un sito chiede login o verifiche, completali personalmente prima di riprovare.

La procedura di caricamento è documentata anche nella [guida ufficiale Chrome](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked).

### Ricerche automatiche

1. Salva almeno una ricerca nella dashboard.
2. Apri il popup dell’estensione.
3. Seleziona i marketplace.
4. Attiva **Usa tutte le ricerche** oppure seleziona quelle desiderate nell’elenco.
5. Imposta **Controlla ogni 15 minuti e all’avvio** secondo la tua preferenza: nella configurazione iniziale è attivo.
6. Premi **Salva automazione**.
7. Per partire subito premi **Esegui ricerche selezionate**.
8. Per fermarti premi **Interrompi ricerca**.

Il browser, almeno una scheda della dashboard e il server locale devono restare aperti. Le schede dell’automazione vengono aperte in background; i controlli possono essere ritardati durante la sospensione del PC. L’estensione non avvia il server. Senza **Usa tutte le ricerche**, un elenco non selezionato non avvia alcuna ricerca.

## Notifiche Discord: pubblica le bombe nel tuo canale

Questa funzione è facoltativa e inizialmente disattivata. Non serve creare un bot.

![Pannello Discord nelle impostazioni di LootSniper](docs/images/discord.png)

1. Nel tuo server Discord apri **Impostazioni server → Integrazioni → Webhook**. Serve il permesso di gestire i webhook.
2. Crea un webhook, scegli un **canale testuale** e copia l’URL. Questa versione non configura thread di canali forum.
3. Nella dashboard apri **Impostazioni → Discord · pubblica le bombe**.
4. Incolla l’URL nel campo **URL webhook Discord**.
5. Imposta la **Differenza stimata minima (€)**: per esempio 200 invia soltanto nuove opportunità con almeno 200 € di differenza tra stima e prezzo.
6. Attiva **Pubblica le nuove bombe** e premi **Salva Discord**.
7. Premi **Invia messaggio di prova** e verifica il messaggio nel canale. Il pulsante usa il webhook già salvato.
8. Avvia una ricerca oppure importa nuovi annunci con l’estensione. Le nuove opportunità che rispettano la soglia vengono pubblicate automaticamente con titolo, link, prezzo e stima indicativa.

Gli annunci già presenti nell’archivio prima dell’attivazione non vengono pubblicati in blocco. Gli invii confermati vengono ricordati per gli ultimi 10.000 identificativi, anche dopo un riavvio; le normali variazioni di prezzo non producono nuovi messaggi. La coda conserva fino a 200 invii, rispetta le attese richieste da Discord e riprova gli errori di rete temporanei fino a tre tentativi. Lo stato degli invii compare sotto i pulsanti. Le menzioni automatiche come @everyone sono disabilitate.

Per fermare le notifiche disattiva **Pubblica le nuove bombe** e premi **Salva Discord**: gli invii ancora in coda vengono annullati. **Rimuovi webhook** elimina la configurazione del canale. Una richiesta già partita può comunque completarsi.

Il webhook è conservato in **radar-discord.json**, escluso da Git e dal pacchetto distribuibile. Il backup della dashboard non contiene il webhook: su un altro PC va configurato di nuovo. Non pubblicare questo file e non incollare l’URL nel README. Quando attivi Discord, i dati delle nuove opportunità vengono inviati al canale scelto; ricerche salvate e altri archivi restano locali. Dettagli tecnici: [webhook Discord](https://docs.discord.com/developers/resources/webhook), [limiti degli invii](https://docs.discord.com/developers/topics/rate-limits).

## Backup, ripristino e aggiornamenti

### Esporta e ripristina

1. Premi **Esporta backup** e conserva il file JSON.
2. Per ripristinarlo, anche su un altro PC, avvia LootSniper e premi **Importa backup**.
3. Seleziona il file: gli annunci vengono uniti per identità e vengono recuperati preferiti e ricerche compatibili.

Se non hai annunci ma vuoi salvare le ricerche, usa **Archivio → Backup completo**.

**Archivio → Svuota archivio** conserva una copia recuperabile con **Annulla svuotamento**, anche dopo un ricaricamento. Il recupero resta disponibile finché i dati del browser sono conservati. Gli annunci svuotati possono rientrare se aggiornati o trovati da una nuova scansione.

### Dove sono i dati

| Dato | Dove si trova |
| --- | --- |
| Ricerche condivise con l’estensione | `radar-searches.json`, nella cartella del progetto |
| Ultimi 5.000 annunci importati dall’estensione | `radar-imports.json`, nella cartella del progetto |
| Opportunità, preferiti, filtri e recupero archivio | Memoria locale del browser |
| Configurazione privata Discord, coda e invii confermati | `radar-discord.json` |
| Diagnostica del server e dell’avvio nascosto | `radar-server.log`, `radar-avvio.log` |
| Backup esportati | Cartella download scelta nel browser |

I file dati vengono creati quando necessari. Un progetto appena scaricato parte senza i tuoi archivi personali.

### Aggiorna il programma

1. Esporta un backup prima dell’aggiornamento.
2. Premi **Arresta LootSniper** nella vecchia dashboard.
3. Scarica ed estrai il nuovo ZIP.
4. Esegui di nuovo **Installa LootSniper.cmd**. L’installer aggiorna i file del programma, riusa il runtime già verificato e conserva ricerche, importazioni e configur Discord presenti nella cartella installata.
5. Ricarica l’estensione dalla pagina delle estensioni del browser e poi ricarica le schede dei marketplace.

Gli annunci e i preferiti della dashboard restano nella memoria del browser: usando lo stesso browser e `127.0.0.1:8765` ricompaiono automaticamente.

## Risoluzione dei problemi

| Problema | Cosa fare |
| --- | --- |
| Il download automatico non parte | Controlla la connessione e che `python.org` non sia bloccato da firewall o proxy; poi riavvia `Installa LootSniper.cmd`. |
| L’installer segnala che LootSniper è aperto | Premi **Arresta LootSniper** nella dashboard e riprova. |
| Windows mostra un avviso | Verifica di aver scaricato dal repository ufficiale, poi usa **Ulteriori informazioni → Esegui comunque**. |
| Python non trovato nella modalità portatile | Installa Python 3.10+ e verifica `py -3 --version`, oppure usa l’installer automatico. |
| L’avvio nascosto segnala un errore | Leggi `radar-avvio.log` e `radar-server.log` nella cartella del progetto. |
| Script VBS non disponibile sul PC | Apri un terminale nella cartella ed esegui `py -3 launcher.py --background`; poi chiudi il terminale. |
| Porta 8765 occupata | Arresta la vecchia copia; non avviare due copie diverse insieme. |
| Server offline | Riapri `avvia radar.vbs` e visita `http://127.0.0.1:8765`. |
| Discord non invia | Salva un webhook valido, prova il messaggio di test e controlla soglia e stato. La dashboard deve essere aperta per rilevare nuove bombe. |
| Nessuna opportunità trovata | Azzera i filtri, controlla i link e il riquadro Attività; verifica se gli annunci rientrano nei criteri hardware e prezzo. |
| Un marketplace non viene letto | Apri la ricerca nel browser e usa l’estensione dopo il caricamento. |
| L’estensione non risponde | Ricarica l’estensione e le schede dei marketplace; controlla che il server sia avviato. |
| Ricerche non sincronizzate | Ricarica la dashboard a server attivo. Se compare, usa **Recupera ricerche dalla copia locale**. |
| Archivio apparentemente vuoto | Usa lo stesso browser e indirizzo; controlla **Solo preferiti** e gli altri filtri, oppure importa un backup. |
| File dati danneggiato | Il file viene conservato. Arresta il server e ripristina una copia valida; non cancellarlo senza un backup. |

## Pubblicare o contribuire

Il repository contiene codice, estensione, test e immagini della guida. Non occorre configurare un servizio cloud.

**Per preparare una copia distribuibile**, dalla cartella del progetto esegui:

```powershell
py -3 crea_pacchetto.py
```

Troverai **dist/radar-usato-locale.zip**. Il pacchetto include soltanto i file previsti, senza ricerche personali, annunci, webhook, log o cache. Puoi allegarlo a una release GitHub oppure estrarlo e caricare il contenuto nella radice del repository.

Con Git, `.gitignore` esclude gli archivi personali. Se usi il caricamento manuale dal sito GitHub, usa il contenuto del pacchetto pulito: il caricamento manuale non applica `.gitignore`. Carica anche **docs/images**, altrimenti le immagini nel README non saranno visibili.

### Verifica per sviluppatori

Python usa soltanto la libreria standard. Node.js serve esclusivamente per i test JavaScript:

```text
python -B -m unittest discover -s tests -v
node --test tests/core.test.js tests/app.test.js tests/extension.test.js
```

Per un’anteprima con annunci sintetici, isolata dai dati reali:

```text
python -B tests/preview_server.py
```

Apri [la dashboard di test](http://127.0.0.1:8766/) o [i test del parser](http://127.0.0.1:8766/tests/listings.html). Arresta il server di test con **Ctrl+C**.

| File o cartella | Funzione |
| --- | --- |
| `Installa LootSniper.cmd`, `installa.ps1`, `distribuzione.json` | Installazione Windows, runtime verificato e collegamenti |
| `avvia radar.vbs`, `avvia radar locale.bat` | Avvio Windows nascosto |
| `launcher.py` | Avvio, controllo del server e apertura del browser |
| `server.py` | Server locale e gestione degli archivi |
| `radar usato 3 market.html`, `styles.css`, `experience.css`, `app.js`, `radar-guide.js` | Dashboard e avvio guidato |
| `radar-core.js` | Prezzi, validazione e stime hardware |
| `radar-runtime.js`, `radar_lifecycle.py` | Impostazioni, presenza delle dashboard e arresto automatico |
| `radar_discord.py` | Configurazione privata, coda e invio delle notifiche Discord |
| `browser-bridge/` | Estensione Chrome/Edge |
| `assets/` | Icona del programma |
| `docs/images/` | Immagini della guida |
| `tests/` | Test automatici e anteprima isolata |

Il server ascolta soltanto su **127.0.0.1**, verifica gli URL dei marketplace e non serve al browser i file Python o gli archivi JSON come file pubblici.
