# Passo dopo Passo — Versione 3.0.0

## Novità: Archivio documenti e referti

La versione 3.0 aggiunge al Centro documenti:

- caricamento locale di PDF, immagini e file di testo;
- apertura e anteprima dei file salvati;
- testo del referto associato al documento;
- lettura guidata che organizza sintesi, indicazioni da verificare, date e termini da chiedere al medico;
- collegamento del documento alle visite già registrate;
- ricerca globale anche nel testo associato ai documenti.

## Privacy

I file vengono conservati nell'archivio IndexedDB del browser sul dispositivo utilizzato. Non vengono inviati a Google Sheets. I dati descrittivi e il testo incollato possono invece rientrare nella normale sincronizzazione configurata dall'utente.

La lettura guidata non interpreta clinicamente il referto, non formula diagnosi e non sostituisce il professionista sanitario.

## Installazione

1. Estrarre tutti i file dello ZIP.
2. Conservare in `config.js` l'indirizzo `/exec` della propria Web App Apps Script.
3. Caricare e sostituire tutti i file nel repository GitHub Pages.
4. Eseguire il commit.
5. Aprire l'app e scegliere **Aggiorna adesso**.

Nelle Impostazioni deve comparire la versione `3.0.0`.

## Nota sui file

I file locali non passano automaticamente da un telefono a un altro. Per la futura sincronizzazione cloud protetta sarà necessario un servizio di archiviazione con autenticazione e regole specifiche per dati sanitari.
