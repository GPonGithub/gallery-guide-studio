import {
  generateText, Output, convertToModelMessages, createUIMessageStream,
  createUIMessageStreamResponse, type UIMessage, type ModelMessage,
} from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';
import { getBoxPlan, getFlowPlans, needsPlan, type BoxPlan } from '@/lib/flowPlan';

export const maxDuration = 30;

const FALLBACK_SYSTEM_PROMPT =
  'You are a helpful voice agent being prototyped by a student. No playbook has been selected for this stage yet, so introduce yourself briefly and ask what the visitor needs.';

// Guards a misconfigured table (e.g. a NAV step pointing at nothing, or a
// cycle of unconditional NAV jumps) from looping forever within one request
// — not something a normal, correctly-wired table would ever approach.
const MAX_STEP_ADVANCES = 25;

type StepOption = 'BOT' | 'USER' | 'NAV';
type ChatStep = { id: string; option: StepOption; instruction: string; navTarget?: string; variable?: string };
type StageBox = { id: string; label: string; steps: ChatStep[]; leadsTo?: string[] };
// `toStepNumber` set = a smart jump within the same playbook (see flowPlan.ts),
// shown in the studio chat so a wrong interpretation is easy to spot.
type Transition = { toBoxId: string; toLabel: string; toStepNumber?: number };
type PositionData = { boxId: string | null; stepIndex: number; transitions: Transition[]; variableUpdates: Record<string, string> };
type ServerUIMessage = UIMessage<never, { position: PositionData }>;

function getLastUserText(messages: UIMessage[]): string | null {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return null;
  const text = last.parts
    .filter((p): p is Extract<(typeof last.parts)[number], { type: 'text' }> => p.type === 'text')
    .map((p) => p.text ?? '')
    .join(' ')
    .trim();
  return text || null;
}

