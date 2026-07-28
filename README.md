# Passo dopo Passo – Versione 2.3

## Novità
- Centro documenti intelligente
- Stati: Manca, Da aggiornare, Completo
- Date e scadenze
- Collegamento del documento a una visita
- Note organizzative
- Riepilogo automatico documenti completi, mancanti e in scadenza entro 30 giorni
- Compatibilità con i documenti già presenti

Il progetto continua a usare il medesimo salvataggio locale e la sincronizzazione Google Sheets. Non è necessario modificare Code.gs.

Prima di pubblicare, conservare in config.js il proprio URL Apps Script terminante in /exec.


## Versione 2.4 – Assistente Oggi
La dashboard analizza visite future, documenti mancanti, diario della gravidanza e checklist per proporre automaticamente una sola azione prioritaria. Il pulsante “Iniziamo” apre direttamente la sezione corretta.


## Versione 2.6 — Aggiornamenti automatici

La PWA controlla gli aggiornamenti all'apertura e poi periodicamente. Quando una nuova versione è pronta mostra **Aggiorna adesso**; il nuovo service worker viene attivato e la pagina si ricarica senza eliminare i dati locali o quelli sincronizzati con Google Sheets.

Per ogni futura pubblicazione ricordarsi di cambiare il nome della cache in `service-worker.js` (ad esempio da `passo-dopo-passo-v6` a `passo-dopo-passo-v7`) e il numero `APP_VERSION` in `app.js`.


## Novità v2.6
- Modulo Prepariamoci alla nascita
- Checklist dinamica in base ai giorni mancanti al parto
- Valigia mamma, bambino, accompagnatore, documenti, casa e rientro
- Attività personalizzate
- Collegamento con l’Assistente Oggi
