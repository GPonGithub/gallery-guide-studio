'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { boardToFlow, flowToBoard, type ReadTable } from '@/lib/agent/cards';
import { listProjects, markWrittenToFigjam, type SheetConflict, type SheetImport } from '@/lib/agent/localProjects';
import { flowFingerprint, parseSheetUrl } from '@/lib/agent/sheetScenes';
import type { MemoryItem } from '@/lib/agent/memory';
import type { SheetSource } from '@/lib/agent/projectStore';
import { displayLabel, isScriptUrl } from '@/lib/agent/sheetScript';
import type { AgentFlow } from '@/lib/agent/types';
import { validateFlow } from '@/lib/agent/validate';
import { buttonBusy, buttonDone, buttonOutline, buttonPrimary, buttonUnsaved, fieldInput, fieldLabel } from '@/lib/styles';
import { BoardPicker } from './BoardPicker';
import { CollapsiblePanel } from './CollapsiblePanel';
import { ImmersiveMedia } from './ImmersiveMedia';
import { ProgressLine } from './ProgressLine';
import { estimateGeneration, recordGeneration } from '@/lib/agent/generationTiming';
import { ProcessSection } from './ProcessSection';
import { SceneButtons } from './SceneButtons';
import { SheetSaving } from './SheetSaving';
import { connectionCode, useHosting } from '@/lib/agent/hosting';
import { Spinner } from './Spinner';

// Sheet → scenes → brief → flow (Claude) → FigJam board (drawn by the
// plugin, each scene in its own section) → edit there → import back → test
// in the chat. Figma's web API can't draw on a board,
// so drawing and reading both go through the FigJam plugin, which polls
// this app for jobs while its panel is open (see figmaJobStore.ts).

const PLUGIN_TIMEOUT_MS = 90_000;

// The fields students write themselves (the brief and the knowledge base)
// get a light yellow fill, so it's obvious where their input goes.
const studentField = fieldInput.replace('bg-paper', 'bg-[#fff6cc]');
const POLL_MS = 1500;
/** The FigJam board's three buttons (Board Selected, Draw All Scenes, View in FigJam) are one size, stacked. */
const FIGJAM_BUTTON = 'inline-flex h-10 w-[260px] items-center justify-center gap-2';

