import { generateText, Output, streamText, type ModelMessage } from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';
import { findStage } from './flow';
import { SentenceSplitter } from './sentences';
import {
  END,
  type AgentEvent,
  type AgentFlow,
  type ChatTurn,
  type Cue,
  type CueStatus,
  type Exit,
  type SessionState,
  type Stage,
  type TurnRequest,
  type TurnResponse,
} from './types';

/**
 * One conversational turn:
 *   1. ANALYSE (fast model) — proposes collected values, an exit, whether
 *      the goal is met, whether the caller is off topic.
 *   2. APPLY (plain code) — keeps only what the flow defines, moves stage,
 *      fires TouchDesigner cues.
 *   3. RESPOND (main model) — talks freely, inside the current stage's goal.
 *   4. MOMENTS (fast model, only if any are defined) — judges plain-English
 *      cue moments against what was actually just said.
 */

const FAST_MODEL = 'claude-haiku-4-5-20251001';
// Enough context to read the latest reply; more just slows the analysis down.
const HISTORY_FOR_ANALYSIS = 8;
const CUE_TIMEOUT_MS = 800;
const OFF_TOPIC_ESCALATE = 3;

type Model = ReturnType<typeof anthropicModel>;

async function timed<T>(timings: string[], label: string, work: Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await work;
  } finally {
    timings.push(`${label} ${((Date.now() - start) / 1000).toFixed(1)}s`);
  }
}

function transcript(history: ChatTurn[]): string {
  return history.map((t) => `${t.role === 'user' ? 'CALLER' : 'AGENT'}: ${t.text}`).join('\n');
}

function exitLabel(flow: AgentFlow, exit: Exit): string {
  return exit.to === END ? 'END the conversation' : `stage ${exit.to} (${findStage(flow, exit.to)?.name ?? '?'})`;
}

// --- 1. ANALYSE ------------------------------------------------------------

const analysisSchema = z.object({
  slots: z.array(z.object({ name: z.string(), value: z.string() })),
  exit: z.object({ id: z.string(), reason: z.string() }).nullable(),
  goalMet: z.boolean(),
  offTopic: z.boolean(),
  note: z.string(),
});
type Analysis = z.infer<typeof analysisSchema>;

