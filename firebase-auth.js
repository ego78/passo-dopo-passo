import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updateProfile, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  getDocs, serverTimestamp, writeBatch, onSnapshot, deleteDoc, query, where, runTransaction, increment
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const cfg = window.FIREBASE_CONFIG || {};
const configured = cfg.apiKey && !String(cfg.apiKey).includes('INCOLLA_');
const authScreen = document.getElementById('authScreen');
const authStatus = document.getElementById('authStatus');
const familySetup = document.getElementById('familySetup');
let app, auth, db, currentFamilyId = '', currentMember = null, unsubscribeFamily = null, currentRevision = 0, lastCloudPayload = null;

function text(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; }
function show(el, yes = true) { if (el) el.classList.toggle('hidden', !yes); }
function setStatus(message, error = false) {
  if (!authStatus) return;
  authStatus.textContent = message || '';
  authStatus.classList.toggle('error', !!error);
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

async function activateFamily(familyId, member) {
  currentFamilyId = familyId;
  currentMember = member;
  show(familySetup, false);
  show(authScreen, false);
  document.body.classList.remove('auth-locked');
  if (unsubscribeFamily) unsubscribeFamily();
  unsubscribeFamily = onSnapshot(doc(db, 'families', familyId), async snap => {
    if (!snap.exists()) return;
    const familyDoc = snap.data();
    currentRevision = Number(familyDoc.revision || 0);
    const payload = familyDoc.data || null;
    lastCloudPayload = payload ? JSON.parse(JSON.stringify(payload)) : null;
    const members = await loadMembers(familyId);
    if (payload && window.PDP_APP) {
      payload.profile = payload.profile || {};
      payload.profile.familyCode = familyId;
      payload.members = members.map(m => ({
        id: m.id, name: m.name || m.email || 'Familiare', role: roleLabel(m.role), permission: m.permission || 'viewer', email: m.email || ''
      }));
      payload.activeMemberId = auth.currentUser.uid;
      window.PDP_APP.replaceState(payload, { fromCloud: true, revision: currentRevision, updatedAt: familyDoc.updatedAt?.toDate?.()?.toISOString?.() || '' });
    }
    updateAccountPanel();
  }, err => setStatus('Sincronizzazione Firebase non disponibile: ' + err.message, true));
  window.dispatchEvent(new CustomEvent('pdp-auth-ready', { detail: { user: auth.currentUser, familyId, member } }));
}

async function updateAccountPanel() {
  const user = auth?.currentUser;
  if (!user) return;
  text('accountEmail', user.email || '');
  text('accountRole', `${currentMember?.name || user.displayName || 'Utente'} · ${roleLabel(currentMember?.role)} · ${currentMember?.permission || ''}`);
  const inviteBtn = document.getElementById('createInviteBtn');
  if (inviteBtn) inviteBtn.classList.toggle('hidden', !['owner','admin'].includes(currentMember?.permission));
}

async function createFamily(name, role) {
  const user = auth.currentUser;
  if (!user) throw new Error('Accedi prima di creare una famiglia.');
  const familyRef = doc(collection(db, 'families'));
  const familyId = familyRef.id;
  const local = window.PDP_APP?.getState?.() || {};
  const member = {
    name: user.displayName || user.email?.split('@')[0] || 'Genitore',
    email: user.email || '', role: role || 'Papà', permission: 'owner', joinedAt: serverTimestamp()
  };
  const cloudData = cleanStateForCloud(local);
  cloudData.profile = cloudData.profile || null;
  if (cloudData.profile) cloudData.profile.familyCode = familyId;
  cloudData.members = [];
  cloudData.activeMemberId = user.uid;
  const batch = writeBatch(db);
  batch.set(familyRef, { name: name || 'La nostra famiglia', ownerUid: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), updatedBy: user.uid, revision: 1, data: cloudData });
  batch.set(doc(db, 'families', familyId, 'members', user.uid), member);
  batch.set(doc(db, 'users', user.uid), { email: user.email || '', displayName: user.displayName || '', activeFamilyId: familyId, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  await activateFamily(familyId, member);
}

async function joinFamily(inviteCode, name) {
  const user = auth.currentUser;
  const code = inviteCode.trim().toUpperCase();
  const inviteRef = doc(db, 'invites', code);
  const inviteSnap = await getDoc(inviteRef);
  if (!inviteSnap.exists()) throw new Error('Codice invito non trovato.');
  const invite = inviteSnap.data();
  if (invite.expiresAt?.toMillis?.() < Date.now()) throw new Error('Questo invito è scaduto.');
  const member = {
    name: name || user.displayName || user.email?.split('@')[0] || 'Familiare',
    email: user.email || '', role: invite.role || 'Mamma', permission: invite.permission || 'editor',
    inviteCode: code, joinedAt: serverTimestamp()
  };
  if (invite.revokedAt || invite.usedBy) throw new Error('Questo invito non è più valido.');
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', invite.familyId, 'members', user.uid), member);
  batch.set(doc(db, 'users', user.uid), { email: user.email || '', displayName: user.displayName || '', activeFamilyId: invite.familyId, updatedAt: serverTimestamp() }, { merge: true });
  batch.update(inviteRef, { usedBy: user.uid, usedAt: serverTimestamp() });
  await batch.commit();
  await activateFamily(invite.familyId, member);
}

async function createInvite(role, permission) {
  if (!currentFamilyId || !['owner','admin'].includes(currentMember?.permission)) throw new Error('Solo un amministratore può creare inviti.');
  const code = randomCode();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await setDoc(doc(db, 'invites', code), {
    familyId: currentFamilyId, role: role || 'Mamma', permission: permission || 'editor',
    createdBy: auth.currentUser.uid, createdAt: serverTimestamp(), expiresAt: expires
  });
  return code;
}

async function saveFamilyData(data, options = {}) {
  if (!currentFamilyId || !auth.currentUser) return false;
  if (currentMember?.permission === 'viewer') throw new Error('Questo profilo è in sola lettura.');
  const clean = cleanStateForCloud(data);
  clean.profile = clean.profile || {};
  clean.profile.familyCode = currentFamilyId;
  clean.members = [];
  clean.activeMemberId = auth.currentUser.uid;
  const familyRef = doc(db, 'families', currentFamilyId);
  const result = await runTransaction(db, async tx => {
    const snap = await tx.get(familyRef);
    if (!snap.exists()) throw new Error('Famiglia non trovata.');
    const remote = snap.data();
    const remoteRevision = Number(remote.revision || 0);
    const baseRevision = Number(options.baseRevision ?? currentRevision ?? 0);
    if (!options.force && remoteRevision > baseRevision && remote.updatedBy && remote.updatedBy !== auth.currentUser.uid) {
      const err = new Error('Sono presenti modifiche più recenti da un altro dispositivo.');
      err.code = 'pdp/conflict'; err.remoteData = remote.data || {}; err.remoteRevision = remoteRevision;
      throw err;
    }
    const nextRevision = remoteRevision + 1;
    tx.update(familyRef, { data: clean, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid, revision: nextRevision });
    return nextRevision;
  });
  currentRevision = result;
  lastCloudPayload = clean;
  return { ok: true, revision: result };
}


async function listInvites() {
  if (!currentFamilyId || !['owner','admin'].includes(currentMember?.permission)) return [];
  const snap = await getDocs(query(collection(db, 'invites'), where('familyId', '==', currentFamilyId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b)=>(b.createdAt?.toMillis?.()||0)-(a.createdAt?.toMillis?.()||0));
}
async function revokeInvite(code) {
  if (!['owner','admin'].includes(currentMember?.permission)) throw new Error('Solo un amministratore può revocare inviti.');
  await updateDoc(doc(db, 'invites', code), { revokedAt: serverTimestamp(), revokedBy: auth.currentUser.uid });
  return true;
}
async function updateMember(memberId, changes) {
  if (!['owner','admin'].includes(currentMember?.permission)) throw new Error('Solo un amministratore può modificare i membri.');
  if (memberId === auth.currentUser.uid && changes.permission === 'viewer') throw new Error('Non puoi toglierti i permessi di amministratore.');
  await updateDoc(doc(db, 'families', currentFamilyId, 'members', memberId), { ...changes, updatedAt: serverTimestamp(), updatedBy: auth.currentUser.uid });
  return true;
}
async function removeMember(memberId) {
  if (!['owner','admin'].includes(currentMember?.permission)) throw new Error('Solo un amministratore può revocare accessi.');
  if (memberId === auth.currentUser.uid) throw new Error('Non puoi rimuovere il tuo account dalla famiglia.');
  await deleteDoc(doc(db, 'families', currentFamilyId, 'members', memberId));
  return true;
}
window.PDP_CLOUD = {
  isConfigured: () => configured,
  isReady: () => !!(auth?.currentUser && currentFamilyId),
  getUser: () => auth?.currentUser || null,
  getFamilyId: () => currentFamilyId,
  getMember: () => currentMember,
  save: saveFamilyData,
  getRevision: () => currentRevision,
  getLastCloudData: () => lastCloudPayload,
  listMembers: () => loadMembers(currentFamilyId),
  updateMember, removeMember, listInvites, revokeInvite,
  reload: async () => {
    if (!currentFamilyId) return false;
    const snap = await getDoc(doc(db, 'families', currentFamilyId));
    if (snap.exists() && window.PDP_APP) { const d=snap.data(); currentRevision=Number(d.revision||0); lastCloudPayload=d.data||{}; window.PDP_APP.replaceState(d.data || {}, { fromCloud: true, revision: currentRevision, updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() || '' }); }
    return true;
  },
  logout: () => signOut(auth),
  createInvite
};

function bindUi() {
  document.querySelectorAll('[data-auth-tab]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    show(document.getElementById('loginForm'), btn.dataset.authTab === 'login');
    show(document.getElementById('registerForm'), btn.dataset.authTab === 'register');
    setStatus('');
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
      const name = document.getElementById('registerName').value.trim();
      await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, 'users', cred.user.uid), { email: cred.user.email || '', displayName: name, activeFamilyId: '', createdAt: serverTimestamp() }, { merge: true });
    } catch (err) { setStatus('Registrazione non riuscita: ' + friendlyError(err), true); }
  });
  document.getElementById('forgotPasswordBtn')?.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail').value.trim();
    if (!email) return setStatus('Inserisci prima la tua email.', true);
    try { await sendPasswordResetEmail(auth, email); setStatus('Email per reimpostare la password inviata.'); }
    catch (err) { setStatus(friendlyError(err), true); }
  });
  document.getElementById('createFamilyForm')?.addEventListener('submit', async e => {
    e.preventDefault(); setStatus('Creazione famiglia…');
    try { await createFamily(document.getElementById('newFamilyName').value.trim(), document.getElementById('ownerRole').value); }
    catch (err) { setStatus(err.message, true); }
  });
  document.getElementById('joinFamilyForm')?.addEventListener('submit', async e => {
    e.preventDefault(); setStatus('Collegamento alla famiglia…');
    try { await joinFamily(document.getElementById('inviteCode').value, document.getElementById('joinMemberName').value.trim()); }
    catch (err) { setStatus(err.message, true); }
  });
  document.querySelectorAll('[data-family-mode]').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-family-mode]').forEach(x => x.classList.remove('active'));
    btn.classList.add('active');
    show(document.getElementById('createFamilyForm'), btn.dataset.familyMode === 'create');
    show(document.getElementById('joinFamilyForm'), btn.dataset.familyMode === 'join');
  }));
  document.getElementById('logoutBtn')?.addEventListener('click', () => signOut(auth));
  document.getElementById('createInviteBtn')?.addEventListener('click', async () => {
    try {
      const role = document.getElementById('inviteRole').value;
      const permission = document.getElementById('invitePermission').value;
      const code = await createInvite(role, permission);
      document.getElementById('generatedInviteCode').value = code;
      show(document.getElementById('inviteResult'), true);
    } catch (err) { alert(err.message); }
  });
  document.getElementById('copyInviteBtn')?.addEventListener('click', async () => {
    const code = document.getElementById('generatedInviteCode').value;
    try { await navigator.clipboard.writeText(code); text('copyInviteBtn', 'Copiato'); setTimeout(() => text('copyInviteBtn', 'Copia codice'), 1500); }
    catch { alert('Codice invito: ' + code); }
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
  document.body.classList.add('auth-locked');
  show(authScreen, true);
  if (!configured) {
    setStatus('Firebase non è ancora configurato. Compila firebase-config.js seguendo il README.', true);
    document.querySelectorAll('#authScreen input,#authScreen button').forEach(el => { if (!el.matches('[data-auth-tab]')) el.disabled = true; });
    return;
  }
  app = initializeApp(cfg); auth = getAuth(app); db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);
  bindUi();
  onAuthStateChanged(auth, async user => {
    if (!user) {
      currentFamilyId = ''; currentMember = null;
      if (unsubscribeFamily) unsubscribeFamily();
      document.body.classList.add('auth-locked'); show(authScreen, true); show(familySetup, false); setStatus('');
      return;
    }
    setStatus('Accesso effettuato. Caricamento famiglia…');
    try {
      const membership = await loadMembership(user.uid);
      if (membership) await activateFamily(membership.familyId, membership.member);
      else { show(authScreen, true); show(familySetup, true); setStatus('Crea una nuova famiglia oppure inserisci un codice invito.'); }
    } catch (err) { setStatus('Impossibile caricare la famiglia: ' + err.message, true); }
  });
}

start();
