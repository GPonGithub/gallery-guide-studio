'use client';

import { useEffect, useMemo, useState } from 'react';
import { buttonOutline, fieldInput } from '@/lib/styles';
import { isPress } from '@/lib/agent/mqttEvents';
import {
  buttonVolumeOf,
  setButtonReversed,
  setButtonSound,
  setButtonVolume,
  useButtonSounds,
  type ButtonToggle,
} from '@/lib/agent/buttonSounds';
import { MAX_SOUND_VOLUME, playSound } from '@/lib/agent/mediaPlayback';
import type { MediaAsset } from '@/lib/agent/media';

const small = buttonOutline.replace('px-4 py-2', 'px-2.5 py-1.5');
/**
 * The reverse toggle: off, an outline button that only greys on hover (not the usual black, which would look
 * the same as on); on, black with a white icon, hover or not — so a click always shows.
 */
const toggleOff = small.replace('hover:bg-ink hover:text-paper', 'hover:bg-muted hover:text-ink');
const toggleOn = small.replace('bg-paper', 'bg-ink').replace(' text-ink ', ' text-paper ');

type Message = { topic: string; payload: unknown; at: number; retained: boolean };
type Status = { url: string; state: 'connecting' | 'connected' | 'offline' | 'error'; address?: string; error?: string };

/** /cca/r140/<type>/<name>/<what> → its parts (null for anything else). */
function parts(topic: string) {
  const m = /^\/cca\/r140\/([^/]+)\/([^/]+)\/(.+)$/.exec(topic);
  return m ? { type: m[1], name: m[2], what: m[3] } : null;
}

function shortPayload(payload: unknown): string {
  if (payload && typeof payload === 'object') {
    return Object.entries(payload as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
      .join(' · ');
  }
  return String(payload);
}

/** The room's single buttons, sb-01 to sb-10, each with its own colour for the press indicators. */
const SB_BUTTONS = Array.from({ length: 10 }, (_, i) => `sb-${String(i + 1).padStart(2, '0')}`);
const SB_COLORS = ['#e03131', '#f76707', '#f59f00', '#37b24d', '#0ca678', '#1098ad', '#1c7ed6', '#4263eb', '#7048e8', '#d6336c'];
/**
 * The four-button switches. Button n of w4-01 sends {"event":"press"} (or
 * {"event":"double"} for a double press) on /cca/r140/button/w4-01/<n>, seen
 * 2026-11-13; either lights it. The grid shows 1 2 on top, 3 4 below.
 */
const W4_DEVICES = [
  { name: 'w4-01', label: 'W4-01', color: '#1c7ed6' },
  { name: 'w4-02', label: 'W4-02', color: '#e8590c' },
];
const W4_PRESS = /^\/cca\/r140\/button\/(w4-0[12])\/([1-4])$/;

/** Reverse: a sound wave with an arrow under it pointing back, right to left. */
function ReverseIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6v0M4.5 4v4M7 2.5v7M9.5 4.5v3M12 3.5v5M14 5.5v1" />
      <path d="M14 13H3M5.5 10.5 3 13l2.5 2.5" />
    </svg>
  );
}

/** Play: a solid triangle pointing right. */
function PlayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
      <path d="M4.5 2.5v11l9-5.5z" />
    </svg>
  );
}

/** How long an indicator stays lit after a press. */
const LIT_MS = 1500;

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/**
 * Adding Immersive Media, section 7: the room's buttons, dials and sensors,
 * heard through the MQTT broker on the Zigbee Pi (pi02zigbee.local). The app's
 * server holds the connection (lib/mqttBroker.ts); this shows each device's
 * state and every press or turn as it arrives.
 */
