'use client';

import { useEffect, useState } from 'react';
import { boardToFlow, flowToBoard, type ReadTable } from '@/lib/agent/cards';
import type { AgentFlow } from '@/lib/agent/types';
import { validateFlow } from '@/lib/agent/validate';
import { buttonDone, buttonOutline, buttonPrimary, buttonUnsaved, fieldInput, fieldLabel } from '@/lib/styles';
import { CollapsiblePanel } from './CollapsiblePanel';

// Brief → flow (Claude) → FigJam board (drawn by the plugin) → edit there →
// import back → test in the chat. Figma's web API can't draw on a board,
// so drawing and reading both go through the FigJam plugin, which polls
// this app for jobs while its panel is open (see figmaJobStore.ts).

const PLUGIN_TIMEOUT_MS = 90_000;

// The fields students write themselves (the brief and the knowledge base)
// get a light yellow fill, so it's obvious where their input goes.
const studentField = fieldInput.replace('bg-paper', 'bg-[#fff6cc]');
const POLL_MS = 1500;

type Job = { status: 'pending' | 'running' | 'done' | 'error'; log: string[]; result?: unknown };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runPluginJob(kind: 'draw-agent-flow' | 'read-agent-flow', payload: unknown, onStatus: (s: string) => void) {
  const created = await fetch('/api/figma-jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, payload }),
  });
  const { id } = (await created.json()) as { id: string };
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

const BRIEF_PLACEHOLDER =
  'e.g. A voice guide at the entrance of a science museum. It welcomes visitors, asks what they are curious about ' +
  '(space, dinosaurs or the human body), recommends the matching gallery, asks if they want the audio tour, and ' +
  'says goodbye. Each gallery choice should trigger its video on the big screen.';

