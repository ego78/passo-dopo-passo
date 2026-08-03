# Passo dopo Passo 4.1

## Novità
- stato reale della sincronizzazione e ultima data/ora;
- salvataggio locale immediato e ritentativi automatici;
- rilevamento dei conflitti tra dispositivi;
- gestione permessi dei membri;
- inviti monouso e revocabili (backend predisposto);
- backup JSON, esportazione CSV e registro attività;
- cache PWA aggiornata alla 4.1.0.

## Aggiornamento obbligatorio delle regole
Copia `firestore.rules` in Firebase Console > Firestore Database > Regole e premi Pubblica.

## Configurazione
Conserva i tuoi valori reali in `firebase-config.js` e l’URL Apps Script in `config.js`.
