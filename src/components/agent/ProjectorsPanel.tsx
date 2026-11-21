'use client';

import { useEffect } from 'react';
import { buttonOutline } from '@/lib/styles';
import { setSceneLabelOn, useSceneLabelOn } from '@/lib/agent/sceneLabel';
import { send, useTDStatus } from '@/lib/agent/touchDesigner';
import { useZone } from '@/lib/agent/zones';

const SCRIPT_URL = '/touchdesigner/projector_output.py';

const small = buttonOutline.replace('px-4 py-2', 'px-2.5 py-1.5');

/**
 * Adding Immersive Media, section 5: TouchDesigner's projector windows (projector_output.py), their
 * ID numbers, and the Kantan Mapper for fitting shapes to the walls. (The per-projector "what each
 * projector shows" switches were taken out on 2026-11-21: swapping screens from here never worked;
 * Claude/TouchDesigner/fix_projector_screens_auto.py on the lab Mac does that job.)
 */
export function ProjectorsPanel() {
  const status = useTDStatus();
  const connected = status.state === 'connected';
  const projectors = connected ? status.projectors : undefined;
  const count = projectors?.count ?? 0;
  // The scene label on zone 1 · area 2 (the same switch as 4 · TouchDesigner's button; see sceneLabel.ts).
  const labelOn = useSceneLabelOn();
  // The zone whose drawing is open (the Zone 1 / 2 / 3 buttons): zones 1 and 3 are on projectors 5 and 6,
  // mapped by their own Kantan Mapper ('p56').
  const zone = useZone();
  const p56 = zone !== 2;
  // Ask again each time this step opens: projectors may have been added since connecting (5 and 6 on 2026-11-09).
  useEffect(() => {
    if (connected) send({ type: 'projectors', action: 'status' });
  }, [connected]);
  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-xs italic text-muted-ink">
        Each projector shows one part of the picture. Open the projector windows and show their IDs to check that
        every projector in the room shows its own number.
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
          Click <b>Show projector IDs</b>. Each projector shows &ldquo;PROJECTOR&nbsp;1&rdquo;, &ldquo;PROJECTOR&nbsp;2&rdquo;…
        </li>
        <li>
          Click <b>Hide projector IDs</b> when you&rsquo;re done.
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
          {/* items-stretch: the buttons in the row are all as tall as the tallest. */}
          <div className="flex flex-wrap items-stretch gap-1.5">
            <button
              onClick={() => send({ type: 'projectors', action: 'identify', on: !projectors.identify })}
              className={`${small} w-[150px]`}
              title="PROJECTOR 1, 2… on each projector, for matching them to the room"
            >
              {projectors.identify ? 'Hide projector IDs' : 'Show projector IDs'}
            </button>
            <button
              onClick={() => send({ type: 'projectors', action: projectors.open ? 'close' : 'open' })}
              className={small}
              title="The full-screen window on each projector"
            >
              {projectors.open ? 'Close projector windows' : 'Open projector windows'}
            </button>
            <span className="self-center font-body text-xs text-muted-ink">
              {count} projector{count === 1 ? '' : 's'} · {projectors.open ? `${projectors.open} open` : 'windows closed'}
            </span>
          </div>

        </>
      )}

      {connected && (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-stretch gap-1.5">
            <button
              onClick={() => {
                // Each zone's projectors have their own Kantan Mapper: the open zone's editor comes up, the other closes.
                send(p56 ? { type: 'kantan', action: 'close' } : { type: 'kantan', action: 'close', mapper: 'p56' });
                send(p56 ? { type: 'kantan', action: 'open', mapper: 'p56' } : { type: 'kantan', action: 'open' });
              }}
              className={small}
              title={
                p56
                  ? `Opens the Kantan Mapper for projectors 5 and 6 (zones 1 and 3) in TouchDesigner, as zone ${zone} is open — choose Zone 2 above for the room's walls`
                  : "Opens the Kantan Mapper for projectors 1 to 4 (zone 2, the room's walls) in TouchDesigner — choose Zone 1 or 3 above for theirs"
              }
            >
              Open Kantan Mapper · Zone {zone}
            </button>
            <button
              onClick={() => send({ type: 'numbers', action: status.areaNumbers === false ? 'show' : 'hide' })}
              disabled={status.areaNumbers === null}
              className={`${small} w-[120px]`}
              title={
                status.areaNumbers === null
                  ? 'No area numbers in TouchDesigner — run area_labels.py'
                  : 'The area number in the corner of each coloured shape'
              }
            >
              {status.areaNumbers === false ? 'Show numbers' : 'Hide numbers'}
            </button>
            <button
              onClick={() => setSceneLabelOn(!labelOn)}
              className={`${small} w-[150px]`}
              title="The label in the top-left corner of zone 1 · area 2: microphone on or off, the scene's number and title, and its stages"
            >
              {labelOn ? 'Hide scene label' : 'Show scene label'}
            </button>
            <button
              onClick={() => {
                send({ type: 'kantan', action: 'close' });
                send({ type: 'kantan', action: 'close', mapper: 'p56' });
              }}
              className={small}
              title="Closes both Kantan Mapper editors"
            >
              Close
            </button>
          </div>
          <p className="font-body text-xs italic text-muted-ink">
            To fit a shape to the wall, open the Kantan Mapper for the zone that&rsquo;s open (it opens on
            TouchDesigner&rsquo;s computer) and drag the
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
