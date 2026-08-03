# Passo dopo Passo 3.1.1

## Novità
- Estrazione automatica del testo da PDF e fotografie.
- Salvataggio del file originale nella cartella privata Google Drive `Passo dopo Passo - Documenti`.
- Sottocartella separata per ogni codice famiglia.
- Nuovo foglio `Documenti` con nome file, tipo, dimensione e collegamento Drive.
- Copia locale mantenuta sul dispositivo per l'uso rapido e offline.

## Aggiornamento obbligatorio di Apps Script
1. Apri il Foglio Google collegato e vai in **Estensioni → Apps Script**.
2. Sostituisci completamente il vecchio `Code.gs` con quello incluso nello ZIP.
3. Salva ed esegui manualmente una volta la funzione `setup`.
4. Accetta le autorizzazioni richieste per Fogli Google e Google Drive.
5. Vai in **Esegui il deployment → Gestisci deployment**.
6. Modifica il deployment esistente, scegli **Nuova versione** e distribuisci.
7. Mantieni in `config.js` l'indirizzo `/exec` del deployment.

I file vengono creati come privati nell'account Google che possiede lo script. Non impostare la cartella come pubblica.

Limite consigliato per singolo file: 8 MB.
