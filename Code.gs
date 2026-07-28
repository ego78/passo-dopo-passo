const SHEET_NAME = 'Dati';
const HEADERS = ['Codice famiglia', 'Nome bambino', 'Data nascita', 'Dati JSON', 'Ultimo aggiornamento'];

function doGet(e) {
  try {
    const action = String(e.parameter.action || 'status');
    if (action === 'load') return jsonOutput(loadFamily_(e.parameter.familyCode));
    if (action === 'status') return jsonOutput({ ok: true, service: 'Passo dopo Passo API' });
    return jsonOutput({ ok: false, error: 'Azione non valida' });
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action !== 'save') return jsonOutput({ ok: false, error: 'Azione non valida' });
    return jsonOutput(saveFamily_(payload.familyCode, payload.data));
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message });
  }
}

function setup() {
  const sheet = getSheet_();
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
  return 'Foglio configurato correttamente';
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function normalizeCode_(value) {
  const code = String(value || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
  if (code.length < 6) throw new Error('Il codice famiglia deve avere almeno 6 caratteri');
  return code;
}

function findRow_(sheet, familyCode) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().flat();
  const index = values.findIndex(value => String(value).trim().toUpperCase() === familyCode);
  return index === -1 ? 0 : index + 2;
}

function saveFamily_(familyCode, data) {
  const code = normalizeCode_(familyCode);
  if (!data || typeof data !== 'object') throw new Error('Dati mancanti');

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getSheet_();
    const row = findRow_(sheet, code) || sheet.getLastRow() + 1;
    const updatedAt = new Date();
    const profile = data.profile || {};
    sheet.getRange(row, 1, 1, HEADERS.length).setValues([[
      code,
      String(profile.childName || ''),
      String(profile.birthDate || ''),
      JSON.stringify(data),
      updatedAt
    ]]);
    return { ok: true, updatedAt: updatedAt.toISOString() };
  } finally {
    lock.releaseLock();
  }
}

function loadFamily_(familyCode) {
  const code = normalizeCode_(familyCode);
  const sheet = getSheet_();
  const row = findRow_(sheet, code);
  if (!row) return { ok: true, found: false };
  const raw = sheet.getRange(row, 4).getValue();
  if (!raw) return { ok: true, found: false };
  return { ok: true, found: true, data: JSON.parse(raw) };
}

function jsonOutput(value) {
  return ContentService
    .createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}
