'use client';

import { useEffect, useRef, useState } from 'react';
import { replayMarker } from '@/lib/agent/markerPlay';
import { timelineOf, useMediaLinks, useSceneActions } from '@/lib/agent/mediaFolder';
import { applySceneCopy, planSceneCopy, type CopyMode, type CopyPlan, type CopyScene } from '@/lib/agent/sceneCopy';

type SceneItem = { id: string; number: string; name: string; sheetId: string; stages: string[] };

/**
 * Copy media from… — the timeline's button for bringing another scene's media (pictures, film, sounds,
 * chatbots, bars and all) into the open scene: pick the scene, Replace or Add, see what will happen, Copy.
 * One undo step (⌘Z). See sceneCopy.ts for how files, stages and actions are matched.
 */
export function SceneCopy({
  scene,
  stages,
  scenes,
}: {
  /** The open scene (the one copied into). */
  scene: { sheetId: string; number: string };
  /** Its stages, in order. */
  stages: string[];
  /** The team's scenes from the sheet. */
  scenes: SceneItem[];
}) {
  const [open, setOpen] = useState(false);
  const [fromId, setFromId] = useState<string | null>(null);
  const [mode, setMode] = useState<CopyMode>('replace');
  const [plan, setPlan] = useState<CopyPlan | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const links = useMediaLinks();
  const actions = useSceneActions();
  const box = useRef<HTMLDivElement>(null);

  const here = scenes.find((s) => s.sheetId === scene.sheetId && s.number === scene.number);
  const to: CopyScene = { sheetId: scene.sheetId, number: scene.number, name: here?.name ?? '', stages };
  const others = scenes.filter((s) => s !== here && s.sheetId === scene.sheetId);
  const count = (s: { sheetId: string; number: string }) => timelineOf(links, s).length;
  const from = others.find((s) => s.id === fromId) ?? null;
  const fromScene: CopyScene | null = from && { sheetId: from.sheetId, number: from.number, name: from.name, stages: from.stages };
  const actionList = actions && actions.key === `${scene.sheetId}:${scene.number}` ? actions.list : null;

  // What the copy will do, worked out again whenever the choice (or the media) changes.
  const planKey = JSON.stringify([fromId, mode, stages, actionList, open]);
  useEffect(() => {
    if (!open || !fromScene) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clears the preview when nothing is chosen
      setPlan(null);
      return;
    }
    let gone = false;
    planSceneCopy(fromScene, to, mode, actionList)
      .then((p) => !gone && setPlan(p))
      .catch((err: unknown) => !gone && setProblem(err instanceof Error ? err.message : 'Couldn’t read that scene’s media.'));
    return () => {
      gone = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- planKey stands for the choice; links: see below
  }, [planKey, links]);

  // Escape, or a press outside, closes it.
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const press = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('pointerdown', press);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('pointerdown', press);
    };
  }, [open]);

  const copy = async () => {
    if (!plan || !fromScene) return;
    setWorking(true);
    setProblem(null);
    try {
      await applySceneCopy(plan, fromScene, to, mode);
      setOpen(false);
      setFromId(null);
      // The room shows the stage the marker is on, copied media and all.
      setTimeout(() => void replayMarker(), 300);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'Couldn’t copy the media.');
    } finally {
      setWorking(false);
    }
  };

  const ownCount = count(scene);
  return (
    // Above the timeline's pinned ruler (z-50) and its corner (z-[55]), which hid the panel's top — scene 1.
    <div ref={box} className="relative z-[70] shrink-0">
      <button
        onClick={() => {
          setOpen((o) => !o);
          setProblem(null);
        }}
        aria-expanded={open}
        title="Bring another scene’s pictures, film and sounds into this scene"
        className={`border border-ink px-1.5 py-0.5 font-label text-[10px] uppercase tracking-wide transition-colors ${
          open ? 'bg-ink text-paper' : 'bg-paper text-ink hover:bg-ink/10'
        }`}
      >
        Copy media from…
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Copy media from another scene"
          className="absolute left-0 top-full z-[70] mt-1 w-[360px] border-2 border-ink bg-paper p-3 font-body text-xs text-ink shadow-lg"
        >
          <p className="mb-2 font-label text-[10px] uppercase tracking-widest text-muted-ink">
            Into scene {scene.number}
            {here?.name ? ` · ${here.name}` : ''}, from:
          </p>
          {others.length === 0 ? (
            <p className="italic text-muted-ink">No other scenes from this sheet yet.</p>
          ) : (
            <ul className="mb-3 max-h-48 overflow-y-auto border border-hair">
              {others.map((s) => {
                const n = count(s);
                return (
                  <li key={s.id}>
                    <label
                      className={`flex items-center gap-2 border-b border-hair px-2 py-1 last:border-b-0 ${
                        n ? 'cursor-pointer hover:bg-ink/5' : 'opacity-50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="copy-from"
                        disabled={!n}
                        checked={fromId === s.id}
                        onChange={() => setFromId(s.id)}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        Scene {s.number} · {s.name}
                      </span>
                      <span className="shrink-0 text-muted-ink">{n ? `${n} item${n === 1 ? '' : 's'}` : 'no media'}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          <fieldset className="mb-3 flex flex-col gap-1">
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="copy-mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
              <span>
                <b>Replace</b> this scene&rsquo;s media
                {ownCount ? ` (its ${ownCount} item${ownCount === 1 ? '' : 's'} go)` : ' (it has none yet)'}
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2">
              <input type="radio" name="copy-mode" checked={mode === 'add'} onChange={() => setMode('add')} />
              <span>
                <b>Add</b> to it — this scene&rsquo;s own media stays; copies go on free tracks
              </span>
            </label>
          </fieldset>

          {plan && from && (
            <div className="mb-3 flex flex-col gap-1 border-l-4 border-ink pl-2">
              <p>
                {plan.copied ? (
                  <>
                    Brings {plan.copied} item{plan.copied === 1 ? '' : 's'} from scene {from.number}
                    {plan.newFiles ? ` (${plan.newFiles} new to this scene’s Media Library)` : ''}.
                  </>
                ) : (
                  <>Nothing from scene {from.number} can come across.</>
                )}
                {plan.replaced ? ` This scene’s ${plan.replaced} item${plan.replaced === 1 ? '' : 's'} go.` : ''}
              </p>
              {plan.stagesMatched && (
                <p className="text-muted-ink">
                  The two scenes&rsquo; stages differ: bars are matched by position (first to first, last to last).
                </p>
              )}
              {plan.folder && (
                <p className="text-muted-ink">This scene gets scene {from.number}&rsquo;s media folder, “{plan.folder.name}”.</p>
              )}
              {plan.folderWarning && <p className="border-l-4 border-[#b91c1c] pl-2">{plan.folderWarning}</p>}
              {plan.left.length > 0 && (
                <details>
                  <summary className="cursor-pointer">
                    {plan.left.length} not copied
                  </summary>
                  <ul className="mt-1 list-disc pl-4 text-muted-ink">
                    {plan.left.map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {problem && <p className="mb-2 border-l-4 border-[#b91c1c] pl-2">{problem}</p>}

          <div className="flex justify-end gap-2">
            <button
              onClick={() => setOpen(false)}
              className="border border-ink bg-paper px-3 py-1 font-label text-[10px] uppercase tracking-wide hover:bg-ink/10"
            >
              Cancel
            </button>
            <button
              onClick={() => void copy()}
              disabled={!plan || !plan.copied || working}
              title="One step: ⌘Z undoes it"
              className="border border-ink bg-ink px-3 py-1 font-label text-[10px] uppercase tracking-wide text-paper disabled:opacity-40"
            >
              {working ? 'Copying…' : mode === 'replace' ? 'Replace' : 'Add'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