export function DesignPanel({
  flow,
  brief,
  generatedBrief,
  onGenerated,
  boardUrl,
  anthropicApiKey,
  onBriefChange,
  onBoardUrlChange,
  onFlowLoaded,
  onKnowledgeChange,
  onNeedKey,
}: {
  flow: AgentFlow;
  brief: string;
  /** The description the current flow was generated from (null = never generated). */
  generatedBrief: string | null;
  /** A flow was generated from `brief` (as it was when generation started). */
  onGenerated: (brief: string) => void;
  boardUrl: string;
  anthropicApiKey: string;
  onBriefChange: (brief: string) => void;
  onBoardUrlChange: (url: string) => void;
  onFlowLoaded: (flow: AgentFlow) => void;
  onKnowledgeChange: (knowledge: string) => void;
  onNeedKey: () => void;
}) {
  const [busy, setBusy] = useState<null | 'generate' | 'draw' | 'import'>(null);
  const [activity, setActivity] = useState<string[]>([]);
  const [problems, setProblems] = useState<string[]>([]);
  const [drawAfterGenerate, setDrawAfterGenerate] = useState(true);

  // null = not checked yet; the plugin polls every ~4s while open.
  const [pluginSeenAgo, setPluginSeenAgo] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch('/api/figma-jobs?status=1', { cache: 'no-store' });
        const data = (await res.json()) as { pluginLastSeenMsAgo: number | null };
        if (!cancelled) setPluginSeenAgo(data.pluginLastSeenMsAgo);
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

  const say = (line: string) => setActivity((a) => [...a, line]);
  const hasFlow = flow.stages.length > 0;
  const boardLooksValid = /figma\.com\/(board|file)\//.test(boardUrl);

  const replaceOk = () => !hasFlow || window.confirm('Replace the current flow in the app with this one?');

  const draw = async (target: AgentFlow) => {
    setBusy('draw');
    say('Sending the flow to the FigJam plugin…');
    try {
      await runPluginJob('draw-agent-flow', flowToBoard(target), say);
      say('✓ Drawn on the board. Edit it there, then Import from FigJam.');
    } catch (err) {
      say(`✗ ${err instanceof Error ? err.message : 'Drawing failed.'}`);
    } finally {
      setBusy(null);
    }
  };

  // The flow is up to date with the description when it was last generated from exactly this text.
  const upToDate = busy !== 'generate' && generatedBrief !== null && brief.trim() !== '' && brief.trim() === generatedBrief.trim();

  const generate = async () => {
    if (!anthropicApiKey.trim()) {
      onNeedKey();
      return;
    }
    if (!replaceOk()) return;
    // The description as sent — if it's edited while this runs, the button goes back to red.
    const usedBrief = brief;
    setBusy('generate');
    setActivity(['Designing the flow from your brief — this takes about a minute…']);
    setProblems([]);
    let generated: AgentFlow | null = null;
    try {
      const res = await fetch('/api/agent/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, anthropicApiKey, knowledge: flow.knowledge ?? '' }),
      });
      const data = (await res.json()) as { flow: AgentFlow; problems: string[] } | { error: string };
      if ('error' in data) throw new Error(data.error);
      // Keep what isn't part of the design: the TD address and the knowledge base.
      generated = { ...data.flow, tdUrl: flow.tdUrl, tdTiming: flow.tdTiming, knowledge: flow.knowledge ?? '' };
      onFlowLoaded(generated);
      onGenerated(usedBrief);
      setProblems(data.problems);
      say(`✓ Designed ${generated.stages.length} stages — they're in the editor tabs above.`);
    } catch (err) {
      say(`✗ ${err instanceof Error ? err.message : 'Generation failed.'}`);
    }
    setBusy(null);
    if (generated && drawAfterGenerate) await draw(generated);
  };

  const importBoard = async () => {
    setBusy('import');
    setActivity(['Asking the FigJam plugin to read the board…']);
    setProblems([]);
    try {
      const tables = (await runPluginJob('read-agent-flow', null, say)) as ReadTable[] | undefined;
      const { flow: imported, warnings } = boardToFlow(tables ?? [], {
        tdUrl: flow.tdUrl,
        tdTiming: flow.tdTiming,
        knowledge: flow.knowledge ?? '',
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
      <CollapsiblePanel title="1 · FigJam board">
        <input
          value={boardUrl}
          onChange={(e) => onBoardUrlChange(e.target.value.trim())}
          placeholder="Paste the board link — figma.com/board/…"
          className={`w-full font-label text-[12px] ${fieldInput}`}
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => window.open(boardUrl, '_blank', 'noopener')}
            disabled={!boardLooksValid}
            className={buttonOutline}
          >
            View in FigJam
          </button>
          <button
            onClick={() => window.confirm('Draw the current flow on the board? This replaces any flow the plugin drew there before (your other board content is left alone).') && draw(flow)}
            disabled={busy !== null || !hasFlow}
            className={buttonOutline}
          >
            {busy === 'draw' ? 'Drawing…' : 'Draw in FigJam'}
          </button>
        </div>
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
        <details className="font-body text-xs text-ink" open={pluginSeenAgo !== undefined && !pluginListening}>
          <summary className="cursor-pointer font-label text-[10px] uppercase tracking-wide text-muted-ink">
            First time? Set up the plugin
          </summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 leading-snug">
            <li>Open the board in the <b>Figma desktop app</b> (plugins in development don’t run in the browser).</li>
            <li>
              Only once: <b>Plugins → Development → Import plugin from manifest…</b> and choose{' '}
              <code>figjam-plugin/manifest.json</code> in this project.
            </li>
            <li>
              Run <b>Plugins → Development → Gallery Guide Studio — Playbook Builder</b> and leave its panel open with{' '}
              <b>Listen for requests</b> ticked.
            </li>
            <li>The app must be running at localhost:3000 on the same computer.</li>
          </ol>
        </details>
      </CollapsiblePanel>

      <CollapsiblePanel title="2 · Describe the conversation">
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
        <label className="flex items-center gap-1.5 font-label text-[10px] uppercase tracking-wide text-muted-ink">
          <input
            type="checkbox"
            checked={drawAfterGenerate}
            onChange={(e) => setDrawAfterGenerate(e.target.checked)}
            className="accent-ink"
          />
          Draw it on my FigJam board afterwards
        </label>
        {/* Red until the flow comes from the description as it reads now; green once it does. */}
        <button
          onClick={() => {
            if (upToDate && !window.confirm('This description has already been generated. Generate a new version of the flow from it anyway?')) return;
            void generate();
          }}
          disabled={busy !== null || !brief.trim()}
          aria-disabled={upToDate || undefined}
          className={`self-start disabled:cursor-not-allowed disabled:opacity-60 ${upToDate ? buttonDone : buttonUnsaved}`}
          title={
            upToDate
              ? 'The flow was generated from this description. Edit the description to generate again.'
              : 'Design the conversation flow from this description'
          }
        >
          {busy === 'generate' ? 'Generating…' : upToDate ? 'Conversation Generated' : 'Generate New Conversation'}
        </button>
      </CollapsiblePanel>

      <CollapsiblePanel title="3 · Knowledge base — facts the bot can use">
        <p className="font-body text-xs italic text-muted-ink">
          Everything the bot should know but not invent: names, times, prices, options. It answers questions and
          offers choices from this, and says when something isn&rsquo;t covered. Drawn on the board as a KNOWLEDGE card;
          importing a board with one replaces this (without one, this is kept). Generating a flow never changes it.
        </p>
        <textarea
          value={flow.knowledge ?? ''}
          onChange={(e) => onKnowledgeChange(e.target.value)}
          placeholder={KNOWLEDGE_PLACEHOLDER}
          className={`min-h-[200px] w-full resize-y font-body text-[13px] leading-snug ${studentField}`}
        />
        <KnowledgeSize text={flow.knowledge ?? ''} />
      </CollapsiblePanel>

      <CollapsiblePanel title="4 · Bring your edits back">
        <p className="font-body text-xs italic text-muted-ink">
          After editing the cards in FigJam, import them. The board replaces the flow in the app.
        </p>
        <button onClick={importBoard} disabled={busy !== null} className={`self-start ${buttonPrimary}`}>
          {busy === 'import' ? 'Importing…' : 'Import from FigJam'}
        </button>
      </CollapsiblePanel>

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
