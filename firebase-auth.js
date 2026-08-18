import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updateProfile, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, collection,
  getDocs, serverTimestamp, writeBatch, onSnapshot, runTransaction,
  query, where, orderBy, limit, Timestamp
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const cfg = window.FIREBASE_CONFIG || {};
const configured = !!(cfg.apiKey && !String(cfg.apiKey).includes('INCOLLA_'));
const authScreen = document.getElementById('authScreen');
const authStatus = document.getElementById('authStatus');
const familySetup = document.getElementById('familySetup');
const PENDING_KEY = 'pdp_cloud_pending_v1';
let app, auth, db, currentFamilyId = '', currentMember = null, unsubscribeFamily = null;
let currentRevision = 0, saving = false, lastRemoteUpdatedBy = '';

function text(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function show(el, yes = true) { if (el) el.classList.toggle('hidden', !yes); }
function setStatus(message, error = false) {
  if (!authStatus) return;
  authStatus.textContent = message || '';
  authStatus.classList.toggle('error', !!error);
}
function emitSync(state, detail = {}) {
  window.dispatchEvent(new CustomEvent('pdp-sync-state', { detail: { state, ...detail } }));
}
function cleanStateForCloud(data) {
  return JSON.parse(JSON.stringify(data || {}, (key, value) => {
    if (key === 'localFile' || key === 'blob') return undefined;
    return value;
  }));
}
function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  crypto.getRandomValues(new Uint32Array(10)).forEach(n => out += chars[n % chars.length]);
  return out;
}
function roleLabel(role) { return role || 'Familiare'; }
function isAdmin() { return ['owner', 'admin'].includes(currentMember?.permission); }
function pendingRead() { try { return JSON.parse(localStorage.getItem(PENDING_KEY) || 'null'); } catch { return null; } }
function pendingWrite(data, baseRevision = currentRevision) { localStorage.setItem(PENDING_KEY, JSON.stringify({ familyId: currentFamilyId, data, baseRevision: Number(baseRevision || 0), savedAt: new Date().toISOString() })); }
function pendingClear() { localStorage.removeItem(PENDING_KEY); }

async function logActivity(type, description, metadata = {}) {
  if (!currentFamilyId || !auth?.currentUser) return;
  const ref = doc(collection(db, 'families', currentFamilyId, 'activity'));
  await setDoc(ref, {
    type, description, metadata,
    userId: auth.currentUser.uid,
    userName: currentMember?.name || auth.currentUser.displayName || auth.currentUser.email || 'Utente',
    createdAt: serverTimestamp()
  });
}