async function phraseLines(
  model: ReturnType<typeof anthropicModel>,
  masterPlaybook: string | undefined,
  variables: Record<string, string>,
  lines: string[],
  modelMessages: ModelMessage[],
): Promise<string> {
  const systemParts = [
    masterPlaybook?.trim() ? `OVERALL CONTEXT (applies throughout the conversation):\n${masterPlaybook.trim()}` : '',
    'Say the following, in order, in your own natural voice. Do not add anything beyond what is listed here, and ' +
      `do not ask any question that isn't listed:\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
    Object.keys(variables).length > 0
      ? `Known about this visitor so far — use naturally if it helps: ${Object.entries(variables)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`
      : '',
    'Voice conversation — keep each item to a sentence or two.',
  ].filter(Boolean);

  const { text } = await generateText({
    model,
    system: systemParts.join('\n\n'),
    messages: modelMessages,
    maxOutputTokens: 400,
  });
  return text.trim();
}

async function extractVariable(
  model: ReturnType<typeof anthropicModel>,
  instruction: string,
  modelMessages: ModelMessage[],
): Promise<string> {
  const { output } = await generateText({
    model,
    output: Output.object({ schema: z.object({ value: z.string() }) }),
    system:
      `The visitor just answered a question. Extract the value described by "${instruction}" from their most ` +
      'recent message. Return their answer as plainly and directly as possible (e.g. just the name, or just ' +
      '"yes"/"no"), not a full sentence.',
    messages: modelMessages,
    maxOutputTokens: 200,
  });
  return output.value;
}

// The single most common shape a turn takes: a USER step with a variable to
// save, immediately followed by the next thing the agent says. Previously
// that was two sequential model calls (extractVariable, then phraseLines) —
// each a full network round trip. Doing both in one call is the main
// latency win of this pass; see extractVariable/phraseLines above for the
// unmerged version this mirrors (kept as separate functions, still used
// for every other shape a turn can take).
async function extractAndPhrase(
  model: ReturnType<typeof anthropicModel>,
  masterPlaybook: string | undefined,
  variables: Record<string, string>,
  extractInstruction: string,
  lines: string[],
  modelMessages: ModelMessage[],
): Promise<{ value: string; reply: string }> {
  const systemParts = [
    masterPlaybook?.trim() ? `OVERALL CONTEXT (applies throughout the conversation):\n${masterPlaybook.trim()}` : '',
    `The visitor just answered a question. First, extract the value described by "${extractInstruction}" from ` +
      'their most recent message, as plainly and directly as possible (e.g. just the name, or just "yes"/"no"), ' +
      'not a full sentence.',
    'Then, as your reply to them, say the following, in order, in your own natural voice. Do not add anything ' +
      `beyond what is listed here, and do not ask any question that isn't listed:\n${lines.map((l, i) => `${i + 1}. ${l}`).join('\n')}`,
    Object.keys(variables).length > 0
      ? `Known about this visitor so far — use naturally if it helps: ${Object.entries(variables)
          .map(([k, v]) => `${k}=${v}`)
          .join(', ')}`
      : '',
    'Voice conversation — keep the reply to a sentence or two.',
  ].filter(Boolean);

  const { output } = await generateText({
    model,
    output: Output.object({ schema: z.object({ value: z.string(), reply: z.string() }) }),
    system: systemParts.join('\n\n'),
    messages: modelMessages,
    // Two structured fields instead of phraseLines' one, under the same
    // budget that was previously reserved for phrasing alone — give it real
    // headroom so it can't get truncated mid-JSON before finishing both.
    maxOutputTokens: 700,
  });
  return output;
}

async function classifyBranch(
  model: ReturnType<typeof anthropicModel>,
  options: ChatStep[],
  modelMessages: ModelMessage[],
): Promise<string> {
  const ids = options.map((o) => o.id) as [string, ...string[]];
  const menu = options.map((o) => `- ${o.id}: ${o.instruction}`).join('\n');
  const { output } = await generateText({
    model,
    output: Output.object({ schema: z.object({ choiceId: z.enum(ids) }) }),
    system:
      'Based on the visitor\'s most recent reply, pick exactly one of these conditions — the one that best ' +
      `matches what they just said:\n${menu}`,
    messages: modelMessages,
    maxOutputTokens: 200,
  });
  return output.choiceId;
}

// Dev-log timing for each model call in a turn (see the [chat] line the
// server prints), so latency can be traced to a specific step.
async function timed<T>(timings: string[], label: string, work: Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await work;
  } finally {
    timings.push(`${label} ${((Date.now() - start) / 1000).toFixed(1)}s`);
  }
}

type WalkResult = {
  textLines: string[];
  finalBoxId: string | null;
  finalStepIndex: number;
  transitions: Transition[];
  variableUpdates: Record<string, string>;
};

/**
 * Walks the active box's step table forward, mechanically, for exactly one
 * incoming request. A BOT step is done the instant it's phrased; a USER (or
 * branching NAV) step is done the instant the visitor's fresh reply is
 * consumed; an unconditional NAV step is an immediate jump. The one
 * judgment call this doesn't eliminate is picking a branch among several
 * NAV options — kept as narrow as possible: one bounded classification
 * among a short, explicit, labeled list, never open-ended reasoning about
 * whether to transition at all.
 *
 * The incoming fresh reply may only ever be consumed once, and only by the
 * very first USER/branching-NAV step reached *before any new BOT text has
 * been generated this pass* (`canConsume`) — otherwise a table like
 * `BOT welcome -> USER name` would misread the visitor's kickoff message
 * (sent just to get the agent talking) as their actual answer to the first
 * real question.
 */
