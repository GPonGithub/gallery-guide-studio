import {
  streamText, convertToModelMessages, createUIMessageStreamResponse,
  toUIMessageStream, tool, type UIMessage,
} from 'ai';
import { z } from 'zod';
import { anthropicModel } from '@/lib/anthropicModel';

export const maxDuration = 30;

const FALLBACK_SYSTEM_PROMPT =
  'You are a helpful voice agent being prototyped by a student. No playbook has been selected for this stage yet, so introduce yourself briefly and ask what the visitor needs.';

type StageBox = { id: string; label: string; instructions: string };

function summarize(text: string, max = 150) {
  const flat = text.trim().replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export async function POST(req: Request) {
  const { messages, activeBoxId, boxes, masterPlaybook, anthropicApiKey } = (await req.json()) as {
    messages: UIMessage[];
    activeBoxId?: string | null;
    boxes?: StageBox[];
    masterPlaybook?: string;
    anthropicApiKey?: string;
  };

  const allBoxes = boxes ?? [];
  const currentBox = allBoxes.find((b) => b.id === activeBoxId);
  const otherBoxes = allBoxes.filter((b) => b.id !== activeBoxId);

  const systemParts: string[] = [];
  if (masterPlaybook?.trim()) {
    systemParts.push(`OVERALL CONTEXT (applies throughout the conversation):\n${masterPlaybook.trim()}`);
  }
  systemParts.push(
    currentBox?.instructions.trim()
      ? `CURRENT STAGE — "${currentBox.label}". Follow these instructions for how to act right now:\n${currentBox.instructions.trim()}`
      : FALLBACK_SYSTEM_PROMPT,
  );

  const canTransition = otherBoxes.length > 0;
  if (canTransition) {
    const menu = otherBoxes.map((b) => `- ${b.id}: "${b.label}" — ${summarize(b.instructions)}`).join('\n');
    systemParts.push(
      "If the conversation should move out of the current stage — a topic shift, a signal like an emergency, or " +
      "this stage's goal being complete — call the changeStage tool. You only get this one response for the " +
      "turn (no separate follow-up turn to reply in), so always write your reply text in this exact same " +
      `response alongside the tool call. Available stages you can move to:\n${menu}`,
    );
  }
  systemParts.push('Voice conversation — keep replies to a sentence or two.');

  const result = streamText({
    model: anthropicModel(anthropicApiKey),
    system: systemParts.join('\n\n'),
    messages: await convertToModelMessages(messages),
    // The system prompt's own brevity instruction is the primary brake;
    // this is just a backstop, kept generous so it never cuts off a normal
    // reply before it can start (a tight cap risks a turn finishing with no
    // visible text at all if any overhead — e.g. the tool call's own JSON —
    // eats into it).
    maxOutputTokens: 1024,
    tools: canTransition ? {
      changeStage: tool({
        description: 'Move the conversation to a different stage of the flow.',
        inputSchema: z.object({
          stageId: z.enum(otherBoxes.map((b) => b.id) as [string, ...string[]]),
          reason: z.string().describe('One short phrase: why move here now'),
        }),
        execute: async (input) => input,
      }),
    } : undefined,
    // No stopWhen beyond the default (stop after step 1) — see rebuild spec
    // Priority Directive #1. Do not change this.
    onFinish: ({ finishReason, text, toolCalls, usage }) => {
      if (!text.trim() && toolCalls.length === 0) {
        console.warn(
          `chat: turn finished with no text and no tool call (finishReason=${finishReason}, ` +
          `outputTokens=${usage.outputTokens}) — the student will see nothing for this turn.`,
        );
      }
    },
  });

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      // This is a local prototyping tool — surface the real cause (e.g. a
      // missing API key) instead of a generic message.
      onError: (err) => (err instanceof Error ? err.message : 'Something went wrong.'),
    }),
  });
}