async function loadMembership(uid) {
  const userSnap = await getDoc(doc(db, 'users', uid));
  const familyId = userSnap.exists() ? userSnap.data().activeFamilyId : '';
  if (!familyId) return null;
  const memberSnap = await getDoc(doc(db, 'families', familyId, 'members', uid));
  if (!memberSnap.exists()) return null;
  return { familyId, member: memberSnap.data() };
}
async function loadMembers(familyId) {
  const snap = await getDocs(collection(db, 'families', familyId, 'members'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
async function loadInvites() {
  if (!currentFamilyId || !isAdmin()) return [];
  const snap = await getDocs(query(collection(db, 'invites'), where('familyId', '==', currentFamilyId)));
  return snap.docs.map(d => ({ code: d.id, ...d.data() })).sort((a,b) => (b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
}
async function loadActivity() {
  if (!currentFamilyId) return [];
  const snap = await getDocs(query(collection(db, 'families', currentFamilyId, 'activity'), orderBy('createdAt','desc'), limit(30)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function applyRemoteRoot(familyId, root, options = {}) {
  currentRevision = Number(root.dataRevision || 0);
  lastRemoteUpdatedBy = root.dataUpdatedBy || '';
  const payload = root.data || null;
  if (!payload || !window.PDP_APP) return;
  const members = await loadMembers(familyId);
  payload.profile = payload.profile || {};
  payload.profile.familyCode = familyId;
  payload.members = members.map(m => ({
    id: m.id, name: m.name || m.email || 'Familiare', role: roleLabel(m.role),
    permission: m.permission || 'viewer', email: m.email || ''
  }));
  payload.activeMemberId = auth.currentUser.uid;
  window.PDP_APP.replaceState(payload, { fromCloud: true, revision: currentRevision });
  emitSync('synced', { revision: currentRevision, at: root.dataUpdatedAt?.toDate?.()?.toISOString?.() || '', source: options.source || 'cloud' });
}

async function activateFamily(familyId, member) {
  currentFamilyId = familyId; currentMember = member;
  show(familySetup, false); show(authScreen, false);
  document.body.classList.remove('auth-locked');
  if (unsubscribeFamily) unsubscribeFamily();

  // Il cloud è la fonte principale dopo il login. Prima leggiamo esplicitamente
  // Firestore, poi attiviamo il listener. Questo evita che una vecchia coda
  // locale possa partire prima di conoscere la revisione cloud corrente.
  emitSync('syncing', { phase: 'initial-load' });
  const initialSnap = await getDoc(doc(db, 'families', familyId));
  if (!initialSnap.exists()) throw new Error('Famiglia non trovata.');
  await applyRemoteRoot(familyId, initialSnap.data(), { source: 'initial' });

  unsubscribeFamily = onSnapshot(doc(db, 'families', familyId), async snap => {
    if (!snap.exists()) return;
    const root = snap.data();
    const remoteRevision = Number(root.dataRevision || 0);
    if (remoteRevision < currentRevision) return;

    const pending = pendingRead();
    if (pending && pending.familyId === familyId) {
      const remoteMs = root.dataUpdatedAt?.toMillis?.() || 0;
      const pendingMs = Date.parse(pending.savedAt || '') || 0;
      const baseRevision = Number(pending.baseRevision || 0);
      // FIX 4.1.12: una coda locale che non è più recente del cloud viene sempre
      // scartata, anche quando la revisione di base coincide. In precedenza una
      // vecchia coda con baseRevision == remoteRevision poteva essere reinviata al
      // riavvio e riportare l'app a dati obsoleti.
      if (remoteRevision >= baseRevision && pendingMs <= remoteMs) {
        pendingClear();
      } else if (remoteRevision > baseRevision && root.dataUpdatedBy !== auth.currentUser.uid) {
        emitSync('conflict', { message: 'Esistono modifiche locali non inviate e una versione cloud più recente.', revision: remoteRevision });
        return;
      }
    }
    await applyRemoteRoot(familyId, root, { source: 'listener' });
    updateAccountPanel();
  }, err => emitSync('error', { message: err.message }));

  window.dispatchEvent(new CustomEvent('pdp-auth-ready', { detail: { user: auth.currentUser, familyId, member } }));
  await retryPending();
}

async function updateAccountPanel() {
  const user = auth?.currentUser;
  if (!user) return;
  text('accountEmail', user.email || '');
  text('accountRole', `${currentMember?.name || user.displayName || 'Utente'} · ${roleLabel(currentMember?.role)} · ${currentMember?.permission || ''}`);
  const inviteBtn = document.getElementById('createInviteBtn');
  if (inviteBtn) inviteBtn.classList.toggle('hidden', !isAdmin());
}

async function createFamily(name, role) {
  const user = auth.currentUser;
  if (!user) throw new Error('Accedi prima di creare una famiglia.');
  const familyRef = doc(collection(db, 'families'));
  const familyId = familyRef.id;
  const local = window.PDP_APP?.getState?.() || {};
  const member = {
    name: user.displayName || user.email?.split('@')[0] || 'Genitore', email: user.email || '',
    role: role || 'Papà', permission: 'owner', joinedAt: serverTimestamp(), lastSeenAt: serverTimestamp()
  };
  const cloudData = cleanStateForCloud(local);
  cloudData.profile = cloudData.profile || null;
  if (cloudData.profile) cloudData.profile.familyCode = familyId;
  cloudData.members = []; cloudData.activeMemberId = user.uid;
  const batch = writeBatch(db);
  batch.set(familyRef, {
    name: name || 'La nostra famiglia', ownerUid: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    data: cloudData, dataRevision: 1, dataUpdatedAt: serverTimestamp(), dataUpdatedBy: user.uid
  });
  batch.set(doc(db, 'families', familyId, 'members', user.uid), member);
  batch.set(doc(db, 'users', user.uid), { email: user.email || '', displayName: user.displayName || '', activeFamilyId: familyId, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit(); currentRevision = 1;
  await activateFamily(familyId, member);
  await logActivity('family_created', 'Ha creato la famiglia');
}

async function joinFamily(inviteCode, name) {
  const user = auth.currentUser;
  const code = inviteCode.trim().toUpperCase();
  const inviteRef = doc(db, 'invites', code);
  await runTransaction(db, async tx => {
    const inviteSnap = await tx.get(inviteRef);
    if (!inviteSnap.exists()) throw new Error('Codice invito non trovato.');
    const invite = inviteSnap.data();
    if (invite.status && invite.status !== 'active') throw new Error('Questo invito non è più valido.');
    if (invite.usedBy) throw new Error('Questo invito è già stato utilizzato.');
    if (invite.expiresAt?.toMillis?.() < Date.now()) throw new Error('Questo invito è scaduto.');
    const member = {
      name: name || user.displayName || user.email?.split('@')[0] || 'Familiare', email: user.email || '',
      role: invite.role || 'Mamma', permission: invite.permission || 'editor', inviteCode: code,
      joinedAt: serverTimestamp(), lastSeenAt: serverTimestamp()
    };
    tx.set(doc(db, 'families', invite.familyId, 'members', user.uid), member);
    tx.set(doc(db, 'users', user.uid), { email: user.email || '', displayName: user.displayName || '', activeFamilyId: invite.familyId, updatedAt: serverTimestamp() }, { merge: true });
    tx.update(inviteRef, { status: 'used', usedBy: user.uid, usedAt: serverTimestamp() });
    currentFamilyId = invite.familyId; currentMember = member;
  });
  await activateFamily(currentFamilyId, currentMember);
  await logActivity('member_joined', `${currentMember.name} è entrato nella famiglia`);
}

async function createInvite(role, permission) {
  if (!currentFamilyId || !isAdmin()) throw new Error('Solo un amministratore può creare inviti.');
  const code = randomCode();
  const expires = Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
  await setDoc(doc(db, 'invites', code), {
    familyId: currentFamilyId, role: role || 'Mamma', permission: permission || 'editor', status: 'active',
    createdBy: auth.currentUser.uid, createdAt: serverTimestamp(), expiresAt: expires
  });
  await logActivity('invite_created', `Ha creato un invito per ${role || 'Familiare'}`, { code, permission });
  return code;
}
async function revokeInvite(code) {
  if (!isAdmin()) throw new Error('Solo un amministratore può revocare inviti.');
  await updateDoc(doc(db, 'invites', code), { status: 'revoked', revokedAt: serverTimestamp(), revokedBy: auth.currentUser.uid });
  await logActivity('invite_revoked', 'Ha revocato un invito', { code });
}
async function updateMember(memberId, changes) {
  if (!isAdmin()) throw new Error('Solo un amministratore può modificare i membri.');
  if (memberId === auth.currentUser.uid && changes.permission && !['owner','admin'].includes(changes.permission)) throw new Error('Non puoi ridurre il tuo stesso permesso amministratore.');
  await updateDoc(doc(db, 'families', currentFamilyId, 'members', memberId), { ...changes, updatedAt: serverTimestamp() });
  await logActivity('member_updated', 'Ha modificato un membro della famiglia', { memberId, changes });
}
async function removeMember(memberId) {
  if (!isAdmin()) throw new Error('Solo un amministratore può rimuovere membri.');
  if (memberId === auth.currentUser.uid) throw new Error('Non puoi rimuovere il tuo account amministratore.');
  await deleteDoc(doc(db, 'families', currentFamilyId, 'members', memberId));
  await updateDoc(doc(db, 'users', memberId), { activeFamilyId: '', updatedAt: serverTimestamp() }).catch(()=>{});
  await logActivity('member_removed', 'Ha rimosso un membro dalla famiglia', { memberId });
}

async function saveFamilyData(data, options = {}) {
  if (!currentFamilyId || !auth.currentUser) return { synced: false };
  if (currentMember?.permission === 'viewer') throw new Error('Questo profilo è in sola lettura.');
  const clean = cleanStateForCloud(data);
  clean.profile = clean.profile || {}; clean.profile.familyCode = currentFamilyId;
  clean.members = []; clean.activeMemberId = auth.currentUser.uid;
  const baseRevision = Number(currentRevision || 0);
  emitSync('syncing', { revision: baseRevision });
  try {
    const result = await runTransaction(db, async tx => {
      const ref = doc(db, 'families', currentFamilyId);
      const snap = await tx.get(ref);
      if (!snap.exists()) throw new Error('Famiglia non trovata.');
      const remoteRevision = Number(snap.data().dataRevision || 0);
      if (!options.force && remoteRevision > baseRevision && snap.data().dataUpdatedBy !== auth.currentUser.uid) {
        const err = new Error('Un altro familiare ha aggiornato i dati. Scarica prima la versione più recente.');
        err.code = 'pdp/conflict'; throw err;
      }
      const nextRevision = remoteRevision + 1;
      tx.update(ref, { data: clean, dataRevision: nextRevision, dataUpdatedAt: serverTimestamp(), dataUpdatedBy: auth.currentUser.uid, updatedAt: serverTimestamp() });
      return nextRevision;
    });
    currentRevision = result; pendingClear();
    emitSync('synced', { revision: result, at: new Date().toISOString(), source: 'save' });
    return { synced: true, revision: result };
  } catch (err) {
    if (err.code !== 'pdp/conflict') {
      const code = String(err?.code || '');
      const networkLike = !navigator.onLine || code.includes('unavailable') || code.includes('deadline-exceeded') || code.includes('network');
      if (networkLike) {
        pendingWrite(clean, baseRevision);
        emitSync('queued', { message: err.message, revision: baseRevision });
        return { synced: false, queued: true, message: err.message };
      }
      // Errori di permesso/configurazione non devono creare code che potrebbero
      // essere reinviate in un secondo momento con dati vecchi.
      emitSync('error', { message: err.message, revision: baseRevision });
      throw err;
    }
    emitSync('conflict', { message: err.message }); throw err;
  }
}

async function retryPending() {
  const p = pendingRead();
  if (!p || p.familyId !== currentFamilyId || !navigator.onLine) return false;
  const snap = await getDoc(doc(db, 'families', currentFamilyId));
  if (!snap.exists()) return false;
  const root = snap.data();
  const remoteRevision = Number(root.dataRevision || 0);
  const remoteMs = root.dataUpdatedAt?.toMillis?.() || 0;
  const pendingMs = Date.parse(p.savedAt || '') || 0;
  const baseRevision = Number(p.baseRevision || 0);

  if (remoteRevision >= baseRevision && pendingMs <= remoteMs) {
    // Il cloud è almeno altrettanto recente della coda: non reinviare mai la copia locale.
    pendingClear();
    await applyRemoteRoot(currentFamilyId, root, { source: 'discard-stale-pending' });
    return false;
  }
  if (remoteRevision > baseRevision) {
    emitSync('conflict', { message: 'Modifiche locali in attesa e cloud più recente. Nessun dato è stato sovrascritto.', revision: remoteRevision });
    return false;
  }
  const result = await saveFamilyData(p.data).catch(()=>null);
  return !!result?.synced;
}


window.PDP_CLOUD = {
  isConfigured: () => configured,
  isReady: () => !!(auth?.currentUser && currentFamilyId),
  getUser: () => auth?.currentUser || null,
  getFamilyId: () => currentFamilyId,
  getMember: () => currentMember,
  getRevision: () => currentRevision,
  getDiagnostics: () => ({ familyId: currentFamilyId, userId: auth?.currentUser?.uid || '', revision: currentRevision, pending: pendingRead(), online: navigator.onLine }),
  save: saveFamilyData,
  retryPending,
  reload: async () => {
    if (!currentFamilyId) return false;
    emitSync('syncing');
    const snap = await getDoc(doc(db, 'families', currentFamilyId));
    if (snap.exists() && window.PDP_APP) {
      currentRevision = Number(snap.data().dataRevision || 0);
      window.PDP_APP.replaceState(snap.data().data || {}, { fromCloud: true });
      emitSync('synced', { revision: currentRevision, at: snap.data().dataUpdatedAt?.toDate?.()?.toISOString?.() || '' });
    }
    return true;
  },
  logout: () => signOut(auth), createInvite, revokeInvite, loadInvites,
  loadMembers: () => loadMembers(currentFamilyId), updateMember, removeMember, loadActivity,
  logActivity
};

function bindUi() {
  document.querySelectorAll('[data-auth-tab]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach(x => x.classList.remove('active')); btn.classList.add('active');
    show(document.getElementById('loginForm'), btn.dataset.authTab === 'login');
    show(document.getElementById('registerForm'), btn.dataset.authTab === 'register'); setStatus('');
  }));
  document.getElementById('loginForm')?.addEventListener('submit', async e => {
    e.preventDefault(); setStatus('Accesso in corso…');
    try { await signInWithEmailAndPassword(auth, document.getElementById('loginEmail').value.trim(), document.getElementById('loginPassword').value); }
    catch (err) { setStatus('Accesso non riuscito: ' + friendlyError(err), true); }
  });
  document.getElementById('registerForm')?.addEventListener('submit', async e => {
    e.preventDefault(); setStatus('Creazione account…');
    try {
      const cred = await createUserWithEmailAndPassword(auth, document.getElementById('registerEmail').value.trim(), document.getElementById('registerPassword').value);
      const name = document.getElementById('registerName').value.trim(); await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, 'users', cred.user.uid), { email: cred.user.email || '', displayName: name, activeFamilyId: '', createdAt: serverTimestamp() }, { merge: true });
    } catch (err) { setStatus('Registrazione non riuscita: ' + friendlyError(err), true); }
  });
  document.getElementById('forgotPasswordBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim(); if (!email) return setStatus('Inserisci prima la tua email.', true);
    try { await sendPasswordResetEmail(auth, email); setStatus('Email per reimpostare la password inviata.'); }
    catch (err) { setStatus(friendlyError(err), true); }
  });
  document.getElementById('createFamilyForm')?.addEventListener('submit', async e => { e.preventDefault(); setStatus('Creazione famiglia…'); try { await createFamily(document.getElementById('newFamilyName').value.trim(), document.getElementById('ownerRole').value); } catch (err) { setStatus(err.message, true); } });
  document.getElementById('joinFamilyForm')?.addEventListener('submit', async e => { e.preventDefault(); setStatus('Collegamento alla famiglia…'); try { await joinFamily(document.getElementById('inviteCode').value, document.getElementById('joinMemberName').value.trim()); } catch (err) { setStatus(err.message, true); } });
  document.querySelectorAll('[data-family-mode]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-family-mode]').forEach(x => x.classList.remove('active')); btn.classList.add('active');
    show(document.getElementById('createFamilyForm'), btn.dataset.familyMode === 'create'); show(document.getElementById('joinFamilyForm'), btn.dataset.familyMode === 'join');
  }));
  document.getElementById('logoutBtn')?.addEventListener('click', () => signOut(auth));
  document.getElementById('createInviteBtn')?.addEventListener('click', async () => {
    try { const code = await createInvite(document.getElementById('inviteRole').value, document.getElementById('invitePermission').value); document.getElementById('generatedInviteCode').value = code; show(document.getElementById('inviteResult'), true); window.dispatchEvent(new Event('pdp-family-refresh')); }
    catch (err) { alert(err.message); }
  });
  document.getElementById('copyInviteBtn')?.addEventListener('click', async () => {
    const code = document.getElementById('generatedInviteCode').value;
    try { await navigator.clipboard.writeText(code); text('copyInviteBtn', 'Copiato'); setTimeout(() => text('copyInviteBtn', 'Copia codice'), 1500); } catch { alert('Codice invito: ' + code); }
  });
}
function friendlyError(err) {
  const c = err?.code || '';
  if (c.includes('invalid-credential')) return 'email o password non corretti.';
  if (c.includes('email-already-in-use')) return 'questa email è già registrata.';
  if (c.includes('weak-password')) return 'usa una password di almeno 6 caratteri.';
  if (c.includes('invalid-email')) return 'indirizzo email non valido.';
  return err?.message || 'errore imprevisto.';
}
async function start() {
  document.body.classList.add('auth-locked'); show(authScreen, true);
  if (!configured) { setStatus('Firebase non è ancora configurato. Compila firebase-config.js seguendo il README.', true); document.querySelectorAll('#authScreen input,#authScreen button').forEach(el => { if (!el.matches('[data-auth-tab]')) el.disabled = true; }); return; }
  app = initializeApp(cfg); auth = getAuth(app); db = getFirestore(app); await setPersistence(auth, browserLocalPersistence); bindUi();
  onAuthStateChanged(auth, async user => {
    if (!user) { currentFamilyId=''; currentMember=null; if(unsubscribeFamily)unsubscribeFamily(); document.body.classList.add('auth-locked'); show(authScreen,true); show(familySetup,false); setStatus(''); return; }
    setStatus('Accesso effettuato. Caricamento famiglia…');
    try { const membership=await loadMembership(user.uid); if(membership) await activateFamily(membership.familyId,membership.member); else { show(authScreen,true); show(familySetup,true); setStatus('Crea una nuova famiglia oppure inserisci un codice invito.'); } }
    catch(err){ setStatus('Impossibile caricare la famiglia: '+err.message,true); }
  });
  window.addEventListener('online', retryPending);
}
start();
