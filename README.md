# Passo dopo Passo – versione completa

Web app PWA per organizzare il percorso di una famiglia con un figlio con sindrome di Down, dalla nascita ai 18 anni.

## Funzioni incluse

- Dashboard mobile e desktop
- Profilo del bambino
- Checklist per fase di età
- Calendario di visite, terapie e scadenze
- Area salute e terapie
- Registro documenti
- Area scuola e PEI
- Monitoraggio agevolazioni
- Registro spese con totale in euro
- Diario dei traguardi
- Salvataggio locale per uso offline
- Sincronizzazione con Google Sheets tramite Apps Script
- Icone PWA, favicon e logo personalizzato

## Collegamento a Google Sheets

1. Crea un Foglio Google.
2. Apri **Estensioni > Apps Script**.
3. Incolla il contenuto di `Code.gs`.
4. Esegui una volta la funzione `setup` e autorizzala.
5. Apri **Esegui il deployment > Nuovo deployment > App web**.
6. Imposta **Esegui come: Me** e **Chi ha accesso: Chiunque**.
7. Copia l'indirizzo che termina con `/exec`.
8. Incollalo nel file `config.js` al posto di `INCOLLA_QUI_URL_APPS_SCRIPT_EXEC`.

## Pubblicazione su GitHub Pages

Carica tutti i file nella cartella principale del repository e attiva GitHub Pages da **Settings > Pages > Deploy from a branch**, scegliendo `main` e `/root`.

## Aggiornamenti

Quando sostituisci i file su GitHub, il service worker potrebbe mantenere per pochi minuti la vecchia versione. Chiudi e riapri l'app oppure elimina i dati del sito dal browser.

## Privacy

La versione registra dati organizzativi e note. Il registro documenti non carica ancora i file sanitari veri e propri. Prima di offrire il servizio pubblicamente a più famiglie è necessario aggiungere autenticazione, informativa privacy, gestione del consenso e adeguate misure di sicurezza.

## Aggiornamento dashboard 1.1

- Riepilogo numerico immediato
- Azioni rapide
- Priorità evidenziate
- Migliore esperienza mobile


## Versione 2.1 – Diario della gravidanza
- Diario settimanale automatico
- Stato emotivo di mamma e papà
- Ricordi e domande per il medico
- Cronologia sincronizzata con Google Sheets