async function analyse(
  model: Model,
  flow: AgentFlow,
  stage: Stage,
  state: SessionState,
  history: ChatTurn[],
  userText: string,
  abortSignal?: AbortSignal,
): Promise<Analysis> {
  const value = (name: string) => state.slots[name] ?? '(not yet)';
  const stageSlots = stage.collect
    .map((s) => `- ${s.name}${s.required ? ' [required]' : ''}: ${s.description} — current: ${value(s.name)}`)
    .join('\n');
  const otherSlots = flow.stages
    .filter((st) => st.code !== stage.code)
    .flatMap((st) => st.collect)
    .filter((s) => !state.slots[s.name])
    .map((s) => `- ${s.name}: ${s.description}`)
    .join('\n');
  const exits = [
    ...stage.exits.map((e, i) => `S${i + 1}: → ${exitLabel(flow, e)} — ${e.onComplete ? 'once the goal is met' : `when ${e.when}`}`),
    ...flow.globalExits.map((e, i) => `G${i + 1}: → ${exitLabel(flow, e)} — when ${e.when}`),
  ].join('\n');

  const { output } = await generateText({
    model,
    abortSignal,
    output: Output.object({ schema: analysisSchema }),
    system:
      "You track the state of a voice conversation for a goal-driven agent. You do NOT reply to the caller. " +
      "Read the caller's latest message in context and report:\n" +
      '- slots: any listed information the caller has now given (exact slot names; short plain values, e.g. "Tuesday", ' +
      '"Dr Smith", "no"). Include info for later stages too if they volunteer it. Only values they actually said or ' +
      'clearly confirmed — never guesses. A vague answer ("whenever", "not sure") is NOT a value.\n' +
      '- exit: the id of an exit whose condition the caller\'s message clearly matches, with a short reason — or null. ' +
      'Exits marked "once the goal is met" are taken automatically; don\'t pick those.\n' +
      "- goalMet: true only if this stage's goal is now achieved (include anything the agent must confirm).\n" +
      "- offTopic: true if the latest message has nothing to do with this stage's goal and matches no exit.\n" +
      '- note: what the caller is doing, in at most 12 words.',
    prompt: [
      `CURRENT STAGE ${stage.code}: ${stage.name}`,
      `GOAL: ${stage.goal}`,
      stage.instructions ? `INSTRUCTIONS TO THE AGENT: ${stage.instructions}` : '',
      `INFORMATION THIS STAGE NEEDS:\n${stageSlots || '(none)'}`,
      otherSlots ? `INFORMATION LATER STAGES NEED (record if volunteered):\n${otherSlots}` : '',
      `EXITS:\n${exits || '(none)'}`,
      `CONVERSATION SO FAR:\n${transcript(history.slice(-HISTORY_FOR_ANALYSIS)) || '(nothing yet)'}`,
      `CALLER'S LATEST MESSAGE: ${userText}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    maxOutputTokens: 350,
  });
  return output;
}

// --- 2. APPLY ---------------------------------------------------------------

class Turn {
  events: AgentEvent[] = [];
  private cueSends: Promise<void>[] = [];
  /** Set when this turn moved stage — tells the responder to bridge naturally. */
  arrivedFrom: { stage: Stage; reason: string } | null = null;

  constructor(
    private flow: AgentFlow,
    public state: SessionState,
    private holdCues = false,
  ) {}

  stage(): Stage | undefined {
    return findStage(this.flow, this.state.stageCode);
  }

  fireCue(cue: Cue, trigger: string) {
    const index = this.events.length;
    const url = this.flow.tdUrl.trim();
    this.events.push({ type: 'cue', name: cue.name, trigger, status: url && this.holdCues ? 'pending' : 'logged' });
    if (!url || this.holdCues) return;
    // Sent from the server (works for every client, no mixed-content
    // blocking); never allowed to hold up or break the conversation.
    this.cueSends.push(
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cue: cue.name,
          trigger,
          stage: this.state.stageCode,
          sessionId: this.state.sessionId,
          slots: this.state.slots,
        }),
        signal: AbortSignal.timeout(CUE_TIMEOUT_MS),
      })
        .then((res) => (res.ok ? 'sent' : 'failed'))
        .catch(() => 'failed' as const)
        .then((status: CueStatus) => {
          const event = this.events[index];
          if (event.type === 'cue') event.status = status;
        }),
    );
  }

  fireStageCues(stage: Stage, on: 'enter' | 'complete' | 'exit') {
    for (const cue of stage.cues) if (cue.on === on) this.fireCue(cue, `${on} ${stage.code}`);
  }

  setSlot(name: string, value: string) {
    const isNew = !this.state.slots[name];
    this.state.slots[name] = value;
    this.events.push({ type: 'slot', name, value });
    if (!isNew) return;
    const allCues = [...this.flow.globalCues, ...this.flow.stages.flatMap((s) => s.cues)];
    for (const cue of allCues) if (cue.on === 'slot' && cue.slot === name) this.fireCue(cue, `slot ${name}`);
  }

  moveTo(exit: Exit, reason: string) {
    const from = this.stage();
    if (from) this.fireStageCues(from, 'exit');
    if (exit.to === END) {
      this.state.ended = true;
      this.events.push({ type: 'end', reason });
      return;
    }
    const to = findStage(this.flow, exit.to);
    if (!to) {
      this.events.push({ type: 'rejected', text: `Exit points to stage "${exit.to}", which doesn't exist.` });
      return;
    }
    this.events.push({ type: 'stage', from: from?.code ?? '?', to: to.code, reason });
    this.state.stageCode = to.code;
    this.state.turnsInStage = 0;
    this.state.offTopicStreak = 0;
    if (from) this.arrivedFrom = { stage: from, reason };
    this.fireStageCues(to, 'enter');
  }

  apply(analysis: Analysis) {
    const stage = this.stage();
    if (!stage) return;
    if (analysis.note) this.events.push({ type: 'note', text: analysis.note });

    const declared = new Set(this.flow.stages.flatMap((s) => s.collect.map((c) => c.name)));
    for (const { name, value } of analysis.slots) {
      const clean = value.trim();
      if (!clean || this.state.slots[name] === clean) continue;
      if (!declared.has(name)) {
        this.events.push({ type: 'rejected', text: `Ignored "${name}" — no stage collects that.` });
        continue;
      }
      this.setSlot(name, clean);
    }

    this.state.offTopicStreak = analysis.offTopic ? this.state.offTopicStreak + 1 : 0;
    if (analysis.offTopic) this.events.push({ type: 'offTopic', streak: this.state.offTopicStreak });

    // An intent exit (including global ones like "emergency") wins over completion.
    if (analysis.exit) {
      const match = /^([SG])(\d+)$/i.exec(analysis.exit.id.trim());
      const list = match?.[1].toUpperCase() === 'G' ? this.flow.globalExits : stage.exits;
      const exit = match ? list[Number(match[2]) - 1] : undefined;
      if (exit && !exit.onComplete) {
        this.moveTo(exit, analysis.exit.reason);
        return;
      }
      this.events.push({ type: 'rejected', text: `Ignored exit "${analysis.exit.id}" — not a valid exit here.` });
    }

    if (analysis.goalMet && !this.state.completedStages.includes(stage.code)) {
      const missing = stage.collect.filter((s) => s.required && !this.state.slots[s.name]).map((s) => s.name);
      if (missing.length > 0) {
        this.events.push({ type: 'rejected', text: `Goal looked met, but still missing: ${missing.join(', ')}.` });
        return;
      }
      this.state.completedStages.push(stage.code);
      this.events.push({ type: 'complete', stage: stage.code });
      this.fireStageCues(stage, 'complete');
      const next = stage.exits.find((e) => e.onComplete);
      if (next) this.moveTo(next, 'stage goal met');
    }
  }

  async settleCues() {
    await Promise.all(this.cueSends);
  }
}

// --- 3. RESPOND -------------------------------------------------------------

const STEERING: Record<Stage['steering'], string> = {
  strict:
    "Stay firmly on this stage's goal. If the caller goes off topic, don't engage with it — acknowledge it in a few " +
    'words and bring them straight back.',
  balanced:
    'If the caller goes off topic, answer briefly and kindly if you reasonably can, then steer back to the goal in ' +
    'the same reply.',
  relaxed:
    'You may chat a little if the caller goes off topic, but work gently back toward the goal within a turn or two.',
};

function responderSystem(flow: AgentFlow, stage: Stage, state: SessionState, arrivedFrom: Turn['arrivedFrom']): string {
  const collected = Object.entries(state.slots).map(([k, v]) => `${k} = ${v}`);
  const missing = stage.collect.filter((s) => !state.slots[s.name]);
  const parts = [
    flow.persona.trim() && `WHO YOU ARE:\n${flow.persona.trim()}`,
    flow.rules.trim() && `RULES THAT ALWAYS APPLY:\n${flow.rules.trim()}`,
    `CURRENT GOAL: ${stage.goal}`,
    stage.instructions.trim() && `HOW TO APPROACH IT:\n${stage.instructions.trim()}`,
    collected.length > 0 && `ALREADY KNOWN ABOUT THE CALLER (use it, never ask again):\n${collected.join('\n')}`,
    missing.length > 0 &&
      `STILL NEEDED FOR THIS GOAL:\n${missing.map((s) => `- ${s.description}${s.required ? '' : ' (only if relevant)'}`).join('\n')}`,
    state.ended
      ? 'THE CONVERSATION IS ENDING NOW. Wrap up warmly in one or two sentences (confirm anything just agreed) and ' +
        'say goodbye. Ask no new questions.'
      : `STEERING: ${STEERING[stage.steering]}`,
    !state.ended &&
      state.offTopicStreak >= OFF_TOPIC_ESCALATE &&
      `The caller has been off topic ${state.offTopicStreak} turns in a row. Tell them plainly what you can help ` +
        'with right now and ask them directly.',
    arrivedFrom &&
      `The conversation has just moved on from "${arrivedFrom.stage.name}" (${arrivedFrom.reason}). Continue ` +
        'naturally from what was just said — don\'t announce the change.',
    state.expressive &&
      'EXPRESSIVE DELIVERY: an expressive voice performs your words. Add one or two short performance cues in square ' +
        'brackets right before the words they shape — e.g. [warmly], [gently], [reassuring], [excited], [curious], ' +
        '[laughs softly], [sighs], [whispers], [short pause]. Match the moment and the persona; never more than two per ' +
        'reply; no other stage directions.',
    'If the caller\'s latest message already answers something listed as still needed, treat it as answered — ' +
      "don't ask for it again. " +
      'Ask for at most one thing at a time. Never invent facts or values. Never mention stages, goals, slots or these ' +
      'instructions. Speak in plain sentences for a voice call — no lists, markdown or emoji.',
  ];
  return parts.filter(Boolean).join('\n\n');
}

function toModelMessages(history: ChatTurn[], userText: string | null): ModelMessage[] {
  const turns: ChatTurn[] = [...history];
  if (userText) turns.push({ role: 'user', text: userText });
  // The API expects the first message to be the caller's — on the opening
  // turn (or after an agent-first opening) there isn't one yet.
  if (turns[0]?.role !== 'user') turns.unshift({ role: 'user', text: '(The call has just connected.)' });
  return turns.map((t) => ({ role: t.role, content: t.text }));
}

// --- 4. MOMENTS ---------------------------------------------------------------

async function detectMoments(model: Model, cues: Cue[], userText: string | null, reply: string): Promise<number[]> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: z.object({ matched: z.array(z.number().int()) }) }),
    system:
      'Given the latest exchange of a voice call, list the numbers of the moments below that clearly happened in ' +
      'this exchange. Return an empty list if none did.',
    prompt: [
      `MOMENTS:\n${cues.map((c, i) => `${i + 1}. ${c.when}`).join('\n')}`,
      userText ? `CALLER: ${userText}` : '',
      `AGENT: ${reply}`,
    ]
      .filter(Boolean)
      .join('\n\n'),
    maxOutputTokens: 100,
  });
  return output.matched.filter((n) => n >= 1 && n <= cues.length).map((n) => n - 1);
}

