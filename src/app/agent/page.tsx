'use client';

// First: splits this browser's storage by student team before anything reads it (see lib/team.ts).
import '@/lib/team';
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import { DesignPanel, type SheetImportOutcome, type SheetSync } from '@/components/agent/DesignPanel';
import { MasterEditor, StageEditor } from '@/components/agent/FlowEditor';
import { OpenMic, type OpenMicStatus, type UtteranceTiming } from '@/components/agent/OpenMic';
import { SpeechQueue } from '@/components/agent/speechQueue';
import { startStreamedClip, type StreamedClip } from '@/components/agent/streamedAudio';
import { BackgroundMusic } from '@/components/agent/backgroundMusic';
import { MusicPanel } from '@/components/agent/MusicPanel';
import { OnboardingTour } from '@/components/agent/OnboardingTour';
import { SceneButtons } from '@/components/agent/SceneButtons';
import { TeamToggle } from '@/components/agent/TeamToggle';
import { ProjectFileButtons } from '@/components/agent/ProjectFileButtons';
import { useHosting } from '@/lib/agent/hosting';
import { ONBOARDING_STEPS } from '@/components/agent/onboardingSteps';
import { DEMO_SCENE_NAMES, sceneDemoActions } from '@/components/agent/sceneDemo';
import { LAYOUT_DEMO_ACTIONS } from '@/components/agent/layoutDemo';
import { DEMO_SCENE, DEMO_STAGES, endMediaDemo, useMediaDemo } from '@/lib/agent/mediaDemo';
import { forgetMarker, markerArrived } from '@/lib/agent/markerPlay';
import { MEDIA_TOUR_STEPS, mediaTourActions } from '@/components/agent/mediaTour';
import { clampDesignWidth, DESIGN_WIDTH, DesignResizeHandle, loadDesignWidth, saveDesignWidth } from '@/components/agent/DesignResizeHandle';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CueMarker, CueMonitor, type SentCue } from '@/components/agent/CueMonitor';
import { MediaMarker, type PlayedSound } from '@/components/agent/MediaMarker';
import {
  duckSounds,
  playEvent,
  sceneSounds,
  soundsFor,
  startLoop,
  playSound,
  stopLoops,
  stopSounds,
  isSoundPlaying,
  anySoundPlaying,
  onSoundsChange,
  setSoundLevels,
  type PlannedSound,
} from '@/lib/agent/mediaPlayback';
import { clearVisuals, everyVisuals, hideVisual, isShowing, sceneMedia, showVisual, type PlannedMedia } from '@/lib/agent/mediaShow';
import { followRewording, loopOf, redoMediaLinks, undoMediaLinks, updateMediaLinks } from '@/lib/agent/mediaFolder';

/** A "once" media action an exchange triggered: show (or play) it, or remove (or stop) it. */
type JudgedMedia = { media: PlannedMedia; do: 'show' | 'remove' };
import {
  CHAT_FOLD_BELOW,
  CHAT_WIDTH,
  clampChatWidth,
  loadChatHidden,
  loadChatWidth,
  MediaWorkspace,
  saveChatHidden,
  saveChatWidth,
} from '@/components/agent/MediaWorkspace';
import { adoptKeylessTrack, clearTrack, loadTrack, saveTrack } from '@/lib/musicStore';
import {
  applySheetScene,
  getProject,
  refreshOtherSheetScenes,
  getProjectMusic,
  importSheetScenes,
  keepSceneEdits,
  deleteProject,
  listProjects,
  markWrittenToFigjam,
  moveServerProjectsHere,
  type SheetConflict,
} from '@/lib/agent/localProjects';
import { compareSceneNumbers, type SheetScene } from '@/lib/agent/sheetScenes';
import { displayLabel, isScriptUrl } from '@/lib/agent/sheetScript';
import {
  clearMemory,
  clearSceneMemory,
  createPatient,
  earlierMemory,
  listPatients,
  saveToMemory,
  savedInScene,
  type MemoryItem,
  type Patient,
  type SceneRef,
} from '@/lib/agent/memory';
import type { RememberedItem } from '@/lib/agent/types';
import type { TurnStreamEvent } from '@/lib/agent/runtime';
import { MAX_VOICES, VoicePanel, type AccountVoices, type SavedVoice, type VoiceCheck } from '@/components/agent/VoicePanel';
import { DEFAULT_VOICE_SETTINGS } from '@/lib/storage';
import type { VoiceSettings } from '@/lib/types';
import { ProjectsMenu, saveProjectRequest, type CurrentProject } from '@/components/agent/ProjectsMenu';
import type { AgentProject, ProjectMusic, ProjectVoice, SheetSource } from '@/lib/agent/projectStore';
import { Inspector, type TurnLog } from '@/components/agent/Inspector';
import { blankStage, emptyFlow, initialState, sampleFlow, sortStages, startStage } from '@/lib/agent/flow';
import type { AgentEvent, AgentFlow, ChatTurn, CueEvent, CueStatus, RoomMedia, SessionState, Stage, TurnResponse } from '@/lib/agent/types';
import { ACTION_KINDS, type EveryWhen } from '@/lib/agent/media';
import { buttonBusyCompact, buttonIcon, buttonOutline, buttonOutlineCompact, buttonPrimary, toolbarButtonWidth, buttonSaved, buttonUnsaved, fieldInput, fieldLabel } from '@/lib/styles';
import { ProgressLine } from '@/components/agent/ProgressLine';
import { Spinner } from '@/components/agent/Spinner';

// v4 prototype: define a goal-driven agent by typing stage cards (no
// image, no FigJam yet) and test it in the same page — chat in the
// middle, the agent's reasoning in the inspector on the right.

const STORAGE_KEY = 'gallery-guide-agent:v1';
/** Set once Onboard Me has been clicked: it stops pulsing for good. */
const ONBOARD_SEEN_KEY = 'chatbot-designer-onboard-seen';

// The onboarding tour's Scenes demo (see sceneDemo.ts) runs in a sandbox:
// the open work and conversations are put aside here — in this browser too,
// so closing the page mid-demo loses nothing — and come back afterwards.
const DEMO_BACKUP_KEY = 'chatbot-designer-scenes-demo';
type DemoBackup = { saved: Saved; conversations: ConversationStore; ids: string[] };

/** Deletes the demo's scenes (archived ones too) — never one that was there before the demo. */
async function removeDemoScenes(before: string[]) {
  const names: readonly string[] = DEMO_SCENE_NAMES;
  for (const p of await listProjects()) {
    if (!before.includes(p.id) && names.includes(p.name)) await deleteProject(p.id);
  }
}
const LEGACY_STUDIO_KEY = 'gallery-guide-studio:v1';


type Saved = {
  flow: AgentFlow;
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  voiceId: string;
  voiceSettings: VoiceSettings | null;
  /** The plain-English description the flow was generated from. */
  brief: string;
  /** `brief` as it was when the flow was last generated (null = never) — it's up to date when they match. */
  generatedBrief: string | null;
  /** The Google Sheet link last used to generate scenes. */
  sheetUrl: string;
  /** The sheet's Apps Script web app, which writes what scenes save into row 7 (see lib/agent/sheetScript.ts). */
  sheetScriptUrl: string;
  /** The sheet whose scenes get number buttons in "Describe the conversation in each scene". */
  activeSheetId: string | null;
  /** The open scene's link to its sheet column, if it was imported from one. */
  sceneSheet: SheetSource | null;
  /** Fingerprint of the open scene's flow as last written to FigJam (null = not written). */
  figjamFlow: string | null;
  /** The patient being talked to: what their conversations save is kept for them (see memory.ts). */
  activePatientId: string | null;
  /** The FigJam board the flow is drawn on and imported from. */
  boardUrl: string;
  /** The saved project this work belongs to (null = not saved yet). */
  projectId: string | null;
  projectName: string;
  /** flow + brief + board as last saved/opened — anything different is unsaved. */
  savedSnapshot: string;
  /** Open mic: seconds of quiet before what was said is sent. */
  pauseSeconds: number;
  /** Open mic: the caller can talk over the agent to interrupt it (the mic keeps listening while it speaks). */
  interruptByVoice: boolean;
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

// Conversations are kept — per scene, and within a scene per starting stage
// ("Start at") — when moving to another scene or starting point, and brought
// back on return (and across reloads). Only "Refresh this scene" (or
// "Complete restart") clears one. Scenes are keyed by id ('unsaved' for a
// scene not saved yet); `lastStart` remembers each scene's starting point.
const CONVERSATIONS_KEY = 'goal-agent-conversations:v2';
const OLD_CONVERSATIONS_KEY = 'goal-agent-conversations:v1';
type SceneConversation = { session: SessionState; messages: ChatTurn[]; log: TurnLog[]; cueLog: SentCue[]; startAt: string };
type ConversationStore = { threads: Record<string, SceneConversation>; lastStart: Record<string, string> };
const threadKey = (scene: string, start: string) => `${scene}::${start}`;

function loadConversations(): ConversationStore {
  try {
    const stored = window.localStorage.getItem(CONVERSATIONS_KEY);
    if (stored) return JSON.parse(stored) as ConversationStore;
    // From when each scene had a single conversation.
    const old = JSON.parse(window.localStorage.getItem(OLD_CONVERSATIONS_KEY) ?? '{}') as Record<string, SceneConversation>;
    const store: ConversationStore = { threads: {}, lastStart: {} };
    for (const [scene, c] of Object.entries(old)) {
      store.threads[threadKey(scene, c.startAt)] = c;
      store.lastStart[scene] = c.startAt;
    }
    return store;
  } catch {
    return { threads: {}, lastStart: {} };
  }
}

function storeConversations(store: ConversationStore) {
  try {
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(store));
  } catch {
    // Not kept across a reload — still kept while the page is open.
  }
}

