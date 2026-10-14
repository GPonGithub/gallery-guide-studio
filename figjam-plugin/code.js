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

// --- Goal Agent Studio (v4) ---------------------------------------------------
// The app sends a finished layout spec (cards as rows of [label, value], plus
// arrows) and this just draws it; the card format itself lives in the app
// (src/lib/agent/cards.ts), so drawing and importing always agree. Every
// node drawn here is tagged, so drawing again replaces the previous flow
// instead of stacking a second copy on the board.

const AGENT_TAG = 'goalAgent';
const CARD_WIDTH = 730;
// Wide gutters: arrows and their labels run between the cards, never over them.
const CARD_GAP_X = 560;
const CARD_GAP_Y = 260;

function hexColor(r, g, b) {
  return { r: r / 255, g: g / 255, b: b / 255 };
}
const AGENT_COLORS = {
  black: hexColor(0x1e, 0x1e, 0x1e),
  darkGray: hexColor(0x75, 0x75, 0x75),
  lightGray: hexColor(0xd9, 0xd9, 0xd9),
  lightBlue: hexColor(0xc2, 0xe5, 0xff),
  lightYellow: hexColor(0xff, 0xec, 0xbd),
  lightGreen: hexColor(0xcd, 0xf4, 0xd3),
  white: hexColor(0xff, 0xff, 0xff),
};

function tag(node) {
  node.setPluginData(AGENT_TAG, '1');
  return node;
}

async function drawAgentCard(card, x, y) {
  const table = tag(figma.createTable(card.rows.length + 1, 2));
  await figma.loadFontAsync(table.cellAt(0, 0).text.fontName);
  table.cellAt(0, 0).text.characters = card.kind;
  table.cellAt(0, 1).text.characters = card.title;
  for (let c = 0; c < 2; c++) {
    table.cellAt(0, c).fills = [{ type: 'SOLID', color: AGENT_COLORS[card.header] || AGENT_COLORS.black }];
    table.cellAt(0, c).text.fills = [{ type: 'SOLID', color: AGENT_COLORS.white }];
  }
  card.rows.forEach(function (row, i) {
    table.cellAt(i + 1, 0).text.characters = row[0];
    table.cellAt(i + 1, 1).text.characters = row[1] || '';
    table.cellAt(i + 1, 0).fills = [{ type: 'SOLID', color: AGENT_COLORS[card.labels] || AGENT_COLORS.lightGray }];
  });
  table.resizeColumn(0, 170);
  table.resizeColumn(1, CARD_WIDTH - 170);
  table.x = x;
  table.y = y;
  table.name = card.kind + ' ' + card.title;
  return table;
}

