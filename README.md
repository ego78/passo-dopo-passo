# Passo dopo Passo 4.0 — Account familiari Firebase

Questa versione introduce account separati con email e password, famiglia condivisa, inviti e permessi.

## Cosa cambia

- Ogni persona crea il proprio account.
- Un amministratore crea la famiglia e importa i dati già presenti sul dispositivo.
- L'amministratore genera un codice invito valido 7 giorni.
- La persona invitata si registra e inserisce il codice.
- Tutti i membri vedono gli stessi dati tramite Cloud Firestore.
- I permessi disponibili sono: amministratore, modifica, sola lettura.
- I documenti sanitari possono continuare a essere salvati su Google Drive tramite il precedente Apps Script.

## 1. Crea il progetto Firebase

1. Vai su Firebase Console e crea un progetto.
2. Aggiungi una Web app.
3. Copia l'oggetto `firebaseConfig` mostrato dalla console.
4. Apri `firebase-config.js` e sostituisci tutti i valori `INCOLLA_...`.

Esempio:

```js
window.FIREBASE_CONFIG = {
  apiKey: "...",
  authDomain: "nome-progetto.firebaseapp.com",
  projectId: "nome-progetto",
  storageBucket: "nome-progetto.firebasestorage.app",
  messagingSenderId: "...",
  appId: "..."
};
```

## 2. Attiva l'accesso con email e password

Firebase Console → Authentication → Sign-in method → Email/Password → Attiva.

## 3. Crea Cloud Firestore

Firebase Console → Firestore Database → Crea database.

Per la regione scegli una sede europea vicina agli utenti. Non lasciare il database in modalità test.

## 4. Pubblica le regole di sicurezza

1. Apri Firestore Database → Regole.
2. Cancella le regole presenti.
3. Copia tutto il contenuto di `firestore.rules`.
4. Premi Pubblica.

Le regole consentono:

- accesso ai dati solo agli account membri della famiglia;
- modifica solo ad amministratori e editor;
- sola lettura ai viewer;
- ingresso tramite codice invito valido.

## 5. Conserva Google Apps Script per i documenti

Il file `config.js` deve continuare a contenere il tuo URL Apps Script `/exec`.

Firebase gestisce account e dati condivisi. Apps Script e Google Drive continuano a gestire PDF e fotografie.

Non è necessario cambiare `Code.gs` se hai già installato la versione 3.1.1 con Drive.

## 6. Carica i file su GitHub

Carica tutti i file di questa cartella nel repository, sostituendo quelli esistenti.

Dopo il commit, apri l'app dal browser e aggiorna alla versione 4.0.0.

## 7. Primo accesso del proprietario

1. Premi Registrati.
2. Inserisci nome, email e password.
3. Scegli Crea famiglia.
4. Assegna il tuo ruolo, per esempio Papà.
5. I dati già presenti sul telefono vengono importati nella nuova famiglia.

## 8. Accesso della mamma

Sul telefono dell'amministratore:

1. Apri Impostazioni.
2. Nella sezione Invita una persona scegli Mamma.
3. Scegli Può modificare.
4. Premi Genera codice invito.
5. Invia il codice alla mamma.

Sul telefono della mamma:

1. Apri la stessa web app.
2. Premi Registrati.
3. Crea un account con la sua email e password.
4. Seleziona Usa invito.
5. Inserisce nome e codice ricevuto.
6. Da quel momento accede sempre con la propria email e password.

## Migrazione e limiti della versione 4.0

- Quando il primo amministratore crea la famiglia, viene importata la copia locale presente su quel dispositivo.
- Prima della migrazione, sincronizza la vecchia versione con Google Sheets e usa il dispositivo con i dati più aggiornati.
- Il codice invito è valido per 7 giorni.
- La revoca completa degli account e l'invio automatico dell'invito via email richiederanno una futura funzione server.
- In questa versione i dati applicativi sono conservati in un documento Firestore della famiglia. È adeguato alla beta; per un uso pubblico su larga scala sarà opportuno suddividerli in collezioni.
- Non inserire segreti amministrativi nel browser. La configurazione Firebase Web non è una chiave amministrativa; la protezione dipende dalle regole Firestore.

## File principali

- `firebase-config.js`: configurazione del progetto Firebase.
- `firebase-auth.js`: registrazione, accesso, famiglia, inviti e sincronizzazione.
- `firestore.rules`: regole di sicurezza da pubblicare.
- `config.js`: URL Apps Script per Google Drive.
- `app.js`: funzionalità dell'app.
- `service-worker.js`: aggiornamenti e uso offline.
