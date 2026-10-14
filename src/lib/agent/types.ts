/**
 * Goal-driven agent (v4). Instead of a step table the conversation must
 * follow line by line, each stage states a GOAL and the information it
 * needs; the LLM talks freely inside a stage, and plain code owns the
 * structure — which stage is current, what's been collected, which exits
 * and TouchDesigner cues are allowed. The LLM only ever *proposes*
 * changes; runtime.ts checks every proposal against what the student
 * defined here before applying it.
 */

/** A piece of information a stage needs from the caller. */
export type Slot = {
  /** snake_case name, e.g. "patient_name" — what cues and the inspector refer to. */
  name: string;
  /** Plain-English description the agent uses to recognise and ask for it. */
  description: string;
  /** Required slots must all be filled before the stage can count as complete. */
  required: boolean;
};

export const END = 'END';

/** A way out of a stage. */
export type Exit = {
  /** Target stage code, or END to finish the conversation. */
  to: string;
  /** When to take it, in plain English ("if the caller says it's an emergency"). */
  when: string;
  /**
   * Taken automatically once the stage's goal is met (all required slots
   * filled and the agent has confirmed). Otherwise the agent takes it
   * whenever the caller's words match `when`.
   */
  onComplete: boolean;
};

export type CueTrigger = 'enter' | 'complete' | 'exit' | 'slot' | 'moment';

/** A message for TouchDesigner. */
export type Cue = {
  /** What TouchDesigner receives, e.g. "WELCOME_VIDEO". */
  name: string;
  on: CueTrigger;
  /** on === 'slot': fires the first time this slot gets a value. */
  slot?: string;
  /** on === 'moment': plain-English moment the agent judges ("when the price is mentioned"). */
  when?: string;
};

export type Steering = 'strict' | 'balanced' | 'relaxed';

export type Stage = {
  id: string;
  /** "1", "2A", "3B"… — the lowest code is where conversations start. */
  code: string;
  name: string;
  goal: string;
  collect: Slot[];
  instructions: string;
  steering: Steering;
  exits: Exit[];
  cues: Cue[];
};

export type AgentFlow = {
  /** Short name for the whole flow — the MASTER card's header in FigJam. */
  name?: string;
  /** Who the agent is and how it sounds. */
  persona: string;
  /** Rules that apply in every stage. */
  rules: string;
  /** Exits available from every stage (e.g. "emergency at any point"). */
  globalExits: Exit[];
  /** Cues not tied to one stage — 'slot' and 'moment' triggers apply everywhere. */
  globalCues: Cue[];
  stages: Stage[];
  /** Where cues are POSTed. Blank = cues are only shown in the inspector. */
  tdUrl: string;
};

/** Everything the runtime tracks about one conversation. Owned by code, not the LLM. */
export type SessionState = {
  sessionId: string;
  stageCode: string;
  /** Every collected value, across all stages — info given early is kept for later stages. */
  slots: Record<string, string>;
  turnsInStage: number;
  offTopicStreak: number;
  completedStages: string[];
  ended: boolean;
  /**
   * Expressive delivery: the agent writes performance cues ([warmly],
   * [laughs softly]…) into its lines and an expressive ElevenLabs model
   * performs them. Chosen when the conversation starts.
   */
  expressive?: boolean;
};

// 'pending' = held back while the turn wasn't confirmed yet (see TurnRequest.holdCues).
export type CueStatus = 'sent' | 'failed' | 'logged' | 'pending';

/** What happened in a turn — drives the inspector. */
export type AgentEvent =
  | { type: 'slot'; name: string; value: string }
  | { type: 'stage'; from: string; to: string; reason: string }
  | { type: 'complete'; stage: string }
  | { type: 'cue'; name: string; trigger: string; status: CueStatus }
  | { type: 'offTopic'; streak: number }
  | { type: 'end'; reason: string }
  | { type: 'note'; text: string }
  | { type: 'rejected'; text: string };

export type ChatTurn = { role: 'user' | 'assistant'; text: string };

export type TurnRequest = {
  flow: AgentFlow;
  state: SessionState;
  /** Conversation so far, NOT including `userText`. */
  history: ChatTurn[];
  /** Null on the opening turn, when the agent speaks first. */
  userText: string | null;
  anthropicApiKey: string;
  /**
   * Work the turn out but don't send TouchDesigner cues yet — they come back
   * as 'pending' events and are sent via /api/agent/cues once the app
   * actually uses this turn. For turns started early, while the caller's
   * pause is still being timed; if they keep talking the turn is thrown
   * away and nothing must have fired.
   */
  holdCues?: boolean;
};

export type TurnResponse = {
  reply: string;
  state: SessionState;
  events: AgentEvent[];
  timings: string[];
};
