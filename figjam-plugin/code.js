// Gallery Guide Studio — Playbook Builder
// Scans a FigJam board for "PLAYBOOK <code>: <label>" cards (title + prose
// instruction panel + step table), generates step content for any table
// that's still at its 1-row seed state, grows the table to fit, and keeps
// stacked playbooks in the same column spaced exactly GAP px apart.

figma.showUI(__html__, { width: 420, height: 620, title: 'Playbook Builder' });

const TITLE_PATTERN = /^PLAYBOOK\s+([0-9A-Za-z]+)\s*:\s*(.+)$/i;
const BUTTON_TEXT_PATTERN = /^open playbook editor$/i;
const GAP = 100;

function log(message) {
  figma.ui.postMessage({ type: 'log', message });
}

async function setCellText(table, row, col, newText) {
  const cell = table.cellAt(row, col);
  const text = cell.text;
  const fontsToLoad = new Set();
  fontsToLoad.add(JSON.stringify({ family: 'Inter', style: 'Regular' }));
  const segments = text.getStyledTextSegments(['fontName']);
  for (const seg of segments) fontsToLoad.add(JSON.stringify(seg.fontName));
  for (const fJson of fontsToLoad) {
    try {
      await figma.loadFontAsync(JSON.parse(fJson));
    } catch {
      // Best-effort — a cell with no prior font segment falls back to Inter.
    }
  }
  text.characters = newText;
}

function tableHasRealContent(table) {
  if (table.numRows < 2) return false;
  const cell = table.cellAt(1, 1);
  return Boolean((cell.text.characters || '').trim());
}

function findPlaybooks() {
  const texts = figma.currentPage.findAllWithCriteria({ types: ['TEXT'] });
  const tables = figma.currentPage.findAllWithCriteria({ types: ['TABLE'] });
  const shapes = figma.currentPage.findAllWithCriteria({ types: ['SHAPE_WITH_TEXT'] });

  const playbooks = [];
  for (const title of texts) {
    const raw = (title.characters || '').trim();
    const match = TITLE_PATTERN.exec(raw);
    if (!match) continue;
    const code = match[1];
    const label = match[2].trim();

    // The table sits below the title, roughly the same x.
    const nearTables = tables
      .filter((t) => Math.abs(t.x - title.x) < 40 && t.y > title.y)
      .sort((a, b) => a.y - b.y);
    const table = nearTables[0];
    if (!table) continue;

    // The instruction panel is the nearest non-empty, non-button shape
    // between the title and the table.
    const nearPanels = shapes
      .filter((s) => {
        const txt = (s.text.characters || '').trim();
        return (
          txt &&
          !BUTTON_TEXT_PATTERN.test(txt) &&
          Math.abs(s.x - title.x) < 40 &&
          s.y > title.y &&
          s.y < table.y
        );
      })
      .sort((a, b) => a.y - b.y);
    const panel = nearPanels[0] || null;

    // The background is the largest empty-text shape whose top-left sits
    // just above/left of the title and which is wider than the table.
    const emptyShapes = shapes.filter((s) => !(s.text.characters || '').trim());
    const bgCandidates = emptyShapes
      .filter(
        (s) =>
          s.x <= title.x + 5 &&
          s.x > title.x - 40 &&
          s.y <= title.y + 5 &&
          s.y > title.y - 60 &&
          s.width > table.width,
      )
      .sort((a, b) => b.width - a.width);
    const bg = bgCandidates[0] || null;

    // The three buttons sit immediately below the table, left to right.
    const belowTable = shapes
      .filter((s) => Math.abs(s.y - (table.y + table.height)) < 5 && s.x >= table.x - 5)
      .sort((a, b) => a.x - b.x);
    const [btnMain, btn2, btn3] = belowTable;

    playbooks.push({
      code,
      label,
      titleId: title.id,
      tableId: table.id,
      panelId: panel ? panel.id : null,
      bgId: bg ? bg.id : null,
      btnMainId: btnMain ? btnMain.id : null,
      btn2Id: btn2 ? btn2.id : null,
      btn3Id: btn3 ? btn3.id : null,
      x: title.x,
      y: title.y,
      instructionPrompt: panel ? (panel.text.characters || '').trim() : '',
    });
  }
  return playbooks;
}

