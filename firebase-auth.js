import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-app.js';
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signOut, sendPasswordResetEmail,
  updateProfile, setPersistence, browserLocalPersistence
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, collection,
  getDocs, serverTimestamp, writeBatch, onSnapshot
} from 'https://www.gstatic.com/firebasejs/12.17.0/firebase-firestore.js';

const cfg = window.FIREBASE_CONFIG || {};
const configured = cfg.apiKey && !String(cfg.apiKey).includes('INCOLLA_');
const authScreen = document.getElementById('authScreen');
const authStatus = document.getElementById('authStatus');
const familySetup = document.getElementById('familySetup');
let app, auth, db, currentFamilyId = '', currentMember = null, unsubscribeFamily = null;

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
    const payload = snap.data().data || null;
    const members = await loadMembers(familyId);
    if (payload && window.PDP_APP) {
      payload.profile = payload.profile || {};
      payload.profile.familyCode = familyId;
      payload.members = members.map(m => ({
        id: m.id, name: m.name || m.email || 'Familiare', role: roleLabel(m.role), permission: m.permission || 'viewer', email: m.email || ''
      }));
      payload.activeMemberId = auth.currentUser.uid;
      window.PDP_APP.replaceState(payload, { fromCloud: true });
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
  if (inviteBtn) inviteBtn.classList.toggle('hidden', currentMember?.permission !== 'owner');
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
  batch.set(familyRef, { name: name || 'La nostra famiglia', ownerUid: user.uid, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), data: cloudData });
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
  const batch = writeBatch(db);
  batch.set(doc(db, 'families', invite.familyId, 'members', user.uid), member);
  batch.set(doc(db, 'users', user.uid), { email: user.email || '', displayName: user.displayName || '', activeFamilyId: invite.familyId, updatedAt: serverTimestamp() }, { merge: true });
  await batch.commit();
  await activateFamily(invite.familyId, member);
}

async function createInvite(role, permission) {
  if (!currentFamilyId || currentMember?.permission !== 'owner') throw new Error('Solo un amministratore può creare inviti.');
  const code = randomCode();
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await setDoc(doc(db, 'invites', code), {
    familyId: currentFamilyId, role: role || 'Mamma', permission: permission || 'editor',
    createdBy: auth.currentUser.uid, createdAt: serverTimestamp(), expiresAt: expires
  });
  return code;
}

async function saveFamilyData(data) {
  if (!currentFamilyId || !auth.currentUser) return false;
  if (currentMember?.permission === 'viewer') throw new Error('Questo profilo è in sola lettura.');
  const clean = cleanStateForCloud(data);
  clean.profile = clean.profile || {};
  clean.profile.familyCode = currentFamilyId;
  clean.members = [];
  clean.activeMemberId = auth.currentUser.uid;
  await updateDoc(doc(db, 'families', currentFamilyId), { data: clean, updatedAt: serverTimestamp() });
  return true;
}

window.PDP_CLOUD = {
  isConfigured: () => configured,
  isReady: () => !!(auth?.currentUser && currentFamilyId),
  getUser: () => auth?.currentUser || null,
  getFamilyId: () => currentFamilyId,
  getMember: () => currentMember,
  save: saveFamilyData,
  reload: async () => {
    if (!currentFamilyId) return false;
    const snap = await getDoc(doc(db, 'families', currentFamilyId));
    if (snap.exists() && window.PDP_APP) window.PDP_APP.replaceState(snap.data().data || {}, { fromCloud: true });
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
