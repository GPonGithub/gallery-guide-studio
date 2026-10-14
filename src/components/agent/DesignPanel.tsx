'use client';

import { useEffect, useState } from 'react';
import { boardToFlow, flowToBoard, type ReadTable } from '@/lib/agent/cards';
import type { AgentFlow } from '@/lib/agent/types';
import { validateFlow } from '@/lib/agent/validate';
import { buttonOutline, buttonPrimary, fieldInput, fieldLabel } from '@/lib/styles';

// Brief → flow (Claude) → FigJam board (drawn by the plugin) → edit there →
// import back → test in the chat. Figma's web API can't draw on a board,
// so drawing and reading both go through the FigJam plugin, which polls
// this app for jobs while its panel is open (see figmaJobStore.ts).

const PLUGIN_TIMEOUT_MS = 90_000;
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

const BRIEF_PLACEHOLDER =
  'e.g. A voice guide at the entrance of a science museum. It welcomes visitors, asks what they are curious about ' +
  '(space, dinosaurs or the human body), recommends the matching gallery, asks if they want the audio tour, and ' +
  'says goodbye. Each gallery choice should trigger its video on the big screen.';

export function DesignPanel({
  flow,
  brief,
  boardUrl,
  anthropicApiKey,
  onBriefChange,
  onBoardUrlChange,
  onFlowLoaded,
  onNeedKey,
}: {
  flow: AgentFlow;
  brief: string;
  boardUrl: string;
  anthropicApiKey: string;
  onBriefChange: (brief: string) => void;
  onBoardUrlChange: (url: string) => void;
  onFlowLoaded: (flow: AgentFlow) => void;
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

  const generate = async () => {
    if (!anthropicApiKey.trim()) {
      onNeedKey();
      return;
    }
    if (!replaceOk()) return;
    setBusy('generate');
    setActivity(['Designing the flow from your brief — this takes about a minute…']);
    setProblems([]);
    let generated: AgentFlow | null = null;
    try {
      const res = await fetch('/api/agent/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief, anthropicApiKey }),
      });
      const data = (await res.json()) as { flow: AgentFlow; problems: string[] } | { error: string };
      if ('error' in data) throw new Error(data.error);
      generated = { ...data.flow, tdUrl: flow.tdUrl };
      onFlowLoaded(generated);
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
      const { flow: imported, warnings } = boardToFlow(tables ?? [], { tdUrl: flow.tdUrl });
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
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-2">
        <p className={fieldLabel}>1 · Describe the conversation</p>
        <p className="font-body text-xs italic text-muted-ink">
          Who the agent is, who it talks to, and what should be achieved, in plain English. Claude turns it into stages
          with goals.
        </p>
        <textarea
          value={brief}
          onChange={(e) => onBriefChange(e.target.value)}
          placeholder={BRIEF_PLACEHOLDER}
          className={`min-h-[160px] w-full resize-y leading-snug ${fieldInput}`}
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
        <button onClick={generate} disabled={busy !== null || !brief.trim()} className={`self-start ${buttonPrimary}`}>
          {busy === 'generate' ? 'Designing…' : 'Generate flow'}
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <p className={fieldLabel}>2 · FigJam board</p>
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
      </section>

      <section className="flex flex-col gap-2">
        <p className={fieldLabel}>3 · Bring your edits back</p>
        <p className="font-body text-xs italic text-muted-ink">
          After editing the cards in FigJam, import them. The board replaces the flow in the app.
        </p>
        <button onClick={importBoard} disabled={busy !== null} className={`self-start ${buttonPrimary}`}>
          {busy === 'import' ? 'Importing…' : 'Import from FigJam'}
        </button>
      </section>

      {(activity.length > 0 || problems.length > 0) && (
        <section className="flex flex-col gap-2 border-t-2 border-ink pt-3">
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