async function populateTable(table, code, initials, steps) {
  while (table.numRows - 1 < steps.length) table.insertRow(table.numRows);
  for (let i = 0; i < steps.length; i++) {
    const r = i + 1;
    const step = steps[i];
    await setCellText(table, r, 0, String(r));
    await setCellText(table, r, 1, step.option || '');
    await setCellText(table, r, 2, step.instruction || '');
    if (step.variable) await setCellText(table, r, 3, step.variable);
    const designerId = `${initials || 'GP'}_${code}_${String(r).padStart(2, '0')}`;
    await setCellText(table, r, 6, designerId);
  }
}

// Writes the app's own edited step data back into the real tables — the
// "Update FigJam file" path. Unlike run()/populateTable() (which only fills
// a table's 1-row seed state), this OVERWRITES every row the app knows
// about, since the app is the source of truth once a student starts
// editing there. Only grows a table if the app has *more* steps than it
// currently does; if the app has fewer, the extra existing rows are left
// as-is rather than deleted — Figma's Table API removal wasn't exercised
// here, and silently leaving stale rows is safer than getting deletion
// wrong. Tables not found (bad/stale figmaSourceId) are skipped with a
// log line, not a hard failure — one missing table shouldn't abort the
// rest of the batch.
async function applyEdits(payload) {
  const tables = (payload && payload.tables) || [];
  if (tables.length === 0) {
    log('Nothing to write — no table data in this job.');
    return;
  }
  for (const entry of tables) {
    const table = await figma.getNodeByIdAsync(entry.figmaSourceId);
    if (!table || table.type !== 'TABLE') {
      log(`Skipped a table — id ${entry.figmaSourceId} not found on this board.`);
      continue;
    }
    const steps = entry.steps || [];
    while (table.numRows - 1 < steps.length) table.insertRow(table.numRows);
    for (let i = 0; i < steps.length; i++) {
      const r = i + 1;
      const step = steps[i];
      await setCellText(table, r, 0, String(r));
      await setCellText(table, r, 1, step.option || '');
      await setCellText(table, r, 2, step.instruction || '');
      await setCellText(table, r, 3, step.variable || '');
      await setCellText(table, r, 6, step.designerId || '');
    }
    log(`Updated table ${entry.figmaSourceId}: wrote ${steps.length} step${steps.length === 1 ? '' : 's'}.`);
  }
  log('Done writing edits.');
}

const pendingGenerations = new Map();

function requestGeneration(playbook, knownPlaybooks) {
  return new Promise((resolve) => {
    const requestId = playbook.tableId;
    pendingGenerations.set(requestId, resolve);
    figma.ui.postMessage({
      type: 'generate',
      requestId,
      code: playbook.code,
      label: playbook.label,
      instructionPrompt: playbook.instructionPrompt,
      knownPlaybooks,
    });
  });
}

