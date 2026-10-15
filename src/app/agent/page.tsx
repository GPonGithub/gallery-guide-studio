'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { DesignPanel } from '@/components/agent/DesignPanel';
import { MasterEditor, StageEditor } from '@/components/agent/FlowEditor';
import { OpenMic, type OpenMicStatus, type UtteranceTiming } from '@/components/agent/OpenMic';
import { SpeechQueue } from '@/components/agent/speechQueue';
import { BackgroundMusic } from '@/components/agent/backgroundMusic';
import { MusicPanel } from '@/components/agent/MusicPanel';
import { CueMarker, CueMonitor, type SentCue } from '@/components/agent/CueMonitor';
import { adoptKeylessTrack, clearTrack, loadTrack, saveTrack } from '@/lib/musicStore';
import type { TurnStreamEvent } from '@/lib/agent/runtime';
import { MAX_VOICES, VoicePanel, type AccountVoices, type SavedVoice, type VoiceCheck } from '@/components/agent/VoicePanel';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/storage';
import type { VoiceSettings } from '@/lib/types';
import { ProjectsMenu, type CurrentProject } from '@/components/agent/ProjectsMenu';
import type { AgentProject, ProjectMusic, ProjectVoice } from '@/lib/agent/projectStore';
import { Inspector, type TurnLog } from '@/components/agent/Inspector';
import { blankStage, emptyFlow, initialState, sampleFlow, sortStages, startStage } from '@/lib/agent/flow';
import type { AgentEvent, AgentFlow, ChatTurn, CueEvent, CueStatus, SessionState, Stage, TurnResponse } from '@/lib/agent/types';
import { buttonIcon, buttonOutline, buttonPrimary, buttonUnsaved, fieldInput, fieldLabel } from '@/lib/styles';

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
  /** Up to ten saved ElevenLabs voices (empty ID = the default voice). */
  voices: SavedVoice[];
  /** Index into `voices` of the one the agent speaks with. */
  activeVoice: number;
  /** The voice in use speaks expressively (performs [cues]) — like the sliders, saved per voice. */
  voiceExpressive: boolean;
  /** Background music volume, 0–10. (The file itself lives in IndexedDB — see musicStore.) */
  musicVolume: number;
  /** How far the music dips while the agent talks, 0–10 (10 = silent). */
  musicDip: number;
  /** The open project's music (its file is in IndexedDB — see musicStore), or none. */
  musicTrack: { name: string; key: string } | null;
};

// Performance cues ([warmly], [laughs softly]…) are for the voice, not the reader.
const withoutCues = (text: string) => text.replace(/\[[^\]\n]{1,40}\]\s*/g, '').trim();

// What a project saves, as it stands now — compared with the last save to
// tell whether anything (flow, brief, knowledge, board, voices, music) changed.
type ProjectContent = Pick<AgentProject, 'flow' | 'brief' | 'boardUrl'> & { voice: ProjectVoice; music: ProjectMusic | null };

const voiceOf = (s: Saved): ProjectVoice => ({
  voices: s.voices,
  activeVoice: s.activeVoice,
  voiceSettings: s.voiceSettings,
  expressive: s.voiceExpressive,
});
const musicOf = (s: Saved): ProjectMusic | null =>
  s.musicTrack ? { ...s.musicTrack, volume: s.musicVolume, dip: s.musicDip } : null;
const contentOf = (s: Saved): ProjectContent => ({ flow: s.flow, brief: s.brief, boardUrl: s.boardUrl, voice: voiceOf(s), music: musicOf(s) });

