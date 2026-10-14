export type StepOption = 'BOT' | 'USER' | 'NAV';

export type PlaybookStep = {
  id: string;
  option: StepOption;
  /**
   * BOT/USER: what to say or listen for. NAV: the condition that picks this
   * branch (or, when it's the only NAV step at this point in the table,
   * simply the note that it's an unconditional jump).
   */
  instruction: string;
  /** NAV only — id of the box this step jumps to. */
  navTarget?: string;
  /** USER only, optional — variable name to save the patient's answer under. */
  variable?: string;
  /** Inert for now — wiring to TouchDesigner is separate, later scope. */
  sendToTD?: boolean;
  /** Inert for now — wiring to a spreadsheet export is separate, later scope. */
  saveToSheet?: boolean;
};

export type PlaybookBox = {
  id: string;
  label: string;
  /**
   * Auto-parsed playbook code (e.g. "1", "2A", "3B") from a synced Figma
   * board's "PLAYBOOK <code>: <label>" title — drives the editor header and
   * the Designer ID prefix instead of array position. Never hand-edited.
   * Empty for boxes that have never synced from Figma.
   */
  code: string;
  /**
   * The freeform brief a Figma instruction panel (or a student, in-app)
   * writes to describe what this playbook should do — the input to
   * "Regenerate steps", shown in the editor just below the playbook name.
   */
  instructionPrompt: string;
  steps: PlaybookStep[];
  /** Position and size as a percentage of the canvas image, 0-100. */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * IDs of the boxes this one can transition to, read from real Figma
   * connector data (see `/api/sync-figma`). Used to prioritize/prefill the
   * NAV step target picker in the playbook editor with this box's real
   * neighbors. Undefined for boxes created by hand or by image auto-detect,
   * which have no real connection data.
   */
  leadsTo?: string[];
  /**
   * The Figma TABLE node id this box was last synced from — the primary
   * match key for merging a resync without clobbering in-app edits.
   * Undefined for boxes that have never synced.
   */
  figmaSourceId?: string;
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
  /** Position within the active box's step table. Reset to 0 whenever activeBoxId changes. */
  activeStepIndex: number;
  /** Values captured from USER steps' `variable` field, across the whole session. */
  variables: Record<string, string>;
  voiceId: string;
  voiceSettings: VoiceSettings;
  /** Four saved voice-settings slots; a null entry is an empty slot. */
  voicePresets: (VoiceSettings | null)[];
  /** Overall agent context (role, goals, tone, rules) that applies across every stage. */
  masterPlaybook: string;
  /** Short prefix for the auto-generated Designer ID / Step ID shown in the playbook editor (e.g. "GP"). */
  designerInitials: string;
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  /** Personal access token for pulling box content + connections straight from a FigJam board. */
  figmaApiKey: string;
  /** The FigJam board URL Detect Blue Buttons pulls real content from, so it can be re-run without re-pasting it. */
  figmaFileUrl: string;
  /**
   * The real pixel size of the last-uploaded PNG — box x/y/width/height are
   * percentages of this frame, so boxes stay positioned correctly after
   * "Clear PNG" removes the image itself but keeps the detected boxes.
   * Null until an image has ever been uploaded.
   */
  imagePixelSize: { width: number; height: number } | null;
  /**
   * True once any playbook editor Save has happened since the last
   * successful "Update FigJam file" — drives that button's disabled/grey
   * vs. enabled/green state.
   */
  figmaWriteDirty: boolean;
  /**
   * When a NAV step points back at its own playbook, jump to the step it
   * most plausibly means (worked out once by Claude, see flowPlan.ts)
   * instead of restarting that playbook. On by default.
   */
  smartJumps: boolean;
};