async function run(initials, apiKey) {
  const playbooks = findPlaybooks();
  if (playbooks.length === 0) {
    log(
      'No playbooks found on this page — expected a "PLAYBOOK <code>: <label>" text node, an instruction panel, and a table for each.',
    );
    figma.ui.postMessage({ type: 'done' });
    return;
  }
  log(`Found ${playbooks.length} playbook${playbooks.length === 1 ? '' : 's'}.`);
  const knownPlaybooks = playbooks.map((p) => ({ code: p.code, label: p.label }));

  const byColumn = new Map();
  for (const p of playbooks) {
    const key = Math.round(p.x / 10) * 10;
    const list = byColumn.get(key) || [];
    list.push(p);
    byColumn.set(key, list);
  }

  for (const column of byColumn.values()) {
    column.sort((a, b) => a.y - b.y);

    // Pass A — generate (if needed) and let each table settle at its own
    // real height, top to bottom, moving only that playbook's own button
    // row and background.
    for (const p of column) {
      const table = await figma.getNodeByIdAsync(p.tableId);
      if (!table) continue;
      const oldHeight = table.height;

      if (!tableHasRealContent(table) && p.instructionPrompt && apiKey) {
        log(`Generating steps for Playbook ${p.code}: ${p.label}…`);
        const steps = await requestGeneration(p, knownPlaybooks);
        if (steps && steps.length) {
          await populateTable(table, p.code, initials, steps);
          log(`Playbook ${p.code}: wrote ${steps.length} step${steps.length === 1 ? '' : 's'}.`);
        } else {
          log(`Playbook ${p.code}: generation failed or returned nothing — left as-is.`);
        }
      } else if (!apiKey) {
        log(`Playbook ${p.code}: no API key set — skipping generation.`);
      } else {
        log(`Playbook ${p.code}: already populated — leaving content as-is.`);
      }

      const newHeight = table.height;
      const ownDelta = newHeight - oldHeight;
      if (ownDelta !== 0 && p.bgId) {
        const btnMain = p.btnMainId ? await figma.getNodeByIdAsync(p.btnMainId) : null;
        const btn2 = p.btn2Id ? await figma.getNodeByIdAsync(p.btn2Id) : null;
        const btn3 = p.btn3Id ? await figma.getNodeByIdAsync(p.btn3Id) : null;
        const bg = await figma.getNodeByIdAsync(p.bgId);
        if (btnMain) btnMain.y += ownDelta;
        if (btn2) btn2.y += ownDelta;
        if (btn3) btn3.y += ownDelta;
        if (bg) bg.resize(bg.width, bg.height + ownDelta);
      }
    }

    // Pass B — normalize this column's vertical spacing to exactly GAP px,
    // top to bottom, moving every node of each subsequent card as a unit.
    let prevBottom = null;
    for (const p of column) {
      const bg = p.bgId ? await figma.getNodeByIdAsync(p.bgId) : null;
      if (!bg) continue;
      if (prevBottom != null) {
        const desiredTop = prevBottom + GAP;
        const shift = desiredTop - bg.y;
        if (Math.abs(shift) > 0.5) {
          const ids = [p.titleId, p.panelId, p.tableId, p.bgId, p.btnMainId, p.btn2Id, p.btn3Id].filter(Boolean);
          for (const id of ids) {
            const node = await figma.getNodeByIdAsync(id);
            if (node) node.y += shift;
          }
        }
      }
      prevBottom = bg.y + bg.height;
    }
  }

  log('Done.');
  figma.ui.postMessage({ type: 'done' });
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'load-settings-request') {
    const initials = (await figma.clientStorage.getAsync('designerInitials')) || '';
    const apiKey = (await figma.clientStorage.getAsync('anthropicApiKey')) || '';
    const listenForJobs = (await figma.clientStorage.getAsync('listenForJobs')) !== false;
    figma.ui.postMessage({ type: 'settings', initials, apiKey, listenForJobs });
  } else if (msg.type === 'save-settings') {
    await figma.clientStorage.setAsync('designerInitials', msg.initials || '');
    await figma.clientStorage.setAsync('anthropicApiKey', msg.apiKey || '');
    if (typeof msg.listenForJobs === 'boolean') {
      await figma.clientStorage.setAsync('listenForJobs', msg.listenForJobs);
    }
  } else if (msg.type === 'run') {
    try {
      await run(msg.initials, msg.apiKey);
    } catch (err) {
      log('Error: ' + (err && err.message ? err.message : String(err)));
      figma.ui.postMessage({ type: 'done' });
    }
  } else if (msg.type === 'apply-edits') {
    try {
      await applyEdits(msg.payload);
    } catch (err) {
      log('Error: ' + (err && err.message ? err.message : String(err)));
    }
    figma.ui.postMessage({ type: 'done' });
  } else if (msg.type === 'generation-result') {
    const resolve = pendingGenerations.get(msg.requestId);
    if (resolve) {
      pendingGenerations.delete(msg.requestId);
      resolve(msg.steps || null);
    }
  }
};