// A saved conversation still fits its scene: the stage it was at still exists.
const fitsFlow = (c: SceneConversation | undefined, flow: AgentFlow): c is SceneConversation =>
  Boolean(c && (c.session.ended || flow.stages.some((st) => st.code === c.session.stageCode)));

// What the open scene may use from the patient's earlier scenes, and what its
// "cannot use" keeps out (all of it, with `error`, if the check failed).
type MemoryCheck = { allowed: MemoryItem[]; blocked: MemoryItem[]; error?: string };

// A remembered item as the agent is given it.
const toRemembered = (it: MemoryItem): RememberedItem => ({
  label: it.label,
  value: it.value,
  scene: it.sceneNumber ? `Scene ${it.sceneNumber} · ${it.sceneName}` : it.sceneName,
});

// Restart is the conversation's main reset, so its outline is twice as heavy as other buttons'.
// The chat toolbar's buttons are the compact kind, so the row stays on one line.
const restartButton = buttonOutlineCompact.replace('border-2 ', 'border-4 ');

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
    generatedBrief: null,
    sheetUrl: '',
    sheetScriptUrl: '',
    activeSheetId: null,
    sceneSheet: null,
    figjamFlow: null,
    activePatientId: null,
    boardUrl: '',
    projectId: null,
    projectName: 'Untitled scene',
    savedSnapshot: '',
    pauseSeconds: 1.0,
    interruptByVoice: true,
    voices: [],
    activeVoice: 0,
    voiceExpressive: false,
    musicVolume: 5,
    musicDip: 5,
    musicTrack: null,
  };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const stored = raw ? (JSON.parse(raw) as Partial<Saved>) : null;
    const saved = stored ? { ...fallback, ...stored } : fallback;
    // From before generation was tracked: assume the open flow came from the description as it stands.
    if (stored && !('generatedBrief' in stored)) saved.generatedBrief = saved.brief || null;
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
  // Every sound the conversation played for a media action (see mediaPlayback.ts), and where.
  const [soundLog, setSoundLog] = useState<PlayedSound[]>([]);
  // "Refresh this scene" asks the Design Process to update the scene; its progress shows on the button.
  const [updateRequest, setUpdateRequest] = useState(0);
  const [updateProgress, setUpdateProgress] = useState<{ startedAt: number; expectedMs: number; done?: boolean } | null>(
    null,
  );
  // Each turn's number, and the turn the caller last interrupted (with what they'd heard of its reply).
  const turnIdRef = useRef(0);
  const interruptedRef = useRef<{ turn: number; heard: string } | null>(null);
  // The latest interrupt (it's defined further down), for Escape.
  const interruptRef = useRef<() => unknown>(() => {});
  // Images and video on their way into the room (opening takes a moment), so a second check doesn't show them twice.
  const mediaStarting = useRef(new Set<string>());
  // The caller's words, judged for media moments (by history length and text) — see judgeCaller.
  const callerJudgements = useRef(new Map<string, Promise<JudgedMedia[]>>());
  const conversations = useRef<ConversationStore>({ threads: {}, lastStart: {} });
  /** The work put aside while the onboarding's Scenes demo runs (null = no demo). */
  const sceneDemo = useRef<DemoBackup | null>(null);
  const hosting = useHosting();

  // Onboard Me pulses until it's first clicked — then never again in this browser.
  const [onboardPulse, setOnboardPulse] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
      if (!window.localStorage.getItem(ONBOARD_SEEN_KEY)) setOnboardPulse(true);
    } catch {
      // Storage blocked: no pulse, rather than one that could never be switched off.
    }
  }, []);
  const startTour = useRef<(() => void) | null>(null);
  /** The Adding Immersive Media tour's demo scene, while it runs (see mediaDemo.ts). */
  const mediaDemo = useMediaDemo();
  const startMediaTour = useRef<(() => void) | null>(null);
  const stopOnboardPulse = () => {
    setOnboardPulse(false);
    try {
      window.localStorage.setItem(ONBOARD_SEEN_KEY, '1');
    } catch {
      // As above.
    }
  };
  // Row 7 of the sheet, per scene: how the last write of its saved information went.
  const [sheetSync, setSheetSync] = useState<Record<string, SheetSync>>({});
  const sheetWrites = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [confirmCompleteRestart, setConfirmCompleteRestart] = useState(false);
  // The Design Process column's width — dragged on its border (see DesignResizeHandle).
  const [designWidth, setDesignWidth] = useState<number>(DESIGN_WIDTH.standard);
  const resizeDesign = (width: number) => {
    const next = clampDesignWidth(width);
    setDesignWidth(next);
    saveDesignWidth(next);
  };
  // "Adding Immersive Media Process" is open: the media panel sits between Design Process and the chat.
  const [mediaOpen, setMediaOpen] = useState(false);
  // The chat's width while the media panel is open — dragged on the border between them.
  const [chatWidth, setChatWidth] = useState<number>(CHAT_WIDTH.standard);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
    setChatWidth(loadChatWidth());
    setChatHidden(loadChatHidden());
  }, []);
  // Pulled all the way right, the chat folds away (to a tab under the Inspector); pulled back, it returns.
  const [chatHidden, setChatHidden] = useState(false);
  const chatAway = mediaOpen && chatHidden;
  const hideChat = (hidden: boolean) => {
    setChatHidden(hidden);
    saveChatHidden(hidden);
  };
  const resizeChat = (width: number) => {
    if (width < CHAT_FOLD_BELOW) {
      if (!chatHidden) hideChat(true);
      return;
    }
    if (chatHidden) hideChat(false);
    const next = clampChatWidth(width, designWidth);
    setChatWidth(next);
    saveChatWidth(next);
  };
  const reopenChat = () => {
    hideChat(false);
    const next = clampChatWidth(CHAT_WIDTH.reopen, designWidth);
    setChatWidth(next);
    saveChatWidth(next);
  };
  const [sheetScenes, setSheetScenes] = useState<AgentProject[]>([]);
  const [patients, setPatients] = useState<Patient[]>([]);
  // Bumped whenever a patient's memory changes, to re-read it.
  const [memoryVersion, setMemoryVersion] = useState(0);
  const memoryChecks = useRef(new Map<string, Promise<MemoryCheck>>());
  const [memoryCheck, setMemoryCheck] = useState<{ key: string; result: MemoryCheck } | null>(null);
  const [sheetScenesVersion, setSheetScenesVersion] = useState(0);
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
        await moveServerProjectsHere(); // first visit: the project may still be on the old server store
        blob = await getProjectMusic(projectId).catch(() => null);
        if (blob) void saveTrack({ name, key: musicKey, blob });
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
    // The timeline's sounds follow the same Volume and Dip.
    if (saved) setSoundLevels(saved.musicVolume, saved.musicDip);
  }, [saved?.musicVolume, saved?.musicDip]); // eslint-disable-line react-hooks/exhaustive-deps -- only the two levels matter
  // While "Try the dip" is running, the agent finishing speaking mustn't cut it short (and vice versa).
  const speakingRef = useRef(false);
  const tryingDipRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    speakingRef.current = speaking;
    if (!tryingDipRef.current) {
      musicRef.current?.duck(speaking);
      // The timeline's sounds dip under the voice too.
      duckSounds(speaking);
    }
  }, [speaking]);
  // Undo and redo for the media work (bars, connections, when they play): ⌘Z undoes; ⌘⇧Z — or ⌘X, as
  // asked for — redoes (Ctrl on Windows). In a text box they're left to the box's own undo and cut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.defaultPrevented) return;
      const key = e.key.toLowerCase();
      if (key !== 'z' && key !== 'x') return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
      // Something selected on the page: ⌘X is still cut.
      if (key === 'x' && !document.getSelection()?.isCollapsed) return;
      const done = key === 'z' && !e.shiftKey ? undoMediaLinks() : redoMediaLinks();
      if (done || key === 'z') e.preventDefault();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  // Escape interrupts the agent while it speaks.
  useEffect(() => {
    if (!speaking) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      e.preventDefault();
      interruptRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [speaking]);
  // Whether any timeline sound is playing (so "Try the dip" can be tried on it).
  const [soundsPlaying, setSoundsPlaying] = useState(false);
  useEffect(() => onSoundsChange(() => setSoundsPlaying(anySoundPlaying())), []);
  // Another scene, or leaving the page: its "throughout the scene" sounds stop.
  useEffect(() => stopLoops, [saved?.projectId]);
  // …and the room empties.
  useEffect(() => clearVisuals, [saved?.projectId]);
  // Once the call has ended and the goodbye has been spoken, the music fades out.
  useEffect(() => {
    if (session?.ended && !speaking) musicRef.current?.stop();
  }, [session?.ended, speaking]);

  useEffect(() => {
    // A Scenes demo the page was closed in the middle of: put the work back first.
    let demoLeftOver: DemoBackup | null = null;
    try {
      const raw = window.localStorage.getItem(DEMO_BACKUP_KEY);
      if (raw) {
        demoLeftOver = JSON.parse(raw) as DemoBackup;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(demoLeftOver.saved));
        storeConversations(demoLeftOver.conversations);
      }
    } catch {
      demoLeftOver = null;
    }
    if (demoLeftOver) {
      const ids = demoLeftOver.ids;
      void removeDemoScenes(ids).finally(() => {
        try {
          window.localStorage.removeItem(DEMO_BACKUP_KEY);
        } catch {
          // Storage blocked.
        }
      });
    }
    const loaded = loadSaved();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
    setSaved(loaded);
    setSession(initialState(loaded.flow));
    // The open scene's conversation (always from its first stage — there's no "Start at" any more).
    conversations.current = loadConversations();
    const scene = loaded.projectId ?? 'unsaved';
    const start = '';
    const resumed = conversations.current.threads[threadKey(scene, start)];
    if (fitsFlow(resumed, loaded.flow)) {
      setSession(resumed.session);
      setMessages(resumed.messages);
      setLog(resumed.log);
      setCueLog(resumed.cueLog);
      setStartAt(resumed.startAt);
    }
    // First visit with projects in the browser: copy any from the old server store.
    void moveServerProjectsHere();
    setSelected('design');
  }, []);

  // The remembered column width; and a narrower window never squeezes the chat out.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only: localStorage doesn't exist during SSR
    setDesignWidth(loadDesignWidth());
    const onWindowResize = () => setDesignWidth((w) => clampDesignWidth(w));
    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
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

  // The number buttons in "Describe the conversation in each scene": one per scene of the
  // sheet in use, in scene-number order. Re-read whenever scenes may have
  // changed (a scene opened or saved, the Scenes dialog closed, an import).
  const activeSheetId = saved?.activeSheetId ?? null;
  const openSceneId = saved?.projectId ?? null;
  useEffect(() => {
    let stale = false;
    void (async () => {
      const all = activeSheetId ? await listProjects().catch(() => [] as AgentProject[]) : [];
      const ofSheet = all
        // Archived scenes are put away: no number button (they're still in Scenes).
        .filter((p) => p.sheet?.sheetId === activeSheetId && !p.archived)
        .sort((a, b) => compareSceneNumbers(a.sheet!.number, b.sheet!.number));
      if (!stale) setSheetScenes(ofSheet);
    })();
    return () => {
      stale = true;
    };
  }, [activeSheetId, openSceneId, projectsOpen, sheetScenesVersion]);

  // Cross-scene memory: the patients, and what the open scene may use from
  // the selected patient's earlier scenes. Restrictions ("cannot use") are
  // checked once per scene and set of memories, then reused for every turn;
  // if the check can't be done, nothing from earlier scenes is used.
  const activePatient = saved ? (patients.find((p) => p.id === saved.activePatientId) ?? null) : null;
  /** The sheet's scenes as number buttons (in the Design Process and above the room in the media panel). */
  const sheetSceneList = sheetScenes.map((p) => ({ id: p.id, number: p.sheet!.number, name: p.name }));
  const sceneNow: SceneRef | null = saved
    ? { id: saved.projectId ?? 'unsaved', number: saved.sceneSheet?.number ?? '', name: saved.projectName }
    : null;
  const earlierItems = sceneNow ? earlierMemory(activePatient, sceneNow) : [];
  const cannotUseNow = saved?.flow.cannotUse?.trim() ?? '';
  const memoryKey = JSON.stringify([cannotUseNow, earlierItems.map((it) => [it.id, it.label, it.value])]);
  const checkMemory = (key: string, cannotUse: string, items: MemoryItem[], apiKey: string): Promise<MemoryCheck> => {
    let pending = memoryChecks.current.get(key);
    if (!pending) {
      pending = (async (): Promise<MemoryCheck> => {
        if (!cannotUse || items.length === 0) return { allowed: items, blocked: [] };
        try {
          const res = await fetch('/api/agent/memory-filter', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ cannotUse, items: items.map(toRemembered), anthropicApiKey: apiKey }),
          });
          const data = (await res.json()) as { blocked: number[] } | { error: string };
          if ('error' in data) throw new Error(data.error);
          const blocked = new Set(data.blocked);
          return { allowed: items.filter((_, i) => !blocked.has(i)), blocked: items.filter((_, i) => blocked.has(i)) };
        } catch (err) {
          memoryChecks.current.delete(key); // try again next time
          return {
            allowed: [],
            blocked: items,
            error: `Couldn’t check this scene’s restrictions (${err instanceof Error ? err.message : 'error'}) — nothing from earlier scenes is being used.`,
          };
        }
      })();
      memoryChecks.current.set(key, pending);
    }
    return pending;
  };
  useEffect(() => {
    if (!saved) return;
    let stale = false;
    void checkMemory(memoryKey, cannotUseNow, earlierItems, saved.anthropicApiKey).then((result) => {
      if (!stale) setMemoryCheck({ key: memoryKey, result });
    });
    return () => {
      stale = true;
    };
  }, [memoryKey]); // eslint-disable-line react-hooks/exhaustive-deps -- the key covers everything the check depends on
  useEffect(() => {
    void listPatients()
      .then(setPatients)
      .catch(() => {});
  }, [memoryVersion]);

  const sceneKey = saved?.projectId ?? 'unsaved';
  useEffect(() => {
    if (!session) return;
    const store = conversations.current;
    conversations.current = {
      threads: { ...store.threads, [threadKey(sceneKey, startAt)]: { session, messages, log, cueLog, startAt } },
      lastStart: { ...store.lastStart, [sceneKey]: startAt },
    };
    storeConversations(conversations.current);
  }, [session, messages, log, cueLog, startAt]); // eslint-disable-line react-hooks/exhaustive-deps -- saved under the scene and starting point they belong to at the time

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
    setSelected('design');
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

  // Interrupting the agent (the Interrupt button, Escape, talking over it with the open mic, or sending
  // something while it speaks): its voice stops at once, and its reply is cut back to what the caller
  // actually heard — so the conversation (and the agent, next turn) knows where it was cut off.
  const cutOff = (heard: string) => (heard ? `${heard} —` : '—');
  const interrupt = (): ChatTurn[] => {
    const heard = queueRef.current?.heard ?? '';
    stopAudio();
    interruptedRef.current = { turn: turnIdRef.current, heard };
    // A reply still being written: the conversation is free again straight away.
    setBusy(false);
    const last = messages.at(-1);
    const next: ChatTurn[] =
      last?.role === 'assistant' ? [...messages.slice(0, -1), { role: 'assistant', text: cutOff(heard) }] : messages;
    setMessages(next);
    return next;
  };
  interruptRef.current = interrupt;

  // The onboarding's Scenes demo: put the open work aside and start a blank
  // scene (no questions, nothing saved over)…
  const beginSceneDemo = async () => {
    if (sceneDemo.current) return;
    const backup: DemoBackup = {
      saved: structuredClone(saved),
      conversations: structuredClone(conversations.current),
      ids: (await listProjects()).map((p) => p.id),
    };
    sceneDemo.current = backup;
    try {
      window.localStorage.setItem(DEMO_BACKUP_KEY, JSON.stringify(backup));
    } catch {
      // Storage blocked: the demo still tidies up when it's left normally.
    }
    loadFlow({ ...emptyFlow, stages: [blankStage('1')] }, 'design');
    setSaved((s) =>
      s
        ? {
            ...s,
            brief: '',
            generatedBrief: null,
            boardUrl: '',
            projectId: null,
            projectName: 'Untitled scene',
            savedSnapshot: '',
            musicTrack: null,
            sceneSheet: null,
            figjamFlow: null,
          }
        : s,
    );
  };

  // …and afterwards: delete only the demo's scenes, and bring the work back as it was.
  const endSceneDemo = async () => {
    const backup = sceneDemo.current;
    if (!backup) return;
    sceneDemo.current = null;
    setProjectsOpen(false);
    await removeDemoScenes(backup.ids);
    conversations.current = backup.conversations;
    storeConversations(backup.conversations);
    setSaved(backup.saved);
    const scene = backup.saved.projectId ?? 'unsaved';
    showConversation(scene, backup.saved.flow, '');
    refreshSheetScenes();
    try {
      window.localStorage.removeItem(DEMO_BACKUP_KEY);
    } catch {
      // As above.
    }
  };

  // "Complete restart": every scene's conversations are cleared, and this one
  // starts afresh — and everything the selected patient's scenes saved goes,
  // here and in row 7 of every scene column in the sheet.
  const completeRestart = () => {
    conversations.current = { threads: {}, lastStart: {} };
    storeConversations(conversations.current);
    setStartAt('');
    restart('');
    if (activePatient) void clearMemory(activePatient.id).then(() => setMemoryVersion((v) => v + 1));
    const sheet = saved.sceneSheet ?? sheetScenes[0]?.sheet ?? null;
    if (sheet) void clearSheetRow(sheet, '*', saved.projectId ?? 'unsaved');
  };

  // "Refresh this scene": the same as Update This Scene (Design Process, section 3) — it reads the
  // scene's column and the "All scenes" column from the sheet again, brings the scene's conversation
  // design up to date with anything new, and starts its conversation again. (A scene with no sheet
  // and no description just starts again.) What it saved for the selected patient goes too — here
  // and in its row 7 cell. Other scenes keep theirs.
  const refreshScene = () => {
    // The mics go off: the scene is starting again, and shouldn't pick anything up meanwhile.
    setOpenMicOn(false);
    if (listening) recognitionRef.current?.stop();
    if (saved.sceneSheet || saved.brief.trim()) setUpdateRequest((n) => n + 1);
    else restart();
    const sceneId = saved.projectId ?? 'unsaved';
    if (activePatient) void clearSceneMemory(activePatient.id, sceneId).then(() => setMemoryVersion((v) => v + 1));
    if (saved.sceneSheet) void clearSheetRow(saved.sceneSheet, saved.sceneSheet.column, sceneId);
  };

  // Empties row 7 in one scene column, or every one ('*'), through the sheet's Apps Script.
  const clearSheetRow = async (sheet: SheetSource, column: string, sceneId: string) => {
    const scriptUrl = saved.sheetScriptUrl.trim();
    if (!isScriptUrl(scriptUrl)) return;
    // A save still waiting to go would fill the cell straight back in.
    for (const [id, timer] of sheetWrites.current) {
      if (column === '*' || id === sceneId) {
        clearTimeout(timer);
        sheetWrites.current.delete(id);
      }
    }
    const shown = column === '*' ? (saved.sceneSheet?.column ?? 'all') : column;
    try {
      const res = await fetch('/api/sheets/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptUrl, action: 'clear', spreadsheetId: sheet.sheetId, gid: sheet.gid, column }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error ?? 'The sheet didn’t clear row 7.');
      setSheetSync((all) => ({
        ...(column === '*' ? {} : all),
        [sceneId]: { state: 'cleared', column: shown, at: Date.now() },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Couldn’t reach the sheet.';
      setSheetSync((all) => ({ ...all, [sceneId]: { state: 'error', column: shown, message, at: Date.now() } }));
      setError(`Row 7 wasn’t cleared: ${message}`);
    }
  };

  // Shows a scene's conversation for a starting point: the one kept from
  // before if there is one (and it still fits the flow), otherwise a fresh one.
  const showConversation = (scene: string, target: AgentFlow, start: string) => {
    const from = start && target.stages.some((st) => st.code === start) ? start : '';
    const kept = conversations.current.threads[threadKey(scene, from)];
    const c = fitsFlow(kept, target)
      ? kept
      : { session: initialState(target, from || undefined), messages: [], log: [], cueLog: [], startAt: from };
    setSession(c.session);
    setMessages(c.messages);
    setLog(c.log);
    setCueLog(c.cueLog);
    setStartAt(c.startAt);
  };

  // "Refresh this scene": just the open scene's conversation starts again.
  const restart = (code = startAt) => {
    stopAudio();
    musicRef.current?.stop();
    stopLoops();
    clearVisuals();
    forgetMarker();
    setCueLog([]);
    setSoundLog([]);
    setSession(initialState(flow, code || undefined));
    setMessages([]);
    setLog([]);
    setError(null);
  };

  // Swap in a whole new flow (example, generated, or imported) and start
  // a fresh conversation against it.
  const loadFlow = (next: AgentFlow, select?: string) => {
    setFlow(next);
    setSelected(select ?? 'design');
    setStartAt('');
    stopAudio();
    musicRef.current?.stop();
    stopLoops();
    clearVisuals();
    forgetMarker();
    setCueLog([]);
    setSoundLog([]);
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
    generatedBrief: saved.generatedBrief,
    figjamFlow: saved.figjamFlow,
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
  // part of a project keep whatever voice is set up now; so do scenes from a
  // sheet, which share one voice and one FigJam board.)
  const markSaved = (project: AgentProject) =>
    setSaved((s) =>
      s
        ? {
            ...s,
            projectId: project.id,
            projectName: project.name,
            sceneSheet: project.sheet ?? null,
            savedSnapshot: snapshotOf({
              flow: project.flow,
              brief: project.brief,
              boardUrl: project.sheet ? s.boardUrl : project.boardUrl,
              voice: project.sheet ? voiceOf(s) : (project.voice ?? voiceOf(s)),
              music: project.music ?? null,
            }),
          }
        : s,
    );

  // Puts a saved scene in the studio. A scene from a sheet keeps the voice
  // and FigJam board in use (they're shared across the sheet's scenes).
  const openScene = (project: AgentProject) => {
    loadFlow(project.flow, 'design');
    // Pick its conversation up where it was left, at the starting point it was on.
    showConversation(project.id, project.flow, '');
    const shared = Boolean(project.sheet);
    const voice = shared ? undefined : project.voice;
    const music = project.music ?? null;
    setSaved((s) =>
      s
        ? {
            ...s,
            brief: project.brief,
            // Scenes saved before generation was tracked: assume their flow came from their description.
            generatedBrief: project.generatedBrief !== undefined ? project.generatedBrief : project.brief || null,
            figjamFlow: project.figjamFlow ?? null,
            ...(project.sheet && { activeSheetId: project.sheet.sheetId }),
            boardUrl: shared ? s.boardUrl : project.boardUrl,
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
  };

  const openProject = (project: AgentProject) => {
    if (!okToLeave()) return;
    openScene(project);
    setProjectsOpen(false);
  };

  const refreshSheetScenes = () => setSheetScenesVersion((v) => v + 1);

  // Keeps what a conversation picked up, for the selected patient (one is
  // made, "Patient 1", if none is selected yet).
  const rememberForPatient = async (scene: SceneRef, sheet: SheetSource | null, items: { label: string; value: string }[]) => {
    try {
      let patientId = saved.activePatientId && patients.some((p) => p.id === saved.activePatientId) ? saved.activePatientId : null;
      if (!patientId) {
        const created = await createPatient(`Patient ${patients.length + 1}`);
        patientId = created.id;
        setSaved((s) => (s ? { ...s, activePatientId: created.id } : s));
      }
      const patient = await saveToMemory(patientId, scene, items);
      setMemoryVersion((v) => v + 1);
      if (patient) writeSavedToSheet(scene.id, sheet, patient);
    } catch {
      setError('Couldn’t save what this conversation picked up for the patient (this browser’s storage may be blocked).');
    }
  };

  // Row 7 of the scene's column in the Google Sheet mirrors what the scene
  // has saved for the patient (through the sheet's Apps Script). Saves that
  // come close together are sent as one.
  const writeSavedToSheet = (sceneId: string, sheet: SheetSource | null, patient: Patient) => {
    const scriptUrl = saved.sheetScriptUrl.trim();
    if (!sheet || !isScriptUrl(scriptUrl)) return;
    const entries = savedInScene(patient, sceneId).map((it) => ({ label: displayLabel(it.label), value: it.value }));
    if (entries.length === 0) return;
    const status = (next: Omit<SheetSync, 'column'>) =>
      setSheetSync((all) => ({ ...all, [sceneId]: { ...next, column: sheet.column } }));
    const run = async () => {
      status({ state: 'saving', at: Date.now() });
      try {
        const res = await fetch('/api/sheets/saved', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scriptUrl, spreadsheetId: sheet.sheetId, gid: sheet.gid, column: sheet.column, patient: patient.name, entries }),
        });
        const data = (await res.json()) as { ok: boolean; error?: string };
        status(data.ok ? { state: 'saved', at: Date.now() } : { state: 'error', message: data.error ?? 'The sheet didn’t save it.', at: Date.now() });
      } catch {
        status({ state: 'error', message: 'Couldn’t reach the sheet — check the internet connection.', at: Date.now() });
      }
    };
    clearTimeout(sheetWrites.current.get(sceneId));
    sheetWrites.current.set(
      sceneId,
      setTimeout(() => {
        sheetWrites.current.delete(sceneId);
        void run();
      }, 800),
    );
  };

  // Moving to another scene saves the open one first, so nothing is lost.
  const switchScene = async (id: string) => {
    if (id === saved.projectId) return;
    if (busy) return setError('Wait for the agent to finish replying, then switch scenes.');
    if (saved.projectId && dirty) {
      try {
        markSaved(await saveProjectRequest(current, saved.projectName, false));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Couldn’t save this scene before switching.');
        return;
      }
    } else if (!okToLeave()) {
      return;
    }
    const project = await getProject(id);
    if (!project) return setError('That scene couldn’t be found — it may have been deleted.');
    openScene(project);
    void refreshSheetScenes();
  };

  // "Generate Scenes": reads the sheet and creates (or updates) its scenes.
  const importSheet = async (url: string): Promise<SheetImportOutcome> => {
    // Save the open scene first, so edits in it count as edits (not something to overwrite).
    if (saved.projectId && dirty) markSaved(await saveProjectRequest(current, saved.projectName, false));
    const res = await fetch('/api/sheets/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as { sheetId: string; gid: string; scenes: SheetScene[] } | { error: string };
    if ('error' in data) return { error: data.error };
    if (data.scenes.length === 0) return { error: 'No scenes found — every column after A is empty in rows 2 to 6 of that tab.' };
    const result = await importSheetScenes(data.sheetId, data.gid, data.scenes);
    setSaved((s) => (s ? { ...s, activeSheetId: data.sheetId, sheetUrl: url } : s));
    // Show the sheet's first scene, unless one of its scenes is already open.
    const all = await listProjects();
    const ofSheet = all
      .filter((p) => p.sheet?.sheetId === data.sheetId && !p.archived)
      .sort((a, b) => compareSceneNumbers(a.sheet!.number, b.sheet!.number));
    const open = all.find((p) => p.id === saved.projectId);
    if (open?.sheet?.sheetId === data.sheetId) openScene(open);
    else if (ofSheet[0] && okToLeave()) openScene(ofSheet[0]);
    refreshSheetScenes();
    return { result };
  };

  // "Update This Scene", first step: reads the open scene's column from the
  // sheet again and takes its name, description and rows 4–6 — asking first
  // if they've been edited here. Returns what generating should use; null for
  // a scene that isn't from a sheet, 'cancelled' if the edits are kept.
  const refreshSceneFromSheet = async (): Promise<{ brief: string; flow: AgentFlow; others: { updated: number; keptEdits: number } } | 'cancelled' | null> => {
    const sheet = saved.sceneSheet;
    if (!sheet || !saved.projectId) return null;
    const res = await fetch('/api/sheets/scenes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://docs.google.com/spreadsheets/d/${sheet.sheetId}/edit#gid=${sheet.gid}` }),
    });
    const data = (await res.json()) as { scenes: SheetScene[] } | { error: string };
    if ('error' in data) throw new Error(data.error);
    const scene = data.scenes.find((sc) => sc.number === sheet.number) ?? data.scenes.find((sc) => sc.column === sheet.column);
    if (!scene) throw new Error(`Scene ${sheet.number} isn’t in the sheet any more.`);
    // Media actions (row 8) reworded in the sheet: every scene's connections and timeline bars follow them.
    for (const sc of data.scenes)
      updateMediaLinks((links) => followRewording(links, { sheetId: sheet.sheetId, number: sc.number }, sc.mediaActions) ?? links);
    const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim() === (b ?? '').trim();
    const now = [saved.projectName, saved.brief, flow.knowledge, flow.saveInfo, flow.cannotUse];
    const imported = [sheet.importedName, sheet.importedBrief, sheet.importedKnowledge, sheet.importedSaveInfo, sheet.importedCannotUse];
    const fromSheet = [scene.name, scene.description, scene.knowledge, scene.saveInfo, scene.cannotUse];
    const editedHere = now.some((v, i) => imported[i] !== undefined && !same(v, imported[i]));
    const differs = now.some((v, i) => !same(v, fromSheet[i]));
    if (
      editedHere &&
      differs &&
      !window.confirm('This scene has been edited here since it came from the sheet. Replace those edits with what the sheet says now?')
    ) {
      return 'cancelled';
    }
    // The stored scene takes the sheet's version as its new baseline, so it doesn't count as edited.
    const stored = await getProject(saved.projectId);
    const updated = stored ? await applySheetScene(stored, scene) : null;
    const nextFlow: AgentFlow = { ...flow, knowledge: scene.knowledge, saveInfo: scene.saveInfo, cannotUse: scene.cannotUse, canUse: '' };
    setSaved((s) =>
      s
        ? {
            ...s,
            projectName: scene.name,
            brief: scene.description,
            flow: nextFlow,
            sceneSheet: updated?.sheet ?? s.sceneSheet,
          }
        : s,
    );
    // The other scenes from this sheet take its latest text too — so a change to the shared
    // "All scenes" column reaches them all (their conversations update next time they're updated).
    const others = await refreshOtherSheetScenes(sheet.sheetId, data.scenes, saved.projectId);
    refreshSheetScenes();
    return { brief: scene.description, flow: nextFlow, others };
  };

  // "Keep mine" / "Use the sheet" for a scene edited in both places.
  const resolveSheetConflict = async (conflict: SheetConflict, useSheet: boolean) => {
    if (useSheet) {
      const updated = await applySheetScene(conflict.project, conflict.scene);
      if (updated.id === saved.projectId) openScene(updated);
    } else {
      await keepSceneEdits(conflict.project, conflict.scene);
    }
    void refreshSheetScenes();
  };

  // A fresh, unsaved scene. The Scenes dialog stays open to name and save it;
  // returns false if the user chose to keep their unsaved work instead.
  const newProject = () => {
    if (!okToLeave()) return false;
    const next = { ...emptyFlow, stages: [blankStage('1')] };
    loadFlow(next, 'design');
    setSaved((s) =>
      s
        ? {
            ...s,
            brief: '',
            generatedBrief: null,
            boardUrl: '',
            projectId: null,
            projectName: 'Untitled scene',
            savedSnapshot: '',
            musicTrack: null,
            sceneSheet: null,
            figjamFlow: null,
          }
        : s,
    );
    return true;
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
      // Played as it streams in — speech starts with the first audio
      // ElevenLabs sends, instead of after the whole clip has downloaded.
      const clip = await startStreamedClip(() =>
        fetch('/api/tts/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            voiceId: voiceId ?? voiceRef.current.voiceId,
            apiKey: voiceRef.current.apiKey,
            voiceSettings,
            expressive,
          }),
        }),
      );
      stopAudio();
      const audio = new Audio(clip.src);
      audioRef.current = audio;
      audioExpressiveRef.current = expressive;
      // The expressive models have no speed setting, so apply the Speed
      // slider here instead (keeping the pitch natural).
      if (expressive) {
        audio.playbackRate = voiceSettings.speed;
        audio.preservesPitch = true;
      }
      audio.onplay = () => setSpeaking(true);
      audio.onended = () => {
        clip.release();
        setSpeaking(false);
      };
      audio.onerror = () => {
        clip.release();
        setSpeaking(false);
        setError('Voice playback stopped unexpectedly — try again, or check the voice in the Voice panel.');
      };
      await audio.play();
    } catch (err) {
      setError(`Voice failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
  };

  // Says a line in the voice in use and waits until it's finished (the Media Library's Try it);
  // `signal` stops it (Try it's Stop).
  const sayAndWait = async (text: string, signal?: AbortSignal) => {
    if (signal?.aborted) return;
    await speak(text, true, saved.voiceExpressive);
    const audio = audioRef.current;
    if (!audio || audio.ended) return;
    if (signal?.aborted) {
      audio.pause();
      return;
    }
    await new Promise<void>((resolve) => {
      audio.addEventListener('ended', () => resolve(), { once: true });
      audio.addEventListener('pause', () => resolve(), { once: true });
      audio.addEventListener('error', () => resolve(), { once: true });
      signal?.addEventListener(
        'abort',
        () => {
          audio.pause();
          resolve();
        },
        { once: true },
      );
    });
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
  // `takeAudio` hands over audio already being made for a sentence, if any.
  // `listenCues` does the same for TouchDesigner cues (and their status updates).
  type TurnStream = {
    listen: (onSentence: (sentence: string) => void) => void;
    listenCues: (onCue: (cue: CueEvent) => void) => void;
    takeAudio: (sentence: string) => Promise<StreamedClip | null> | undefined;
    done: Promise<TurnResponse>;
  };

  // Starts one sentence's audio streaming in (see streamedAudio.ts).
  // Settings are read now, so a slider moved while the agent was thinking
  // still applies.
  const requestAudio = (text: string, previousText: string, expressive: boolean) =>
    startStreamedClip(() =>
      fetch('/api/tts/stream', {
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
      }),
    );

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
    const headStarts = new Map<string, Promise<StreamedClip | null>>();
    const headStart = (text: string) => {
      if (!voiceReady || headStarts.size > 0 || !withoutCues(text)) return;
      headStarts.set(text, requestAudio(text, '', Boolean(state.expressive)).catch(() => null));
    };
    const done = (async (): Promise<TurnResponse> => {
      // Only what this scene may use from the patient's earlier scenes ever goes to the agent.
      const allowed = (await checkMemory(memoryKey, cannotUseNow, earlierItems, saved.anthropicApiKey)).allowed;
      // What the room can show or play (the scene's media actions with a file connected), and what's on now —
      // so the agent goes along with it rather than saying it can't show anything.
      // What the caller's words are about to put up or take down (waited for, but never for long).
      const judged = userText
        ? await Promise.race([judgeCaller(history, userText), new Promise<JudgedMedia[]>((r) => setTimeout(() => r([]), 3000))])
        : [];
      const media: RoomMedia[] = (await sceneMedia(sceneRef(), [...ACTION_KINDS])).map((m) => {
        const change = judged.find((j) => j.media.asset.id === m.asset.id && j.media.link.action === m.link.action)?.do;
        return {
          action: m.link.action,
          kind: m.asset.kind,
          showing: mediaOn(m),
          ...(change && { change: change === 'show' ? ('appearing' as const) : ('removing' as const) }),
        };
      });
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
          memory: allowed.map(toRemembered),
          savedHere: savedInScene(activePatient, sceneNow?.id ?? null).map((it) => ({ label: displayLabel(it.label), value: it.value })),
          media,
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
      takeAudio: (sentence) => {
        const clip = headStarts.get(sentence);
        headStarts.delete(sentence);
        return clip;
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
  const newSpeechQueue = (
    expressive: boolean,
    hooks: { onPlay?: () => void; onQuiet?: () => void; beforeFirst?: () => Promise<void> } = {},
  ) =>
    new SpeechQueue({
      expressive,
      beforeFirst: hooks.beforeFirst,
      playbackRate: () => voiceRef.current.settings.speed,
      onSpeakingChange: (speakingNow) => {
        setSpeaking(speakingNow);
        if (!speakingNow) hooks.onQuiet?.();
      },
      onPlay: hooks.onPlay,
      onError: setError,
      requestAudio: (text, previousText) => requestAudio(text, previousText, expressive),
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

  // A media action's sound played (or couldn't): mark it in the conversation.
  const noteSound = (sound: PlannedSound, afterMessage: number, problem?: string) =>
    setSoundLog((list) => {
      // A sound that then couldn't play updates its own marker.
      const last = list.findLast((p) => p.assetId === sound.asset.id && p.afterMessage === afterMessage);
      if (problem && last && !last.problem) return list.map((p) => (p === last ? { ...p, problem } : p));
      return [
        ...list,
        {
          id: crypto.randomUUID(),
          at: Date.now(),
          afterMessage,
          assetId: sound.asset.id,
          name: sound.asset.name,
          when: sound.timing.when,
          kind: sound.timing.kind,
          action: sound.link.action,
          problem,
        },
      ];
    });

  // A media action's image or video shown in (or taken out of) its area of the room, or a "once" sound
  // played or stopped: mark it in the conversation.
  const noteMedia = (media: PlannedMedia, afterMessage: number, event: 'shown' | 'removed', problem?: string) =>
    setSoundLog((list) => {
      // Then it couldn't be shown: its own marker says so.
      const last = list.findLast((p) => p.assetId === media.asset.id && p.afterMessage === afterMessage && p.event === event);
      if (problem && last && !last.problem) return list.map((p) => (p === last ? { ...p, problem } : p));
      return [
      ...list,
      {
        id: crypto.randomUUID(),
        at: Date.now(),
        afterMessage,
        assetId: media.asset.id,
        name: media.asset.name,
        when: media.timing.when,
        kind: media.timing.kind,
        action: media.link.action,
        problem,
        ...(media.asset.kind !== 'sound' && { areas: media.areas }),
        event,
      },
      ];
    });

  // Shows an image or video in its area, or (a "once" sound) plays it — and marks it.
  const startMedia = (media: PlannedMedia, afterMessage: number) => {
    const id = media.asset.id;
    const fail = (err: unknown) =>
      noteMedia(media, afterMessage, 'shown', err instanceof Error ? err.message : 'It couldn’t be shown.');
    noteMedia(media, afterMessage, 'shown');
    if (media.asset.kind === 'sound') {
      // "Loop, when user instructs": it loops until removed (or the call ends).
      (loopOf(media.link) ? startLoop(media.asset) : playSound(media.asset)).catch(fail);
      return;
    }
    mediaStarting.current.add(id);
    showVisual(media)
      .catch(fail)
      .finally(() => mediaStarting.current.delete(id));
  };
  const endMedia = (media: PlannedMedia, afterMessage: number) => {
    noteMedia(media, afterMessage, 'removed');
    if (media.asset.kind === 'sound') stopSounds(media.asset.id);
    else hideVisual(media.asset.id);
  };

  // "Once, when…" media actions: after each part of an exchange (the caller speaking, then the reply),
  // Claude says which of this scene's actions it triggered — to show (or play) their media, or remove it.
  const mediaOn = (m: PlannedMedia) =>
    m.asset.kind === 'sound' ? isSoundPlaying(m.asset.id) : isShowing(m.asset.id) || mediaStarting.current.has(m.asset.id);
  const sceneRef = () =>
    saved.sceneSheet ? { sheetId: saved.sceneSheet.sheetId, number: saved.sceneSheet.number } : null;

  // Which "once" actions an exchange triggers — judged, not yet done (see applyMedia).
  const judgeMediaMoments = async (
    scene: { sheetId: string; number: string } | null,
    exchange: { before?: string | null; caller?: string | null; callerChecked?: boolean; reply?: string | null },
  ): Promise<JudgedMedia[]> => {
    const once = await sceneMedia(scene, ['once']);
    if (once.length === 0) return [];
    try {
      const res = await fetch('/api/media/moments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actions: once.map((m) => ({ line: m.link.action, showing: mediaOn(m) })),
          ...exchange,
          anthropicApiKey: saved.anthropicApiKey,
        }),
      });
      const data = (await res.json()) as { triggered?: { line: string; do: 'show' | 'remove' }[] };
      return (data.triggered ?? []).flatMap((t) =>
        once.filter((m) => m.link.action === t.line).map((media) => ({ media, do: t.do })),
      );
    } catch {
      // A missed moment never interrupts the conversation.
      return [];
    }
  };
  // Shows (or plays) and removes (or stops) what was judged.
  const applyMedia = (judged: JudgedMedia[], afterMessage: number) => {
    for (const { media, do: change } of judged)
      if (change === 'show' && !mediaOn(media)) startMedia(media, afterMessage);
      else if (change === 'remove' && mediaOn(media)) endMedia(media, afterMessage);
  };
  const checkMediaMoments = async (
    scene: { sheetId: string; number: string } | null,
    exchange: { before?: string | null; caller?: string | null; callerChecked?: boolean; reply?: string | null },
    afterMessage: number,
  ) => applyMedia(await judgeMediaMoments(scene, exchange), afterMessage);

  // What the caller's words trigger is judged once (from the moment their phrase is confirmed, alongside
  // an early turn) — before the reply is written, so the agent is told what the room is putting up or
  // taking down and goes along with it, instead of the two deciding separately and disagreeing.
  const judgeCaller = (history: ChatTurn[], text: string): Promise<JudgedMedia[]> => {
    const key = `${history.length}|${text}`;
    const kept = callerJudgements.current.get(key);
    if (kept) return kept;
    const judged = judgeMediaMoments(sceneRef(), { before: history.findLast((m) => m.role === 'assistant')?.text, caller: text });
    if (callerJudgements.current.size > 20) callerJudgements.current.clear();
    callerJudgements.current.set(key, judged);
    return judged;
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
    // Sent while the agent is still speaking: that's interrupting it.
    const history = speaking ? interrupt() : messages;
    const turn = ++turnIdRef.current;
    // This turn's reply was interrupted (it stays cut back to what was heard), or a newer turn has begun.
    const cut = () => interruptedRef.current?.turn === turn;
    const superseded = () => turnIdRef.current !== turn;
    setError(null);
    setBusy(true);
    stopAudio();
    const withCaller: ChatTurn[] = [...history, ...(userText ? [{ role: 'user' as const, text: userText }] : [])];
    setMessages(withCaller);
    // Cues of this turn go out before its reply (the reply is about the
    // situation they mark), so that's where they show in the conversation.
    const cuePosition = withCaller.length;
    // Sounds connected to this scene's "every time" media actions (Media Library), looked up now
    // so they're ready the moment they're needed.
    const mediaScene = saved.sceneSheet ? { sheetId: saved.sceneSheet.sheetId, number: saved.sceneSheet.number } : null;
    const sounds = {
      before: soundsFor(mediaScene, 'before-reply'),
      start: soundsFor(mediaScene, 'reply-start'),
      after: soundsFor(mediaScene, 'after-reply'),
    };
    const play = (planned: Promise<PlannedSound[]>, afterMessage: number) =>
      planned.then((list) => playEvent(list, (s, problem) => noteSound(s, afterMessage, problem))).catch(() => {});
    // "Every time" pictures and video start again (from the beginning) at each of their events.
    const showEvery = (when: EveryWhen, afterMessage: number) =>
      void everyVisuals(mediaScene, when).then((list) => list.forEach((m) => startMedia(m, afterMessage)));
    if (userText) {
      void play(soundsFor(mediaScene, 'caller-speaks'), cuePosition);
      showEvery('caller-speaks', cuePosition);
    }
    // The caller's words alone may be the moment ("when the nurse asks to see it"): checked now, so the
    // picture can appear as the reply begins rather than after it.
    if (userText) void judgeCaller(history, userText).then((judged) => applyMedia(judged, cuePosition));
    // The call begins: "throughout the scene" sounds start looping, "at the start" ones play once.
    if (history.length === 0) {
      stopLoops();
      void sceneSounds(mediaScene, 'throughout').then((list) =>
        list.forEach((s) => {
          noteSound(s, 0);
          startLoop(s.asset).catch((err: unknown) =>
            noteSound(s, 0, err instanceof Error ? err.message : 'It couldn’t be played.'),
          );
        }),
      );
      void play(sceneSounds(mediaScene, 'start'), 0);
      // Images and video "throughout the scene" or "at the start" show in their areas from the start.
      clearVisuals();
      // "On marker arrival": whatever has a bar on the stage the call starts at.
      forgetMarker();
      void markerArrived(mediaScene, sortStages(flow.stages), session.stageCode);
      void sceneMedia(mediaScene, ['throughout', 'start']).then((list) =>
        list.filter((m) => m.asset.kind !== 'sound').forEach((m) => startMedia(m, 0)),
      );
    }
    // Set once the reply is in: this reply ends the call ("at the end" sounds follow it).
    let endsCall = false;
    let replyStarted = false;
    const replyStarts = () => {
      if (replyStarted) return;
      replyStarted = true;
      void play(sounds.start, cuePosition);
      showEvery('reply-start', cuePosition);
    };
    let turnFailed = false;
    let replyEnded = false;
    const replyEnds = () => {
      if (replyEnded || turnFailed) return;
      replyEnded = true;
      void play(sounds.after, cuePosition + 1);
      if (!endsCall) showEvery('after-reply', cuePosition + 1);
      // The goodbye has been said: "at the end" sounds, and the loops stop.
      if (endsCall) {
        stopLoops();
        void play(sceneSounds(mediaScene, 'end'), cuePosition + 1);
        // Images and video: "throughout the scene" and "every time" ones come down, "at the end" ones go up.
        void sceneMedia(mediaScene, ['throughout', 'every', 'end']).then((list) =>
          list
            .filter((m) => m.asset.kind !== 'sound')
            .forEach((m) =>
              m.timing.kind === 'end' ? startMedia(m, cuePosition + 1) : isShowing(m.asset.id) && endMedia(m, cuePosition + 1),
            ),
        );
      }
    };
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
            // "Every time before you speak": the voice waits for those sounds.
            beforeFirst: () => {
              showEvery('before-reply', cuePosition);
              return play(sounds.before, cuePosition);
            },
            onPlay: () => {
              if (clock.voice === null) {
                clock.voice = performance.now();
                reportWait();
              }
              replyStarts();
              openGate();
            },
            onQuiet: () => {
              openGate();
              replyEnds();
            },
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
      // No voice: the reply appearing is when it "starts".
      if (!queue && clock.text === null) {
        void play(sounds.before, cuePosition);
        showEvery('before-reply', cuePosition);
        replyStarts();
      }
      if (cut() || superseded()) return;
      clock.text ??= performance.now();
      shown = `${shown} ${sentence}`.trim();
      setMessages([...withCaller, { role: 'assistant', text: shown }]);
      if (withoutCues(sentence)) queue?.add(sentence, stream?.takeAudio(sentence));
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
      endsCall = Boolean(data.state.ended);
      queue?.finish();
      // Nothing to say out loud (or no voice): the reply is "heard" now.
      if (!queue || queue.idle) {
        openGate();
        replyEnds();
      }
      const heardReply = cut() ? cutOff(interruptedRef.current!.heard) : data.reply;
      if (!superseded()) setMessages([...withCaller, { role: 'assistant', text: heardReply }]);
      setSession(data.state);
      // The marker moves with the conversation: "on marker arrival" media for the stage it's on now.
      if (!data.state.ended) void markerArrived(mediaScene, sortStages(flow.stages), data.state.stageCode);
      // Cue statuses as last heard (held ones may have been sent since the turn finished).
      const events = data.events.map((e) =>
        e.type === 'cue' ? { ...e, status: cueStatusRef.current.get(e.id) ?? e.status } : e,
      );
      const toSave = data.events.flatMap((e) => (e.type === 'saved' ? [{ label: e.label, value: e.value }] : []));
      if (toSave.length > 0 && sceneNow) void rememberForPatient(sceneNow, saved.sceneSheet, toSave);
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
      void checkMediaMoments(mediaScene, { caller: userText, callerChecked: Boolean(userText), reply: heardReply }, cuePosition + 1);
    } catch (err) {
      // A failed turn sends nothing.
      turnFailed = true;
      gate.open = true;
      gate.waiting.length = 0;
      queue?.cancel();
      if (!superseded()) {
        setMessages(history);
        if (userText) setInput(userText);
        setError(err instanceof Error ? err.message : 'Something went wrong.');
      }
    } finally {
      // An interrupted turn has already freed the conversation — and a newer one may be under way.
      if (!superseded()) setBusy(false);
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

  // The open scene's stages, under its scene buttons in "Describe the
  // conversation": Master, each stage (● = where the live conversation is),
  // + Stage. Clicking one opens its card right below; clicking it again closes it.
  const stageChip = (active: boolean) =>
    `px-2 py-1 font-label text-[11px] uppercase tracking-wide ${active ? 'bg-ink text-paper' : 'text-ink hover:bg-muted'}`;
  const toggleCard = (id: string) => setSelected((current) => (current === id ? 'design' : id));
  const stageArea = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="This scene's stages" data-tour="stages">
        <button onClick={() => toggleCard('master')} aria-pressed={selected === 'master'} className={stageChip(selected === 'master')}>
          Master
        </button>
        {orderedStages.map((s) => (
          <button
            key={s.id}
            onClick={() => toggleCard(s.id)}
            aria-pressed={selected === s.id}
            title={s.name}
            className={stageChip(selected === s.id)}
          >
            {s.code}
            {session.stageCode === s.code && !session.ended ? ' ●' : ''}
          </button>
        ))}
        <button onClick={addStage} className={stageChip(false)}>
          + Stage
        </button>
      </div>
      {(selectedStage || selected === 'master') && (
        <div className="flex flex-col gap-2 border-2 border-ink p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display text-base text-ink">
              {selectedStage ? `${selectedStage.code} · ${selectedStage.name}` : 'Master card'}
            </p>
            <button
              onClick={() => setSelected('design')}
              className="text-lg leading-none text-ink hover:text-muted-ink"
              aria-label="Close this card"
            >
              ×
            </button>
          </div>
          {selectedStage ? (
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
      )}
    </div>
  );
  const firstStage = startStage(flow);

  return (
    <main className="flex min-h-screen flex-col bg-paper lg:h-screen">
      <header className="relative flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink px-5 py-3">
        <div className="flex min-w-0 items-center gap-3">
          {/* The guided tour of the chatbot generation process (see onboardingSteps.tsx) — started
              by Onboard Me beside that section's heading in Design Process. */}
          <OnboardingTour
            steps={ONBOARDING_STEPS}
            actions={{ ...sceneDemoActions({ begin: beginSceneDemo }), ...LAYOUT_DEMO_ACTIONS }}
            onLeaveGroup={(group) => (group === 'scenes-demo' ? endSceneDemo() : undefined)}
            startRef={startTour}
          />
          {/* The Adding Immersive Media tour (see mediaTour.tsx), started by its section's Onboard Me. */}
          <OnboardingTour
            steps={MEDIA_TOUR_STEPS}
            actions={mediaTourActions}
            onLeaveGroup={(group) => (group === 'media-demo' ? endMediaDemo() : undefined)}
            startRef={startMediaTour}
            progressKey="immersive-media-onboarding"
          />
          {/* The team switch, left of the title (see TeamToggle). */}
          <TeamToggle />
          <div className="min-w-0">
            <h1 className="font-display text-2xl leading-none tracking-tight text-ink">Chatbot Designer</h1>
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
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setKeysOpen((o) => !o)} aria-expanded={keysOpen} data-tour="keys-button" className={buttonOutline}>
            Keys
          </button>
          <button onClick={() => setProjectsOpen(true)} className={buttonOutline} data-tour="scenes-button">
            Scenes
          </button>
          {/* Opens Scenes to save. Red "Not Saved" while anything (flow, brief,
              knowledge base, voices, music) has changed since the last save; green "Saved" otherwise. */}
          <button
            onClick={() => setProjectsOpen(true)}
            className={`min-w-[8.5rem] ${dirty ? buttonUnsaved : buttonSaved}`}
            title={dirty ? 'There are unsaved changes — click to save the scene' : 'Everything is saved'}
          >
            {dirty ? 'Not Saved' : 'Saved'}
          </button>
          <ProjectFileButtons />
        </div>
      </header>

      {keysOpen && (
        <div className="flex flex-wrap items-end gap-3 border-b-2 border-ink bg-muted px-5 py-3" data-tour="keys-panel">
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

      <div
        className={`grid min-h-0 flex-1 grid-cols-1 ${
          mediaOpen && !chatAway
            ? 'lg:grid-cols-[var(--design-width)_minmax(0,1fr)_var(--chat-width)_auto]'
            : 'lg:grid-cols-[var(--design-width)_minmax(0,1fr)_auto]'
        }`}
        style={{ '--design-width': `${designWidth}px`, '--chat-width': `${chatWidth}px` } as CSSProperties}
      >
        {/* Flow editor */}
        <section className="relative flex min-h-0 flex-col border-b-2 border-ink lg:border-b-0 lg:border-r-2">
          <DesignResizeHandle width={designWidth} onResize={resizeDesign} onReset={() => resizeDesign(DESIGN_WIDTH.standard)} />
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <p className="mb-1 font-display text-lg text-ink">Design Process</p>
            <div>
              <DesignPanel
                flow={flow}
                brief={saved.brief}
                generatedBrief={saved.generatedBrief}
                onGenerated={(used) => setSaved((s) => (s ? { ...s, generatedBrief: used } : s))}
                sheetUrl={saved.sheetUrl}
                onSheetUrlChange={(sheetUrl) => setSaved({ ...saved, sheetUrl })}
                sheetScriptUrl={saved.sheetScriptUrl}
                onSheetScriptUrlChange={(sheetScriptUrl) => setSaved({ ...saved, sheetScriptUrl })}
                sheetSync={saved.projectId ? sheetSync[saved.projectId] : undefined}
                sceneSheet={saved.sceneSheet}
                onImportSheet={importSheet}
                onResolveConflict={resolveSheetConflict}
                sheetScenes={sheetSceneList}
                currentSceneId={saved.projectId}
                onSwitchScene={(id) => void switchScene(id)}
                scene={{
                  key: saved.projectId,
                  number: saved.sceneSheet?.number ?? '',
                  heading: saved.sceneSheet ? `Scene ${saved.sceneSheet.number} · ${saved.projectName}` : saved.projectName,
                  fromSheet: Boolean(saved.sceneSheet),
                }}
                figjamFlow={saved.figjamFlow}
                onWrittenToFigjam={(fingerprint) => {
                  setSaved((s) => (s ? { ...s, figjamFlow: fingerprint } : s));
                  if (saved.projectId) void markWrittenToFigjam(saved.projectId, fingerprint);
                }}
                boardUrl={saved.boardUrl}
                anthropicApiKey={saved.anthropicApiKey}
                onBriefChange={(brief) => setSaved({ ...saved, brief })}
                onBoardUrlChange={(boardUrl) => setSaved({ ...saved, boardUrl })}
                onFlowLoaded={(next) => loadFlow(next, 'design')}
                onKnowledgeChange={(knowledge) => setFlow({ ...flow, knowledge })}
                onSaveInfoChange={(saveInfo) => setFlow({ ...flow, saveInfo })}
                onMergeCanUse={() =>
                  setFlow({
                    ...flow,
                    knowledge: [flow.knowledge?.trim(), flow.canUse?.trim()].filter(Boolean).join('\n\n'),
                    canUse: '',
                  })
                }
                onCannotUseChange={(cannotUse) => setFlow({ ...flow, cannotUse })}
                memory={{
                  patientName: activePatient?.name ?? null,
                  available: memoryCheck?.key === memoryKey ? memoryCheck.result.allowed : [],
                  blocked: memoryCheck?.key === memoryKey ? memoryCheck.result.blocked : [],
                  savedHere: savedInScene(activePatient, saved.projectId ?? 'unsaved'),
                  checking: memoryCheck?.key !== memoryKey && earlierItems.length > 0,
                  error: memoryCheck?.key === memoryKey ? memoryCheck.result.error : undefined,
                }}
                onClearConversation={() => restart()}
                onRefreshFromSheet={refreshSceneFromSheet}
                updateRequest={updateRequest}
                onUpdateProgress={setUpdateProgress}
                onMediaOpenChange={setMediaOpen}
                onTryVoice={sayAndWait}
                onboardPulse={onboardPulse}
                onOnboard={() => {
                  stopOnboardPulse();
                  startTour.current?.();
                }}
                onMediaOnboard={() => startMediaTour.current?.()}
                onNeedKey={() => {
                  setError('Add your Anthropic API key first (Keys, top right).');
                  setKeysOpen(true);
                }}
                stages={stageArea}
              />
            </div>
          </div>
        </section>

        {mediaOpen && (
          <MediaWorkspace
            chatWidth={chatAway ? 0 : chatWidth}
            onChatResize={resizeChat}
            scenes={sheetSceneList}
            currentSceneId={saved.projectId}
            onSwitchScene={(id) => void switchScene(id)}
            switching={busy}
            // The Adding Immersive Media tour works on its own demo scene (see mediaDemo.ts).
            sceneKey={mediaDemo ? 'media-demo' : (saved.projectId ?? 'unsaved')}
            sceneTitle={
              mediaDemo
                ? DEMO_SCENE.name
                : saved.sceneSheet
                  ? `Scene ${saved.sceneSheet.number} · ${saved.projectName}`
                  : saved.projectName
            }
            stages={
              mediaDemo ? DEMO_STAGES : sortStages(flow.stages).map((s) => ({ code: s.code, name: s.name, goal: s.goal }))
            }
            liveStage={mediaDemo ? undefined : session.stageCode}
            scene={
              mediaDemo
                ? { sheetId: DEMO_SCENE.sheetId, number: DEMO_SCENE.number }
                : saved.sceneSheet
                  ? { sheetId: saved.sceneSheet.sheetId, number: saved.sceneSheet.number }
                  : null
            }
          />
        )}

        {/* Conversation. It can shrink (min-w-0) when the Design column is dragged wide — but it doesn't
            clip, so the Voice and Music panels, which open leftwards over the Design column, show in full. */}
        {/* Folded away (chatAway), it stays mounted — a conversation in progress carries on. */}
        <section
          className={`flex min-h-[520px] min-w-0 flex-col border-b-2 border-ink lg:min-h-0 lg:border-b-0 lg:border-r-2 ${chatAway ? 'hidden' : ''}`}
        >
          {/* One row of controls, every one exactly 40px tall: the conversation on
              the left, its sound (music, voice) on the right. Its grey (and the
              scene row's) is a step darker than the dialogue's. */}
          {/* Wide enough for one row (a container query on the chat's own width): Restart and Refresh on the
              left, sound on the right. Narrower, the row wraps and every button lines up on the right. */}
          <div className="@container flex flex-col gap-2 border-b-2 border-ink bg-hair px-3 py-2.5">
            {/* Switch scene from here too (as above the room drawing, and in Design Process steps 3–6). */}
            {sheetSceneList.length > 0 && (
              <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1.5" data-tour="chat-scenes">
                <span className={fieldLabel}>Scene</span>
                <SceneButtons
                  scenes={sheetSceneList}
                  currentId={saved.projectId}
                  onSwitch={(id) => void switchScene(id)}
                  disabled={busy}
                  label="Switch scene (the chat is the open scene's conversation)"
                />
                <span className="min-w-0 truncate font-body text-sm text-ink" title={saved.projectName}>
                  {sheetSceneList.find((sc) => sc.id === saved.projectId)?.name ?? ''}
                </span>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 @[700px]:justify-start">
              <button
                onClick={() => setConfirmCompleteRestart(true)}
                disabled={busy}
                className={`h-10 ${toolbarButtonWidth} ${restartButton}`}
                title="Clear the conversations in every scene and start this one afresh"
              >
                Complete restart
              </button>
              <button
                data-tour="refresh-scene"
                onClick={refreshScene}
                disabled={busy || updateProgress !== null}
                aria-busy={updateProgress !== null}
                className={`relative h-10 overflow-hidden ${toolbarButtonWidth} ${updateProgress ? buttonBusyCompact : buttonOutlineCompact}`}
                title="Update this scene: read its column and the “All scenes” column from the sheet again, bring its conversation up to date with anything new, and start it again (clearing what it saved here and in row 7) — as Update This Scene does"
              >
                {updateProgress && !updateProgress.done && <Spinner />}
                {updateProgress && !updateProgress.done ? 'Updating…' : 'Refresh this scene'}
                {updateProgress && (
                  <ProgressLine
                    startedAt={updateProgress.startedAt}
                    expectedMs={updateProgress.expectedMs}
                    done={updateProgress.done}
                  />
                )}
              </button>
              {/* Sound controls: always together at the right — if the row wraps, they move down as a pair
                  (so the Voice panel opens neatly under its button). */}
              {/* The pair wraps too: in a very narrow chat all four make one column on the right. */}
              <div className="flex flex-wrap justify-end gap-2 @[700px]:ml-auto">
                <MusicPanel
                  trackName={saved.musicTrack?.name ?? null}
                  playing={musicPlaying}
                  soundsPlaying={soundsPlaying}
                  volume={saved.musicVolume}
                  dip={saved.musicDip}
                  onFile={async (file) => {
                    const key = crypto.randomUUID();
                    const kept = await saveTrack({ name: file.name, key, blob: file });
                    musicRef.current?.setTrack(file);
                    loadedMusicKey.current = key;
                    musicFileRef.current = { key, blob: file };
                    setSaved((s) => (s ? { ...s, musicTrack: { name: file.name, key } } : s));
                    return kept ? null : 'Playing it now — save the scene to keep it (this browser’s storage is blocked).';
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
                    duckSounds(true);
                    tryingDipRef.current = setTimeout(() => {
                      tryingDipRef.current = null;
                      musicRef.current?.duck(speakingRef.current);
                      duckSounds(speakingRef.current);
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
                  spokenReplies={voiceOn}
                  onSpokenRepliesChange={setVoiceOn}
                  pauseSeconds={saved.pauseSeconds}
                  onPauseSecondsChange={(pauseSeconds) => setSaved({ ...saved, pauseSeconds })}
                  interruptByVoice={saved.interruptByVoice}
                  onInterruptByVoiceChange={(interruptByVoice) => setSaved({ ...saved, interruptByVoice })}
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
            </div>
          </div>

          {/* Very light grey behind the dialogue, so the white chatbot boxes stand out. */}
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto bg-muted p-4">
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
                {soundLog
                  .filter((p) => p.afterMessage === i)
                  .map((p) => (
                    <MediaMarker key={p.id} played={p} />
                  ))}
                <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  {/* The caller's words: white on blue (#3c5eac — about 6:1, easy to read). */}
                  <div
                    className={`max-w-[80%] px-3 py-2 font-body text-sm ${
                      m.role === 'user' ? 'bg-[#3c5eac] text-paper' : 'border-2 border-ink bg-paper text-ink'
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
            {soundLog
              .filter((p) => p.afterMessage >= messages.length)
              .map((p) => (
                <MediaMarker key={p.id} played={p} />
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
            hosted={hosting?.hosted ?? false}
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
                  ? saved.interruptByVoice
                    ? 'Agent is speaking — talk to interrupt it'
                    : 'Agent is speaking — mic paused so it can’t hear itself'
                  : busy
                    ? 'Agent is thinking…'
                    : openMicStatus === 'hearing'
                      ? `Hearing you — sends after ${saved.pauseSeconds.toFixed(1)}s of quiet`
                      : openMicStatus === 'listening'
                        ? 'Listening — just talk'
                        : 'Starting the mic…'}
              {/* Talk to interrupt, on or off (also in the Voice panel). */}
              <button
                onClick={() => setSaved({ ...saved, interruptByVoice: !saved.interruptByVoice })}
                aria-pressed={saved.interruptByVoice}
                title={
                  saved.interruptByVoice
                    ? 'On: talking while the agent speaks interrupts it (the mic listens through its voice). Click to turn off — the mic then rests while the agent speaks.'
                    : 'Off: the mic rests while the agent speaks. Click to turn on — then talking over the agent interrupts it.'
                }
                className={`ml-auto shrink-0 border px-2 py-0.5 font-label text-[10px] uppercase tracking-widest transition-colors ${
                  saved.interruptByVoice
                    ? 'border-[#18a0fb] bg-[#18a0fb] text-white hover:bg-[#18a0fb]/80'
                    : 'border-ink/40 bg-paper text-muted-ink hover:border-ink hover:text-ink'
                }`}
              >
                ✋ Talk to interrupt: {saved.interruptByVoice ? 'On' : 'Off'}
              </button>
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
              // Speak to interrupt: the mic listens through the agent's voice for the caller talking over it.
              paused={(busy && !speaking) || session.ended || (speaking && !saved.interruptByVoice)}
              agentSpeaking={speaking && saved.interruptByVoice}
              agentText={messages.at(-1)?.role === 'assistant' ? messages.at(-1)!.text : ''}
              onBargeIn={() => void interrupt()}
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
            {speaking ? (
              <button
                onClick={() => void interrupt()}
                // As tall as the message box beside it.
                className={`inline-flex items-center self-stretch whitespace-nowrap ${buttonPrimary.replace('px-4 py-2', 'px-3 py-0')}`}
                title={`Stop the agent mid-reply${saved.interruptByVoice && openMicOn ? ' — or just start talking' : ''} (Esc)`}
              >
                ✋ Interrupt
              </button>
            ) : (
              <button onClick={submit} disabled={busy || session.ended || !input.trim()} className={buttonPrimary}>
                Send
              </button>
            )}
          </div>
        </section>

        {/* Inspector — tucked away by default; the edge tab slides it out and back in. */}
        <section className="flex min-h-[420px] lg:min-h-0">
          <div className="flex w-9 shrink-0 flex-col bg-paper">
            <button
              onClick={() => setInspectorOpen((o) => !o)}
              aria-expanded={inspectorOpen}
              title={inspectorOpen ? 'Slide the inspector away' : 'Show the inspector: current stage, collected information, what happened each turn'}
              className={`flex w-9 flex-col items-center gap-3 py-4 text-ink transition-colors duration-100 hover:bg-muted ${chatAway ? '' : 'flex-1'}`}
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
            {chatAway && (
              // The chat, folded away by pulling its border all the way right: click to bring it back.
              <button
                onClick={reopenChat}
                title="Show the chat again"
                className="flex w-9 flex-col items-center gap-3 border-y-2 border-ink bg-ink py-4 text-paper transition-colors duration-100 hover:bg-ink/80"
              >
                <span className="font-label text-sm">◂</span>
                <span className="rotate-180 font-label text-[10px] uppercase tracking-widest [writing-mode:vertical-rl]">
                  Chat
                </span>
              </button>
            )}
            {chatAway && (
              <button
                onClick={() => setInspectorOpen((o) => !o)}
                tabIndex={-1}
                aria-hidden="true"
                className="flex-1 transition-colors duration-100 hover:bg-muted"
              />
            )}
          </div>
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
      {confirmCompleteRestart && (
        <ConfirmDialog
          title="Complete restart?"
          message={`The conversations in every scene will be cleared, and this scene will start afresh. ${
            activePatient ? `Everything ${activePatient.name}'s scenes have saved will be deleted too` : 'Saved information will be deleted too'
          }${saved.sheetScriptUrl.trim() ? ', and row 7 of the sheet emptied in every scene column' : ''}. This action cannot be undone.`}
          confirmLabel="Complete restart"
          onConfirm={() => {
            setConfirmCompleteRestart(false);
            completeRestart();
          }}
          onCancel={() => setConfirmCompleteRestart(false)}
        />
      )}
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
