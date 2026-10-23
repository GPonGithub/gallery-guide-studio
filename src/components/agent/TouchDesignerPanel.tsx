'use client';

import { useState } from 'react';
import { buttonOutline, fieldInput } from '@/lib/styles';
import type { MediaAsset } from '@/lib/agent/media';
import {
  send,
  setTDSettings,
  showProjections,
  useTDSettings,
  useTDStatus,
  visualMessage,
  type SoundsOn,
} from '@/lib/agent/touchDesigner';

const SCRIPT_URL = '/touchdesigner/build_immersive_lab.py';
const AREAS = Array.from({ length: 11 }, (_, i) => i + 1);
const SOUNDS_ON: { value: SoundsOn; label: string; hint: string }[] = [
  { value: 'computer', label: 'This computer', hint: 'Sounds play through this computer’s speakers only' },
  {
    value: 'touchdesigner',
    label: 'TouchDesigner',
    hint: 'Sounds play in TouchDesigner only (here too while it isn’t connected)',
  },
  { value: 'both', label: 'Both', hint: 'Sounds play here and in TouchDesigner' },
];

const small = buttonOutline.replace('px-4 py-2', 'px-2.5 py-1.5');

/**
 * Adding Immersive Media, section 3: the live link to TouchDesigner (see
 * lib/agent/touchDesigner.ts) — how to set it up, its address and status,
 * where sounds play, and a test panel that sends messages by hand.
 */
