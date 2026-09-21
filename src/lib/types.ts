export type PlaybookBox = {
  id: string;
  label: string;
  instructions: string;
  /** Position and size as a percentage of the canvas image, 0-100. */
  x: number;
  y: number;
  width: number;
  height: number;
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
};
