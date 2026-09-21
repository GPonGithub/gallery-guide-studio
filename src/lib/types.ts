export type PlaybookBox = {
  id: string;
  label: string;
  instructions: string;
  /** Position and size as a percentage of the canvas image, 0-100. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * IDs of the boxes this one can transition to, read from real Figma
   * connector data (see `/api/sync-figma`). When present, the chat route
   * restricts the changeStage tool to just these — the fix for the model
   * picking a wrong-but-similarly-named box out of the full list. Undefined
   * for boxes created by hand or by image auto-detect, which have no real
   * connection data and fall back to the old "any box" behavior.
   */
  leadsTo?: string[];
};

/** ElevenLabs `voice_settings` — https://elevenlabs.io/docs/api-reference/text-to-speech/convert */
export type VoiceSettings = {
  stability: number;
  similarityBoost: number;
  style: number;
  speed: number;
  useSpeakerBoost: boolean;
};

export type StudioState = {
  imageDataUrl: string | null;
  imageName: string | null;
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  voiceId: string;
  voiceSettings: VoiceSettings;
  /** Four saved voice-settings slots; a null entry is an empty slot. */
  voicePresets: (VoiceSettings | null)[];
  /** Overall agent context (role, goals, tone, rules) that applies across every stage. */
  masterPlaybook: string;
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  /** Personal access token for pulling box content + connections straight from a FigJam board. */
  figmaApiKey: string;
  /** The FigJam board URL last synced from, so "Sync from Figma" can be re-run without re-pasting it. */
  figmaFileUrl: string;
};