type Job = { status: 'pending' | 'running' | 'done' | 'error'; log: string[]; result?: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runPluginJob(kind: 'draw-agent-flow' | 'read-agent-flow', payload: unknown, onStatus: (s: string) => void) {
  const created = await fetch('/api/figma-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // The connection code keeps a class's jobs apart on a hosted copy (ignored when running locally).
    body: JSON.stringify({ kind, payload, code: connectionCode() }),
  });
  const { id, error } = (await created.json()) as { id?: string; error?: string };
  if (!id) throw new Error(error ?? 'The job couldn’t be sent to the plugin.');
  const deadline = Date.now() + PLUGIN_TIMEOUT_MS;
  let picked = false;
  let shown = 0;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    const { job } = (await (await fetch(`/api/figma-jobs/${id}`)).json()) as { job: Job };
    if (job.status !== 'pending') picked = true;
    for (; shown < job.log.length; shown += 1) onStatus(job.log[shown]);
    if (job.status === 'done') return job.result;
    if (job.status === 'error') throw new Error(job.log[job.log.length - 1] ?? 'The plugin reported an error.');
  }
  // Retire it so the plugin can't pick it up minutes later, out of the blue.
  await fetch(`/api/figma-jobs/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'error', message: 'Timed out in the app.' }),
  }).catch(() => {});
  throw new Error(
    picked
      ? 'The plugin started but didn’t finish in time — check its panel in FigJam for errors.'
      : 'The FigJam plugin didn’t pick this up. Open your board in the Figma desktop app, run the plugin (see “First time?” below), keep its panel open, and make sure “Listen for requests” is ticked.',
  );
}

const KNOWLEDGE_PLACEHOLDER = [
  'e.g.',
  'Opening hours: Mon–Fri 8am–6pm, Sat 9am–1pm',
  'Doctors: Dr. Maya Chen (family medicine), Dr. Luis Ortega (family medicine)',
  'Specialists: Dr. Priya Shah (cardiology), Dr. Ben Okafor (dermatology)',
  'Free appointment times this week: Tue 10:00, Tue 14:30, Thu 9:15',
  'Prescriptions on file: Zoloft, BuSpar, Propranolol',
].join('\n');

// Everything here goes to the model on every turn (twice: the reply and the
// analysis), so a very long knowledge base slows every reply and costs more.
const KNOWLEDGE_SOFT_LIMIT_WORDS = 3000;

function KnowledgeSize({ text }: { text: string }) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (words === 0) return null;
  const long = words > KNOWLEDGE_SOFT_LIMIT_WORDS;
  return (
    <p className={`font-label text-[10px] uppercase tracking-wide ${long ? 'text-[#b91c1c]' : 'text-muted-ink'}`}>
      {words.toLocaleString()} words
      {long ? ' — long: every reply reads all of this, so replies get slower. Trim to what the bot needs.' : ''}
    </p>
  );
}

// The description as sent for designing a flow, with what the scene should
// save (so stages collect it) and must not use (so none asks for it).
function briefForDesign(brief: string, flow: AgentFlow): string {
  return [
    brief,
    flow.canUse?.trim() && `Information this scene can use:\n${flow.canUse.trim()}`,
    flow.saveInfo?.trim() && `Information to collect during this scene (it's kept for later scenes):\n${flow.saveInfo.trim()}`,
    flow.cannotUse?.trim() && `Information this scene must not use or ask about:\n${flow.cannotUse.trim()}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// A remembered item, with the scene it came from.
function MemoryList({ items, empty }: { items: MemoryItem[]; empty: string }) {
  if (items.length === 0) return <p className="font-body text-xs italic text-muted-ink">{empty}</p>;
  return (
    <ul className="flex flex-col gap-1 font-body text-[13px] leading-snug text-ink">
      {items.map((it) => (
        <li key={it.id}>
          <span className="font-label text-[11px] uppercase tracking-wide text-muted-ink">{it.label}</span> {it.value}
          <span className="text-muted-ink"> — {it.sceneNumber ? `Scene ${it.sceneNumber} · ${it.sceneName}` : it.sceneName}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * What the open scene has saved for the selected patient, as "Label: value"
 * lines — the same lines row 7 of the sheet holds — and how the last write
 * to the sheet went.
 */
function SavedFromScene({
  items,
  patientName,
  sync,
  sheetColumn,
  connected,
}: {
  items: MemoryItem[];
  patientName: string | null;
  sync: SheetSync | undefined;
  sheetColumn: string | null;
  connected: boolean;
}) {
  const time = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return (
    <div className="flex flex-col gap-1">
      {items.length === 0 ? (
        <p className="font-body text-xs italic text-muted-ink">
          Nothing saved yet — it fills in as the conversation goes.
        </p>
      ) : (
        <div className="max-h-80 overflow-y-auto border-2 border-ink px-3 py-2 font-body text-[13px] leading-snug text-ink">
          <p className="text-muted-ink">Patient: {patientName}</p>
          {items.map((it) => (
            <p key={it.id}>
              {displayLabel(it.label)}: {it.value}
            </p>
          ))}
        </div>
      )}
      <p
        className={`font-label text-[10px] uppercase tracking-wide ${
          sync?.state === 'error' ? 'text-[#b91c1c]' : sync?.state === 'saved' || sync?.state === 'cleared' ? 'text-[#15803d]' : 'text-muted-ink'
        }`}
      >
        {!sheetColumn
          ? 'This scene isn’t from a Google Sheet — saved in the app only.'
          : !connected
            ? `Not saved to the sheet — set up “Save to the sheet” in section 1 (row 7, column ${sheetColumn}).`
            : !sync
              ? `Saves to row 7, column ${sheetColumn} of the sheet as it’s collected.`
              : sync.state === 'saving'
                ? `Saving to row 7, column ${sync.column}…`
                : sync.state === 'saved'
                  ? `✓ Saved to row 7, column ${sync.column} at ${time(sync.at)}`
                  : sync.state === 'cleared'
                    ? `✓ Row 7, column ${sync.column} cleared at ${time(sync.at)}`
                  : `✗ Not saved to the sheet: ${sync.message}`}
      </p>
    </div>
  );
}

const BRIEF_PLACEHOLDER =
  'e.g. A voice guide at the entrance of a science museum. It welcomes visitors, asks what they are curious about ' +
  '(space, dinosaurs or the human body), recommends the matching gallery, asks if they want the audio tour, and ' +
  'says goodbye. Each gallery choice should trigger its video on the big screen.';

/** The selected patient's memory, as the open scene sees it. */
export type MemoryView = {
  patientName: string | null;
  /** From earlier scenes, allowed by this scene's restrictions. */
  available: MemoryItem[];
  /** From earlier scenes, kept out by this scene's "cannot use". */
  blocked: MemoryItem[];
  /** What this scene's conversations have saved for the selected patient. */
  savedHere: MemoryItem[];
  checking: boolean;
  error?: string;
};

/** How the last write of a scene's saved information into row 7 of the sheet went. */
export type SheetSync = { state: 'saving' | 'saved' | 'cleared' | 'error'; column: string; message?: string; at: number };

/** What "Generate Scenes" reports back: the import, or why it couldn't happen. */
export type SheetImportOutcome = { result: SheetImport } | { error: string };

/** The open scene, as far as FigJam drawing and reading are concerned. */
export type SceneInfo = {
  /** Its lasting id (a FigJam section is tied to it); null for a scene that isn't saved yet. */
  key: string | null;
  /** Its number — from the sheet, as given (ordering on the board). */
  number: string;
  /** The heading drawn above it on the board, e.g. "Scene 4 · Ghost train". */
  heading: string;
  fromSheet: boolean;
};

/** Onboard Me, at the right-hand end of a process section's heading. */
const onboardButton = `${buttonOutline} !px-3 !py-1.5`;

export function DesignPanel({
  flow,
  brief,
  generatedBrief,
  onGenerated,
  sheetUrl,
  onSheetUrlChange,
  sheetScriptUrl,
  onSheetScriptUrlChange,
  sheetSync,
  sceneSheet,
  onImportSheet,
  onResolveConflict,
  sheetScenes,
  activeSheetId,
  currentSceneId,
  onSwitchScene,
  scene,
  figjamFlow,
  onWrittenToFigjam,
  onSaveInfoChange,
  onMergeCanUse,
  onCannotUseChange,
  memory,
  stages,
  boardUrl,
  anthropicApiKey,
  onBriefChange,
  onBoardUrlChange,
  onFlowLoaded,
  onKnowledgeChange,
  onNeedKey,
  onClearConversation,
  onRefreshFromSheet,
  onMediaOpenChange,
  onTryVoice,
  onOnboard,
  onMediaOnboard,
  onboardPulse = false,
  updateRequest = 0,
  onUpdateProgress,
}: {
  flow: AgentFlow;
  brief: string;
  /** The description the current flow was generated from (null = never generated). */
  generatedBrief: string | null;
  /** A flow was generated from `brief` (as it was when generation started). */
  onGenerated: (brief: string) => void;
  sheetUrl: string;
  onSheetUrlChange: (url: string) => void;
  /** The sheet's Apps Script link, for saving into row 7. */
  sheetScriptUrl: string;
  onSheetScriptUrlChange: (url: string) => void;
  /** The open scene's last write to row 7, if any. */
  sheetSync: SheetSync | undefined;
  /** The open scene's sheet column, if it came from a sheet. */
  sceneSheet: SheetSource | null;
  onImportSheet: (url: string) => Promise<SheetImportOutcome>;
  /** "Use the sheet" (true) or "Keep mine" (false) for a scene edited in both places. */
  onResolveConflict: (conflict: SheetConflict, useSheet: boolean) => Promise<void>;
  /** The sheet's scenes, in number order — one button each. */
  sheetScenes: { id: string; number: string; name: string }[];
  /** The sheet `sheetScenes` came from (null = none generated yet). */
  activeSheetId: string | null;
  currentSceneId: string | null;
  onSwitchScene: (id: string) => void;
  scene: SceneInfo;
  /** Fingerprint of the flow as last written to FigJam for this scene (null = never). */
  figjamFlow: string | null;
  onWrittenToFigjam: (fingerprint: string) => void;
  onSaveInfoChange: (text: string) => void;
  /** Moves leftover "can use" text (from before it was part of the knowledge base) into the knowledge base. */
  onMergeCanUse: () => void;
  onCannotUseChange: (text: string) => void;
  /** The selected patient's memory, as this scene sees it. */
  memory: MemoryView;
  /** The scene's stage buttons (and the card being edited), shown under its scene buttons. */
  stages: ReactNode;
  boardUrl: string;
  anthropicApiKey: string;
  onBriefChange: (brief: string) => void;
  onBoardUrlChange: (url: string) => void;
  onFlowLoaded: (flow: AgentFlow) => void;
  onKnowledgeChange: (knowledge: string) => void;
  onNeedKey: () => void;
  /** Clears this scene's conversation in the chat (as "Refresh this scene" does). */
  onClearConversation: () => void;
  /** Re-reads this scene from its sheet into the app (see refreshSceneFromSheet in the page). */
  onRefreshFromSheet: () => Promise<{ brief: string; flow: AgentFlow; others: { updated: number; keptEdits: number } } | 'cancelled' | null>;
  /** "Adding Immersive Media Process" opened or closed — it opens the media panel beside this column. */
  onMediaOpenChange?: (open: boolean) => void;
  /** Says a line in the voice in use, resolving once it's finished (the Media Library's Try it). */
  onTryVoice?: (text: string, signal?: AbortSignal) => Promise<void>;
  /** Starts the Chatbot Generation Process tour (Onboard Me, beside that section's heading). */
  onOnboard?: () => void;
  /** Starts the Adding Immersive Media tour. */
  onMediaOnboard?: () => void;
  /** Onboard Me pulses until it's first clicked. */
  onboardPulse?: boolean;
  /** Goes up by one each time "Refresh this scene" (in the chat) asks for an Update This Scene. */
  updateRequest?: number;
  /** An update's progress (for the chat's Refresh button to show the same line), or null when none is running. */
  onUpdateProgress?: (progress: { startedAt: number; expectedMs: number; done?: boolean } | null) => void;
}) {
  const [busy, setBusy] = useState<null | 'generate' | 'draw' | 'import' | 'sheet'>(null);
  const [conflicts, setConflicts] = useState<SheetConflict[]>([]);
  const [activity, setActivity] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [updating, setUpdating] = useState(false);
  /**
   * The progress line: which button it's on, when the work started, how long it's
   * expected to take — and `done` for the moment it fills to the end before it goes.
   */
  const [generating, setGenerating] = useState<{ source: 'generate' | 'update'; startedAt: number; expectedMs: number; done?: boolean } | null>(
    null,
  );
  const finishLine = () => {
    setGenerating((g) => g && { ...g, done: true });
    setTimeout(() => setGenerating((g) => (g?.done ? null : g)), 600);
  };

  // null = not checked yet; the plugin polls every ~4s while open.
  const [pluginSeenAgo, setPluginSeenAgo] = useState<number | null | undefined>(undefined);
  const [pluginProblem, setPluginProblem] = useState<string | null>(null);
  const hosting = useHosting();
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/figma-jobs?status=1&code=${encodeURIComponent(connectionCode())}`, { cache: 'no-store' });
        const data = (await res.json()) as { pluginLastSeenMsAgo: number | null; problem?: string };
        if (!cancelled) {
          setPluginSeenAgo(data.pluginLastSeenMsAgo);
          setPluginProblem(data.problem ?? null);
        }
      } catch {
        // Next tick will try again.
      }
    };
    void check();
    const timer = setInterval(check, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);
  const pluginListening = typeof pluginSeenAgo === 'number' && pluginSeenAgo < 12_000;
  // Shown (and typed into the plugin) only on a hosted copy; read after mounting, as it lives in this browser.
  const [connectionCodeShown, setConnectionCodeShown] = useState('');
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
    setConnectionCodeShown(connectionCode());
  }, []);

  const say = (line: string) => setActivity((a) => [...a, line]);
  const hasFlow = flow.stages.length > 0;
  // A scene fresh from a sheet has just a placeholder stage — nothing worth asking before replacing.
  const placeholderOnly = flow.stages.length === 1 && !flow.stages[0].goal.trim() && flow.stages[0].collect.length === 0;
  // Scenes already generated from the sheet in step 1 (not archived ones): the button then updates them.
  const generatedHere = parseSheetUrl(sheetUrl)?.sheetId === activeSheetId && activeSheetId ? sheetScenes.length : 0;
  const boardLooksValid = /figma\.com\/(board|file)\//.test(boardUrl);

  const replaceOk = () => !hasFlow || placeholderOnly || window.confirm('Replace the current flow in the app with this one?');

  // A saved scene is drawn in its own section of the board (replacing only
  // that scene's earlier drawing); an unsaved one the old way, on its own.
  const draw = async (target: AgentFlow) => {
    setBusy('draw');
    say(scene.key ? `Sending ${scene.heading} to the FigJam plugin…` : 'Sending the flow to the FigJam plugin…');
    try {
      const board = flowToBoard(target);
      await runPluginJob(
        'draw-agent-flow',
        scene.key ? { ...board, title: scene.heading, scene: { key: scene.key, number: scene.number, heading: scene.heading } } : board,
        say,
      );
      if (scene.key) onWrittenToFigjam(flowFingerprint(target));
      say('✓ Drawn on the board. Edit it there, then Import from FigJam.');
    } catch (err) {
      say(`✗ ${err instanceof Error ? err.message : 'Drawing failed.'}`);
    } finally {
      setBusy(null);
    }
  };

  // Draw All Scenes to FigJam: every saved scene that has a conversation (archived ones left out), one
  // after another, each in its own section of the board — replacing only that scene's earlier drawing.
  // The open scene is drawn as it is now (unsaved edits included).
  const drawAll = async () => {
    setBusy('draw');
    try {
      const drawable = (f: AgentFlow) => f.stages.some((s) => s.goal.trim() || s.collect.length > 0);
      const scenes = (await listProjects())
        .filter((p) => !p.archived)
        .map((p) => (p.id === scene.key ? { ...p, flow } : p))
        .filter((p) => drawable(p.flow));
      if (scenes.length === 0) {
        say('✗ No saved scene has a conversation to draw yet — generate one first.');
        return;
      }
      say(`Sending ${scenes.length} scene${scenes.length === 1 ? '' : 's'} to the FigJam plugin…`);
      let drawn = 0;
      for (const p of scenes) {
        const heading = p.sheet ? `Scene ${p.sheet.number} · ${p.name}` : p.name;
        say(`Drawing ${heading}…`);
        try {
          await runPluginJob(
            'draw-agent-flow',
            { ...flowToBoard(p.flow), title: heading, scene: { key: p.id, number: p.sheet?.number ?? '', heading } },
            say,
          );
          const fingerprint = flowFingerprint(p.flow);
          if (p.id === scene.key) onWrittenToFigjam(fingerprint);
          else await markWrittenToFigjam(p.id, fingerprint);
          drawn++;
        } catch (err) {
          say(`✗ ${heading}: ${err instanceof Error ? err.message : 'drawing failed.'}`);
        }
      }
      if (!scene.key && drawable(flow)) say('The open scene isn’t saved yet, so it wasn’t drawn — save it in Scenes first.');
      say(
        drawn === scenes.length
          ? `✓ All ${drawn} scene${drawn === 1 ? '' : 's'} drawn on the board. Edit them there, then Import from FigJam.`
          : `${drawn} of ${scenes.length} scenes drawn.`,
      );
    } finally {
      setBusy(null);
    }
  };

  // The flow is up to date with the description when it was last generated from exactly this text.
  const upToDate = busy !== 'generate' && generatedBrief !== null && brief.trim() !== '' && brief.trim() === generatedBrief.trim();

  // "Update This Scene" asks nothing; the generate button checks before
  // replacing a flow. Neither draws in FigJam — that only ever happens when
  // someone clicks "Draw it on my FigJam board" (or Draw All Scenes to FigJam).
  const briefNow = brief;
  const flowNow = flow;
  // `from` is the description and flow to use when they've only just changed
  // (this render's props are still the old ones).
  // `fresh` = a whole new design even if one exists; otherwise, when this design
  // records what it was made from, only the changes are sent to be revised.
  const generate = async ({ update = false, from, fresh = false }: { update?: boolean; from?: { brief: string; flow: AgentFlow }; fresh?: boolean } = {}) => {
    const brief = from?.brief ?? briefNow;
    const flow = from?.flow ?? flowNow;
    if (!anthropicApiKey.trim()) {
      onNeedKey();
      return;
    }
    if (!update && !replaceOk()) return;
    // The description as sent — if it's edited while this runs, the button goes back to red.
    const usedBrief = brief;
    setBusy('generate');
    // What the scene saves, and must not use, shape the design too.
    const sent = briefForDesign(brief, flow);
    // What the current design was made from. Scenes generated before this was recorded still
    // know the description they were last generated from — that (with the scene's information
    // rules as they were) stands in, so every already-generated scene gets the quick path.
    // Only a scene never generated at all needs a whole new design.
    const madeFrom =
      flowNow.designedFrom ?? (generatedBrief !== null && flowNow.stages.length > 0 ? briefForDesign(generatedBrief, flowNow) : undefined);
    const revising = !fresh && Boolean(madeFrom) && flow.stages.length > 0;
    const mode = revising ? 'revise' : 'design';
    const designing = revising
      ? 'Updating the design with your changes — only what changed is redone…'
      : 'Designing the flow from your brief — this takes about a minute…';
    if (update) say(designing);
    else setActivity([designing]);
    setProblems([]);
    let generated: AgentFlow | null = null;
    const startedAt = Date.now();
    // An update's line started at its click (it read the sheet first): keep it going, now expecting the AI step too.
    setGenerating((g) =>
      g?.source === 'update' && update
        ? { ...g, expectedMs: startedAt - g.startedAt + estimateGeneration(sent.length, mode) }
        : { source: 'generate', startedAt, expectedMs: estimateGeneration(sent.length, mode) },
    );
    try {
      const res = await fetch('/api/agent/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brief: sent,
          anthropicApiKey,
          knowledge: flow.knowledge ?? '',
          ...(revising && { previous: { brief: madeFrom, flow } }),
        }),
      });
      const data = (await res.json()) as { flow: AgentFlow; problems: string[]; summary?: string; unchanged?: boolean } | { error: string };
      if ('error' in data) throw new Error(data.error);
      // Only a finished design counts towards the next estimate.
      recordGeneration(Date.now() - startedAt, sent.length, mode);
      // Keep what isn't part of the design: the TD address and the scene's information.
      generated = {
        ...data.flow,
        tdUrl: flow.tdUrl,
        tdTiming: flow.tdTiming,
        knowledge: flow.knowledge ?? '',
        saveInfo: flow.saveInfo,
        canUse: flow.canUse,
        cannotUse: flow.cannotUse,
        // What it was made from — so next time only the changes need redoing.
        designedFrom: sent,
      };
      onFlowLoaded(generated);
      onGenerated(usedBrief);
      setProblems(data.problems);
      say(
        data.unchanged
          ? '✓ Nothing has changed since the last design — it’s kept as it is.'
          : revising
          ? `✓ Updated — ${data.summary || 'the design now follows your changes'} (${generated.stages.length} stages).`
          : `✓ Designed ${generated.stages.length} stages — they're in the editor tabs above.`,
      );
    } catch (err) {
      say(`✗ ${err instanceof Error ? err.message : 'Generation failed.'}`);
    }
    finishLine();
    setBusy(null);
  };

  const updateScene = async () => {
    setUpdating(true);
    // The progress line starts at the click — reading the sheet is part of the wait.
    const quick = Boolean(flow.designedFrom ?? generatedBrief) && flow.stages.length > 0;
    setGenerating({ source: 'update', startedAt: Date.now(), expectedMs: 1500 + estimateGeneration(brief.length, quick ? 'revise' : 'design') });
    try {
      // A scene from the sheet takes what the sheet says now — the description above included.
      let fresh: Awaited<ReturnType<typeof onRefreshFromSheet>> = null;
      setActivity([]);
      if (scene.fromSheet) {
        setActivity(['Reading this scene from the Google Sheet…']);
        try {
          fresh = await onRefreshFromSheet();
        } catch (err) {
          say(`✗ ${err instanceof Error ? err.message : 'Couldn’t read the sheet.'} The scene wasn’t updated.`);
          return;
        }
        if (fresh === 'cancelled') {
          say('Update cancelled — your edits are kept.');
          return;
        }
        say('✓ Updated from the sheet.');
        if (fresh?.others.updated) {
          say(
            `✓ ${fresh.others.updated} other scene${fresh.others.updated === 1 ? '' : 's'} also took the sheet’s latest text (e.g. the “All scenes” column) — update ${fresh.others.updated === 1 ? 'it' : 'each'} to refresh its conversation.`,
          );
        }
        if (fresh?.others.keptEdits) {
          say(`${fresh.others.keptEdits} other scene${fresh.others.keptEdits === 1 ? ' was' : 's were'} edited here, so kept as ${fresh.others.keptEdits === 1 ? 'it is' : 'they are'} (Generate Scenes from Google Sheet offers “Use the sheet”).`);
        }
      }
      // The old conversation doesn't fit the new pattern: it goes before the new one is made.
      onClearConversation();
      await generate({ update: true, from: fresh ?? undefined });
    } finally {
      setUpdating(false);
      // Stopped early (sheet couldn't be read, or the update was cancelled): the line goes. Otherwise it's finishing.
      setGenerating((g) => (g?.source === 'update' && !g.done ? null : g));
    }
  };

  // "Refresh this scene" in the chat: the same as Update This Scene.
  const updateNow = useRef(updateScene);
  useEffect(() => {
    updateNow.current = updateScene;
  });
  const lastRequest = useRef(updateRequest);
  useEffect(() => {
    if (updateRequest === lastRequest.current) return;
    lastRequest.current = updateRequest;
    if (!updating) void updateNow.current();
  }, [updateRequest, updating]);
  // …and its progress line, shown on that button too.
  const progress = generating?.source === 'update' ? generating : null;
  useEffect(() => {
    onUpdateProgress?.(progress && { startedAt: progress.startedAt, expectedMs: progress.expectedMs, done: progress.done });
    // Only the line itself matters, not the callback's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress?.startedAt, progress?.expectedMs, progress?.done]);

  // --- scenes from a Google Sheet -------------------------------------------

  const importSheet = async () => {
    setBusy('sheet');
    setActivity(['Reading the Google Sheet…']);
    setProblems([]);
    setConflicts([]);
    try {
      const outcome = await onImportSheet(sheetUrl.trim());
      if ('error' in outcome) {
        say(`✗ ${outcome.error}`);
        return;
      }
      const { added, updated, unchanged, archived, conflicts: edited } = outcome.result;
      const parts = [
        added.length && `${added.length} new`,
        updated.length && `${updated.length} updated from the sheet`,
        unchanged.length && `${unchanged.length} unchanged`,
        archived.length && `${archived.length} archived (left alone)`,
        edited.length && `${edited.length} edited here and in the sheet — choose below`,
      ].filter(Boolean);
      say(`✓ Scenes: ${parts.join(', ')}. Pick one by its number under “Describe the conversation in each scene”.`);
      setConflicts(edited);
    } catch (err) {
      say(`✗ ${err instanceof Error ? err.message : 'Couldn’t read the sheet.'}`);
    } finally {
      setBusy(null);
    }
  };

  const resolve = async (conflict: SheetConflict, useSheet: boolean) => {
    await onResolveConflict(conflict, useSheet);
    setConflicts((list) => list.filter((c) => c.project.id !== conflict.project.id));
    say(`✓ Scene ${conflict.scene.number}: ${useSheet ? 'took the sheet’s version' : 'kept your version'}.`);
  };

  // FigJam: the current flow can go on the board once it exists — and, for a
  // scene from a sheet, once it has been generated from its description.
  const canWrite = hasFlow && !placeholderOnly && (!scene.fromSheet || generatedBrief !== null);
  const fingerprint = flowFingerprint(flow);
  const figjamStatus = !scene.key
    ? null
    : figjamFlow === null
      ? 'Not on the board yet'
      : figjamFlow === fingerprint
        ? 'On the board ✓ — up to date'
        : 'On the board, but changed since — write it again to update it';

  const importBoard = async () => {
    setBusy('import');
    setActivity(['Asking the FigJam plugin to read the board…']);
    setProblems([]);
    try {
      // Just this scene's section of the board (if it has one).
      const tables = (await runPluginJob('read-agent-flow', scene.key ? { sceneKey: scene.key } : null, say)) as
        | ReadTable[]
        | undefined;
      const { flow: imported, warnings } = boardToFlow(tables ?? [], {
        tdUrl: flow.tdUrl,
        tdTiming: flow.tdTiming,
        knowledge: flow.knowledge ?? '',
        saveInfo: flow.saveInfo,
        canUse: flow.canUse,
        cannotUse: flow.cannotUse,
        designedFrom: flow.designedFrom,
      });
      if (imported.stages.length === 0) {
        say('✗ No STAGE cards found on that board. Is the plugin open in the right board?');
        return;
      }
      if (!replaceOk()) {
        say('Import cancelled.');
        return;
      }
      onFlowLoaded(imported);
      setProblems([...warnings, ...validateFlow(imported)]);
      say(`✓ Imported ${imported.stages.length} stages. The conversation has restarted — try it in the middle panel.`);
    } catch (err) {
      say(`✗ ${err instanceof Error ? err.message : 'Import failed.'}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col">
      {/* The steps of making a chatbot. More titled groups (ProcessSection) can sit alongside this one. */}
      <ProcessSection
        title="Chatbot Generation Process"
        tourId="process-chatbot"
        action={
          <button
            onClick={onOnboard}
            className={`${onboardButton} ${onboardPulse ? 'onboard-pulse' : ''}`}
            title="A guided tour of the chatbot generation process"
          >
            Onboard Me
          </button>
        }
      >
        <CollapsiblePanel title="1 · Generate scenes from Google Sheet" tourId="design-1">
          <div className="flex flex-col gap-1" data-tour="sheet-url">
            <label htmlFor="sheet-url-field" className={fieldLabel}>
              Google Sheet URL
            </label>
            <div className="flex gap-2">
              <input
                id="sheet-url-field"
                value={sheetUrl}
                onChange={(e) => onSheetUrlChange(e.target.value.trim())}
                placeholder="https://docs.google.com/spreadsheets/d/…"
                className={`min-w-0 flex-1 font-label text-[12px] normal-case tracking-normal ${studentField}`}
              />
              {/* Always a proper Google Sheets address (built from the link's id and tab), in a new tab. */}
              <button
                onClick={() => {
                  const sheet = parseSheetUrl(sheetUrl);
                  if (sheet) window.open(`https://docs.google.com/spreadsheets/d/${sheet.sheetId}/edit#gid=${sheet.gid}`, '_blank', 'noopener');
                }}
                disabled={!parseSheetUrl(sheetUrl)}
                className={`shrink-0 ${buttonOutline}`}
                title={parseSheetUrl(sheetUrl) ? 'Open this Google Sheet in a new tab' : 'Paste a Google Sheets link first'}
              >
                Open This Sheet
              </button>
            </div>
          </div>
          <button
            // While it's running it shows a black spinning wheel (rather than greying out); clicks are ignored.
            onClick={() => busy === null && void importSheet()}
            disabled={(busy !== null && busy !== 'sheet') || !sheetUrl.trim()}
            aria-busy={busy === 'sheet'}
            aria-disabled={busy === 'sheet' || undefined}
            className={`self-start ${busy === 'sheet' ? buttonBusy : buttonPrimary}`}
            data-tour="generate-scenes"
            title="Create a scene for every filled-in column — or update the scenes already made from this sheet"
          >
            {busy === 'sheet' && <Spinner />}
            {busy === 'sheet'
              ? generatedHere
                ? 'Updating scenes…'
                : 'Generating scenes…'
              : generatedHere
                ? 'Update Scenes from Google Sheet'
                : 'Generate Scenes from Google Sheet'}
          </button>
          {generatedHere > 0 && (
            <p className="border-l-4 border-[#15803d] pl-2 font-body text-xs text-ink">
              ✓ {generatedHere} scene{generatedHere === 1 ? '' : 's'} generated from this sheet — Update brings in
              what&rsquo;s changed in it.
            </p>
          )}
          <SheetSaving
            scriptUrl={sheetScriptUrl}
            onScriptUrlChange={onSheetScriptUrlChange}
            spreadsheetId={sceneSheet?.sheetId ?? null}
          />
          {conflicts.length > 0 && (
            <div className="flex flex-col gap-2 border-l-4 border-[#b45309] pl-2">
              <p className={fieldLabel}>Edited here and changed in the sheet</p>
              {conflicts.map((c) => (
                <div key={c.project.id} className="flex flex-wrap items-center gap-2 font-body text-[13px] text-ink">
                  <span className="min-w-0 flex-1">
                    Scene {c.scene.number} · {c.project.name}
                    {c.scene.name !== c.project.name && <span className="text-muted-ink"> (sheet: {c.scene.name})</span>}
                  </span>
                  <button onClick={() => void resolve(c, false)} className={buttonOutline}>
                    Keep mine
                  </button>
                  <button onClick={() => void resolve(c, true)} className={buttonOutline}>
                    Use the sheet
                  </button>
                </div>
              ))}
            </div>
          )}
        </CollapsiblePanel>

        <CollapsiblePanel title="2 · FigJam board (optional)" tourId="design-6">
          {/* One column, top to bottom: Board Selected (in the picker), Draw All Scenes to FigJam, View in FigJam. */}
          <BoardPicker
            boardUrl={boardUrl}
            onBoardUrlChange={onBoardUrlChange}
            buttonClass={FIGJAM_BUTTON}
            below={
              <div className="flex flex-col items-start gap-2" data-tour="figjam-actions">
                <button
                  onClick={() => void drawAll()}
                  disabled={busy !== null || !boardLooksValid}
                  className={`${FIGJAM_BUTTON} ${busy === 'draw' ? buttonBusy : buttonOutline}`}
                  title={
                    boardLooksValid
                      ? 'Draws every scene on the board, each in its own section (replacing only that scene’s earlier drawing)'
                      : 'Select a board first'
                  }
                >
                  {busy === 'draw' && <Spinner />}
                  {busy === 'draw' ? 'Drawing…' : 'Draw All Scenes to FigJam'}
                </button>
                <button
                  onClick={() => window.open(boardUrl, '_blank', 'noopener')}
                  disabled={!boardLooksValid}
                  className={`${FIGJAM_BUTTON} ${buttonOutline}`}
                >
                  View in FigJam
                </button>
              </div>
            }
          />
          {figjamStatus && (
            <p className="font-label text-[10px] uppercase tracking-wide text-muted-ink">{figjamStatus}</p>
          )}
          <p className="flex items-center gap-2 font-label text-[10px] uppercase tracking-wide text-ink">
            <span
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${pluginListening ? 'bg-[#15803d]' : 'bg-[#b91c1c]'}`}
              aria-hidden="true"
            />
            {pluginSeenAgo === undefined
              ? 'Checking for the FigJam plugin…'
              : pluginListening
                ? 'FigJam plugin: listening ✓'
                : 'FigJam plugin: not running — drawing and importing need it (see below)'}
          </p>
          {pluginProblem && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">{pluginProblem}</p>}
          <details className="font-body text-xs text-ink" open={pluginSeenAgo !== undefined && !pluginListening} data-tour="plugin-setup">
            <summary className="cursor-pointer font-label text-[10px] uppercase tracking-wide text-muted-ink">
              First time? Set up the plugin
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 leading-snug">
              <li>
                Download the plugin by clicking this button — it goes into your <b>Downloads</b> folder. Then unzip it.
                <a
                  href="/api/figjam-plugin"
                  download="chatbot-designer-figjam.zip"
                  data-tour="plugin-download"
                  className={`mt-1 flex w-fit ${buttonOutline}`}
                >
                  Download the FigJam plugin
                </a>
              </li>
              <li>Open the board in the <b>Figma desktop app</b> (plugins in development don’t run in the browser).</li>
              <li>
                Only once: <b>Plugins → Development → Import plugin from manifest…</b> and choose <code>manifest.json</code>{' '}
                in the unzipped folder.
              </li>
              {hosting?.hosted ? (
                <li>
                  Run <b>Plugins → Development → Chatbot Designer — FigJam</b>. In its panel, type this connection
                  code: <b className="font-label tracking-widest">{connectionCodeShown}</b>
                </li>
              ) : (
                <li>
                  Run <b>Plugins → Development → Chatbot Designer — FigJam</b>. Leave its connection code empty — this
                  app must be running at localhost:3000 on the same computer.
                </li>
              )}
              <li>
                Leave the panel open with <b>Listen for requests</b> ticked.
              </li>
            </ol>
          </details>
        </CollapsiblePanel>

        <CollapsiblePanel title="3 · Describe the conversation in each scene" tourId="design-2">
          <SceneButtons
            scenes={sheetScenes}
            currentId={currentSceneId}
            onSwitch={onSwitchScene}
            disabled={busy !== null}
            tourId="scene-buttons"
          />
          {scene.fromSheet && <p className="font-display text-base text-ink">{scene.heading}</p>}
          {stages}
          <p className="font-body text-xs italic text-muted-ink">
            Who the agent is, who it talks to, and what should be achieved, in plain English. Claude turns it into stages
            with goals.
          </p>
          <textarea
            value={brief}
            onChange={(e) => onBriefChange(e.target.value)}
            placeholder={BRIEF_PLACEHOLDER}
            className={`min-h-[160px] w-full resize-y leading-snug ${studentField}`}
          />
          <div className="flex flex-wrap items-center gap-2" data-tour="generate-conversation">
            {/* Red until the flow comes from the description as it reads now; green once it does. */}
            <button
              onClick={() => {
                // Already up to date: confirming starts a whole new design (rather than revising this one).
                if (upToDate) {
                  if (window.confirm('This description has already been generated. Make a completely new design from it anyway? (Your edits to the stages will be replaced.)')) void generate({ fresh: true });
                  return;
                }
                void generate();
              }}
              disabled={busy !== null || !brief.trim()}
              aria-disabled={upToDate || undefined}
              className={`relative self-start overflow-hidden disabled:cursor-not-allowed disabled:opacity-60 ${upToDate ? buttonDone : buttonUnsaved}`}
              title={
                upToDate
                  ? 'The flow was generated from this description. Edit the description to generate again.'
                  : 'Design the conversation flow from this description'
              }
            >
              {busy === 'generate' && !updating ? 'Generating…' : upToDate ? 'Conversation Generated' : 'Generate New Conversation'}
              {generating?.source === 'generate' && (
                <ProgressLine startedAt={generating.startedAt} expectedMs={generating.expectedMs} done={generating.done} />
              )}
            </button>
            {/* Regenerates the pattern and clears the chat — all in one go (FigJam is left alone). */}
            <button
              onClick={() => !updating && void updateScene()}
              disabled={(busy !== null && !updating) || !brief.trim()}
              aria-busy={updating}
              aria-disabled={updating || undefined}
              className={`relative overflow-hidden ${updating ? buttonBusy : buttonOutline}`}
              title="Recreate this scene’s conversation pattern from the description and clear the conversation in the chat"
            >
              {updating && <Spinner />}
              {updating ? 'Updating…' : 'Update This Scene'}
              {generating?.source === 'update' && (
                <ProgressLine startedAt={generating.startedAt} expectedMs={generating.expectedMs} done={generating.done} />
              )}
            </button>
            {/* FigJam is only ever drawn when this (or Draw All Scenes to FigJam, in section 2) is clicked — never by itself. */}
            <button
              onClick={() =>
                (scene.key ||
                  window.confirm('Draw the current flow on the board? This replaces any flow the plugin drew there before (your other board content is left alone).')) &&
                void draw(flow)
              }
              disabled={busy !== null || !canWrite}
              className={buttonOutline}
              title={
                canWrite
                  ? scene.key
                    ? `Draws ${scene.heading} in its own section of the FigJam board (replacing only its earlier drawing)`
                    : 'Draws the current flow on the FigJam board'
                  : 'Generate this scene’s conversation first'
              }
            >
              {busy === 'draw' ? 'Drawing…' : 'Draw it on my FigJam board'}
            </button>
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel title="4 · Information this scene can use" tourId="design-3">
          <SceneButtons scenes={sheetScenes} currentId={currentSceneId} onSwitch={onSwitchScene} disabled={busy !== null} />
          <p className="font-body text-xs italic text-muted-ink">
            Facts the bot can rely on but never invent: names, times, prices, options (row 4 of the sheet, after the
            &ldquo;All scenes&rdquo; column&rsquo;s). It answers questions and offers choices from this, and says when
            something isn&rsquo;t covered. Drawn on the board as a KNOWLEDGE card.
          </p>
          <textarea
            value={flow.knowledge ?? ''}
            onChange={(e) => onKnowledgeChange(e.target.value)}
            data-tour="can-use"
            placeholder={KNOWLEDGE_PLACEHOLDER}
            className={`min-h-[200px] w-full resize-y font-body text-[13px] leading-snug ${studentField}`}
          />
          <KnowledgeSize text={flow.knowledge ?? ''} />
          {/* Scenes made before "can use" and the knowledge base became one box may still have some. */}
          {flow.canUse?.trim() && (
            <div className="flex flex-col gap-1 border-l-4 border-[#b45309] pl-2">
              <p className="font-body text-xs text-ink">
                This scene also has older &ldquo;can use&rdquo; text, kept apart from the box above — the bot still uses
                it: <span className="italic">{flow.canUse.trim()}</span>
              </p>
              <button onClick={onMergeCanUse} className={`self-start ${buttonOutline}`}>
                Move it into the box above
              </button>
            </div>
          )}
          <p className={fieldLabel}>
            Also usable: {memory.patientName ?? 'the patient'}&rsquo;s earlier scenes{memory.checking ? ' · checking…' : ''}
          </p>
          {memory.error && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">{memory.error}</p>}
          <MemoryList
            items={memory.available}
            empty="Nothing saved by earlier scenes yet."
          />
        </CollapsiblePanel>

        <CollapsiblePanel title="5 · Information saved from the scene" tourId="design-4">
          <SceneButtons scenes={sheetScenes} currentId={currentSceneId} onSwitch={onSwitchScene} disabled={busy !== null} />
          <p className="font-body text-xs italic text-muted-ink">
            What to pick up during this scene&rsquo;s conversation and keep for the patient&rsquo;s later scenes (row 5 of
            the sheet). It&rsquo;s kept for the patient, and scenes numbered after this one can use it.
          </p>
          <textarea
            value={flow.saveInfo ?? ''}
            onChange={(e) => onSaveInfoChange(e.target.value)}
            data-tour="save-info"
            placeholder="e.g. Their symptoms and how long they've had them. Whether they prefer a morning or afternoon appointment."
            className={`min-h-[120px] w-full resize-y font-body text-[13px] leading-snug ${studentField}`}
          />
          <div className="flex flex-col gap-2" data-tour="saved-list">
            <p className={`mt-1 ${fieldLabel}`}>List of Saved Information from This Scene · {memory.savedHere.length}</p>
            <SavedFromScene
              items={memory.savedHere}
              patientName={memory.patientName}
              sync={sheetSync}
              sheetColumn={sceneSheet?.column ?? null}
              connected={isScriptUrl(sheetScriptUrl)}
            />
          </div>
        </CollapsiblePanel>

        <CollapsiblePanel title="6 · Information this scene cannot use" tourId="design-5">
          <SceneButtons scenes={sheetScenes} currentId={currentSceneId} onSwitch={onSwitchScene} disabled={busy !== null} />
          <p className="font-body text-xs italic text-muted-ink">
            What the bot must not have in this scene (row 6 of the sheet). Anything the patient&rsquo;s earlier scenes
            saved that falls under this is left out of what the bot is given — it never sees it. It&rsquo;s also told not
            to bring these things up from its general knowledge.
          </p>
          <textarea
            value={flow.cannotUse ?? ''}
            onChange={(e) => onCannotUseChange(e.target.value)}
            data-tour="cannot-use"
            placeholder="e.g. Anything about the patient's insurance or payment details."
            className={`min-h-[120px] w-full resize-y font-body text-[13px] leading-snug ${studentField}`}
          />
          <p className={fieldLabel}>Kept out of this scene</p>
          <MemoryList items={memory.blocked} empty="Nothing from earlier scenes is being kept out." />
        </CollapsiblePanel>

        <CollapsiblePanel title="7 · Bring your edits back">
          <p className="font-body text-xs italic text-muted-ink">
            After editing the cards in FigJam, import them. The board replaces the flow in the app (for a scene drawn in
            its own section, just that section is read).
          </p>
          <button onClick={importBoard} disabled={busy !== null} className={`self-start ${buttonPrimary}`}>
            {busy === 'import' ? 'Importing…' : 'Import from FigJam'}
          </button>
        </CollapsiblePanel>
      </ProcessSection>

      <ProcessSection
        title="Adding Immersive Media Process"
        tourId="process-media"
        defaultOpen={false}
        onOpenChange={onMediaOpenChange}
        action={
          <button
            onClick={onMediaOnboard}
            className={onboardButton}
            title="A guided tour of adding pictures, video and sound"
          >
            Onboard Me
          </button>
        }
      >
        <ImmersiveMedia sheetUrl={sheetUrl} sheetScriptUrl={sheetScriptUrl} sceneSheet={sceneSheet} sceneName={sceneSheet?.importedName ?? scene.heading} onTryVoice={onTryVoice} anthropicApiKey={anthropicApiKey} />
      </ProcessSection>

      {/* Progress and problems stay outside the panels, so they're seen even with every panel folded. */}
      {(activity.length > 0 || problems.length > 0) && (
        <section className="mt-3 flex flex-col gap-2 border-t-2 border-ink pt-3">
          {activity.length > 0 && (
            <ul className="flex flex-col gap-1 font-body text-[13px] leading-snug text-ink">
              {activity.map((line, i) => (
                <li key={i} className={line.startsWith('✗') ? 'text-[#b91c1c]' : ''}>
                  {line}
                </li>
              ))}
            </ul>
          )}
          {problems.length > 0 && (
            <div className="border-l-4 border-[#b91c1c] pl-2">
              <p className={fieldLabel}>Check these</p>
              <ul className="mt-1 list-disc pl-4 font-body text-[13px] leading-snug text-ink">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
