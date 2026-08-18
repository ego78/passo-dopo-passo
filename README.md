# Passo dopo Passo 4.1.1

Correzione della gestione documenti condivisi.

## Novità
- PDF e fotografie caricati su Google Drive tramite Apps Script.
- File condivisi come visualizzatori con le email dei membri Firebase presenti nella famiglia.
- Stato visibile: caricamento, salvato e condiviso, in attesa, errore.
- Nuovo tentativo automatico al ritorno della connessione.
- Pulsante manuale 🔄 per riprovare il caricamento.
- Copia locale mantenuta per l’uso offline.

## Aggiornamento obbligatorio Apps Script
Sostituire `Code.gs`, eseguire `setup`, poi creare una nuova versione del deployment web. L’URL `/exec` resta normalmente invariato.

## Nota privacy
Google Drive invia normalmente una notifica email quando un file viene condiviso. I membri devono usare nell’app la stessa email del proprio account Google per aprire i documenti condivisi.
