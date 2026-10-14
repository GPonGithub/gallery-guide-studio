'use client';

import { useEffect, useRef, useState } from 'react';
import { DesignPanel } from '@/components/agent/DesignPanel';
import { MasterEditor, StageEditor } from '@/components/agent/FlowEditor';
import { OpenMic, type OpenMicStatus } from '@/components/agent/OpenMic';
import { SpeechQueue } from '@/components/agent/speechQueue';
import type { TurnStreamEvent } from '@/lib/agent/runtime';
import { MAX_VOICES, VoicePanel, type AccountVoices, type SavedVoice, type VoiceCheck } from '@/components/agent/VoicePanel';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/storage';
import type { VoiceSettings } from '@/lib/types';
import { ProjectsMenu, saveProjectRequest, type CurrentProject } from '@/components/agent/ProjectsMenu';
import type { AgentProject } from '@/lib/agent/projectStore';
import { Inspector, type TurnLog } from '@/components/agent/Inspector';
import { blankStage, emptyFlow, initialState, sampleFlow, sortStages, startStage } from '@/lib/agent/flow';
import type { AgentEvent, AgentFlow, ChatTurn, CueStatus, SessionState, Stage, TurnResponse } from '@/lib/agent/types';
import { buttonIcon, buttonOutline, buttonPrimary, fieldInput, fieldLabel } from '@/lib/styles';

// v4 prototype: define a goal-driven agent by typing stage cards (no
// image, no FigJam yet) and test it in the same page — chat in the
// middle, the agent's reasoning in the inspector on the right.

const STORAGE_KEY = 'gallery-guide-agent:v1';
const LEGACY_STUDIO_KEY = 'gallery-guide-studio:v1';


type Saved = {
  flow: AgentFlow;
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  voiceId: string;
  voiceSettings: VoiceSettings | null;
  /** The plain-English description the flow was generated from. */
  brief: string;
  /** The FigJam board the flow is drawn on and imported from. */
  boardUrl: string;
  /** The saved project this work belongs to (null = not saved yet). */
  projectId: string | null;
  projectName: string;
  /** flow + brief + board as last saved/opened — anything different is unsaved. */
  savedSnapshot: string;
  /** Open mic: seconds of quiet before what was said is sent. */
  pauseSeconds: number;
  /** Up to five saved ElevenLabs voices (empty ID = the default voice). */
  voices: SavedVoice[];
  /** Index into `voices` of the one the agent speaks with. */
  activeVoice: number;
};

// Performance cues ([warmly], [laughs softly]…) are for the voice, not the reader.
const withoutCues = (text: string) => text.replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim();

const snapshotOf = (s: Pick<Saved, 'flow' | 'brief' | 'boardUrl'>) =>
  JSON.stringify({ flow: s.flow, brief: s.brief, boardUrl: s.boardUrl });

type SpeechRecognitionLike = {
  interimResults: boolean;
  continuous: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
};

function loadSaved(): Saved {
  const fallback: Saved = {
    flow: sampleFlow(),
    anthropicApiKey: '',
    elevenLabsApiKey: '',
    voiceId: '',
    voiceSettings: null,
    brief: '',
    boardUrl: '',
    projectId: null,
    projectName: 'Untitled project',
    savedSnapshot: '',
    pauseSeconds: 1.0,
    voices: [],
    activeVoice: 0,
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const saved = raw ? { ...fallback, ...(JSON.parse(raw) as Partial<Saved>) } : fallback;
    // First visit: borrow the keys and voice already set up in the step-table studio.
    if (!saved.anthropicApiKey || !saved.elevenLabsApiKey || !saved.voiceId) {
      const legacy = JSON.parse(window.localStorage.getItem(LEGACY_STUDIO_KEY) ?? '{}') as Partial<{
        anthropicApiKey: string;
        elevenLabsApiKey: string;
        voiceId: string;
        voiceSettings: VoiceSettings;
      }>;
      saved.anthropicApiKey ||= legacy.anthropicApiKey ?? '';
      saved.elevenLabsApiKey ||= legacy.elevenLabsApiKey ?? '';
      saved.voiceId ||= legacy.voiceId ?? '';
      saved.voiceSettings ??= legacy.voiceSettings ?? null;
    }
    // Before there was a voice list there was one voice ID — it becomes Voice 1.
    if (!Array.isArray(saved.voices) || saved.voices.length === 0) {
      saved.voices = [{ name: 'Voice 1', voiceId: saved.voiceId ?? '' }];
    }
    saved.voices = saved.voices.slice(0, MAX_VOICES);
    saved.activeVoice = Math.min(Math.max(0, saved.activeVoice ?? 0), saved.voices.length - 1);
    return saved;
  } catch {
    return fallback;
  }
}

