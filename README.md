# Passo dopo Passo 4.1.11 — Sync Fix

Correzione critica: Firestore è la fonte principale dopo il login; le code locali obsolete non possono più sovrascrivere una revisione cloud più recente. Aggiunta diagnostica sincronizzazione in Impostazioni. Google Drive/Apps Script restano dedicati ai file.

# Passo dopo Passo 4.1.10 — Diario fotografico

Aggiornamento cumulativo basato sulla 4.1.9.

- Aggiunta diretta di una o più fotografie al ricordo.
- Scatto/selezione dalla galleria tramite selettore del telefono.
- Selezione multipla di fotografie già presenti nell’archivio.
- Ogni nuova foto viene registrata automaticamente nel Centro documenti come Foto/Ricordo.
- Copia locale + tentativo automatico di caricamento su Google Drive.
- Mini-galleria dentro ogni ricordo; tocco sulla foto per aprirla.
- Compatibilità con i vecchi ricordi che avevano un solo documentId.

Non richiede modifiche a Code.gs o alle regole Firestore rispetto alla configurazione già funzionante.
