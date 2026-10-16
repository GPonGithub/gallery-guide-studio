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
// into row 7 of that scene's column. It writes to nothing else.
// Deploy: Deploy → New deployment → Web app → Execute as: Me,
// Who has access: Anyone → Deploy, then paste the Web app URL into
// Chatbot Designer (Design Process, section 1).

var SAVED_ROW = 7;
var ROW_LABEL = /saved information/i;

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
