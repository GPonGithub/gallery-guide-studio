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
  /**
   * When a cue goes to TouchDesigner: 'spoken' (the default) holds it until
   * the agent's voice starts saying the reply it belongs to; 'decided' sends
   * it the moment the agent decides (new stage, information collected) —
   * up to a second or so before that reply is heard.
   */
  tdTiming?: 'spoken' | 'decided';
  /**
   * Facts the agent can draw on — doctors, opening hours, prices, menus…
   * Written by the student (never generated), kept separate from the
   * conversation design, and preserved when a flow is generated or
   * imported from FigJam. Shown as "Knowledge base".
   */
  knowledge?: string;
  /**
   * "Information this scene can use": context specific to this scene, given
   * to the agent along with the knowledge base and what the patient's
   * earlier scenes saved. Kept like `knowledge` when a flow is generated or
   * imported.
   */
  canUse?: string;
  /**
   * "Information saved from the scene": what to collect during the
   * conversation and keep for the patient's later scenes (see memory.ts).
   * Kept like `knowledge` when a flow is generated or imported.
   */
  saveInfo?: string;
  /**
   * "Information this scene cannot use": anything the patient's earlier
   * scenes saved that matches this is removed before the agent sees it.
   * Kept like `knowledge` when a flow is generated or imported.
   */
  cannotUse?: string;
  /**
   * The exact text this design was generated from (description plus the
   * scene's information rules). With it, the next generation only revises
   * what the changes in that text call for, instead of redesigning — see
   * reviseFlow in generate.ts.
   */
  designedFrom?: string;
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

// 'pending' = held back while the turn wasn't confirmed yet (see TurnRequest.holdCues);
// 'sending' = on its way to TouchDesigner; 'logged' = no TouchDesigner address set.
export type CueStatus = 'sent' | 'failed' | 'logged' | 'pending' | 'sending';

/** The message a cue sends to TouchDesigner (as JSON, POSTed to the flow's TD address). */
export type CuePayload = {
  cue: string;
  trigger: string;
  stage: string;
  sessionId: string;
  slots: Record<string, string>;
};

/** One cue as it fires — `id` ties together the updates for it (sending → sent). */
export type CueEvent = { type: 'cue'; id: string; name: string; trigger: string; status: CueStatus; payload: CuePayload };

/** What happened in a turn — drives the inspector. */
export type AgentEvent =
  | { type: 'slot'; name: string; value: string }
  | { type: 'stage'; from: string; to: string; reason: string }
  | { type: 'complete'; stage: string }
  | CueEvent
  | { type: 'offTopic'; streak: number }
  | { type: 'end'; reason: string }
  | { type: 'note'; text: string }
  | { type: 'rejected'; text: string }
  /** Picked up for the patient's later scenes (cross-scene memory). */
  | { type: 'saved'; label: string; value: string };

/** Something the patient's earlier scenes saved, as the agent is given it (restrictions already applied). */
export type RememberedItem = { label: string; value: string; scene: string };

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
  /**
   * What the patient's earlier scenes saved that this scene may use —
   * anything its "cannot use" rules out has already been removed.
   */
  memory?: RememberedItem[];
  /** What this scene has already saved for the patient — so the same thing keeps its label, and a correction replaces it. */
  savedHere?: { label: string; value: string }[];
};

export type TurnResponse = {
  reply: string;
  state: SessionState;
  events: AgentEvent[];
  timings: string[];
};