async function walk(opts: {
  startBoxId: string;
  startStepIndex: number;
  boxes: StageBox[];
  model: ReturnType<typeof anthropicModel>;
  fastModel: ReturnType<typeof anthropicModel>;
  masterPlaybook: string | undefined;
  variables: Record<string, string>;
  modelMessages: ModelMessage[];
  lastUserText: string | null;
  /** Smart-jump plan for a playbook, or null when it has none (or smart jumps are off). */
  planFor: (boxId: string) => Promise<BoxPlan | null>;
  timings: string[];
}): Promise<WalkResult> {
  const { boxes, model, fastModel, masterPlaybook, modelMessages, lastUserText, timings } = opts;
  // A branch decision started early, alongside the USER step's variable
  // extraction (both only read the same reply) — consumed by the NAV group
  // it was started for.
  let prefetchedChoice: { navIndex: number; choice: Promise<string | null> } | null = null;
  const textLines: string[] = [];
  const transitions: Transition[] = [];
  const variableUpdates: Record<string, string> = {};
  const variables = { ...opts.variables };
  let canConsume = true;
  let consumed = false;
  // The standard "USER: wait for an answer → NAV: if X… / NAV: if Y…"
  // pattern: the USER step consumes the reply (saving its variable), and
  // the branch right after it has to decide on that *same* reply — there's
  // no second reply coming in this request. Without this, the walk stopped
  // at the branch with nothing to say, waiting for a reply that had already
  // been given.
  let replyPendingForBranch = false;
  let boxId: string | null = opts.startBoxId;
  let stepIndex = opts.startStepIndex;

  for (let advances = 0; advances < MAX_STEP_ADVANCES; advances += 1) {
    const box = boxes.find((b) => b.id === boxId);
    if (!box || stepIndex >= box.steps.length) {
      return { textLines, finalBoxId: boxId, finalStepIndex: stepIndex, transitions, variableUpdates };
    }
    const step = box.steps[stepIndex];
    const plan = needsPlan(box) ? await timed(timings, 'plan', opts.planFor(box.id)) : null;
    const jumpTo = new Map(plan?.jumps.map((m) => [m.stepId, m.toIndex]));
    const skipTo = new Map(plan?.skips.map((m) => [m.stepId, m.toIndex]));
    // Where to continue once a step is done: the next row, unless the plan
    // says this step ends a branch and the conversation rejoins further down.
    const nextAfter = (s: ChatStep, fallback: number) => skipTo.get(s.id) ?? fallback;
    // A maximal run of consecutive BOT steps from `from`, cut short at a
    // step that has a skip (what follows it belongs to another branch).
    const botRun = (from: number) => {
      const run: ChatStep[] = [];
      let k = from;
      while (k < box.steps.length && box.steps[k].option === 'BOT') {
        run.push(box.steps[k]);
        k += 1;
        if (skipTo.has(box.steps[k - 1].id)) break;
      }
      return { run, resumeAt: run.length > 0 ? nextAfter(run[run.length - 1], k) : k };
    };

    if (step.option === 'USER') {
      if (canConsume && !consumed && lastUserText) {
        const afterUser = nextAfter(step, stepIndex + 1);
        const next = box.steps[afterUser];
        if (step.variable && next?.option === 'BOT') {
          // The next thing to say is already known to be a straight BOT
          // run — fold the variable extraction and that phrasing into one
          // call instead of two (see extractAndPhrase above).
          const { run, resumeAt } = botRun(afterUser);
          // Merging saves a round trip in the common case, but asking one
          // call to produce two structured fields is inherently more
          // fragile than asking for one — if it fails for any reason, fall
          // back to the original two separate calls rather than surfacing
          // a hard error to a visitor mid-conversation.
          let value: string;
          let reply: string;
          try {
            ({ value, reply } = await timed(
              timings,
              'extract+phrase',
              extractAndPhrase(model, masterPlaybook, variables, step.instruction, run.map((s) => s.instruction), modelMessages),
            ));
          } catch {
            value = await timed(timings, 'extract', extractVariable(fastModel, step.instruction, modelMessages));
            reply = await timed(
              timings,
              'phrase',
              phraseLines(model, masterPlaybook, { ...variables, [step.variable]: value }, run.map((s) => s.instruction), modelMessages),
            );
          }
          variableUpdates[step.variable] = value;
          variables[step.variable] = value;
          if (reply) textLines.push(reply);
          consumed = true;
          canConsume = false;
          stepIndex = resumeAt;
          continue;
        }
        // USER → branch: the branch choice and the variable both come from
        // this same reply and don't depend on each other, so start the
        // choice now and let the two model calls run side by side.
        if (next?.option === 'NAV' && box.steps[afterUser + 1]?.option === 'NAV') {
          const options: ChatStep[] = [];
          for (let j = afterUser; j < box.steps.length && box.steps[j].option === 'NAV'; j += 1) {
            if (box.steps[j].navTarget && boxes.some((b) => b.id === box.steps[j].navTarget)) options.push(box.steps[j]);
          }
          if (options.length > 0) {
            prefetchedChoice = {
              navIndex: afterUser,
              choice: timed(timings, 'classify', classifyBranch(fastModel, options, modelMessages)).catch(() => null),
            };
          }
        }
        if (step.variable) {
          const value = await timed(timings, 'extract', extractVariable(fastModel, step.instruction, modelMessages));
          variableUpdates[step.variable] = value;
          variables[step.variable] = value;
        }
        consumed = true;
        replyPendingForBranch = true;
        stepIndex = afterUser;
        continue;
      }
      return { textLines, finalBoxId: boxId, finalStepIndex: stepIndex, transitions, variableUpdates };
    }

    if (step.option === 'NAV') {
      const group: ChatStep[] = [];
      let j = stepIndex;
      while (j < box.steps.length && box.steps[j].option === 'NAV') {
        group.push(box.steps[j]);
        j += 1;
      }

      if (group.length === 1) {
        const jumpIndex = jumpTo.get(group[0].id);
        if (jumpIndex !== undefined) {
          transitions.push({ toBoxId: box.id, toLabel: box.label, toStepNumber: jumpIndex + 1 });
          stepIndex = jumpIndex;
          continue;
        }
        const targetBox = group[0].navTarget ? boxes.find((b) => b.id === group[0].navTarget) : undefined;
        if (!targetBox) {
          return { textLines, finalBoxId: boxId, finalStepIndex: stepIndex, transitions, variableUpdates };
        }
        transitions.push({ toBoxId: targetBox.id, toLabel: targetBox.label });
        boxId = targetBox.id;
        stepIndex = 0;
        continue;
      }

      if (canConsume && (!consumed || replyPendingForBranch) && lastUserText) {
        const validOptions = group.filter((g) => g.navTarget && boxes.some((b) => b.id === g.navTarget));
        if (validOptions.length === 0) {
          return { textLines, finalBoxId: boxId, finalStepIndex: stepIndex, transitions, variableUpdates };
        }
        const early = prefetchedChoice?.navIndex === stepIndex ? await prefetchedChoice.choice : null;
        prefetchedChoice = null;
        const chosenId = early ?? (await timed(timings, 'classify', classifyBranch(fastModel, validOptions, modelMessages)));
        const chosen = validOptions.find((g) => g.id === chosenId) ?? validOptions[0];
        consumed = true;
        replyPendingForBranch = false;
        const jumpIndex = jumpTo.get(chosen.id);
        if (jumpIndex !== undefined) {
          transitions.push({ toBoxId: box.id, toLabel: box.label, toStepNumber: jumpIndex + 1 });
          stepIndex = jumpIndex;
          continue;
        }
        const targetBox = boxes.find((b) => b.id === chosen.navTarget)!;
        transitions.push({ toBoxId: targetBox.id, toLabel: targetBox.label });
        boxId = targetBox.id;
        stepIndex = 0;
        continue;
      }

      return { textLines, finalBoxId: boxId, finalStepIndex: stepIndex, transitions, variableUpdates };
    }

    // BOT — phrase the maximal run of consecutive BOT steps in one call.
    const { run, resumeAt } = botRun(stepIndex);
    const phrased = await timed(
      timings,
      'phrase',
      phraseLines(model, masterPlaybook, variables, run.map((s) => s.instruction), modelMessages),
    );
    if (phrased) textLines.push(phrased);
    canConsume = false;
    replyPendingForBranch = false;
    stepIndex = resumeAt;
  }

  return { textLines, finalBoxId: boxId, finalStepIndex: stepIndex, transitions, variableUpdates };
}