export function TouchDesignerPanel({ assets }: { assets: MediaAsset[] }) {
  const settings = useTDSettings();
  const status = useTDStatus();
  const [address, setAddress] = useState(settings.address);
  const present = assets.filter((a) => a.status === 'present');
  const visuals = present.filter((a) => a.kind !== 'sound');
  const sounds = present.filter((a) => a.kind === 'sound');
  const [area, setArea] = useState(1);
  const [visualId, setVisualId] = useState('');
  const [soundId, setSoundId] = useState('');
  const [loop, setLoop] = useState(true);
  const visual = visuals.find((a) => a.id === visualId) ?? visuals[0];
  const sound = sounds.find((a) => a.id === soundId) ?? sounds[0];
  const connected = status.state === 'connected';

  const light =
    status.state === 'connected'
      ? { color: '#15803d', text: 'Connected' }
      : status.state === 'connecting'
        ? { color: '#b45309', text: 'Connecting…' }
        : status.state === 'closed'
          ? { color: '#b91c1c', text: 'Not connected — is TouchDesigner open, with immersive_lab built? Trying again…' }
          : { color: '#a3a3a3', text: 'Off' };

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-xs italic text-muted-ink">
        TouchDesigner shows what the room drawing shows — each picture or video in its projection area (1–11) — and, if
        you choose, plays the sounds.
      </p>
      <ol className="ml-4 list-decimal font-body text-xs text-ink">
        <li>
          <a href={SCRIPT_URL} download className="underline underline-offset-2">
            Download the build script
          </a>{' '}
          and keep it beside your TouchDesigner project.
        </li>
        <li>
          In TouchDesigner open the Textport (Alt+T) and run{' '}
          <code className="break-all bg-muted px-1">
            exec(open(&apos;/path/to/build_immersive_lab.py&apos;).read())
          </code>{' '}
          with the script&rsquo;s path. It makes <b>immersive_lab</b>: outputs <b>area1–area11</b>, audio, and the
          tables message_guide, message_log, now_playing and media_list.
        </li>
        <li>
          Set immersive_lab&rsquo;s <b>Media Folder</b> parameter to your media folder, then connect below.
        </li>
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onBlur={() => address.trim() !== settings.address && setTDSettings({ address: address.trim() })}
          aria-label="TouchDesigner address"
          className={`${fieldInput} w-[200px]`}
        />
        <button
          onClick={() => setTDSettings({ on: !settings.on, address: address.trim() })}
          className={`${small} w-[110px]`}
        >
          {settings.on ? 'Disconnect' : 'Connect'}
        </button>
        <button
          onClick={() => void showProjections(address.trim())}
          className={small}
          title="Connects to TouchDesigner if needed (showing the timeline marker's stage) and opens a full-screen window on each projector (numbers off)"
        >
          Show projections
        </button>
      </div>
      {status.projectors === null && connected && (
        <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">
          TouchDesigner has no projector windows yet — run projector_output.py (5 · Set up the projectors).
        </p>
      )}
      <p className="flex items-start gap-2 font-body text-xs text-ink" role="status">
        <span className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: light.color }} />
        <span>
          {light.text}
          {connected && status.mediaFolder !== undefined && (
            <span className={status.folderFound ? 'text-muted-ink' : 'text-[#b91c1c]'}>
              {' · '}
              {status.folderFound
                ? `media folder: ${status.mediaFolder}`
                : `media folder not found: “${status.mediaFolder}”`}
            </span>
          )}
        </span>
      </p>

      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Sounds play on">
        <span className="mr-1 font-label text-[10px] uppercase tracking-wide text-muted-ink">Sounds play on</span>
        {SOUNDS_ON.map((o) => (
          <button
            key={o.value}
            onClick={() => setTDSettings({ sounds: o.value })}
            aria-pressed={settings.sounds === o.value}
            title={o.hint}
            className={`${small} ${settings.sounds === o.value ? 'border-4 px-2 py-1' : ''}`}
          >
            {o.label}
          </button>
        ))}
      </div>

      <fieldset className="flex flex-col gap-2 border border-hair p-2" disabled={!connected}>
        <legend className="px-1 font-label text-[10px] uppercase tracking-wide text-muted-ink">
          Test TouchDesigner{!connected && ' (connect first)'}
        </legend>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={area}
            onChange={(e) => setArea(Number(e.target.value))}
            aria-label="Area"
            className={fieldInput}
          >
            {AREAS.map((a) => (
              <option key={a} value={a}>
                Area {a}
              </option>
            ))}
          </select>
          <select
            value={visual?.id ?? ''}
            onChange={(e) => setVisualId(e.target.value)}
            aria-label="Picture or video"
            className={`${fieldInput} min-w-0 flex-1`}
          >
            {visuals.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => visual && send(visualMessage(area, visual, loop))}
            disabled={!visual}
            className={small}
          >
            ▶ Show in area {area}
          </button>
          <button onClick={() => send({ type: 'media', action: 'hide', area })} className={small}>
            Hide area {area}
          </button>
          <label className="flex items-center gap-1 font-body text-xs text-ink">
            <input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop video
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            value={sound?.id ?? ''}
            onChange={(e) => setSoundId(e.target.value)}
            aria-label="Sound"
            className={`${fieldInput} min-w-0 flex-1`}
          >
            {sounds.map((a) => (
              <option key={a.id} value={a.id}>
                {a.id} · {a.name}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              sound && send({ type: 'sound', action: 'play', id: sound.id, path: sound.path, loop: false })
            }
            disabled={!sound}
            className={small}
          >
            ♪ Play
          </button>
          <button
            onClick={() => sound && send({ type: 'sound', action: 'stop', id: sound.id })}
            disabled={!sound}
            className={small}
          >
            ■ Stop
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => send({ type: 'levels', gain: 0.3, ms: 400 })}
            className={small}
            title="As when the chatbot talks"
          >
            Dip sounds
          </button>
          <button onClick={() => send({ type: 'levels', gain: 1, ms: 1200 })} className={small}>
            Full volume
          </button>
          <button onClick={() => send({ type: 'clear' })} className={small}>
            Clear all
          </button>
        </div>
        {status.last && (
          <p
            className={`font-body text-xs ${status.last.ok ? 'text-muted-ink' : 'border-l-4 border-[#b91c1c] pl-2 text-ink'}`}
          >
            TouchDesigner: {status.last.text}
          </p>
        )}
      </fieldset>
    </div>
  );
}
