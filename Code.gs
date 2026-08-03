const SHEET_NAME = 'Dati';
const DOCUMENTS_SHEET_NAME = 'Documenti';
const ROOT_FOLDER_NAME = 'Passo dopo Passo - Documenti';
const HEADERS = ['Codice famiglia', 'Nome bambino', 'Data nascita', 'Dati JSON', 'Ultimo aggiornamento'];
const DOCUMENT_HEADERS = ['Codice famiglia', 'ID documento', 'Nome documento', 'Nome file', 'Tipo file', 'Dimensione byte', 'ID Drive', 'Link Drive', 'Data caricamento'];

function doGet(e) {
  try {
    const action = String(e.parameter.action || 'status');
    if (action === 'load') return jsonOutput(loadFamily_(e.parameter.familyCode));
    if (action === 'status') return jsonOutput({ ok: true, service: 'Passo dopo Passo API', drive: true });
    return jsonOutput({ ok: false, error: 'Azione non valida' });
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message });
  }
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action === 'save') return jsonOutput(saveFamily_(payload.familyCode, payload.data));
    if (payload.action === 'uploadFile') return jsonOutput(uploadFile_(payload));
    if (payload.action === 'deleteFile') return jsonOutput(deleteFile_(payload));
    return jsonOutput({ ok: false, error: 'Azione non valida' });
  } catch (error) {
    return jsonOutput({ ok: false, error: error.message });
  }
}

function setup() {
  const sheet = getSheet_();
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, HEADERS.length);
  const documentSheet = getDocumentsSheet_();
  documentSheet.setFrozenRows(1);
  documentSheet.autoResizeColumns(1, DOCUMENT_HEADERS.length);
  getRootFolder_();
  return 'Foglio e cartella Google Drive configurati correttamente';
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

function getDocumentsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(DOCUMENTS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(DOCUMENTS_SHEET_NAME);
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, DOCUMENT_HEADERS.length).setValues([DOCUMENT_HEADERS]);
    sheet.getRange(1, 1, 1, DOCUMENT_HEADERS.length).setFontWeight('bold');
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

function findDocumentRow_(sheet, familyCode, documentId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, 1, lastRow - 1, 2).getDisplayValues();
  const index = values.findIndex(row => String(row[0]).trim().toUpperCase() === familyCode && String(row[1]) === String(documentId));
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
      code, String(profile.childName || ''), String(profile.birthDate || ''), JSON.stringify(data), updatedAt
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

function getRootFolder_() {
  const properties = PropertiesService.getScriptProperties();
  const storedId = properties.getProperty('PDP_ROOT_FOLDER_ID');
  if (storedId) {
    try { return DriveApp.getFolderById(storedId); } catch (ignored) {}
  }
  const existing = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  const folder = existing.hasNext() ? existing.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  properties.setProperty('PDP_ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getFamilyFolder_(familyCode) {
  const root = getRootFolder_();
  const folders = root.getFoldersByName(familyCode);
  return folders.hasNext() ? folders.next() : root.createFolder(familyCode);
}

function uploadFile_(payload) {
  const code = normalizeCode_(payload.familyCode);
  const documentId = String(payload.documentId || '').trim();
  const documentName = String(payload.documentName || 'Documento').trim();
  const fileName = String(payload.fileName || documentName).replace(/[\\/:*?"<>|]/g, '_');
  const mimeType = String(payload.mimeType || 'application/octet-stream');
  const base64 = String(payload.base64 || '');
  if (!documentId || !base64) throw new Error('File o identificativo documento mancante');

  const folder = getFamilyFolder_(code);
  const oldFileId = String(payload.oldFileId || '').trim();
  if (oldFileId) {
    try { DriveApp.getFileById(oldFileId).setTrashed(true); } catch (ignored) {}
  }

  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, fileName);
  const file = folder.createFile(blob);
  file.setDescription('Passo dopo Passo | ' + documentName + ' | famiglia ' + code);
  const uploadedAt = new Date();

  const sheet = getDocumentsSheet_();
  const row = findDocumentRow_(sheet, code, documentId) || sheet.getLastRow() + 1;
  sheet.getRange(row, 1, 1, DOCUMENT_HEADERS.length).setValues([[
    code, documentId, documentName, fileName, mimeType, bytes.length,
    file.getId(), file.getUrl(), uploadedAt
  ]]);

  return {
    ok: true,
    fileId: file.getId(),
    fileUrl: file.getUrl(),
    fileName: file.getName(),
    fileSize: bytes.length,
    uploadedAt: uploadedAt.toISOString()
  };
}

function deleteFile_(payload) {
  const code = normalizeCode_(payload.familyCode);
  const documentId = String(payload.documentId || '').trim();
  const fileId = String(payload.fileId || '').trim();
  if (fileId) {
    try { DriveApp.getFileById(fileId).setTrashed(true); } catch (ignored) {}
  }
  const sheet = getDocumentsSheet_();
  const row = findDocumentRow_(sheet, code, documentId);
  if (row) sheet.deleteRow(row);
  return { ok: true };
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
