import type { StudioState } from './types';

const STORAGE_KEY = 'gallery-guide-studio:v1';
// ElevenLabs' public "Rachel" voice — works out of the box once an API key is set.
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

// ElevenLabs' own defaults for these settings.
export const DEFAULT_VOICE_SETTINGS = {
  stability: 0.5,
  similarityBoost: 0.75,
  style: 0,
  speed: 1,
  useSpeakerBoost: true,
};

export const defaultState: StudioState = {
  imageDataUrl: null,
  imageName: null,
  boxes: [],
  activeBoxId: null,
  voiceId: DEFAULT_VOICE_ID,
  voiceSettings: DEFAULT_VOICE_SETTINGS,
  voicePresets: [null, null, null, null],
  masterPlaybook: '',
  anthropicApiKey: '',
  elevenLabsApiKey: '',
  figmaApiKey: '',
  figmaFileUrl: '',
};

export function loadState(): StudioState {
  if (typeof window === 'undefined') return defaultState;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<StudioState>;
    return {
      ...defaultState,
      ...parsed,
      voiceSettings: { ...defaultState.voiceSettings, ...parsed.voiceSettings },
    };
  } catch {
    return defaultState;
  }
}

export function saveState(state: StudioState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore quota errors from a large pasted image.
  }
}
