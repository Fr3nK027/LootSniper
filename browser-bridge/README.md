# Radar Usato Browser Bridge

Importa gli annunci caricati nelle ricerche Vinted.it, eBay.it e Subito.it nel Radar sul tuo computer.

## Installazione o aggiornamento

1. Avvia **avvia radar.vbs** nella cartella principale e lascia aperta la dashboard.
2. Apri la gestione estensioni di Chrome o Edge e abilita la modalità sviluppatore.
3. Scegli **Carica non pacchettizzata** e seleziona questa cartella.
4. Se era già installata, premi **Ricarica** sulla scheda dell'estensione.
5. Ricarica anche le schede dei marketplace già aperte, per attivare il parser aggiornato.
6. Apri il popup del Radar e premi **Importa questa pagina**. Il popup conferma solo gli annunci effettivamente salvati.

## Ricerche automatiche

Le ricerche salvate nella dashboard vengono lette dal server locale.

- Le selezioni dei marketplace e delle ricerche vengono ricordate.
- **Usa tutte le ricerche** comprende anche nuove ricerche aggiunte successivamente.
- Con l'opzione disattivata e nessuna selezione non viene eseguita alcuna ricerca.
- **Controlla ogni 15 minuti e all'avvio** abilita o disabilita il controllo automatico. Rimane possibile avviarlo manualmente.
- **Esegui ricerche selezionate** apre schede in background. Per ogni fonte legge fino a 20 pagine e si ferma su una pagina vuota o ripetuta.
- **Interrompi ricerca** chiude la scheda aperta dall'automazione; le schede personali rimangono aperte.
- Lo stato resta visibile riaprendo il popup. Gli annunci nuovi e aggiornati sono conteggiati separatamente.

I controlli periodici richiedono browser, dashboard e server aperti; chiudendo tutte le dashboard il server avviato in modalità nascosta si arresta automaticamente. I controlli possono essere ritardati durante sospensione o risparmio energetico; gli allarmi vengono ripristinati all'avvio. Vedi la [documentazione Chrome sugli allarmi](https://developer.chrome.com/docs/extensions/reference/api/alarms).

## Se qualcosa non funziona

| Messaggio o comportamento | Cosa fare |
| --- | --- |
| Server offline | Avvia avvia radar.vbs, poi riapri il popup. |
| Pagina non pronta / nessuna risposta | Ricarica la scheda dopo aver aggiornato l'estensione. |
| Nessun annuncio leggibile | Apri una pagina di ricerca e attendi che le schede siano caricate. |
| Login o verifica richiesti | Completa personalmente il normale accesso sul sito, poi riprova l'importazione. |
| Una fonte non leggibile nell'automazione | Prova l'importazione manuale dalla ricerca aperta. |
| Nessuna ricerca selezionata | Salva una ricerca nella dashboard e selezionala nel popup. |

L'estensione non avvia direttamente programmi sul computer. Legge titolo, prezzo, testo della scheda, URL e immagine, e li invia al server su 127.0.0.1:8765. Non trasmette password o cookie. Il server conserva fino a 5.000 importazioni; la dashboard mantiene separatamente le opportunità già salvate.

Il parser condiviso è in listings.js; content.js gestisce raccolta e conferma, background.js le importazioni e l'automazione, popup.js le impostazioni. La messaggistica asincrona segue la [documentazione Chrome](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).