export default function AgentStudioPage() {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [selected, setSelected] = useState<string>('master');
  const [keysOpen, setKeysOpen] = useState(false);
  // The inspector starts tucked away; its edge tab slides it out and back.
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);

  const [startAt, setStartAt] = useState('');
  const [session, setSession] = useState<SessionState | null>(null);
  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [log, setLog] = useState<TurnLog[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [voiceOn, setVoiceOn] = useState(true);
  const [openMicOn, setOpenMicOn] = useState(false);
  const [openMicStatus, setOpenMicStatus] = useState<OpenMicStatus>('off');
  // A reply being worked out early, during the open mic's pause (see startEarlyTurn).
  const earlyTurnRef = useRef<{
    text: string;
    basis: string;
    controller: AbortController;
    stream: { listen: (onSentence: (sentence: string) => void) => void; done: Promise<TurnResponse> };
  } | null>(null);
  // True while the agent's voice is playing — the open mic stays deaf then.
  const [speaking, setSpeaking] = useState(false);
  const [listening, setListening] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // The reply being spoken sentence by sentence (see speechQueue.ts).
  const queueRef = useRef<SpeechQueue | null>(null);
  // Whether the line now playing is expressive (its speed is ours to set live).
  const audioExpressiveRef = useRef(false);
  // The voice settings as they are right now. A reply is spoken some seconds
  // after the message that prompted it was sent; reading these at speaking
  // time (not send time) means a slider moved while the agent was thinking
  // still applies to the very next thing it says.
  const voiceRef = useRef({ voiceId: '', apiKey: '', settings: DEFAULT_VOICE_SETTINGS });
  useEffect(() => {
    if (!saved) return;
    const settings = saved.voiceSettings ?? DEFAULT_VOICE_SETTINGS;
    const voiceId = saved.voices[saved.activeVoice]?.voiceId ?? saved.voiceId;
    voiceRef.current = { voiceId, apiKey: saved.elevenLabsApiKey, settings };
    // Speed is applied by the browser for expressive lines, so it can change
    // mid-sentence too.
    if (audioRef.current && audioExpressiveRef.current) audioRef.current.playbackRate = settings.speed;
    const queued = queueRef.current?.current();
    if (queued && queueRef.current?.expressive) queued.playbackRate = settings.speed;
  }, [saved]);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const loaded = loadSaved();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
    setSaved(loaded);
    setSession(initialState(loaded.flow));
    setSelected('design');
  }, []);

  useEffect(() => {
    if (!saved) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
    } catch {
      // Storage blocked — edits just won't survive a reload.
    }
  }, [saved]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages, busy]);

  if (!saved || !session) return null;
  const flow = saved.flow;

  const setFlow = (next: AgentFlow) => setSaved((s) => (s ? { ...s, flow: next } : s));

  const updateStage = (id: string, patch: Partial<Stage>) => {
    const old = flow.stages.find((s) => s.id === id);
    let stages = flow.stages.map((s) => (s.id === id ? { ...s, ...patch } : s));
    let globalExits = flow.globalExits;
    // Renaming a stage's code keeps every exit that pointed at it working.
    if (old && patch.code !== undefined && patch.code !== old.code) {
      const rename = (to: string) => (to === old.code ? patch.code! : to);
      stages = stages.map((s) => ({ ...s, exits: s.exits.map((e) => ({ ...e, to: rename(e.to) })) }));
      globalExits = globalExits.map((e) => ({ ...e, to: rename(e.to) }));
    }
    setFlow({ ...flow, stages, globalExits });
  };

  const deleteStage = (id: string) => {
    const stage = flow.stages.find((s) => s.id === id);
    if (!stage || !window.confirm(`Delete stage ${stage.code} ${stage.name}?`)) return;
    const unlink = (to: string) => (to === stage.code ? '' : to);
    setFlow({
      ...flow,
      stages: flow.stages
        .filter((s) => s.id !== id)
        .map((s) => ({ ...s, exits: s.exits.map((e) => ({ ...e, to: unlink(e.to) })) })),
      globalExits: flow.globalExits.map((e) => ({ ...e, to: unlink(e.to) })),
    });
    setSelected('master');
  };

  const addStage = () => {
    const used = new Set(flow.stages.map((s) => s.code));
    let n = flow.stages.length + 1;
    while (used.has(String(n))) n += 1;
    const stage = blankStage(String(n));
    setFlow({ ...flow, stages: [...flow.stages, stage] });
    setSelected(stage.id);
  };

  const stopAudio = () => {
    audioRef.current?.pause();
    audioRef.current = null;
    queueRef.current?.cancel();
    queueRef.current = null;
    setSpeaking(false);
  };

  const restart = (code = startAt) => {
    stopAudio();
    setSession(initialState(flow, code || undefined));
    setMessages([]);
    setLog([]);
    setError(null);
  };

  // Swap in a whole new flow (example, generated, or imported) and start
  // a fresh conversation against it.
  const loadFlow = (next: AgentFlow, select?: string) => {
    setFlow(next);
    setSelected(select ?? sortStages(next.stages)[0]?.id ?? 'master');
    setStartAt('');
    stopAudio();
    setSession(initialState(next));
    setMessages([]);
    setLog([]);
    setError(null);
  };

  const dirty = saved.projectId ? snapshotOf(saved) !== saved.savedSnapshot : flow.stages.length > 0;
  const current: CurrentProject = {
    id: saved.projectId,
    name: saved.projectName,
    dirty,
    flow,
    brief: saved.brief,
    boardUrl: saved.boardUrl,
  };
  const okToLeave = () =>
    !dirty || window.confirm(`"${saved.projectName}" has unsaved changes. Continue without saving them?`);

  const markSaved = (project: AgentProject) =>
    setSaved((s) =>
      s ? { ...s, projectId: project.id, projectName: project.name, savedSnapshot: snapshotOf(project) } : s,
    );

  const openProject = (project: AgentProject) => {
    if (!okToLeave()) return;
    loadFlow(project.flow, 'design');
    setSaved((s) => (s ? { ...s, brief: project.brief, boardUrl: project.boardUrl } : s));
    markSaved(project);
    setProjectsOpen(false);
  };

  const newProject = (kind: 'blank' | 'example') => {
    if (!okToLeave()) return;
    const next = kind === 'example' ? sampleFlow() : { ...emptyFlow, stages: [blankStage('1')] };
    loadFlow(next, 'design');
    setSaved((s) =>
      s
        ? {
            ...s,
            brief: '',
            boardUrl: '',
            projectId: null,
            projectName: kind === 'example' ? 'UCSF front desk (example)' : 'Untitled project',
            savedSnapshot: '',
          }
        : s,
    );
    setProjectsOpen(false);
  };

  // Header "Save": straight to disk for a project that already has a name;
  // a brand-new one opens the menu to name it.
  const quickSave = async () => {
    if (!saved.projectId) {
      setProjectsOpen(true);
      return;
    }
    try {
      markSaved(await saveProjectRequest(current, saved.projectName, false));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed.');
    }
  };

  // `always` = play even with Spoken replies off (the voice panel's Test button).
  // `expressive` = the text carries performance cues for an expressive model.
  // `voiceId` = a specific saved voice (the panel's per-voice Test buttons);
  // otherwise the voice in use.
  const speak = async (text: string, always = false, expressive = false, voiceId?: string) => {
    if (!always && !voiceOn) return;
    if (!withoutCues(text)) return; // nothing to say (e.g. an empty reply)
    if (!voiceRef.current.apiKey.trim()) {
      if (always) setError('Add your ElevenLabs API key first (Keys, top right).');
      return;
    }
    try {
      // Get a one-time ticket for the voice, then let the <audio> element
      // play it as it streams in — speech starts with the first audio
      // ElevenLabs sends, instead of after the whole clip has downloaded.
      const res = await fetch('/api/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voiceId: voiceId ?? voiceRef.current.voiceId,
          apiKey: voiceRef.current.apiKey,
          voiceSettings: voiceRef.current.settings,
          expressive,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      const { ticket } = (await res.json()) as { ticket: string };
      stopAudio();
      const audio = new Audio(`/api/tts/stream?ticket=${encodeURIComponent(ticket)}`);
      audioRef.current = audio;
      audioExpressiveRef.current = expressive;
      // The expressive models have no speed setting, so apply the Speed
      // slider here instead (keeping the pitch natural).
      if (expressive) {
        audio.playbackRate = voiceRef.current.settings.speed;
        audio.preservesPitch = true;
      }
      audio.onplay = () => setSpeaking(true);
      audio.onended = () => setSpeaking(false);
      audio.onerror = () => {
        setSpeaking(false);
        setError('Voice playback stopped unexpectedly — try again, or check the voice in the Voice panel.');
      };
      await audio.play();
    } catch (err) {
      setError(`Voice failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  // "Moment" cues are judged against the reply, so they're checked after it
  // is already on screen and being spoken — never holding the reply back.
  // Whatever fires is added to the latest turn in the inspector.
  const checkMoments = async (state: SessionState, userText: string | null, reply: string) => {
    const stage = flow.stages.find((s) => s.code === state.stageCode);
    const hasMoments = [...(stage?.cues ?? []), ...flow.globalCues].some((c) => c.on === 'moment' && c.when?.trim());
    if (!hasMoments) return;
    try {
      const res = await fetch('/api/agent/moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow, state, userText, reply, anthropicApiKey: saved.anthropicApiKey }),
      });
      const data = (await res.json()) as { events: AgentEvent[] } | { error: string };
      if ('error' in data || data.events.length === 0) return;
      setLog((l) =>
        l.length === 0 ? l : [...l.slice(0, -1), { ...l[l.length - 1], events: [...l[l.length - 1].events, ...data.events] }],
      );
    } catch {
      // A missed moment cue never interrupts the conversation.
    }
  };

  // A turn being worked out: its reply arrives sentence by sentence (as the
  // server writes it) and then the full result. `listen` hands over every
  // sentence received so far and each new one as it arrives — so a turn
  // started early can collect sentences silently and be voiced only once
  // it's actually used.
  type TurnStream = { listen: (onSentence: (sentence: string) => void) => void; done: Promise<TurnResponse> };

  const startTurnStream = (
    state: SessionState,
    history: ChatTurn[],
    userText: string | null,
    options: { holdCues?: boolean; signal?: AbortSignal } = {},
  ): TurnStream => {
    const sentences: string[] = [];
    // Set later by listen(), from outside this function.
    const hub: { listener: ((sentence: string) => void) | null } = { listener: null };
    const done = (async (): Promise<TurnResponse> => {
      const res = await fetch('/api/agent/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow, state, history, userText, anthropicApiKey: saved.anthropicApiKey, holdCues: options.holdCues }),
        signal: options.signal,
      });
      if (!res.body) throw new Error('No reply from the app server.');
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        pending += decoder.decode(value, { stream: true });
        for (let newline = pending.indexOf('\n'); newline >= 0; newline = pending.indexOf('\n')) {
          const line = pending.slice(0, newline).trim();
          pending = pending.slice(newline + 1);
          if (!line) continue;
          const event = JSON.parse(line) as TurnStreamEvent;
          if (event.type === 'sentence') {
            sentences.push(event.text);
            hub.listener?.(event.text);
          } else if (event.type === 'error') {
            throw new Error(event.message);
          } else {
            return { reply: event.reply, state: event.state, events: event.events, timings: event.timings };
          }
        }
      }
      throw new Error('The reply stopped before it finished — try again.');
    })();
    return {
      done,
      listen: (onSentence) => {
        for (const sentence of sentences) onSentence(sentence);
        hub.listener = onSentence;
      },
    };
  };

  // Speaks one reply sentence by sentence, each requested as soon as it's written.
  const newSpeechQueue = (expressive: boolean) =>
    new SpeechQueue({
      expressive,
      playbackRate: () => voiceRef.current.settings.speed,
      onSpeakingChange: setSpeaking,
      onError: setError,
      requestTicket: async (text, previousText) => {
        const res = await fetch('/api/tts/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voiceId: voiceRef.current.voiceId,
            apiKey: voiceRef.current.apiKey,
            voiceSettings: voiceRef.current.settings,
            expressive,
            // Keeps the normal voice's delivery continuous across sentences.
            previousText: expressive ? undefined : previousText,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        return ((await res.json()) as { ticket: string }).ticket;
      },
    });

  // Thinking during the pause: the moment Chrome confirms a finished phrase,
  // start working out the reply while the pause timer is still running. If
  // the caller then stays quiet, that reply is used as-is (saving up to the
  // whole pause); if they keep talking, it's thrown away. TouchDesigner cues
  // are held back until the turn is actually used.
  const turnBasis = `${session.sessionId}:${messages.length}`;
  const startEarlyTurn = (text: string) => {
    if (busy || session.ended || !saved.anthropicApiKey.trim()) return;
    if (earlyTurnRef.current?.text === text && earlyTurnRef.current.basis === turnBasis) return;
    earlyTurnRef.current?.controller.abort();
    const controller = new AbortController();
    const stream = startTurnStream(session, messages, text, { holdCues: true, signal: controller.signal });
    stream.done.catch(() => {}); // an abandoned early turn is expected to fail
    earlyTurnRef.current = { text, basis: turnBasis, controller, stream };
  };
  const takeEarlyTurn = (text: string): TurnStream | undefined => {
    const early = earlyTurnRef.current;
    earlyTurnRef.current = null;
    if (early && early.text === text && early.basis === turnBasis) return early.stream;
    early?.controller.abort();
    return undefined;
  };

  // Cues of an early turn were held back — send them now that it's being used.
  const sendHeldCues = async (data: TurnResponse, turnNumber: number) => {
    const held = data.events.filter((e) => e.type === 'cue' && e.status === 'pending');
    if (held.length === 0) return;
    try {
      const res = await fetch('/api/agent/cues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow,
          state: data.state,
          cues: held.map((e) => (e.type === 'cue' ? { name: e.name, trigger: e.trigger } : null)),
        }),
      });
      const { statuses } = (await res.json()) as { statuses: CueStatus[] };
      let i = 0;
      setLog((l) =>
        l.map((entry) =>
          entry.turn !== turnNumber
            ? entry
            : {
                ...entry,
                events: entry.events.map((e) =>
                  e.type === 'cue' && e.status === 'pending' ? { ...e, status: statuses[i++] ?? 'failed' } : e,
                ),
              },
        ),
      );
    } catch {
      // A cue that can't be delivered never interrupts the conversation.
    }
  };

  const sendTurn = async (
    userText: string | null,
    opening?: { expressive: boolean },
    early?: TurnStream,
  ) => {
    if (busy || session.ended) return;
    // An expressive conversation is chosen by how it's opened, then kept for every turn.
    const state = opening ? { ...session, expressive: opening.expressive } : session;
    if (!saved.anthropicApiKey.trim()) {
      setError('Add your Anthropic API key first (Keys, top right).');
      setKeysOpen(true);
      return;
    }
    const history = messages;
    setError(null);
    setBusy(true);
    stopAudio();
    const withCaller: ChatTurn[] = [...history, ...(userText ? [{ role: 'user' as const, text: userText }] : [])];
    setMessages(withCaller);
    // Each sentence appears in the chat and goes to the voice the moment it's written.
    const queue = voiceOn && voiceRef.current.apiKey.trim() ? newSpeechQueue(Boolean(state.expressive)) : null;
    queueRef.current = queue;
    let shown = '';
    const onSentence = (sentence: string) => {
      shown = `${shown} ${sentence}`.trim();
      setMessages([...withCaller, { role: 'assistant', text: shown }]);
      if (withoutCues(sentence)) queue?.add(sentence);
    };
    try {
      let data: TurnResponse | null = null;
      if (early) {
        try {
          early.listen(onSentence);
          data = await early.done;
        } catch (err) {
          // An early turn that failed is redone normally — unless it had
          // already started speaking, which must never repeat.
          if (shown) throw err;
        }
      }
      if (!data) {
        const stream = startTurnStream(state, history, userText);
        stream.listen(onSentence);
        data = await stream.done;
      }
      queue?.finish();
      setMessages([...withCaller, { role: 'assistant', text: data.reply }]);
      setSession(data.state);
      const turnNumber = log.length + 1;
      setLog((l) => [
        ...l,
        { turn: turnNumber, userText, events: data.events, timings: early ? ['started during your pause', ...data.timings] : data.timings },
      ]);
      void sendHeldCues(data, turnNumber);
      void checkMoments(data.state, userText, data.reply);
    } catch (err) {
      queue?.cancel();
      setMessages(history);
      if (userText) setInput(userText);
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    void sendTurn(text);
  };

  const toggleMic = () => {
    // The two mics never run at once.
    if (openMicOn) setOpenMicOn(false);
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
      .SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;
    if (!Ctor) {
      setError('This browser has no speech recognition — use Chrome, or type instead.');
      return;
    }
    stopAudio();
    const recognition = new Ctor();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = '';
    recognition.onresult = (e) => {
      const parts = Array.from(e.results);
      finalText = parts.map((r) => r[0].transcript).join(' ').trim();
      setInput(finalText);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      if (finalText) {
        setInput('');
        void sendTurn(finalText);
      }
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  const orderedStages = sortStages(flow.stages);
  const selectedStage = flow.stages.find((s) => s.id === selected);
  const firstStage = startStage(flow);

  return (
    <main className="flex min-h-screen flex-col bg-paper lg:h-screen">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink px-5 py-3">
        <div className="min-w-0">
          <h1 className="font-display text-2xl leading-none tracking-tight text-ink">Goal Agent Studio</h1>
          <p className="mt-1 truncate font-label text-[10px] uppercase tracking-widest text-muted-ink">
            <span className="text-ink">{saved.projectName}</span>
            {dirty ? ' · unsaved changes' : ' · saved'}
            {saved.boardUrl && (
              <>
                {' · '}
                <a href={saved.boardUrl} target="_blank" rel="noopener noreferrer" className="text-ink underline underline-offset-2">
                  FigJam board ↗
                </a>
              </>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setProjectsOpen(true)} className={buttonOutline}>
            Projects
          </button>
          <button onClick={quickSave} disabled={!dirty} className={buttonPrimary}>
            Save
          </button>
          <button onClick={() => setKeysOpen((o) => !o)} className={buttonOutline}>
            Keys
          </button>
        </div>
      </header>

      {keysOpen && (
        <div className="flex flex-wrap items-end gap-3 border-b-2 border-ink bg-muted px-5 py-3">
          <label className={`flex min-w-[260px] flex-1 flex-col gap-1 ${fieldLabel}`}>
            Anthropic API key
            <input
              type="password"
              autoComplete="off"
              value={saved.anthropicApiKey}
              onChange={(e) => setSaved({ ...saved, anthropicApiKey: e.target.value })}
              placeholder="sk-ant-…"
              className={fieldInput}
            />
          </label>
          <label className={`flex min-w-[260px] flex-1 flex-col gap-1 ${fieldLabel}`}>
            ElevenLabs API key (for spoken replies)
            <input
              type="password"
              autoComplete="off"
              value={saved.elevenLabsApiKey}
              onChange={(e) => setSaved({ ...saved, elevenLabsApiKey: e.target.value })}
              placeholder="Optional"
              className={fieldInput}
            />
          </label>
          <button onClick={() => setKeysOpen(false)} className={buttonPrimary}>
            Done
          </button>
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[400px_minmax(0,1fr)_auto]">
        {/* Flow editor */}
        <section className="flex min-h-0 flex-col border-b-2 border-ink lg:border-b-0 lg:border-r-2">
          <div className="flex flex-wrap gap-1 border-b-2 border-ink p-2">
            <button
              onClick={() => setSelected('design')}
              className={`px-2 py-1 font-label text-[11px] uppercase tracking-wide ${selected === 'design' ? 'bg-ink text-paper' : 'text-ink hover:bg-muted'}`}
            >
              Design
            </button>
            <button
              onClick={() => setSelected('master')}
              className={`px-2 py-1 font-label text-[11px] uppercase tracking-wide ${selected === 'master' ? 'bg-ink text-paper' : 'text-ink hover:bg-muted'}`}
            >
              Master
            </button>
            {orderedStages.map((s) => (
              <button
                key={s.id}
                onClick={() => setSelected(s.id)}
                title={s.name}
                className={`px-2 py-1 font-label text-[11px] uppercase tracking-wide ${selected === s.id ? 'bg-ink text-paper' : 'text-ink hover:bg-muted'}`}
              >
                {s.code}
                {session.stageCode === s.code && !session.ended ? ' ●' : ''}
              </button>
            ))}
            <button onClick={addStage} className="px-2 py-1 font-label text-[11px] uppercase tracking-wide text-ink hover:bg-muted">
              + Stage
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-3 font-display text-lg text-ink">
              {selectedStage ? `${selectedStage.code} · ${selectedStage.name}` : selected === 'design' ? 'Design with FigJam' : 'Master card'}
            </p>
            {/* Always mounted (just hidden) so a draw/import in progress — and its
                messages — survive switching to another tab. */}
            <div className={selected === 'design' ? '' : 'hidden'}>
              <DesignPanel
                flow={flow}
                brief={saved.brief}
                boardUrl={saved.boardUrl}
                anthropicApiKey={saved.anthropicApiKey}
                onBriefChange={(brief) => setSaved({ ...saved, brief })}
                onBoardUrlChange={(boardUrl) => setSaved({ ...saved, boardUrl })}
                onFlowLoaded={(next) => loadFlow(next, 'design')}
                onNeedKey={() => {
                  setError('Add your Anthropic API key first (Keys, top right).');
                  setKeysOpen(true);
                }}
              />
            </div>
            {selected === 'design' ? null : selectedStage ? (
              <StageEditor
                key={selectedStage.id}
                stage={selectedStage}
                flow={flow}
                onChange={(patch) => updateStage(selectedStage.id, patch)}
                onDelete={() => deleteStage(selectedStage.id)}
              />
            ) : (
              <MasterEditor flow={flow} onChange={(patch) => setFlow({ ...flow, ...patch })} />
            )}
          </div>
        </section>

        {/* Conversation */}
        <section className="flex min-h-[520px] flex-col border-b-2 border-ink lg:min-h-0 lg:border-b-0 lg:border-r-2">
          <div className="flex flex-wrap items-center gap-2 border-b-2 border-ink p-2">
            <span className={fieldLabel}>Start at</span>
            <select
              value={startAt}
              onChange={(e) => {
                setStartAt(e.target.value);
                restart(e.target.value);
              }}
              className="border-2 border-ink bg-paper px-2 py-1 font-label text-[12px]"
            >
              <option value="">{firstStage ? `${firstStage.code} ${firstStage.name} (first)` : '—'}</option>
              {orderedStages.slice(1).map((s) => (
                <option key={s.id} value={s.code}>
                  {s.code} {s.name}
                </option>
              ))}
            </select>
            <button onClick={() => restart()} disabled={busy} className={buttonOutline}>
              Restart
            </button>
            {session.expressive && (
              <span
                className="border-2 border-ink px-2 py-1 font-label text-[10px] uppercase tracking-widest text-ink"
                title="The agent adds performance cues and an expressive ElevenLabs model (v4 Turbo) speaks them. Restart to go back to the normal voice."
              >
                ✦ Expressive voice
              </span>
            )}
            <label
              className="ml-auto flex items-center gap-2 font-label text-[11px] uppercase tracking-widest text-muted-ink"
              title="Open mic (blue): how long you need to be quiet before what you said is sent"
            >
              Pause before sending
              <input
                type="range"
                min={0.2}
                max={3}
                step={0.2}
                value={saved.pauseSeconds}
                onChange={(e) => setSaved({ ...saved, pauseSeconds: Number(e.target.value) })}
                className="w-28 accent-[#18a0fb]"
              />
              <span className="w-8 tabular-nums normal-case text-ink">{saved.pauseSeconds.toFixed(1)}s</span>
            </label>
            <label className="flex items-center gap-1.5 font-label text-[11px] uppercase tracking-widest text-muted-ink">
              <input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} className="accent-ink" />
              Spoken replies
            </label>
            <VoicePanel
              settings={saved.voiceSettings ?? DEFAULT_VOICE_SETTINGS}
              voices={saved.voices}
              activeVoice={saved.activeVoice}
              onSettingsChange={(voiceSettings) => setSaved({ ...saved, voiceSettings })}
              onVoicesChange={(voices, activeVoice) =>
                setSaved({ ...saved, voices, activeVoice, voiceId: voices[activeVoice]?.voiceId ?? '' })
              }
              onTest={(voiceId) =>
                speak('Hi there, this is how I sound with these settings. Does that work for you?', true, false, voiceId)
              }
              onTestExpressive={(voiceId) =>
                speak(
                  '[warmly] Hi there, this is my expressive voice. [laughs softly] I can sound pretty excited... ' +
                    '[whispers] or keep things quiet. [curious] So, how does this sound to you?',
                  true,
                  true,
                  voiceId,
                )
              }
              loadAccountVoices={async (): Promise<AccountVoices> => {
                if (!saved.elevenLabsApiKey.trim()) return { error: 'Add your ElevenLabs API key (Keys, top right) to pick voices by name.' };
                try {
                  const res = await fetch('/api/tts/voices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ apiKey: saved.elevenLabsApiKey }),
                  });
                  return (await res.json()) as AccountVoices;
                } catch {
                  return { error: 'Couldn’t reach the app server.' };
                }
              }}
              onCheck={async (): Promise<VoiceCheck> => {
                if (!saved.elevenLabsApiKey.trim()) return { error: 'Add your ElevenLabs API key first (Keys, top right).' };
                try {
                  const res = await fetch('/api/tts/check', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      apiKey: saved.elevenLabsApiKey,
                      voiceId: saved.voices[saved.activeVoice]?.voiceId ?? '',
                      voiceSettings: saved.voiceSettings ?? DEFAULT_VOICE_SETTINGS,
                    }),
                  });
                  return (await res.json()) as VoiceCheck;
                } catch {
                  return { error: 'Couldn’t reach the app server.' };
                }
              }}
            />
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            {messages.length === 0 && !busy && (
              <div className="flex flex-col items-center gap-3 py-10 text-center">
                <p className="font-body text-sm text-muted-ink">
                  Let the agent open the call, or just type (or speak) to start.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button onClick={() => sendTurn(null, { expressive: false })} disabled={!firstStage} className={buttonPrimary}>
                    Agent speaks first
                  </button>
                  <button
                    onClick={() => sendTurn(null, { expressive: true })}
                    disabled={!firstStage}
                    className={buttonOutline}
                    title="The agent performs its lines — [warmly], [laughs softly], [sighs]… — using ElevenLabs' expressive v4 Turbo model. A little slower to start speaking than the normal voice."
                  >
                    ✦ Agent speaks expressively first
                  </button>
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[80%] px-3 py-2 font-body text-sm ${
                    m.role === 'user' ? 'bg-ink text-paper' : 'border-2 border-ink bg-paper text-ink'
                  }`}
                >
                  {m.role === 'assistant' ? withoutCues(m.text) : m.text}
                </div>
              </div>
            ))}
            {busy && <p className="font-label text-[11px] uppercase tracking-widest text-muted-ink">Agent is thinking…</p>}
            {session.ended && (
              <p className="text-center font-label text-[11px] uppercase tracking-widest text-muted-ink">
                Conversation ended — press Restart to go again
              </p>
            )}
            {error && <p className="border-l-4 border-[#b91c1c] pl-2 font-body text-sm text-ink">{error}</p>}
            <div ref={bottomRef} />
          </div>

          {openMicOn && (
            <div className="flex items-center gap-2 border-t-2 border-ink px-3 pt-2 font-label text-[10px] uppercase tracking-widest text-muted-ink">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${
                  openMicStatus === 'hearing'
                    ? 'bg-[#18a0fb]'
                    : openMicStatus === 'listening'
                      ? 'animate-pulse bg-[#18a0fb]'
                      : 'bg-hair'
                }`}
                aria-hidden="true"
              />
              {session.ended
                ? 'Call ended — press Restart and the open mic carries on'
                : speaking
                  ? 'Agent is speaking — mic paused so it can’t hear itself'
                  : busy
                    ? 'Agent is thinking…'
                    : openMicStatus === 'hearing'
                      ? `Hearing you — sends after ${saved.pauseSeconds.toFixed(1)}s of quiet`
                      : openMicStatus === 'listening'
                        ? 'Listening — just talk'
                        : 'Starting the mic…'}
            </div>
          )}
          <div className={`flex items-center gap-2 p-3 ${openMicOn ? '' : 'border-t-2 border-ink'}`}>
            <button
              onClick={toggleMic}
              disabled={busy || session.ended}
              className={`h-[38px] w-[38px] shrink-0 ${buttonIcon} ${listening ? 'bg-ink text-paper' : ''}`}
              title={listening ? 'Listening — click to stop' : 'Speak your reply'}
            >
              🎤
            </button>
            <OpenMic
              on={openMicOn}
              paused={busy || speaking || session.ended}
              pauseSeconds={saved.pauseSeconds}
              onToggle={(on) => {
                if (on) recognitionRef.current?.stop();
                setOpenMicOn(on);
                if (on) setError(null);
              }}
              onTranscript={setInput}
              onUtterance={(text) => {
                setInput('');
                void sendTurn(text, undefined, takeEarlyTurn(text));
              }}
              onPhraseFinal={startEarlyTurn}
              onStatus={setOpenMicStatus}
              onError={setError}
            />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && submit()}
              disabled={busy || session.ended}
              placeholder={listening || openMicOn ? 'Listening…' : 'Type as the caller…'}
              className={`flex-1 disabled:bg-muted ${fieldInput}`}
            />
            <button onClick={submit} disabled={busy || session.ended || !input.trim()} className={buttonPrimary}>
              Send
            </button>
          </div>
        </section>

        {/* Inspector — tucked away by default; the edge tab slides it out and back in. */}
        <section className="flex min-h-[420px] lg:min-h-0">
          <button
            onClick={() => setInspectorOpen((o) => !o)}
            aria-expanded={inspectorOpen}
            title={inspectorOpen ? 'Slide the inspector away' : 'Show the inspector: current stage, collected information, what happened each turn'}
            className="flex w-9 shrink-0 flex-col items-center gap-3 bg-paper py-4 text-ink transition-colors duration-100 hover:bg-muted"
          >
            <span className="font-label text-sm">{inspectorOpen ? '▸' : '◂'}</span>
            <span className="rotate-180 font-label text-[10px] uppercase tracking-widest [writing-mode:vertical-rl]">
              Inspector
            </span>
            {!inspectorOpen && session.stageCode && (
              <span className="bg-ink px-1 font-label text-[10px] text-paper" title="Current stage">
                {session.ended ? 'END' : session.stageCode}
              </span>
            )}
          </button>
          <div
            className={`overflow-hidden transition-[width] duration-300 ease-out ${inspectorOpen ? 'w-[340px]' : 'w-0'}`}
            aria-hidden={!inspectorOpen}
          >
            <div className="h-full w-[340px] border-l-2 border-ink p-4">
              <Inspector flow={flow} state={session} log={log} />
            </div>
          </div>
        </section>
      </div>
      {projectsOpen && (
        <ProjectsMenu
          current={current}
          onSaved={markSaved}
          onOpen={openProject}
          onNew={newProject}
          onClose={() => setProjectsOpen(false)}
        />
      )}
    </main>
  );
}