export async function POST(req: Request) {
  const {
    messages, activeBoxId, activeStepIndex, boxes, masterPlaybook, variables, anthropicApiKey, smartJumps = true,
  } = (await req.json()) as {
    messages: ServerUIMessage[];
    activeBoxId?: string | null;
    activeStepIndex?: number;
    boxes?: StageBox[];
    masterPlaybook?: string;
    variables?: Record<string, string>;
    anthropicApiKey?: string;
    smartJumps?: boolean;
  };

  const allBoxes = boxes ?? [];
  const model = anthropicModel(anthropicApiKey);
  // Extraction and branch-classification are short, structured-output-only
  // tasks (a value, or a choice from a short labeled list) — a smaller,
  // faster model handles them just as reliably and cuts a meaningful chunk
  // off per-call latency, versus running everything on the same model used
  // for natural-voice phrasing.
  const fastModel = anthropicModel(anthropicApiKey, 'claude-haiku-4-5-20251001');
  const modelMessages = await convertToModelMessages(messages);
  const currentBox = allBoxes.find((b) => b.id === activeBoxId) ?? null;

  // Plans are only awaited when the walk actually enters a playbook that
  // needs one — but start all of them now, in the background, so they're
  // usually ready by the time the conversation gets there. Cached, so this
  // is free after the first time (see flowPlan.ts).
  if (smartJumps) void getFlowPlans(model, allBoxes);
  const planFor = async (boxId: string) => {
    const box = allBoxes.find((b) => b.id === boxId);
    if (!smartJumps || !box) return null;
    // A failed plan just means this playbook behaves as written (jumps land on step 1).
    return getBoxPlan(model, box, allBoxes).catch(() => null);
  };

  return createUIMessageStreamResponse({
    stream: createUIMessageStream<ServerUIMessage>({
      execute: async ({ writer }) => {
        const startedAt = Date.now();
        const timings: string[] = [];
        let text: string;
        let position: PositionData;

        if (!currentBox || currentBox.steps.length === 0) {
          const result = await generateText({
            model,
            system: masterPlaybook?.trim()
              ? `OVERALL CONTEXT (applies throughout the conversation):\n${masterPlaybook.trim()}\n\n${FALLBACK_SYSTEM_PROMPT}`
              : FALLBACK_SYSTEM_PROMPT,
            messages: modelMessages,
            maxOutputTokens: 400,
          });
          text = result.text.trim();
          position = { boxId: activeBoxId ?? null, stepIndex: 0, transitions: [], variableUpdates: {} };
        } else {
          const result = await walk({
            startBoxId: currentBox.id,
            startStepIndex: activeStepIndex ?? 0,
            boxes: allBoxes,
            model,
            fastModel,
            masterPlaybook,
            variables: variables ?? {},
            modelMessages,
            lastUserText: getLastUserText(messages),
            planFor,
            timings,
          });
          text = result.textLines.join(' ');
          position = {
            boxId: result.finalBoxId,
            stepIndex: result.finalStepIndex,
            transitions: result.transitions,
            variableUpdates: result.variableUpdates,
          };
        }

        const id = 'reply';
        writer.write({ type: 'text-start', id });
        if (text) writer.write({ type: 'text-delta', id, delta: text });
        writer.write({ type: 'text-end', id });
        writer.write({ type: 'data-position', data: position });
        console.log(`[chat] reply in ${((Date.now() - startedAt) / 1000).toFixed(1)}s — ${timings.join(', ') || 'no model calls'}`);
      },
      onError: (err) => (err instanceof Error ? err.message : 'Something went wrong.'),
    }),
  });
}
