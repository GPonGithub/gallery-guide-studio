'use client';

import { useEffect, useRef, useState } from 'react';
import type { SheetSource } from '@/lib/agent/projectStore';
import { buttonOutline, fieldInput } from '@/lib/styles';
import {
  DJI_INPUT,
  dualMicSettings,
  listInputs,
  personLabel,
  resumeDualMic,
  scenePeople,
  setDualMic,
  useDualMic,
  useDualMicLive,
  type Input,
  type Person,
  type Side,
} from '@/lib/agent/dualMic';

const small = buttonOutline.replace('px-4 py-2', 'px-2.5 py-1.5');

/**
 * Adding Immersive Media, section 8: Dual microphones. Two people in the conversation, one on each side
 * of a stereo input (the DJI Mic's receiver: transmitter 1 left, 2 right), each a person from the scene's
 * sheet. Live meters for each side; the agent is told who said each sentence and answers them.
 */
export function DualMicPanel({ anthropicApiKey, sceneSheet }: { anthropicApiKey: string; sceneSheet: SheetSource | null }) {
  const settings = useDualMic();
  const live = useDualMicLive();
  const [inputs, setInputs] = useState<Input[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [reading, setReading] = useState(false);
  const [note, setNote] = useState<{ text: string; problem?: boolean } | null>(null);

  // Left on last time: listening again once the page is open.
  useEffect(() => resumeDualMic(), []);

  const findInputs = async () => {
    const list = await listInputs();
    setInputs(list);
    // The DJI receiver, picked by itself the first time.
    if (!settings.deviceId) {
      const dji = list.find((i) => DJI_INPUT.test(i.label));
      if (dji) setDualMic({ deviceId: dji.id });
    }
  };

  const sceneKey = sceneSheet ? `${sceneSheet.sheetId}:${sceneSheet.gid}:${sceneSheet.number}` : null;
  /**
   * The scene's people from its sheet (row 11 "People in this scene", or an AI reading of the scene where
   * that row is empty): the first on the left, the second on the right. `force`: even over names already
   * filled in for this scene (Read names again).
   */
  const readNames = async (force: boolean) => {
    if (!sceneSheet || !sceneKey) {
      setNote({ text: 'The open scene isn’t from the sheet, so there are no names to read. Type them in below.', problem: true });
      return;
    }
    setReading(true);
    setNote(null);
    try {
      const { people: found, from } = await scenePeople(sceneSheet, anthropicApiKey);
      setPeople(found);
      if (found.length === 0) {
        setNote({
          text: `Scene ${sceneSheet.number}’s “People in this scene” row (row 11) is empty${anthropicApiKey.trim() ? ', and its text names no one' : ''}. Type the names in below.`,
          problem: true,
        });
        return;
      }
      const [a, b] = found;
      const current = dualMicSettings();
      if (force || current.namesFor !== sceneKey) {
        setDualMic({ left: a, right: b ?? { name: '', role: '' }, namesFor: sceneKey });
      }
      setNote({
        text:
          `${from === 'sheet' ? `From the sheet (scene ${sceneSheet.number}, row 11)` : 'Read from the scene'}: ` +
          `${a.name} on the left${b ? `, ${b.name} on the right` : ''}.` +
          (found.length > 2 ? ` Also listed: ${found.slice(2).map((p) => p.name).join(', ')}.` : ''),
      });
    } catch (err) {
      setNote({ text: err instanceof Error ? err.message : 'The names couldn’t be read.', problem: true });
    } finally {
      setReading(false);
    }
  };
  // A scene opened (or a different one): its people are filled in by themselves.
  const readRef = useRef(readNames);
  useEffect(() => {
    readRef.current = readNames;
  });
  useEffect(() => {
    if (sceneKey) void readRef.current(false);
  }, [sceneKey]);

  const light =
    live.state === 'on'
      ? { color: '#15803d', text: `Listening to ${live.device || 'the input'}, left and right` }
      : live.state === 'starting'
        ? { color: '#b45309', text: 'Opening the microphone…' }
        : live.state === 'mono' || live.state === 'problem'
          ? { color: '#b91c1c', text: live.problem ?? 'Problem' }
          : { color: '#a3a3a3', text: 'Off' };

  const side = (s: Side) => {
    const p = settings[s];
    const level = s === 'left' ? live.left : live.right;
    // The side the last sentence came from (outlined in blue).
    const lit = live.lastSide === s;
    return (
      <div key={s} className={`flex flex-1 flex-col gap-1.5 border-2 p-2 ${lit ? 'border-[#3c5eac]' : 'border-ink/20'}`}>
        <div className="flex items-center justify-between">
          <span className="font-label text-[11px] uppercase tracking-widest text-ink">{s === 'left' ? '◀ Left' : 'Right ▶'}</span>
          <span className="font-label text-[10px] uppercase text-muted-ink">{s === 'left' ? 'Transmitter 1' : 'Transmitter 2'}</span>
        </div>
        {/* The side's live level. */}
        <div className="h-3 w-full bg-hair" aria-label={`${s} microphone level`}>
          <div
            className="h-full transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%`, backgroundColor: level > 0.9 ? '#b91c1c' : '#3c5eac' }}
          />
        </div>
        <input
          className={fieldInput}
          value={p.name}
          list={`dual-mic-people-${s}`}
          placeholder={s === 'left' ? 'Name, e.g. Dr Patel' : 'Name, e.g. Nurse Lee'}
          onChange={(e) => {
            const name = e.target.value;
            const known = people.find((x) => x.name === name);
            setDualMic({ [s]: known ?? { ...p, name } });
          }}
          aria-label={`${s} microphone: person's name`}
        />
        <datalist id={`dual-mic-people-${s}`}>
          {people.map((x) => (
            <option key={x.name} value={x.name}>
              {x.role}
            </option>
          ))}
        </datalist>
        <input
          className={fieldInput}
          value={p.role}
          placeholder="Role, e.g. doctor"
          onChange={(e) => setDualMic({ [s]: { ...p, role: e.target.value } })}
          aria-label={`${s} microphone: person's role`}
        />
        <p className="font-body text-[11px] text-muted-ink">
          The agent hears: <span className="text-ink">{personLabel(s, settings)}: …</span>
          {lit && <b className="ml-1 text-[#3c5eac]">● spoke last</b>}
        </p>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="font-body text-xs italic text-muted-ink">
        Two people in the conversation, one on each microphone — for example the doctor and the nurse the scene&rsquo;s
        sheet describes. The agent is told who said each sentence and answers that person.
      </p>
      <ol className="ml-4 list-decimal font-body text-xs text-ink">
        <li>Set the DJI receiver to <b>stereo</b>: transmitter 1 comes in on the left, transmitter 2 on the right.</li>
        <li>
          In the Mac&rsquo;s Sound settings, choose <b>Wireless Mic Rx</b> as the input — the chat&rsquo;s speech
          recognition always listens to the Mac&rsquo;s input.
        </li>
        <li>
          The names come from the scene&rsquo;s sheet by themselves — row 11, &ldquo;People in this scene&rdquo;
          (&ldquo;Dave: The nurse&rdquo;): the first person is on the left microphone, the second on the right.
        </li>
        <li>Turn Dual microphones on, then talk with the open mic 🎙️.</li>
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <button
          className={`${small} ${settings.on ? 'bg-ink text-paper' : ''}`}
          aria-pressed={settings.on}
          onClick={() => {
            setDualMic({ on: !settings.on });
            if (!settings.on && inputs.length === 0) void findInputs();
          }}
        >
          Dual microphones: {settings.on ? 'On' : 'Off'}
        </button>
        <select
          className={`${fieldInput} min-w-[200px] flex-1`}
          value={settings.deviceId}
          onFocus={() => inputs.length === 0 && void findInputs()}
          onChange={(e) => setDualMic({ deviceId: e.target.value })}
          aria-label="Microphone input"
        >
          <option value="">{inputs.length ? 'Wireless Mic Rx (found by itself)' : 'Choose the input…'}</option>
          {inputs.map((i) => (
            <option key={i.id} value={i.id}>
              {i.label}
            </option>
          ))}
        </select>
        <button className={small} onClick={() => void readNames(true)} disabled={reading || !sceneSheet}>
          {reading ? 'Reading…' : 'Read names again'}
        </button>
      </div>
      <p className="flex items-center gap-2 font-body text-xs text-ink">
        <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: light.color }} />
        {light.text}
      </p>
      {note && <p className={`font-body text-xs ${note.problem ? 'text-[#b91c1c]' : 'text-ink'}`}>{note.text}</p>}

      <div className="flex flex-col gap-2 sm:flex-row">
        {side('left')}
        {side('right')}
      </div>
    </div>
  );
}