async function drawAgentFlow(spec) {
  const page = figma.currentPage;

  // Replace whatever this plugin drew last time (connectors first, so none
  // are left pointing at removed cards).
  const previous = page.findAll(function (n) { return n.getPluginData(AGENT_TAG) === '1'; });
  previous.sort(function (a, b) { return (a.type === 'CONNECTOR' ? 0 : 1) - (b.type === 'CONNECTOR' ? 0 : 1); });
  previous.forEach(function (n) { if (!n.removed) n.remove(); });
  if (previous.length > 0) log('Removed the previously drawn flow (' + previous.length + ' items).');

  // Hand-made cards (e.g. the template's) aren't replaced — and Import reads
  // every card on the board, so two sets would collide. Say so up front.
  const otherCards = page.findAllWithCriteria({ types: ['TABLE'] }).filter(function (t) {
    const kind = t.cellAt(0, 0).text.characters.trim().toUpperCase();
    return kind === 'STAGE' || kind === 'MASTER' || kind === 'KNOWLEDGE';
  });
  if (otherCards.length > 0) {
    log('Warning: this board already has ' + otherCards.length + ' STAGE/MASTER/KNOWLEDGE cards the plugin did not draw. Import reads every card, so use an empty board for a new flow (or delete the old cards).');
  }

  // Start to the right of anything else already on the board.
  let originX = 0;
  let originY = 0;
  if (page.children.length > 0) {
    originX = Math.max.apply(null, page.children.map(function (n) { return n.x + n.width; })) + 600;
    originY = Math.min.apply(null, page.children.map(function (n) { return n.y; }));
  }

  const bold = { family: 'Inter', style: 'Bold' };
  const medium = { family: 'Inter', style: 'Medium' };
  await figma.loadFontAsync(bold);
  await figma.loadFontAsync(medium);

  const created = [];
  const title = tag(figma.createText());
  title.fontName = bold;
  title.fontSize = 56;
  title.characters = spec.title;
  title.x = originX;
  title.y = originY;
  created.push(title);

  const intro = tag(figma.createText());
  intro.fontName = medium;
  intro.fontSize = 20;
  intro.characters = spec.intro;
  intro.textAutoResize = 'HEIGHT';
  intro.resize(CARD_WIDTH * 2 + CARD_GAP_X, intro.height);
  intro.x = originX;
  intro.y = originY + 90;
  created.push(intro);

  const nodes = [];
  const top = intro.y + intro.height + 80;
  let topBottom = top;
  for (let i = 0; i < spec.cards.length; i++) {
    const card = spec.cards[i];
    if (card.area !== 'top') continue;
    const table = await drawAgentCard(card, originX + card.column * (CARD_WIDTH + CARD_GAP_X), top);
    nodes[i] = table;
    created.push(table);
    topBottom = Math.max(topBottom, table.y + table.height);
  }
  log('Drew the MASTER, GUIDE and KNOWLEDGE cards.');

  const flowTop = topBottom + 260;
  spec.flowTop = flowTop;
  const columnY = {};
  let stageCount = 0;
  for (let i = 0; i < spec.cards.length; i++) {
    const card = spec.cards[i];
    if (card.area !== 'flow') continue;
    const y = columnY[card.column] === undefined ? flowTop : columnY[card.column];
    const table = await drawAgentCard(card, originX + card.column * (CARD_WIDTH + CARD_GAP_X), y);
    columnY[card.column] = y + table.height + CARD_GAP_Y;
    nodes[i] = table;
    created.push(table);
    stageCount++;
  }
  log('Drew ' + stageCount + ' stage cards.');

  // Arrows snap to card edges so they only ever run through the gutters:
  // forward → right edge to left edge, backward → the reverse, and arrows
  // between cards in the same column loop out round the right-hand side
  // rather than cutting through the cards in between. (Anchoring to exact
  // relative positions on a table was tried and lands in odd places.)
  for (const link of spec.links) {
    const from = nodes[link.from];
    const to = nodes[link.to];
    if (!from || !to) continue;
    const connector = tag(figma.createConnector());
    let startMagnet;
    let endMagnet;
    if (from.y + from.height < spec.flowTop && to.y >= spec.flowTop) {
      startMagnet = 'BOTTOM'; endMagnet = 'TOP'; // MASTER above the flow
    } else if (to.x > from.x + 100) {
      startMagnet = 'RIGHT'; endMagnet = 'LEFT';
    } else if (to.x < from.x - 100) {
      startMagnet = 'LEFT'; endMagnet = 'RIGHT';
    } else {
      startMagnet = 'RIGHT'; endMagnet = 'RIGHT';
    }
    connector.connectorStart = { endpointNodeId: from.id, magnet: startMagnet };
    connector.connectorEnd = { endpointNodeId: to.id, magnet: endMagnet };
    connector.connectorLineType = 'ELBOWED';
    connector.connectorStartStrokeCap = 'NONE';
    connector.connectorEndStrokeCap = 'ARROW_LINES';
    connector.text.fontName = medium;
    connector.text.characters = link.label;
    created.push(connector);
  }
  log('Drew ' + spec.links.length + ' arrows.');

  figma.viewport.scrollAndZoomIntoView(created);
  log('Done — the flow is on the board.');
}

// Every table on the page, top-to-bottom, left-to-right, as rows of
// [left cell, right cell]. The app decides which ones are STAGE/MASTER
// cards; anything else (old step tables, notes) is simply ignored there.
function readAgentFlow() {
  const tables = figma.currentPage.findAllWithCriteria({ types: ['TABLE'] });
  tables.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
  return tables.map(function (t) {
    const rows = [];
    for (let r = 0; r < t.numRows; r++) {
      rows.push([t.cellAt(r, 0).text.characters, t.numColumns > 1 ? t.cellAt(r, 1).text.characters : '']);
    }
    return { id: t.id, rows: rows };
  });
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
  } else if (msg.type === 'draw-agent-flow') {
    try {
      await drawAgentFlow(msg.payload);
    } catch (err) {
      log('Error: ' + (err && err.message ? err.message : String(err)));
    }
    figma.ui.postMessage({ type: 'done' });
  } else if (msg.type === 'read-agent-flow') {
    try {
      const tables = readAgentFlow();
      log('Read ' + tables.length + ' tables from the board.');
      figma.ui.postMessage({ type: 'agent-read-result', tables: tables });
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
