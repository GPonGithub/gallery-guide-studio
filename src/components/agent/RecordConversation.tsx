'use client';

import { useEffect, useRef, useState } from 'react';
import { buttonOutline, buttonOutlineCompact, buttonPrimary, fieldInput, fieldLabel, toolbarButtonWidth } from '@/lib/styles';
import {
  allowPickedFolder,
  canPickRecordFolder,
  checkRecordFolder,
  hasRecordFolder,
  listMicrophones,
  microphoneStream,
  pickRecordFolder,
  RECORD_TAIL_MS,
  setRecordSettings,
  useRecordSettings,
  useRecordStatus,
  type FolderCheck,
  type Microphone,
} from '@/lib/agent/conversationRecorder';

/**
 * The chat toolbar's Record conversation button, and its dialog: where the recordings go (a folder's
 * path pasted in, or a folder chosen), which microphone joins in, and recording on or off. On, every
 * conversation is recorded from its start to 5 seconds after its end (conversationRecorder.ts).
 */
export function RecordConversation() {
  const settings = useRecordSettings();
  const status = useRecordStatus();
  const [open, setOpen] = useState(false);
  const recording = status.state === 'recording';
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-pressed={settings.on}
        aria-haspopup="dialog"
        data-record-conversation={recording ? 'recording' : settings.on ? 'on' : 'off'}
        className={`inline-flex h-10 items-center gap-1.5 ${toolbarButtonWidth} ${buttonOutlineCompact} ${settings.on ? 'bg-ink text-paper hover:bg-paper hover:text-ink' : ''}`}
        title={
          recording
            ? 'Recording this conversation — click for where it’s saved'
            : settings.on
              ? 'On: each conversation is recorded from its start to 5 seconds after it ends — click to change'
              : 'Record each conversation (the chatbot’s voice, the studio’s sounds and a microphone) as one sound file — click to set up'
        }
      >
        <span
          className={`h-2.5 w-2.5 shrink-0 rounded-full ${recording ? 'animate-pulse bg-[#dc2626]' : settings.on ? 'bg-[#dc2626]' : 'border border-current'}`}
          aria-hidden="true"
        />
        {recording ? 'Recording…' : 'Record conversation'}
      </button>
      {open && <RecordDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function RecordDialog({ onClose }: { onClose: () => void }) {
  const settings = useRecordSettings();
  const status = useRecordStatus();
  const [path, setPath] = useState(settings.folder);
  const [check, setCheck] = useState<FolderCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [mics, setMics] = useState<Microphone[] | null>(null);
  const meter = useRef<HTMLSpanElement>(null);

  // This computer's microphones, by name.
  useEffect(() => {
    let gone = false;
    void listMicrophones()
      .then((list) => {
        if (!gone) setMics(list);
      })
      .catch(() => {
        if (!gone) setMics([]);
      });
    return () => {
      gone = true;
    };
  }, []);

  // The chosen microphone's level, live, while the dialog is open: proof it's the right one, and working.
  useEffect(() => {
    if (settings.micId === 'none') return;
    let gone = false;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let frame = 0;
    void microphoneStream(settings.micId)
      .then((mic) => {
        if (gone) {
          mic.getTracks().forEach((t) => t.stop());
          return;
        }
        stream = mic;
        ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(mic).connect(analyser);
        const data = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v));
          if (meter.current) meter.current.style.width = `${Math.min(100, Math.round(Math.sqrt(peak) * 100))}%`;
          frame = requestAnimationFrame(tick);
        };
        tick();
      })
      .catch(() => {
        if (!gone) setNote('That microphone didn’t answer — check it’s plugged in and allowed for this page.');
      });
    return () => {
      gone = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close().catch(() => undefined);
    };
  }, [settings.micId]);

  // The pasted path: checked on this computer, and kept if the folder is there.
  const applyPath = async () => {
    const wanted = path.trim();
    if (!wanted) {
      setRecordSettings({ folder: '' });
      setCheck(null);
      return;
    }
    setChecking(true);
    const result = await checkRecordFolder(wanted);
    setChecking(false);
    setCheck(result);
    if (result.ok && result.folder) {
      setPath(result.folder);
      setRecordSettings({ folder: result.folder, pickedName: '' });
    }
  };
  const choose = async () => {
    setNote(null);
    try {
      const name = await pickRecordFolder();
      if (name) {
        setPath('');
        setCheck(null);
      }
    } catch (err) {
      setNote(err instanceof Error ? err.message : 'The folder couldn’t be opened.');
    }
  };
  const turnOn = async () => {
    // A picked folder's permission is renewed here, from this click, so the recording can be saved later.
    if (!settings.folder && settings.pickedName && !(await allowPickedFolder())) {
      setNote('The browser wasn’t allowed to save in that folder — choose it again.');
      return;
    }
    setRecordSettings({ on: true });
  };

  const ready = hasRecordFolder(settings);
  const where = settings.folder || (settings.pickedName ? `${settings.pickedName} (chosen folder)` : '');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4" role="dialog" aria-modal="true" aria-label="Record conversation">
      <div className="flex max-h-full w-full max-w-lg flex-col gap-4 overflow-y-auto border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl tracking-tight text-ink">Record conversation</h2>
          <button onClick={onClose} className="text-xl leading-none text-ink transition-colors duration-100 hover:text-muted-ink" aria-label="Close">
            ×
          </button>
        </div>
        <p className="font-body text-sm italic text-muted-ink">
          Each conversation is saved as one MP3: the chatbot&rsquo;s voice, every sound the studio plays (timeline sounds,
          video sound, music) and the microphone, mixed together. It starts when the conversation starts and stops{' '}
          {RECORD_TAIL_MS / 1000} seconds after it ends.
        </p>

        <div className="flex flex-col gap-1.5">
          <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
            Folder for the recordings (paste its path)
            <input
              type="text"
              value={path}
              onChange={(e) => {
                setPath(e.target.value);
                setCheck(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void applyPath();
              }}
              placeholder="/Users/you/Documents/Conversation recordings"
              spellCheck={false}
              autoComplete="off"
              className={fieldInput}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => void applyPath()} disabled={checking || path.trim() === settings.folder} className={buttonOutline}>
              {checking ? 'Checking…' : 'Use this folder'}
            </button>
            {canPickRecordFolder() && (
              <button onClick={() => void choose()} className={buttonOutline} title="Pick the folder in a Finder window instead of pasting its path">
                Choose folder…
              </button>
            )}
          </div>
          {check && !check.ok && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-sm text-ink">{check.error}</p>}
          <p className="font-body text-sm text-ink" data-record-folder>
            {where ? (
              <>
                Saving in: <b className="break-all">{where}</b>
              </>
            ) : (
              <span className="italic text-muted-ink">
                No folder yet. In Finder, right-click the folder, hold Option and choose Copy as Pathname, then paste it here.
              </span>
            )}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
            Microphone
            <select value={settings.micId} onChange={(e) => setRecordSettings({ micId: e.target.value })} className={fieldInput}>
              <option value="">This computer&rsquo;s default input</option>
              {(mics ?? []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
              {/* One chosen before that isn't plugged in now stays listed, so it isn't lost. */}
              {settings.micId && settings.micId !== 'none' && mics && !mics.some((m) => m.id === settings.micId) && (
                <option value={settings.micId}>The microphone chosen before (not found now)</option>
              )}
              <option value="none">No microphone</option>
            </select>
          </label>
          {settings.micId !== 'none' && (
            <div className="flex items-center gap-2">
              <span className="h-2 flex-1 border border-ink bg-paper" role="img" aria-label="Microphone level">
                <span ref={meter} className="block h-full w-0 bg-[#15803d]" />
              </span>
              <span className="font-body text-xs text-muted-ink">Speak: the bar should move</span>
            </div>
          )}
          <p className="font-body text-xs italic text-muted-ink">
            A microphone in the room also hears the room&rsquo;s speakers, so the voice and sounds are in the recording
            twice, slightly apart. Keep it close to the people talking.
          </p>
        </div>

        {note && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-sm text-ink">{note}</p>}
        {status.state === 'recording' && (
          <p className="font-body text-sm text-ink">
            <span className="mr-1.5 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[#dc2626]" aria-hidden="true" />
            Recording now{status.mic === 'on' ? ', with the microphone' : status.mic === 'off' ? ', without a microphone' : ' (the microphone hasn’t joined)'}.
          </p>
        )}
        {status.state === 'saving' && <p className="font-body text-sm text-ink">Saving the last recording…</p>}
        {status.state === 'saved' && (
          <p className="font-body text-sm text-ink">
            Last recording saved: <b className="break-all">{status.where}</b>
            {status.note ? ` — ${status.note}` : ''}
          </p>
        )}
        {status.state === 'error' && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-sm text-ink">{status.message}</p>}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t-2 border-ink pt-3">
          {settings.on ? (
            <button onClick={() => setRecordSettings({ on: false })} className={buttonOutline}>
              Turn recording off
            </button>
          ) : (
            <button onClick={() => void turnOn()} disabled={!ready} className={buttonPrimary} title={ready ? undefined : 'Give it a folder first'}>
              Turn recording on
            </button>
          )}
          <span className="font-body text-sm text-ink">{settings.on ? 'Recording is on for every conversation.' : 'Recording is off.'}</span>
          <button onClick={onClose} className={buttonOutline}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
