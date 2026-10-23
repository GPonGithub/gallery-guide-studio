'use client';

import { useState } from 'react';
import { buttonOutline, fieldInput } from '@/lib/styles';
import { send, useTDStatus } from '@/lib/agent/touchDesigner';

const SCRIPT_URL = '/touchdesigner/projector_output.py';

const small = buttonOutline.replace('px-4 py-2', 'px-2.5 py-1.5');

/**
 * Adding Immersive Media, section 5: which projector is which. TouchDesigner's
 * projector windows (projector_output.py) each show one part of the picture;
 * with their numbers up, the student says what number each projector in the
 * room is showing, and TouchDesigner swaps their screens so each shows its own.
 */
export function ProjectorsPanel() {
  const status = useTDStatus();
  const connected = status.state === 'connected';
  const projectors = connected ? status.projectors : undefined;
  const count = projectors?.count ?? 0;
  // shows[r - 1]: the number projector r (as labelled in the room) is showing now.
  const [shows, setShows] = useState<number[]>([]);
  const current = Array.from({ length: count }, (_, i) => shows[i] ?? i + 1);
  const repeated = current.filter((n, i) => current.indexOf(n) !== i);
  const changed = current.some((n, i) => n !== i + 1);

  const apply = () => {
    if (send({ type: 'projectors', action: 'assign', shows: current })) setShows([]);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-xs italic text-muted-ink">
        Each projector shows one part of the picture. Check that every projector in the room gets the part meant for
        it — its own number — and swap them here if not. Nothing in the room or the computer&rsquo;s display settings
        needs moving.
      </p>
      <ol className="ml-4 list-decimal font-body text-xs text-ink">
        <li>
          Connect TouchDesigner (4 · TouchDesigner). If it has no projector windows yet,{' '}
          <a href={SCRIPT_URL} download className="underline underline-offset-2">
            download projector_output.py
          </a>{' '}
          and run it in the Textport like the build script: it opens a full-screen window on each projector.
        </li>
        <li>
          Click <b>Show numbers</b>. Each projector shows &ldquo;PROJECTOR&nbsp;1&rdquo;, &ldquo;PROJECTOR&nbsp;2&rdquo;…
        </li>
        <li>
          For each projector in the room (by the number it&rsquo;s labelled with), choose the number it&rsquo;s showing,
          then click <b>Apply</b>. Every projector should now show its own number.
        </li>
        <li>
          Click <b>Hide numbers</b> and save the TouchDesigner project, so it remembers.
        </li>
      </ol>

      {!connected ? (
        <p className="font-body text-xs italic text-muted-ink">Connect TouchDesigner first (4 · TouchDesigner).</p>
      ) : projectors === null ? (
        <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">
          TouchDesigner has no projector windows. Run projector_output.py (step 1), then{' '}
          <button
            onClick={() => send({ type: 'projectors', action: 'status' })}
            className="underline underline-offset-2"
          >
            check again
          </button>
          .
        </p>
      ) : projectors === undefined ? (
        <p className="font-body text-xs italic text-muted-ink">
          Asking TouchDesigner about its projectors…{' '}
          <button
            onClick={() => send({ type: 'projectors', action: 'status' })}
            className="underline underline-offset-2"
          >
            Ask again
          </button>
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => send({ type: 'projectors', action: 'identify', on: !projectors.identify })}
              className={`${small} w-[130px]`}
            >
              {projectors.identify ? 'Hide numbers' : 'Show numbers'}
            </button>
            <button
              onClick={() => send({ type: 'projectors', action: projectors.open ? 'close' : 'open' })}
              className={small}
              title="The full-screen window on each projector"
            >
              {projectors.open ? 'Close projector windows' : 'Open projector windows'}
            </button>
            <span className="font-body text-xs text-muted-ink">
              {count} projector{count === 1 ? '' : 's'} · {projectors.open ? `${projectors.open} open` : 'windows closed'}
            </span>
          </div>

          <fieldset className="flex flex-col gap-2 border border-hair p-2">
            <legend className="px-1 font-label text-[10px] uppercase tracking-wide text-muted-ink">
              What each projector shows
            </legend>
            <div className="grid grid-cols-[auto_auto] items-center justify-start gap-x-2 gap-y-1.5">
              {current.map((n, i) => (
                <label key={i} className="contents font-body text-xs text-ink">
                  <span>Projector {i + 1} shows</span>
                  <select
                    value={n}
                    onChange={(e) => {
                      const next = [...current];
                      next[i] = Number(e.target.value);
                      setShows(next);
                    }}
                    aria-label={`Number projector ${i + 1} shows`}
                    className={`${fieldInput} ${repeated.includes(n) ? 'border-[#b91c1c]' : ''}`}
                  >
                    {current.map((_, k) => (
                      <option key={k} value={k + 1}>
                        PROJECTOR {k + 1}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            {repeated.length > 0 && (
              <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">
                Each number shows on one projector only — check the ones marked.
              </p>
            )}
            <div className="flex flex-wrap items-center gap-1.5">
              <button onClick={apply} disabled={!changed || repeated.length > 0} className={small}>
                Apply
              </button>
              {changed && (
                <button onClick={() => setShows([])} className={small}>
                  Reset
                </button>
              )}
            </div>
          </fieldset>
        </>
      )}

      {connected && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              onClick={() => send({ type: 'kantan', action: 'open' })}
              className={small}
              title="Opens Kantan Mapper's editor in TouchDesigner, ready to drag shapes and corners"
            >
              Open Kantan Mapper
            </button>
            <button onClick={() => send({ type: 'kantan', action: 'close' })} className={small}>
              Close
            </button>
          </div>
          <p className="font-body text-xs italic text-muted-ink">
            To fit a shape to the wall, open Kantan Mapper (it opens on TouchDesigner&rsquo;s computer) and drag the
            shape or its corners — the projectors follow as you drag. Save the TouchDesigner project when you&rsquo;re
            done.
          </p>
        </div>
      )}

      {connected && status.last && (
        <p
          className={`font-body text-xs ${status.last.ok ? 'text-muted-ink' : 'border-l-4 border-[#b91c1c] pl-2 text-ink'}`}
        >
          TouchDesigner: {status.last.text}
        </p>
      )}
    </div>
  );
}
