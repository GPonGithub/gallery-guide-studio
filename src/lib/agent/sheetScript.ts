/**
 * Saving to the Google Sheet. A sheet shared by link can be read but not
 * written, so the sheet gets this small Apps Script (Extensions → Apps
 * Script), deployed as a web app. The app sends it what a scene has saved;
 * the script writes it into row 7 of that scene's column — and nowhere else:
 * it refuses unless cell A7 is the "saved information" row label, and never
 * touches rows 1–6 or the "All scenes" column.
 *
 * It can also empty row 7 — one scene's cell ("Refresh this scene") or every
 * scene's ("Complete restart").
 *
 * And it keeps the media list (see lib/agent/media.ts) on a tab of its own,
 * "Media" — created the first time, and the only other place it writes.
 *
 * The cell holds one "Label: value" line per item, under a "Patient: …"
 * line. A save updates the lines it has labels for and keeps every other
 * line; a different patient's save replaces the cell, so two patients'
 * details are never mixed.
 *
 * A copy of the sheet ("Make a copy") brings the script with it; each copy
 * is deployed once, by whoever owns it. @OnlyCurrentDoc limits what Google
 * asks permission for to this one spreadsheet, not all of the owner's.
 */
export const SHEET_SCRIPT = String.raw`/** @OnlyCurrentDoc */
// Chatbot Designer — saves what each scene's conversation picks up
// into row 7 of that scene's column, and keeps the media list on the
// "Media" tab. It writes to nothing else.
// Deploy: Deploy → New deployment → Web app → Execute as: Me,
// Who has access: Anyone → Deploy, then paste the Web app URL into
// Chatbot Designer (Design Process, section 1).

var SAVED_ROW = 7;
var ROW_LABEL = /saved information/i;
var MEDIA_TAB = 'Media';
// Each column of the Media tab: its heading (for a tab that has none) and how to recognise it.
var MEDIA_FIELDS = [
  { key: 'id', title: 'ID', match: /^\s*id\b/i },
  { key: 'name', title: 'File name', match: /file\s*name|^\s*name/i },
  { key: 'path', title: 'Path', match: /path/i },
  { key: 'kind', title: 'Type', match: /type|kind/i },
  { key: 'status', title: 'Status', match: /status/i },
  { key: 'added', title: 'Date added', match: /added|date/i }
];

function doGet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  return reply({ ok: true, spreadsheetId: ss.getId(), name: ss.getName() });
}

function doPost(e) {
  var lock = LockService.getDocumentLock();
  lock.waitLock(10000);
  try {
    var req = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (req.spreadsheetId && req.spreadsheetId !== ss.getId()) {
      return reply({ ok: false, error: 'This script belongs to a different Google Sheet than these scenes.' });
    }
    if (req.action === 'readMedia') return reply({ ok: true, media: readMedia(ss) });
    if (req.action === 'writeMedia') return reply({ ok: true, written: writeMedia(ss, req.rows || []) });
    var sheet = ss.getSheets().filter(function (s) { return String(s.getSheetId()) === String(req.gid); })[0];
    if (!sheet) return reply({ ok: false, error: 'The scenes’ tab wasn’t found in this sheet.' });
    if (!ROW_LABEL.test(sheet.getRange(SAVED_ROW, 1).getDisplayValue())) {
      return reply({ ok: false, error: 'Cell A7 must be the row label “List of Saved Information from this scene” — row 7 is the only row this script writes to.' });
    }
    if (req.action === 'clear') return reply({ ok: true, cleared: clearRow(sheet, String(req.clearColumn)) });
    if (!/^[B-Z]$/.test(String(req.column))) return reply({ ok: false, error: 'Not a scene column: ' + req.column });
    var col = req.column.charCodeAt(0) - 64;
    if (/all\s*scenes/i.test(sheet.getRange(1, col).getDisplayValue())) {
      return reply({ ok: false, error: 'Column ' + req.column + ' is the “All scenes” column, not a scene.' });
    }
    var cell = sheet.getRange(SAVED_ROW, col);
    var text = merge(cell.getDisplayValue(), String(req.patient || 'Patient'), req.entries || []);
    cell.setValue(text);
    cell.setWrap(true);
    return reply({ ok: true, text: text });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// Empties row 7 in one scene column ("C"), or in every scene column ("*") —
// never in the "All scenes" column. Returns the columns it emptied.
function clearRow(sheet, column) {
  var last = Math.min(sheet.getLastColumn(), 26);
  var cols = [];
  if (column === '*') {
    for (var c = 2; c <= last; c++) cols.push(c);
  } else if (/^[B-Z]$/.test(column)) {
    cols.push(column.charCodeAt(0) - 64);
  }
  var cleared = [];
  cols.forEach(function (c) {
    if (/all\s*scenes/i.test(sheet.getRange(1, c).getDisplayValue())) return;
    sheet.getRange(SAVED_ROW, c).setValue('');
    cleared.push(String.fromCharCode(64 + c));
  });
  return cleared;
}

// The media list: one row per file under a heading row. Each column is
// found by its heading — any order, and wording like "ID #" or "Date Added"
// is fine — so a Media tab set up by hand keeps its own layout. A tab with
// no headings gets them; a heading that's missing is added after the last.
function mediaColumns(tab) {
  var width = Math.max(tab.getLastColumn(), 1);
  var head = tab.getRange(1, 1, 1, width).getDisplayValues()[0];
  var empty = head.join('').trim() === '';
  var cols = {};
  var taken = {};
  var next = empty ? 1 : width + 1;
  MEDIA_FIELDS.forEach(function (f) {
    for (var c = 0; c < head.length && !empty; c++) {
      if (!taken[c] && f.match.test(head[c])) { cols[f.key] = c + 1; taken[c] = true; return; }
    }
    cols[f.key] = next;
    tab.getRange(1, next).setValue(f.title).setFontWeight('bold');
    next++;
  });
  if (empty) tab.setFrozenRows(1);
  return cols;
}

function readMedia(ss) {
  var tab = ss.getSheetByName(MEDIA_TAB);
  if (!tab || tab.getLastRow() < 2) return [];
  var cols = mediaColumns(tab);
  var values = tab.getRange(2, 1, tab.getLastRow() - 1, tab.getLastColumn()).getDisplayValues();
  return values
    .map(function (r) {
      var row = {};
      MEDIA_FIELDS.forEach(function (f) { row[f.key] = r[cols[f.key] - 1] || ''; });
      return row;
    })
    .filter(function (row) { return row.id !== ''; });
}

// Replaces the list in the media columns only — anything in other columns stays put.
function writeMedia(ss, rows) {
  var tab = ss.getSheetByName(MEDIA_TAB) || ss.insertSheet(MEDIA_TAB);
  var cols = mediaColumns(tab);
  var list = rows.slice(0, 5000);
  var last = Math.max(tab.getLastRow(), 2);
  MEDIA_FIELDS.forEach(function (f) {
    tab.getRange(2, cols[f.key], last - 1, 1).clearContent();
    if (list.length === 0) return;
    var range = tab.getRange(2, cols[f.key], list.length, 1);
    range.setNumberFormat('@');
    range.setValues(list.map(function (r) { return [String(r[f.key] == null ? '' : r[f.key])]; }));
  });
  return list.length;
}

// Updates the lines it has labels for and keeps the rest — unless the cell
// belongs to another patient, which is replaced (patients are never mixed).
function merge(existing, patient, entries) {
  var lines = existing ? existing.split(/\r?\n/).filter(function (l) { return l.trim() !== ''; }) : [];
  var first = /^Patient:\s*(.*)$/i.exec(lines[0] || '');
  if (first) lines.shift();
  if (first && first[1].trim().toLowerCase() !== patient.trim().toLowerCase()) lines = [];
  entries.forEach(function (entry) {
    var label = String(entry.label).trim();
    var value = String(entry.value).trim();
    if (!label || !value) return;
    var at = -1;
    var kept = label;
    lines.forEach(function (l, i) {
      var m = /^([^:]+):/.exec(l);
      if (m && m[1].trim().toLowerCase() === label.toLowerCase()) { at = i; kept = m[1].trim(); }
    });
    if (at >= 0) lines[at] = kept + ': ' + value; else lines.push(label + ': ' + value);
  });
  return ['Patient: ' + patient].concat(lines).join('\n');
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
`;

/** A deployed Apps Script web app's address — the only kind of link the app will send saved information to. */
export const isScriptUrl = (url: string) => /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.trim());

/** Labels as the sheet shows them: "preferred doctor" → "Preferred Doctor". */
export const displayLabel = (label: string) => label.trim().replace(/(^|[\s/-])(\p{Ll})/gu, (_, gap: string, ch: string) => gap + ch.toUpperCase());