export function MqttPanel({ scene, assets }: { scene: string | null; assets: MediaAsset[] }) {
  const [hosted, setHosted] = useState<boolean | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [latest, setLatest] = useState<Record<string, Message>>({});
  const [events, setEvents] = useState<Message[]>([]);
  const [url, setUrl] = useState('');
  // sb-01…sb-10: how many presses, when the last was, and which are lit right now.
  const [presses, setPresses] = useState<Record<string, { count: number; at: number }>>({});
  const [lit, setLit] = useState<Record<string, number>>({});

  // The start button's two sounds for the open scene, from its Media Library.
  const buttonSounds = useButtonSounds(scene);
  const sounds = assets.filter((a) => a.kind === 'sound' && a.status === 'present');
  const [soundNote, setSoundNote] = useState<string | null>(null);
  // A volume slider being moved (saved when let go), per toggle.
  const [moving, setMoving] = useState<Partial<Record<ButtonToggle, number>>>({});
  const volumeOf = (toggle: ButtonToggle) => moving[toggle] ?? buttonVolumeOf(buttonSounds, toggle);
  const saveVolume = (toggle: ButtonToggle) => {
    const v = moving[toggle];
    if (v === undefined || !scene) return;
    void setButtonVolume(scene, toggle, v).then(() => setMoving((m) => ({ ...m, [toggle]: undefined })));
  };
  // A reverse click shows at once (before it's saved and read back).
  const [flipped, setFlipped] = useState<Partial<Record<ButtonToggle, boolean>>>({});
  const reversedOf = (toggle: ButtonToggle) => flipped[toggle] ?? !!buttonSounds.reversed?.[toggle];
  const flip = (toggle: ButtonToggle) => {
    if (!scene) return;
    const on = !reversedOf(toggle);
    setFlipped((f) => ({ ...f, [toggle]: on }));
    void setButtonReversed(scene, toggle, on).finally(() => setFlipped((f) => ({ ...f, [toggle]: undefined })));
  };
  const tryOut = (toggle: ButtonToggle) => {
    const asset = sounds.find((a) => a.id === buttonSounds[toggle]);
    setSoundNote(null);
    if (asset) void playSound(asset, true, volumeOf(toggle), 0, reversedOf(toggle)).catch((err) => setSoundNote(err instanceof Error ? err.message : 'It couldn’t be played.'));
  };

  useEffect(() => {
    fetch('/api/hosting')
      .then((res) => res.json() as Promise<{ hosted: boolean }>)
      .then((data) => setHosted(data.hosted))
      .catch(() => setHosted(false));
  }, []);

  useEffect(() => {
    if (hosted !== false) return;
    const source = new EventSource('/api/mqtt');
    source.addEventListener('snapshot', (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data) as { status: Status; latest: Message[]; recent: Message[] };
      setStatus(data.status);
      setUrl((u) => u || data.status.url);
      setLatest(Object.fromEntries(data.latest.map((m) => [m.topic, m])));
      setEvents(data.recent.filter((m) => !m.retained).reverse());
    });
    source.addEventListener('status', (e) => setStatus(JSON.parse((e as MessageEvent<string>).data) as Status));
    source.addEventListener('message', (e) => {
      const m = JSON.parse((e as MessageEvent<string>).data) as Message;
      setLatest((prev) => ({ ...prev, [m.topic]: m }));
      if (!m.retained) setEvents((prev) => [m, ...prev].slice(0, 30));
      // sb-NN, or w4-0N/<button>: the indicator a press lights.
      const w4 = W4_PRESS.exec(m.topic);
      const pressed =
        SB_BUTTONS.find((name) => isPress(m, name)) ??
        (w4 && !m.retained && ['press', 'double'].includes((m.payload as { event?: string } | null)?.event ?? '') ? `${w4[1]}/${w4[2]}` : undefined);
      if (pressed) {
        setPresses((prev) => ({ ...prev, [pressed]: { count: (prev[pressed]?.count ?? 0) + 1, at: m.at } }));
        // Each press relights it; it goes out LIT_MS after the latest one.
        const stamp = Date.now();
        setLit((prev) => ({ ...prev, [pressed]: stamp }));
        setTimeout(() => setLit((prev) => (prev[pressed] === stamp ? { ...prev, [pressed]: 0 } : prev)), LIT_MS);
      }
    });
    return () => source.close();
  }, [hosted]);

  // One row per device: its availability, battery and latest other message.
  const devices = useMemo(() => {
    const rows = new Map<string, { type: string; name: string; online?: boolean; battery?: number; last?: Message }>();
    for (const m of Object.values(latest)) {
      const p = parts(m.topic);
      if (!p) continue;
      const key = `${p.type}/${p.name}`;
      const row = rows.get(key) ?? { type: p.type, name: p.name };
      const payload = (m.payload ?? {}) as Record<string, unknown>;
      if (p.what === 'availability') row.online = payload.state === 'online';
      else if (p.what === 'battery') row.battery = typeof payload.percent === 'number' ? payload.percent : undefined;
      else if (/^battery-\d+$/.test(p.what)) {
        // Extra battery readings on multi-button devices; always 0, so not shown.
      } else if (!row.last || m.at > row.last.at) row.last = m;
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  }, [latest]);

  if (hosted !== false) {
    return hosted ? (
      <p className="font-body text-xs italic text-muted-ink">The room&rsquo;s buttons and sensors are only heard on the studio computer.</p>
    ) : null;
  }

  const post = (body: object) =>
    fetch('/api/mqtt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then((res) => res.json() as Promise<Status & { error?: string }>)
      .then((s) => s.state && setStatus(s))
      .catch(() => {});

  const light =
    status?.state === 'connected'
      ? { color: '#15803d', text: `Connected${status.address ? ` (${status.address})` : ''}` }
      : status?.state === 'connecting'
        ? { color: '#b45309', text: 'Connecting…' }
        : status?.state === 'error'
          ? { color: '#b91c1c', text: status.error || 'Error' }
          : { color: '#a3a3a3', text: 'Off' };

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-xs italic text-muted-ink">
        The room&rsquo;s Zigbee buttons, dials and sensors report through the MQTT broker on the Zigbee Pi. Press a
        button or turn a dial and it shows up below.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <input
          className={`${fieldInput} min-w-[240px] flex-1`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="mqtt://pi02zigbee.local:1883"
          aria-label="Broker address"
        />
        <button className={small} onClick={() => post({ action: 'connect', url })}>
          Connect
        </button>
        <button className={small} onClick={() => post({ action: 'disconnect' })} disabled={status?.state === 'offline'}>
          Disconnect
        </button>
      </div>
      <p className="flex items-center gap-2 font-body text-xs text-ink">
        <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: light.color }} />
        {light.text}
      </p>

      {/* The start button toggles: a press starts the conversation, the next stops it — each with its own sound. */}
      <div className="flex flex-col gap-2 border border-hair p-2">
        <p className="font-label text-[11px] uppercase tracking-widest text-muted-ink">Start button sounds (sb-03 · W4-01 button 3)</p>
        <p className="font-body text-xs italic text-muted-ink">
          A press starts the conversation; the next press stops it, ready to start again. Each can play a sound
          from this scene&rsquo;s Media Library.
        </p>
        {!scene ? (
          <p className="font-body text-xs italic text-muted-ink">Open a scene from your Google Sheet to choose its sounds.</p>
        ) : (
          ([
            ['start', '1 · Starts the conversation'],
            ['stop', '2 · Stops the conversation'],
          ] as [ButtonToggle, string][]).map(([toggle, label]) => {
            const chosen = buttonSounds[toggle];
            const gone = chosen && !sounds.some((a) => a.id === chosen);
            const volume = volumeOf(toggle);
            const percent = Math.round(volume * 100);
            const reversed = reversedOf(toggle);
            return (
              <div key={toggle} className="flex flex-wrap items-center gap-2">
                <span className="w-48 font-body text-xs text-ink">{label}</span>
                <select
                  className={`${fieldInput} min-w-[200px] flex-1`}
                  value={chosen ?? ''}
                  onChange={(e) => void setButtonSound(scene, toggle, e.target.value || null)}
                  aria-label={`Sound when the start button ${toggle === 'start' ? 'starts' : 'stops'} the conversation`}
                >
                  <option value="">No sound</option>
                  {gone && <option value={chosen}>{chosen} — no longer in the library</option>}
                  {sounds.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.id} · {a.name}
                    </option>
                  ))}
                </select>
                <button
                  className={reversed ? toggleOn : toggleOff}
                  onClick={() => flip(toggle)}
                  aria-pressed={reversed}
                  aria-label={`Play the ${toggle} sound backwards`}
                  title={reversed ? 'Plays backwards — click to play it forwards again' : 'Play it backwards'}
                >
                  <ReverseIcon />
                </button>
                <button
                  className={small}
                  onClick={() => tryOut(toggle)}
                  disabled={!chosen || !!gone}
                  aria-label={`Play the ${toggle} sound here`}
                  title={`Play it here, at this volume${reversed ? ', backwards' : ''}`}
                >
                  <PlayIcon />
                </button>
                <span
                  className="flex items-center gap-1"
                  title={`Volume ${percent}% — from silent to 400% (100% is the file as it is; above that a limiter keeps it from distorting)`}
                >
                  <span className="font-body text-[11px] leading-none" aria-hidden="true">
                    {volume === 0 ? '🔇' : '🔊'}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={MAX_SOUND_VOLUME}
                    step={0.05}
                    value={volume}
                    onChange={(e) => setMoving((m) => ({ ...m, [toggle]: Number(e.target.value) }))}
                    onPointerUp={() => saveVolume(toggle)}
                    onKeyUp={() => saveVolume(toggle)}
                    onBlur={() => saveVolume(toggle)}
                    aria-label={`Volume of the ${toggle} sound`}
                    aria-valuetext={`${percent}%`}
                    className="h-1 w-24 cursor-pointer accent-ink"
                  />
                  <span className="w-9 text-right font-body text-[11px] tabular-nums leading-none text-ink">{percent}%</span>
                </span>
              </div>
            );
          })
        )}
        {scene && sounds.length === 0 && (
          <p className="font-body text-xs italic text-muted-ink">No sounds in this scene&rsquo;s Media Library yet (sections 1–2).</p>
        )}
        {soundNote && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-xs text-ink">{soundNote}</p>}
      </div>

      <div className="flex flex-wrap gap-6">
        {W4_DEVICES.map(({ name, label, color }) => {
          const online = (latest[`/cca/r140/button/${name}/availability`]?.payload as { state?: string } | undefined)?.state;
          return (
            <div key={name} className="flex flex-col items-center gap-1" title={`${label}${online ? ` · ${online}` : ' · not on the broker'}`}>
              <div className="grid grid-cols-2 gap-1" style={{ opacity: online ? 1 : 0.35 }}>
                {[1, 2, 3, 4].map((n) => {
                  const key = `${name}/${n}`;
                  const on = Boolean(lit[key]);
                  const p = presses[key];
                  return (
                    <span
                      key={n}
                      className="flex h-6 w-6 items-center justify-center border-2 font-mono text-[10px] transition-all duration-150"
                      style={{
                        borderColor: color,
                        backgroundColor: on ? color : 'transparent',
                        color: on ? '#fff' : color,
                        boxShadow: on ? `0 0 12px 3px ${color}` : 'none',
                      }}
                      title={`${label} button ${n}${p ? ` · ${p.count} press${p.count === 1 ? '' : 'es'}, last ${time(p.at)}` : ''}`}
                    >
                      {n}
                    </span>
                  );
                })}
              </div>
              <span className="font-mono text-[10px] text-ink">{label}</span>
            </div>
          );
        })}
      </div>

      <div>
        <p className="font-label text-[11px] uppercase tracking-widest text-muted-ink">Buttons sb-01 – sb-10</p>
        <div className="mt-1 grid grid-cols-5 gap-2 sm:grid-cols-10">
          {SB_BUTTONS.map((name, i) => {
            const color = SB_COLORS[i];
            const on = Boolean(lit[name]);
            const online = (latest[`/cca/r140/button/${name}/availability`]?.payload as { state?: string } | undefined)?.state;
            const p = presses[name];
            return (
              <div
                key={name}
                className="flex flex-col items-center gap-1"
                title={`${name}${online ? ` · ${online}` : ' · not on the broker'}${p ? ` · ${p.count} press${p.count === 1 ? '' : 'es'}, last ${time(p.at)}` : ''}`}
              >
                <span
                  className="block h-8 w-8 rounded-full border-2 transition-all duration-150"
                  style={{
                    borderColor: color,
                    backgroundColor: on ? color : 'transparent',
                    boxShadow: on ? `0 0 14px 4px ${color}` : 'none',
                    opacity: online ? 1 : 0.35,
                  }}
                />
                <span className="font-mono text-[10px] text-ink">{name}</span>
                <span className="font-mono text-[10px] text-muted-ink">{p ? `×${p.count}` : '–'}</span>
              </div>
            );
          })}
        </div>
      </div>

      {devices.length > 0 && (
        <table className="w-full border-collapse font-body text-xs text-ink">
          <thead>
            <tr className="border-b border-ink text-left">
              <th className="py-1 pr-2 font-normal">Device</th>
              <th className="py-1 pr-2 font-normal">Type</th>
              <th className="py-1 pr-2 font-normal">Status</th>
              <th className="py-1 pr-2 font-normal">Battery</th>
              <th className="py-1 font-normal">Last</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d) => (
              <tr key={`${d.type}/${d.name}`} className="border-b border-hair align-top">
                <td className="py-1 pr-2 font-mono">{d.name}</td>
                <td className="py-1 pr-2">{d.type}</td>
                <td className="py-1 pr-2" style={{ color: d.online === false ? '#b91c1c' : undefined }}>
                  {d.online === undefined ? '' : d.online ? 'online' : 'offline'}
                </td>
                <td className="py-1 pr-2" style={{ color: d.battery !== undefined && d.battery < 25 ? '#b91c1c' : undefined }}>
                  {d.battery === undefined ? '' : `${d.battery}%`}
                </td>
                <td className="py-1 text-muted-ink">{d.last ? shortPayload(d.last.payload) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <div>
        <p className="font-label text-[11px] uppercase tracking-widest text-muted-ink">Live events</p>
        {events.length === 0 ? (
          <p className="font-body text-xs italic text-muted-ink">Nothing yet. Press a button in the room.</p>
        ) : (
          <ul className="mt-1 max-h-48 overflow-y-auto font-mono text-[11px] text-ink">
            {events.map((m, i) => (
              <li key={`${m.at}-${i}`} className="border-b border-hair py-0.5">
                <span className="text-muted-ink">{time(m.at)}</span> {m.topic.replace('/cca/r140/', '')} — {shortPayload(m.payload)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