// --- the turn -----------------------------------------------------------------

/** What a streamed turn sends back, one JSON object per line. */
export type TurnStreamEvent =
  | { type: 'sentence'; text: string }
  | ({ type: 'done' } & TurnResponse)
  | { type: 'error'; message: string };

/**
 * A reply as it's being written: the sentences finished so far, and a way to
 * read them in order as more arrive. Kept separate from sending them on, so
 * an early reply can be held back until the analysis confirms it fits.
 */
class ReplyStream {
  sentences: string[] = [];
  text = '';
  done = false;
  error: unknown = null;
  private wakers: (() => void)[] = [];

  constructor(source: () => AsyncIterable<string>, getError: () => unknown) {
    void (async () => {
      const splitter = new SentenceSplitter();
      try {
        for await (const delta of source()) {
          this.text += delta;
          for (const sentence of splitter.push(delta)) this.add(sentence);
        }
        const rest = splitter.flush();
        if (rest) this.add(rest);
        this.error = getError();
      } catch (err) {
        this.error = err;
      }
      this.done = true;
      this.wake();
    })();
  }

  private add(sentence: string) {
    this.sentences.push(sentence);
    this.wake();
  }

  private wake() {
    const wakers = this.wakers;
    this.wakers = [];
    for (const w of wakers) w();
  }