// Keys sorted, so the same settings compare equal whatever order they were written in.
const snapshotOf = (content: ProjectContent) =>
  JSON.stringify(content, (_key, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  );

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
    voiceExpressive: false,
    musicVolume: 5,
    musicDip: 5,
    musicTrack: null,
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
  // Every TouchDesigner cue of this conversation, as it went out (see CueMonitor).
  const [cueLog, setCueLog] = useState<SentCue[]>([]);
  const cueStatusRef = useRef(new Map<string, CueStatus>());
  const [openMicOn, setOpenMicOn] = useState(false);
  const [openMicStatus, setOpenMicStatus] = useState<OpenMicStatus>('off');
  // A reply being worked out early, during the open mic's pause (see startEarlyTurn).
  const earlyTurnRef = useRef<{
    text: string;
    basis: string;
    controller: AbortController;
    stream: TurnStream;
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

  // Background music: starts when the agent is asked to open the call, dips
  // while the agent talks, fades out when the call ends or restarts.
  const musicRef = useRef<BackgroundMusic | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  // Which music file the player has loaded (see the effect below), and the
  // file itself — kept here too, in case this browser can't store it.
  const loadedMusicKey = useRef<string | null>(null);
  const musicFileRef = useRef<{ key: string; blob: Blob } | null>(null);
  useEffect(() => {
    const music = new BackgroundMusic(setMusicPlaying);
    musicRef.current = music;
    loadedMusicKey.current = null;
    // Music dropped in before music belonged to projects had no key: adopt it
    // into the open project (as an unsaved change), rather than losing it.
    void adoptKeylessTrack().then((adopted) => {
      if (adopted) setSaved((s) => (s && !s.musicTrack ? { ...s, musicTrack: adopted } : s));
    });
    return () => {
      music.stop(0);
      music.setTrack(null);
    };
  }, []);
  // Loads the open project's music into the player whenever it changes
  // (a project opened, a file dropped in or removed): from this browser's
  // copy if it has it, otherwise from the saved project.
  const musicKey = saved?.musicTrack?.key ?? null;
  useEffect(() => {
    const music = musicRef.current;
    if (!music || !saved || musicKey === loadedMusicKey.current) return;
    loadedMusicKey.current = musicKey;
    if (!musicKey || !saved.musicTrack) {
      music.setTrack(null);
      return;
    }
    const { name } = saved.musicTrack;
    const projectId = saved.projectId;
    void (async () => {
      const stored = await loadTrack();
      let blob = musicFileRef.current?.key === musicKey ? musicFileRef.current.blob : null;
      if (!blob && stored?.key === musicKey) blob = stored.blob;
      // The same file under an older key (e.g. from before music belonged to projects): use it.
      if (!blob && stored && stored.name === name) {
        blob = stored.blob;
        void saveTrack({ name, key: musicKey, blob });
      }
      if (!blob && projectId) {
        const res = await fetch(`/api/agent/projects/music?id=${encodeURIComponent(projectId)}`, { cache: 'no-store' });
        if (res.ok) {
          blob = await res.blob();
          void saveTrack({ name, key: musicKey, blob });
        }
      }
      if (loadedMusicKey.current !== musicKey) return; // switched again meanwhile
      if (blob) {
        musicFileRef.current = { key: musicKey, blob };
        music.setTrack(blob);
      }
      else setError(`The music file “${name}” couldn’t be found — drop it into the Music panel again.`);
    })();
  }, [musicKey]); // eslint-disable-line react-hooks/exhaustive-deps -- only a different file needs loading
  useEffect(() => {
    if (saved) musicRef.current?.setLevels(saved.musicVolume, saved.musicDip);
  }, [saved?.musicVolume, saved?.musicDip]); // eslint-disable-line react-hooks/exhaustive-deps -- only the two levels matter
  // While "Try the dip" is running, the agent finishing speaking mustn't cut it short (and vice versa).
  const speakingRef = useRef(false);
  const tryingDipRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    speakingRef.current = speaking;
    if (!tryingDipRef.current) musicRef.current?.duck(speaking);
  }, [speaking]);
  // Once the call has ended and the goodbye has been spoken, the music fades out.
  useEffect(() => {
    if (session?.ended && !speaking) musicRef.current?.stop();
  }, [session?.ended, speaking]);

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
    musicRef.current?.stop();
    setCueLog([]);
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
    musicRef.current?.stop();
    setCueLog([]);
    setSession(initialState(next));
    setMessages([]);
    setLog([]);
    setError(null);
  };

  const dirty = saved.projectId ? snapshotOf(contentOf(saved)) !== saved.savedSnapshot : flow.stages.length > 0;
  const current: CurrentProject = {
    id: saved.projectId,
    name: saved.projectName,
    dirty,
    flow,
    brief: saved.brief,
    boardUrl: saved.boardUrl,
    voice: voiceOf(saved),
    music: musicOf(saved),
    musicBlob: async () => {
      const key = saved.musicTrack?.key;
      if (musicFileRef.current && musicFileRef.current.key === key) return musicFileRef.current.blob;
      const stored = await loadTrack();
      return stored && stored.key === key ? stored.blob : null;
    },
  };
  const okToLeave = () =>
    !dirty || window.confirm(`"${saved.projectName}" has unsaved changes. Continue without saving them?`);

  // Records `project` as what's on disk. (Projects saved before voices were
  // part of a project keep whatever voice is set up now.)
  const markSaved = (project: AgentProject) =>
    setSaved((s) =>
      s
        ? {
            ...s,
            projectId: project.id,
            projectName: project.name,
            savedSnapshot: snapshotOf({
              flow: project.flow,
              brief: project.brief,
              boardUrl: project.boardUrl,
              voice: project.voice ?? voiceOf(s),
              music: project.music ?? null,
            }),
          }
        : s,
    );

  const openProject = (project: AgentProject) => {
    if (!okToLeave()) return;
    loadFlow(project.flow, 'design');
    const voice = project.voice;
    const music = project.music ?? null;
    setSaved((s) =>
      s
        ? {
            ...s,
            brief: project.brief,
            boardUrl: project.boardUrl,
            ...(voice && {
              voices: voice.voices,
              activeVoice: voice.activeVoice,
              voiceSettings: voice.voiceSettings,
              voiceExpressive: voice.expressive ?? false,
              voiceId: voice.voices[voice.activeVoice]?.voiceId ?? '',
            }),
            // Only a project that has music saved with it plays any.
            musicTrack: music && { name: music.name, key: music.key },
            ...(music && { musicVolume: music.volume, musicDip: music.dip }),
          }
        : s,
    );
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
            musicTrack: null,
          }
        : s,
    );
    setProjectsOpen(false);
  };

  // `always` = play even with Spoken replies off (the voice panel's Test button).
  // `expressive` = the text carries performance cues for an expressive model.
  // `voiceId` = a specific saved voice (the panel's per-voice Test buttons);
  // otherwise the voice in use. `settings` = that voice's own saved settings;
  // otherwise the sliders as they are now.
  const speak = async (text: string, always = false, expressive = false, voiceId?: string, settings?: VoiceSettings) => {
    const voiceSettings = settings ?? voiceRef.current.settings;
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
          voiceSettings,
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
        audio.playbackRate = voiceSettings.speed;
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
  const checkMoments = async (state: SessionState, userText: string | null, reply: string, afterMessage: number) => {
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
      for (const event of data.events) if (event.type === 'cue') noteCue(event, afterMessage);
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
  // `takeTicket` hands over audio already being made for a sentence, if any.
  // `listenCues` does the same for TouchDesigner cues (and their status updates).
  type TurnStream = {
    listen: (onSentence: (sentence: string) => void) => void;
    listenCues: (onCue: (cue: CueEvent) => void) => void;
    takeTicket: (sentence: string) => Promise<string | null> | undefined;
    done: Promise<TurnResponse>;
  };

  // Asks the server to start making one sentence's audio; returns a one-time
  // ticket for playing it (see /api/tts/stream). Settings are read now, so a
  // slider moved while the agent was thinking still applies.
  const requestTicket = async (text: string, previousText: string, expressive: boolean) => {
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
  };

  const startTurnStream = (
    state: SessionState,
    history: ChatTurn[],
    userText: string | null,
    options: { holdCues?: boolean; signal?: AbortSignal } = {},
  ): TurnStream => {
    const sentences: string[] = [];
    // Set later by listen(), from outside this function.
    const hub: { listener: ((sentence: string) => void) | null; cueListener: ((cue: CueEvent) => void) | null } = {
      listener: null,
      cueListener: null,
    };
    const cues: CueEvent[] = [];
    // A head start for the voice: the first sentence's audio starts being
    // made as soon as the server has written it (a draft, or the first real
    // sentence of a turn still waiting for the pause to end) — not when it's
    // finally played. A draft the analysis rejects is simply never played.
    const voiceReady = voiceOn && voiceRef.current.apiKey.trim() !== '';
    const tickets = new Map<string, Promise<string | null>>();
    const headStart = (text: string) => {
      if (!voiceReady || tickets.size > 0 || !withoutCues(text)) return;
      tickets.set(text, requestTicket(text, '', Boolean(state.expressive)).catch(() => null));
    };
    const done = (async (): Promise<TurnResponse> => {
      const res = await fetch('/api/agent/turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          flow,
          state,
          history,
          userText,
          anthropicApiKey: saved.anthropicApiKey,
          // "When spoken" cues are held by the server and sent by the app as the reply is heard.
          holdCues: options.holdCues || cuesWhenSpoken,
        }),
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
          if (event.type === 'draft') {
            headStart(event.text);
          } else if (event.type === 'sentence') {
            if (sentences.length === 0) headStart(event.text);
            sentences.push(event.text);
            hub.listener?.(event.text);
          } else if (event.type === 'cue') {
            cues.push(event.cue);
            hub.cueListener?.(event.cue);
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
      takeTicket: (sentence) => {
        const ticket = tickets.get(sentence);
        tickets.delete(sentence);
        return ticket;
      },
      listenCues: (onCue) => {
        for (const cue of cues) onCue(cue);
        hub.cueListener = onCue;
      },
      listen: (onSentence) => {
        for (const sentence of sentences) onSentence(sentence);
        hub.listener = onSentence;
      },
    };
  };

  // Speaks one reply sentence by sentence, each requested as soon as it's written.
  // `hooks`: told when the voice actually starts playing, and when it goes quiet.
  const newSpeechQueue = (expressive: boolean, hooks: { onPlay?: () => void; onQuiet?: () => void } = {}) =>
    new SpeechQueue({
      expressive,
      playbackRate: () => voiceRef.current.settings.speed,
      onSpeakingChange: (speakingNow) => {
        setSpeaking(speakingNow);
        if (!speakingNow) hooks.onQuiet?.();
      },
      onPlay: hooks.onPlay,
      onError: setError,
      requestTicket: (text, previousText) => requestTicket(text, previousText, expressive),
      requestClip: async (text, previousText) => {
        const res = await fetch('/api/tts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voiceId: voiceRef.current.voiceId,
            apiKey: voiceRef.current.apiKey,
            voiceSettings: voiceRef.current.settings,
            expressive,
            previousText: expressive ? undefined : previousText,
          }),
        });
        if (!res.ok) throw new Error(await res.text());
        return res.blob();
      },
    });

  // Thinking during the pause: the moment Chrome confirms a finished phrase,
  // start working out the reply while the pause timer is still running. If
  // the caller then stays quiet, that reply is used as-is (saving up to the
  // whole pause); if they keep talking, it's thrown away. TouchDesigner cues
  // are held back until the turn is actually used.
  const turnBasis = `${session.sessionId}:${messages.length}`;
  // TouchDesigner cues go out as the reply that goes with them is heard (the
  // default), or the moment the agent decides (see AgentFlow.tdTiming).
  const cuesWhenSpoken = (flow.tdTiming ?? 'spoken') === 'spoken';
  // Regular or expressive comes from the voice in use (Voice panel), read
  // fresh for every turn — so switching it mid-call applies to the next reply.
  const withVoiceMode = (state: SessionState): SessionState => ({ ...state, expressive: saved.voiceExpressive });
  const startEarlyTurn = (text: string) => {
    if (busy || session.ended || !saved.anthropicApiKey.trim()) return;
    if (earlyTurnRef.current?.text === text && earlyTurnRef.current.basis === turnBasis) return;
    earlyTurnRef.current?.controller.abort();
    const controller = new AbortController();
    const stream = startTurnStream(withVoiceMode(session), messages, text, { holdCues: true, signal: controller.signal });
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

  // A cue went out (or its status changed): show it in the TouchDesigner
  // window and the conversation, and keep the inspector's copy up to date.
  const noteCue = (cue: CueEvent, afterMessage: number) => {
    cueStatusRef.current.set(cue.id, cue.status);
    setCueLog((list) => {
      const i = list.findIndex((c) => c.id === cue.id);
      if (i < 0) return [...list, { ...cue, at: Date.now(), afterMessage }];
      const next = [...list];
      next[i] = { ...next[i], status: cue.status };
      return next;
    });
    setLog((l) =>
      l.map((entry) =>
        entry.events.some((e) => e.type === 'cue' && e.id === cue.id)
          ? { ...entry, events: entry.events.map((e) => (e.type === 'cue' && e.id === cue.id ? { ...e, status: cue.status } : e)) }
          : entry,
      ),
    );
  };

  // A turn worked out early held its cues back (nothing may fire for a turn
  // that might be thrown away). Now it's being used, send each one straight
  // away — with the message it would have sent when it fired.
  const sendHeldCue = async (cue: CueEvent, afterMessage: number) => {
    noteCue({ ...cue, status: 'sending' }, afterMessage);
    let status: CueStatus = 'failed';
    try {
      const res = await fetch('/api/agent/cues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flow, payloads: [cue.payload] }),
      });
      status = ((await res.json()) as { statuses: CueStatus[] }).statuses[0] ?? 'failed';
    } catch {
      // A cue that can't be delivered never interrupts the conversation.
    }
    noteCue({ ...cue, status }, afterMessage);
  };

  // `heard`: when the open mic last heard the caller (for the wait measurement).
  const sendTurn = async (userText: string | null, early?: TurnStream, heard?: UtteranceTiming) => {
    if (busy || session.ended) return;
    // How long the caller waits: from their last word (or the click) to the
    // reply's first words on screen and the voice starting. Shown in the
    // inspector and logged by the app server.
    const clock = {
      origin: heard?.lastHeardAt || performance.now(),
      confirmed: heard?.confirmedAt ?? null,
      sent: performance.now(),
      text: null as number | null,
      voice: null as number | null,
      server: null as string[] | null,
      reported: false,
    };
    const since = (t: number) => `${((t - clock.origin) / 1000).toFixed(1)}s`;
    const waitLine = () =>
      `${heard ? 'after your last word:' : 'after the click:'} ` +
      [
        clock.confirmed !== null && `Chrome confirmed ${since(clock.confirmed)}`,
        heard && `sent ${since(clock.sent)}`,
        clock.text !== null && `first words ${since(clock.text)}`,
        clock.voice !== null ? `voice heard ${since(clock.voice)}` : 'no voice',
      ]
        .filter(Boolean)
        .join(' · ');
    const postWait = (line: string) =>
      void fetch('/api/agent/timing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wait: line, server: clock.server, early: Boolean(early) }),
      }).catch(() => {});
    // The voice started after the turn was logged: add the wait to that entry now.
    let loggedTurn: number | null = null;
    const reportWait = () => {
      if (clock.reported || !clock.server) return; // not done yet — the done step reports it
      clock.reported = true;
      const line = waitLine();
      const turn = loggedTurn;
      setLog((l) => l.map((entry) => (entry.turn === turn ? { ...entry, timings: [line, ...entry.timings] } : entry)));
      postWait(line);
    };
    const state = withVoiceMode(session);
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
    // Cues of this turn go out before its reply (the reply is about the
    // situation they mark), so that's where they show in the conversation.
    const cuePosition = withCaller.length;
    // "When spoken": this turn's cues wait here until its reply is actually
    // heard — the voice starting, or (voice off) the reply appearing.
    const gate = { open: !cuesWhenSpoken, waiting: [] as CueEvent[] };
    const openGate = () => {
      if (gate.open) return;
      gate.open = true;
      for (const cue of gate.waiting.splice(0)) void sendHeldCue(cue, cuePosition);
    };
    // Each sentence appears in the chat and goes to the voice the moment it's written.
    const queue =
      voiceOn && voiceRef.current.apiKey.trim()
        ? // If the voice fails and goes quiet without playing, the cues still go.
          newSpeechQueue(Boolean(state.expressive), {
            onPlay: () => {
              if (clock.voice === null) {
                clock.voice = performance.now();
                reportWait();
              }
              openGate();
            },
            onQuiet: openGate,
          })
        : null;
    queueRef.current = queue;
    let shown = '';
    let stream: TurnStream | undefined = early;
    // Held cues (an early turn's, or any "when spoken" cue) are sent by the app.
    const onCue = (cue: CueEvent) => {
      if (cue.status !== 'pending') noteCue(cue, cuePosition);
      else if (gate.open) void sendHeldCue(cue, cuePosition);
      else gate.waiting.push(cue);
    };
    const onSentence = (sentence: string) => {
      clock.text ??= performance.now();
      shown = `${shown} ${sentence}`.trim();
      setMessages([...withCaller, { role: 'assistant', text: shown }]);
      if (withoutCues(sentence)) queue?.add(sentence, stream?.takeTicket(sentence));
      if (!queue) openGate();
    };
    try {
      let data: TurnResponse | null = null;
      if (early) {
        try {
          early.listenCues(onCue);
          early.listen(onSentence);
          data = await early.done;
        } catch (err) {
          // An early turn that failed is redone normally — unless it had
          // already started speaking, which must never repeat. Its waiting
          // cues are dropped; the redone turn brings its own.
          if (shown) throw err;
          gate.waiting.length = 0;
        }
      }
      if (!data) {
        stream = startTurnStream(state, history, userText);
        stream.listenCues(onCue);
        stream.listen(onSentence);
        data = await stream.done;
      }
      queue?.finish();
      // Nothing to say out loud (or no voice): the reply is "heard" now.
      if (!queue || queue.idle) openGate();
      setMessages([...withCaller, { role: 'assistant', text: data.reply }]);
      setSession(data.state);
      // Cue statuses as last heard (held ones may have been sent since the turn finished).
      const events = data.events.map((e) =>
        e.type === 'cue' ? { ...e, status: cueStatusRef.current.get(e.id) ?? e.status } : e,
      );
      clock.server = data.timings;
      // Normally the voice has started by now; if not, the wait is filled in when it does.
      const voiceDone = clock.voice !== null || !queue || queue.idle;
      setLog((l) => {
        loggedTurn = l.length + 1;
        const timings = [...(voiceDone ? [waitLine()] : []), ...(early ? ['started during your pause'] : []), ...data.timings];
        return [...l, { turn: loggedTurn, userText, events, timings }];
      });
      if (voiceDone) {
        clock.reported = true;
        postWait(waitLine());
      }
      void checkMoments(data.state, userText, data.reply, cuePosition + 1);
    } catch (err) {
      // A failed turn sends nothing.
      gate.open = true;
      gate.waiting.length = 0;
      queue?.cancel();
      setMessages(history);
      if (userText) setInput(userText);
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  // "Agent speaks first": the music starts in the same click — browsers only
  // let sound start from one — while the agent's opening line is being written.
  const openCall = () => {
    if (saved.anthropicApiKey.trim()) musicRef.current?.start();
    void sendTurn(null);
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
          {/* Opens Projects to save. Grey with red "Not saved" while anything (flow, brief,
              knowledge base, voices, music) has changed since the last save. */}
          <button
            onClick={() => setProjectsOpen(true)}
            className={dirty ? buttonUnsaved : buttonOutline}
            title={dirty ? 'There are unsaved changes — click to save the project' : 'Everything is saved'}
          >
            {dirty ? 'Not saved' : 'Saved ✓'}
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
                onKnowledgeChange={(knowledge) => setFlow({ ...flow, knowledge })}
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
            {saved.voiceExpressive && (
              <span
                className="border-2 border-ink px-2 py-1 font-label text-[10px] uppercase tracking-widest text-ink"
                title="The voice in use is set to expressive (Voice panel): the agent adds performance cues — [laughs], [whispers]… — and ElevenLabs' expressive model performs them."
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
            <MusicPanel
              trackName={saved.musicTrack?.name ?? null}
              playing={musicPlaying}
              volume={saved.musicVolume}
              dip={saved.musicDip}
              onFile={async (file) => {
                const key = crypto.randomUUID();
                const kept = await saveTrack({ name: file.name, key, blob: file });
                musicRef.current?.setTrack(file);
                loadedMusicKey.current = key;
                musicFileRef.current = { key, blob: file };
                setSaved((s) => (s ? { ...s, musicTrack: { name: file.name, key } } : s));
                return kept ? null : 'Playing it now — save the project to keep it (this browser’s storage is blocked).';
              }}
              onRemove={() => {
                musicRef.current?.setTrack(null);
                loadedMusicKey.current = null;
                musicFileRef.current = null;
                setSaved((s) => (s ? { ...s, musicTrack: null } : s));
                void clearTrack();
              }}
              onPreview={() => (musicPlaying ? musicRef.current?.stop() : musicRef.current?.start())}
              onTryDip={() => {
                if (tryingDipRef.current) clearTimeout(tryingDipRef.current);
                musicRef.current?.duck(true);
                tryingDipRef.current = setTimeout(() => {
                  tryingDipRef.current = null;
                  musicRef.current?.duck(speakingRef.current);
                }, 3000);
              }}
              onVolumeChange={(musicVolume) => setSaved({ ...saved, musicVolume })}
              onDipChange={(musicDip) => setSaved({ ...saved, musicDip })}
            />
            <VoicePanel
              settings={saved.voiceSettings ?? DEFAULT_VOICE_SETTINGS}
              voices={saved.voices}
              activeVoice={saved.activeVoice}
              onSettingsChange={(voiceSettings) => setSaved({ ...saved, voiceSettings })}
              expressive={saved.voiceExpressive}
              onExpressiveChange={(voiceExpressive) => setSaved({ ...saved, voiceExpressive })}
              onVoicesChange={(voices, activeVoice) => {
                // Switching to a voice with saved settings moves the sliders (and
                // regular/expressive) to them.
                const switchedTo = activeVoice !== saved.activeVoice ? voices[activeVoice] : undefined;
                setSaved({
                  ...saved,
                  voices,
                  activeVoice,
                  voiceId: voices[activeVoice]?.voiceId ?? '',
                  voiceSettings: switchedTo?.settings ? { ...switchedTo.settings } : saved.voiceSettings,
                  voiceExpressive: switchedTo?.settings ? Boolean(switchedTo.expressive) : saved.voiceExpressive,
                });
              }}
              onTest={(voiceId, settings) =>
                speak('Hi there, this is how I sound with these settings. Does that work for you?', true, false, voiceId, settings)
              }
              onTestExpressive={(voiceId, settings) =>
                speak(
                  '[warmly] Hi there, this is my expressive voice. [laughs softly] I can sound pretty excited... ' +
                    '[whispers] or keep things quiet. [curious] So, how does this sound to you?',
                  true,
                  true,
                  voiceId,
                  settings,
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
                  <button
                    onClick={openCall}
                    disabled={!firstStage}
                    className={buttonPrimary}
                    title={`Speaks with ${saved.voices[saved.activeVoice]?.name.trim() || 'the voice in use'} (${saved.voiceExpressive ? 'expressive' : 'regular'}) — change it in the Voice panel`}
                  >
                    Agent speaks first
                  </button>
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <Fragment key={i}>
                {cueLog
                  .filter((c) => c.afterMessage === i)
                  .map((c) => (
                    <CueMarker key={c.id} cue={c} />
                  ))}
                <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[80%] px-3 py-2 font-body text-sm ${
                      m.role === 'user' ? 'bg-ink text-paper' : 'border-2 border-ink bg-paper text-ink'
                    }`}
                  >
                    {m.role === 'assistant' ? withoutCues(m.text) : m.text}
                  </div>
                </div>
              </Fragment>
            ))}
            {cueLog
              .filter((c) => c.afterMessage >= messages.length)
              .map((c) => (
                <CueMarker key={c.id} cue={c} />
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

          <CueMonitor
            latest={cueLog.at(-1) ?? null}
            count={cueLog.length}
            tdUrl={flow.tdUrl}
            timing={flow.tdTiming ?? 'spoken'}
            onTimingChange={(tdTiming) => setFlow({ ...flow, tdTiming })}
          />

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
              onUtterance={(text, timing) => {
                setInput('');
                void sendTurn(text, takeEarlyTurn(text), timing);
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