  /** Every sentence, in order — those already written, then the rest as they arrive. */
  async *read(): AsyncGenerator<string> {
    for (let i = 0; ; ) {
      while (i < this.sentences.length) yield this.sentences[i++];
      if (this.done) {
        if (this.error) throw this.error;
        return;
      }
      await new Promise<void>((resolve) => this.wakers.push(resolve));
    }
  }
}

export async function runTurnStream(
  { flow, state: incoming, history, userText, anthropicApiKey, holdCues }: TurnRequest,
  abortSignal: AbortSignal | undefined,
  emit: (event: TurnStreamEvent) => void,
): Promise<void> {
  const model = anthropicModel(anthropicApiKey);
  const fast = anthropicModel(anthropicApiKey, FAST_MODEL);
  const timings: string[] = [];
  const startedAt = Date.now();
  const state: SessionState = structuredClone(incoming);
  const turn = new Turn(flow, state, holdCues);

  const startStage = turn.stage();
  if (!startStage) throw new Error(`Stage "${state.stageCode}" doesn't exist in this flow.`);
  if (state.ended) throw new Error('This conversation has ended — restart it to talk again.');

  // Starts writing a reply for `stage`; its sentences collect in a ReplyStream.
  const respond = (stage: Stage, arrivedFrom: Turn['arrivedFrom'], label: string) => {
    const stop = new AbortController();
    let failure: unknown = null;
    const began = Date.now();
    const result = streamText({
      model,
      abortSignal: abortSignal ? AbortSignal.any([abortSignal, stop.signal]) : stop.signal,
      // Built right now, from the state as it is at this moment.
      system: responderSystem(flow, stage, state, arrivedFrom),
      messages: toModelMessages(history, userText),
      maxOutputTokens: 300,
      onError: ({ error }) => {
        failure = error;
      },
      onFinish: () => {
        timings.push(`${label} ${((Date.now() - began) / 1000).toFixed(1)}s`);
      },
    });
    return { reply: new ReplyStream(() => result.textStream, () => failure), stop };
  };

  // Sends a reply's sentences on to the app as they're written.
  let spoken = 0;
  const speak = async (reply: ReplyStream) => {
    for await (const sentence of reply.read()) {
      if (spoken === 0) timings.push(`first sentence ready ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      spoken += 1;
      emit({ type: 'sentence', text: sentence });
    }
    return reply.text.trim();
  };

  let reply: string;
  if (userText) {
    // Most turns stay in the same stage, so the reply starts being written
    // alongside the analysis — but nothing is sent on until the analysis
    // confirms it fits. If the analysis moves the conversation on (new
    // stage, goal met, call ending, or enough off-topic turns to escalate),
    // that early reply was written for the wrong situation: stop it and
    // write the right one.
    const early = respond(startStage, null, 'respond');
    const streakBefore = state.offTopicStreak;
    try {
      const analysis = await timed(timings, 'analyse', analyse(fast, flow, startStage, state, history, userText, abortSignal));
      turn.apply(analysis);
    } catch (err) {
      turn.events.push({ type: 'rejected', text: `Analysis failed (${err instanceof Error ? err.message : 'error'}) — replying without it.` });
    }
    const situationChanged =
      state.stageCode !== startStage.code ||
      state.ended ||
      turn.events.some((e) => e.type === 'complete') ||
      (state.offTopicStreak >= OFF_TOPIC_ESCALATE && streakBefore < OFF_TOPIC_ESCALATE);
    if (situationChanged) {
      early.stop.abort();
      reply = await speak(respond(turn.stage() ?? startStage, turn.arrivedFrom, 'respond again for the new situation').reply);
    } else {
      try {
        reply = await speak(early.reply);
      } catch (err) {
        // Only start over if nothing has been said yet — never repeat a sentence.
        if (spoken > 0) throw err;
        reply = await speak(respond(startStage, null, 'respond (retry)').reply);
      }
    }
  } else {
    if (history.length === 0) turn.fireStageCues(startStage, 'enter');
    reply = await speak(respond(startStage, null, 'respond').reply);
  }

  state.turnsInStage += 1;
  await turn.settleCues();
  emit({ type: 'done', reply, state, events: turn.events, timings });
}

/**
 * "Moment" cues (plain-English moments like "when the agent mentions the
 * price") can only be judged once the reply exists — so they're checked in
 * a separate request the app makes *after* showing and speaking the reply,
 * instead of holding the reply back while they're worked out.
 */
export async function runMoments({
  flow,
  state,
  userText,
  reply,
  anthropicApiKey,
}: {
  flow: AgentFlow;
  state: SessionState;
  userText: string | null;
  reply: string;
  anthropicApiKey: string;
}): Promise<AgentEvent[]> {
  const stage = findStage(flow, state.stageCode);
  const cues = [...(stage?.cues ?? []), ...flow.globalCues].filter((c) => c.on === 'moment' && c.when?.trim());
  if (cues.length === 0) return [];
  const turn = new Turn(flow, structuredClone(state));
  const hits = await detectMoments(anthropicModel(anthropicApiKey, FAST_MODEL), cues, userText, reply);
  for (const i of hits) turn.fireCue(cues[i], `moment: ${cues[i].when}`);
  await turn.settleCues();
  return turn.events;
}

/** Sends cues that a turn held back (see TurnRequest.holdCues), once that turn is actually used. */
export async function sendHeldCues(
  flow: AgentFlow,
  state: SessionState,
  cues: { name: string; trigger: string }[],
): Promise<CueStatus[]> {
  const turn = new Turn(flow, state);
  for (const c of cues) turn.fireCue({ name: c.name, on: 'enter' }, c.trigger);
  await turn.settleCues();
  return turn.events.map((e) => (e.type === 'cue' ? e.status : 'failed'));
}
