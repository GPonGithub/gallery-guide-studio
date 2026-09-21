# Gallery Guide Studio — Rebuild Specification

This is a complete build spec for recreating this app from scratch in a fresh
session. It reflects the app **as it stands today**, after a full round of
latency tuning. Read the "Priority Directive" section first — it changes how
you should build the chat/voice pipeline from the very first line of code,
not as a pass you do afterward.

## What this app is

A classroom tool for prototyping voice agents. A student drops in a picture
of a flow diagram (e.g. a FigJam export with boxes like "Welcome Patient" →
"Select Appointment" → "Confirm"), draws a hotspot over each box, writes a
"playbook" (instructions) for what the agent should do at that stage, then
talks to the agent in a live test panel to see how it behaves — including
watching it automatically move between stages as the conversation progresses.

Stack: Next.js (App Router, TypeScript), Tailwind CSS v4, the
[AI SDK](https://ai-sdk.dev) (`ai` package) calling **Anthropic directly**
(`@ai-sdk/anthropic`) for the conversation, and **ElevenLabs directly** (raw
`fetch`, not an SDK wrapper — see below) for voice. No Vercel account,
deployment, gateway, or database anywhere. All state lives in the browser's
`localStorage`.

---

## Priority directive: build the fast pipeline from the start

The single most important thing about this rebuild: **the chat + voice
pipeline described below is the result of extensive trial and error on
latency.** Several plausible-looking approaches were tried and made things
*worse*, not better. Build the version described here directly — do not
start with a naive version and "optimize later," and do not re-attempt the
rejected approaches listed at the end of this document even if they seem
like they should help. They were tried, measured, and reverted.

The target feel: a student clicks Send and the agent starts speaking in
roughly **1.5-2.5 seconds**, with no visible stutter or gap. That is treated
here as close to the realistic floor for "hosted LLM + hosted TTS, both over
the network" — not a problem left unsolved.

### The five things that actually made it fast

1. **Single-step tool calls — no exceptions.** When the LLM call includes a
   tool (see "Auto-advancing stages" below), do **not** set `stopWhen` to
   allow more than one step. Leave it at the AI SDK's default (stop after
   step 1). Anthropic's tool-calling format natively supports a tool call
   *and* reply text in one response — the model doesn't need a second
   step to use a tool's result. Allowing a second step was tried
   (`stopWhen: stepCountIs(3)`) and caused two real problems: replies
   sometimes came out **duplicated** (the model re-answered from scratch in
   the second step, unaware it already replied in the first), and every
   transition turn cost a **second full Claude round-trip** — measured
   ~5 seconds versus ~2 seconds for the same turn forced to a single step.

2. **Cap reply length.** `maxOutputTokens: 300` on the `streamText` call,
   plus an explicit system-prompt line: `"Voice conversation — keep replies
   to a sentence or two."` A shorter reply is faster to both generate and
   speak. This is a backstop, not the primary mechanism — playbooks should
   also be written to expect brevity.

3. **Proxy ElevenLabs' streaming endpoint directly — do not use the AI SDK's
   `generateSpeech()`.** The AI SDK's ElevenLabs provider (`@ai-sdk/elevenlabs`,
   `generateSpeech()`) only wraps ElevenLabs' **non-streaming** REST call,
   which waits for the entire audio clip to render server-side before
   returning anything. Measured 800-1300ms for a short reply, every time,
   regardless of connection warmth. Instead, have your own `/api/tts` route
   make a raw `fetch` to ElevenLabs' actual streaming endpoint and pipe the
   response body straight through as the Next.js `Response` body (no
   buffering). See the exact code below. Measured 270-550ms warm.

4. **Make it a `GET` endpoint the client can point an `<audio>` element at
   directly**, not a `POST` the client fetches and turns into a blob. A
   `<audio src="...">` pointed at a streaming URL starts playing
   progressively as bytes arrive. A `fetch()` → `.blob()` → `URL.createObjectURL()`
   flow can't start playing until the *entire* body has been read into
   memory, which throws away the streaming benefit even if the server side
   is genuinely streaming.

5. **Warm the ElevenLabs connection proactively.** The very first request to
   any host pays a TLS handshake cost — measured ~500-800ms slower than a
   warm (keep-alive, reused) connection. Fire one throwaway request (e.g.
   the text `"Hi"`) to your `/api/tts` endpoint the moment the chat panel
   mounts, and discard the result. By the time the student's first real
   message gets a reply, the connection is already warm.

**One request per full reply. Do not chunk speech by sentence.** This was
tried two different ways and both were reverted — see "Rejected approaches"
at the end. The reply-length cap (#2) already keeps a "full reply" short
enough that waiting for it to finish before speaking is not the bottleneck
sentence-chunking was trying to solve.

---

## Data model

```ts
// src/lib/types.ts
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

export type StudioState = {
  imageDataUrl: string | null;
  imageName: string | null;
  boxes: PlaybookBox[];
  activeBoxId: string | null;
  voiceId: string;
  /** Overall agent context (role, goals, tone, rules) that applies across every stage. */
  masterPlaybook: string;
};
```

```ts
// src/lib/storage.ts
const STORAGE_KEY = 'gallery-guide-studio:v1';
// ElevenLabs' public "Rachel" voice — works out of the box once an API key is set.
export const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export const defaultState: StudioState = {
  imageDataUrl: null,
  imageName: null,
  boxes: [],
  activeBoxId: null,
  voiceId: DEFAULT_VOICE_ID,
  masterPlaybook: '',
};

// loadState()/saveState(): guard on `typeof window === 'undefined'`, wrap in
// try/catch (ignore quota errors from a large pasted image), and merge onto
// defaultState so old saved state missing newer fields doesn't crash.
```

Everything persists to `localStorage` under that one key. No backend
database. `page.tsx` hydrates from `localStorage` in a client-only
`useEffect` (never during the initial render) so the server-rendered HTML
("Loading…") matches the client's first paint and React doesn't warn about a
hydration mismatch; it saves back to `localStorage` in a second `useEffect`
that runs on every state change.

---

## Setup

```
.env.local:
ANTHROPIC_API_KEY=...      # https://console.anthropic.com/settings/keys
ELEVENLABS_API_KEY=...     # https://elevenlabs.io/app/settings/api-keys
```

Dependencies: `next`, `react`, `react-dom`, `ai`, `zod`, `@ai-sdk/anthropic`,
`@ai-sdk/react`. **Do not install `@ai-sdk/elevenlabs`** — the final design
never uses it; TTS is a raw `fetch` proxy (see Priority Directive #3).

Model used throughout: `anthropic('claude-sonnet-5')`. A faster model
(`claude-haiku-4-5-20251001`) was tried specifically to cut latency and
measured **no faster** (one comparable turn: 2.4s vs Sonnet's 1.6-1.9s) with
worse instruction-following (ignored the brevity instruction, produced stray
line breaks). Don't spend time on a model swap as a latency lever here.

---

## Feature-by-feature build

### 1. Flow canvas (`PlaybookCanvas.tsx`)

- Upload an image via file input or drag-and-drop onto a dropzone; store as
  a data URL (`FileReader.readAsDataURL`) in parent state.
- **Coordinate bug to avoid:** wrap the `<img>` in its own
  `<div className="relative inline-block w-full">` and measure/position
  hotspots against *that wrapper*, not the outer dropzone container. The
  dropzone has a `min-height` for its empty-state placeholder; if hotspot
  percentages are computed against the dropzone instead of the image's own
  rendered box, they drift downward as soon as a real (usually shorter)
  image loads.
- A hotspot ("playbook box") is a **mostly-transparent** dashed-border
  rectangle, not a solid drawn button — the uploaded picture already has its
  own visual buttons baked in (e.g. a blue "OPEN PLAYBOOK EDITOR" bar). Don't
  draw a duplicate on top of it.
- **Click anywhere inside a hotspot → opens the playbook editor for that box
  AND makes it the active stage, in one click.** Don't split this into a
  separate "select" step and "open editor" button.
- A small floating "tag" positioned *above* the hotspot (not overlapping the
  picture) holds: a drag handle (a separate `⋮⋮` glyph — see next point), an
  editable label `<input>`, and a delete `×` button.
- **Drag-handle bug to avoid:** if the rename `<input>` fills the whole
  header row, clicking anywhere to drag will hit the input and do nothing
  (the input's own `onPointerDown` stop-propagates to let the caret land
  normally). Give the grip icon its own small element, separate from the
  input, and only start a drag from that element.
- A resize handle (small square, bottom-right corner) drags out
  `width`/`height`; the drag handle drags `x`/`y`. Both compute new
  percentages from `(pointer delta in px) / (container width or height in px) * 100`,
  clamped to stay in `[0, 100]`.
- Toolbar buttons: "Upload/Replace image", **"Auto-detect blue buttons"**
  (below), "+ Add playbook box" (adds one default-sized box).

### 2. Auto-detect blue buttons (`src/lib/detectHotspots.ts`)

A from-scratch computer-vision pass, done entirely client-side via `<canvas>`
— no server round trip for the position part. Purpose: given an uploaded
diagram image with solid-colored "button" rectangles in it (as most
flowchart exports have), find their pixel positions automatically instead of
making the student drag every hotspot by hand.

Algorithm:

```ts
export type DetectedRect = { x: number; y: number; width: number; height: number };

export function detectBlueHotspots(img: HTMLImageElement): DetectedRect[] {
  // 1. Draw the image to an offscreen canvas sized to its natural dimensions.
  // 2. getImageData() the whole canvas.
  // 3. Single pass over every pixel: mark it "blue" if
  //    a > 200 && b > 180 && (b - r) > 40 && g > 100 && g < 220
  //    (tuned to a solid UI-blue like #2F8FE0, not photographic blues).
  //    Build a Uint8Array mask (1 = blue) and, in the same pass, a
  //    per-row "has any blue pixel" array.
  // 4. Row bands: find contiguous runs of rows that have any blue pixel —
  //    these are the horizontal strips the buttons sit in (there may be
  //    several bands if buttons sit at different heights in the diagram).
  // 5. For each row band, project the mask onto columns within that band's
  //    y-range to find contiguous column groups — these are the individual
  //    buttons within that horizontal strip.
  // 6. For each (row band × column group), find the tight bounding box by
  //    re-scanning just that sub-region for min/max y.
  // 7. Convert every bounding box to PERCENTAGES of the image's natural
  //    width/height (not pixels — the canvas is displayed at a different
  //    size than its natural resolution).
  // 8. Sort results top-to-bottom, then left-to-right.
}
```

Wire it to a button: on click, load the current image into a fresh
`new Image()`, run `detectBlueHotspots` once it's loaded, then hand the
resulting rects to a callback that (a) if boxes already exist, confirms
before replacing them (their playbook text would be lost), and (b) builds
new `PlaybookBox` objects with sequential default labels `"Playbook 1"`,
`"Playbook 2"`, … and empty `instructions`.

### 3. Reading real labels from the image (`/api/detect-labels`)

Detected rects only carry *position* — the sequential "Playbook 1/2/3" names
don't match what's actually printed in the diagram (e.g. "PLAYBOOK 2A"). A
second, server-side pass fixes this using vision:

- `POST { imageDataUrl, rects }`.
- Strip the `data:image/...;base64,` prefix to get the raw base64 and media
  type.
- Build a text prompt listing each rect by index and its approximate
  position ("Button 1: centered at roughly 30% from the left, 85% from the
  top"), asking Claude to find the title text printed at the top of that
  button's enclosing box and return one label per button, in the same
  order.
- Call `generateText` with `output: Output.object({ schema: z.object({ labels: z.array(z.string()) }) })`
  (the current AI SDK API — `generateObject` is deprecated) and the image
  passed as a `{ type: 'file', data: base64, mediaType }` content part
  alongside the text part.
- On any failure, return `{ labels: [] }` — the caller falls back to the
  generic sequential names rather than blocking detection entirely.

### 4. Playbook editor (`PlaybookEditorModal.tsx`) — autosave, no Save button

Fully controlled by the box's `instructions` prop; the `<textarea>`'s
`onChange` calls the save callback **on every keystroke**. No local draft
state, no "Save" button — just "Done" and a `×` to close. An earlier version
required an explicit Save click, which caused a real bug: a student typed a
playbook, tested it immediately without saving, got a generic fallback
response, and assumed the app was broken. Autosave removes that whole class
of failure.

### 5. Master playbook (`MasterPlaybookModal.tsx`)

Same autosave pattern, a single big `<textarea>` bound to
`state.masterPlaybook`. This is explicitly *not* step-by-step content — it's
role/goals/tone/rules that apply across every stage. Surface it via a header
button that reads "Add master playbook" / "Edit master playbook" depending
on whether it's empty.

### 6. Bulk-generating playbook content (`/api/generate-playbooks`)

A "Generate playbook content" header button that fills in every **empty**
hotspot at once, in the style of whatever the student already wrote by hand.

- Client splits boxes into `references` (non-empty `instructions` — used as
  style examples) and `targets` (empty ones). If there are no references,
  show an alert asking the student to write at least one playbook by hand
  first (there's no style to copy). If there are no targets, say there's
  nothing to generate.
- `POST { masterPlaybook, references, targets, imageDataUrl }` to the route.
- Prompt structure: master playbook as overall context (if present) → each
  reference playbook shown in full, with an instruction to match its
  **format, structure, length, and tone exactly** without reusing its literal
  content → for each target, a position hint into the attached image (so the
  model reads what that stage is actually about from the picture, the same
  way `detect-labels` does) → "return one playbook per target, same order."
- Same `generateText` + `Output.object({ schema: z.object({ playbooks: z.array(z.string()) }) })`
  + image-as-file-part pattern as `/api/detect-labels`.
- Client writes results back only into the target boxes (matched by array
  index in the same order they were sent), never touching references.

### 7. The stage-transition highlight (on the canvas)

A cyan glow around whichever hotspot is currently active, fading in/out over
0.3s. Implementation: render the highlight `<div>` for *every* box
unconditionally, absolutely positioned with a few pixels of outward padding
around the hotspot (`inset: -Npx`), and drive visibility purely with CSS
`opacity` + `transition: opacity 300ms ease`:

```tsx
<div
  aria-hidden="true"
  style={{
    borderColor: 'rgba(34, 211, 238, 0.85)',
    backgroundColor: 'rgba(34, 211, 238, 0.16)',
    boxShadow: '0 0 0 3px rgba(34, 211, 238, 0.16)',
    opacity: isActive ? 1 : 0,
    transition: 'opacity 300ms ease',
  }}
  className="pointer-events-none absolute -inset-2 rounded-lg border-2"
/>
```

Keeping the element always mounted (rather than conditionally rendering it)
means both fade-in and fade-out get the same transition for free — no
enter/exit animation library, no unmount-timing edge cases.

### 8. Auto-advancing stages (the `changeStage` tool)

The model can move the conversation to a different playbook mid-conversation
— e.g. detecting an emergency and jumping from a general-intake stage to an
emergency-response stage — without the student manually clicking a different
hotspot.

**Client → server request body** (sent on every message): `activeBoxId`, the
full `boxes` array (`id`, `label`, `instructions` only — not position data),
and `masterPlaybook`. Keep these in refs, synced via a no-dependency-array
`useEffect`, so the `useChat` transport (built once via `useMemo(() => ..., [])`)
always reads current values without needing to be recreated — recreating it
would drop chat history every time the active box changes.

**Server (`/api/chat/route.ts`) system prompt, in order:**

```
1. (if masterPlaybook is set) "OVERALL CONTEXT (applies throughout the conversation):\n{masterPlaybook}"
2. "CURRENT STAGE — \"{label}\". Follow these instructions for how to act right now:\n{instructions}"
   — or a generic fallback if no box is active yet
3. (only if more than one box exists) transition instructions + a menu:
   "- {id}: \"{label}\" — {instructions truncated to ~80-150 chars}"
   for every OTHER box (not the current one)
4. "Voice conversation — keep replies to a sentence or two."
```

**The tool:**

```ts
tools: canTransition ? {
  changeStage: tool({
    description: 'Move the conversation to a different stage of the flow.',
    inputSchema: z.object({
      stageId: z.enum(otherBoxes.map(b => b.id) as [string, ...string[]]),
      reason: z.string().describe('One short phrase: why move here now'),
    }),
    execute: async (input) => input, // pure echo — no server-side effect
  }),
} : undefined,
```

`execute` just echoes its input back; the *real* effect happens client-side.
**No `stopWhen` beyond the default** — see Priority Directive #1, this is
the single most important line (or rather, absent line) in this whole spec.

**Client (`ChatPanel.tsx`) reacts to the tool call:**

```ts
// Watch messages for a completed changeStage call, once per unique toolCallId.
for (const part of last.parts) {
  if (part.type === 'tool-changeStage' && part.state === 'output-available'
      && !handledTransitions.current.has(part.toolCallId)) {
    handledTransitions.current.add(part.toolCallId);
    const stageId = part.input?.stageId;
    if (stageId) queueMicrotask(() => onActiveBoxChange(stageId));
  }
}
```

`onActiveBoxChange` just sets `state.activeBoxId` — the same setter the
canvas hotspot's own click handler uses. That single state change moves the
canvas highlight, updates the "Active playbook" label, *and* changes what
system prompt the next turn uses, all at once.

Render a small inline marker in the transcript whenever this fires, so the
student can see when/why a transition happened without watching the canvas:

```tsx
<div className="my-1.5 flex justify-center">
  <span className="rounded-full bg-cyan-50 px-2.5 py-0.5 text-[11px] font-medium text-cyan-700">
    ↝ Moved to {label}
  </span>
</div>
```

**Empty-reply safety net.** The model occasionally calls `changeStage`
without writing any reply text at all, despite the prompt saying to always
include one — the visitor would otherwise hear/see nothing. Since the tool
schema *requires* a `reason` string every time it's called, fall back to
that reason as the displayed/spoken text whenever there's no real text part:

```ts
function getMessageText(parts) {
  const spoken = parts.filter(p => p.type === 'text').map(p => p.text ?? '').join(' ').trim();
  if (spoken) return spoken;
  const transition = parts.find(p => p.type === 'tool-changeStage' && p.state === 'output-available');
  return (transition?.input?.reason ?? '').trim();
}
```

Use this same helper for both the chat-bubble render and the "what do I pass
to TTS" logic — never render/speak the raw text-parts join directly.

**Design note for playbooks that use this feature:** it only works well if
each playbook is scoped to *its own* stage, the way `/api/generate-playbooks`
already produces content. A playbook written as one big script covering the
entire flow gives the model no reason to ever call the tool, and the
highlight will look "stuck."

### 9. Test conversation panel (`ChatPanel.tsx`)

- `useChat` from `@ai-sdk/react` with a custom `DefaultChatTransport` (see
  request body above).
- Text input + Send button; disabled until a playbook is active.
- **Mic input:** the Web Speech API
  (`window.SpeechRecognition ?? window.webkitSpeechRecognition`, feature
  detected — not in TypeScript's default DOM lib, declare a minimal
  interface yourself). `continuous: false`, `interimResults: true`; results
  are written into the same text input the student would otherwise type
  into, so they can review/edit before hitting Send — it never auto-sends.
  If unsupported (Safari/Firefox), show an alert suggesting Chrome/Edge
  rather than failing silently.
- **Voice output:** see the whole Priority Directive section — one
  `speak(id, text)` call per finished reply, pointed at the streaming
  `/api/tts` GET endpoint via a plain `new Audio(url)`, gated on
  `status === 'ready'` and a `Set<string>` of already-spoken message ids so
  a given reply is only ever spoken once even as the effect re-fires during
  streaming.
- A "Voice replies" checkbox toggles TTS on/off; a "speaking…" indicator
  shows next to whichever bubble is currently playing.

---

## `/api/chat/route.ts` — reference implementation

```ts
import {
  streamText, convertToModelMessages, createUIMessageStreamResponse,
  toUIMessageStream, tool, type UIMessage,
} from 'ai';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

export const maxDuration = 30;

const FALLBACK_SYSTEM_PROMPT =
  'You are a helpful voice agent being prototyped by a student. No playbook has been selected for this stage yet, so introduce yourself briefly and ask what the visitor needs.';

type StageBox = { id: string; label: string; instructions: string };

function summarize(text: string, max = 150) {
  const flat = text.trim().replace(/\s+/g, ' ');
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export async function POST(req: Request) {
  const { messages, activeBoxId, boxes, masterPlaybook } = (await req.json()) as {
    messages: UIMessage[]; activeBoxId?: string | null; boxes?: StageBox[]; masterPlaybook?: string;
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
    model: anthropic('claude-sonnet-5'),
    system: systemParts.join('\n\n'),
    messages: await convertToModelMessages(messages),
    maxOutputTokens: 300,
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
```

## `/api/tts/route.ts` — reference implementation

```ts
export const maxDuration = 30;
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const text = url.searchParams.get('text');
  const voiceId = url.searchParams.get('voiceId')?.trim() || DEFAULT_VOICE_ID;

  if (!text) return new Response('Missing "text" query parameter.', { status: 400 });
  if (!process.env.ELEVENLABS_API_KEY) {
    return new Response('ELEVENLABS_API_KEY is not set. Add it to .env.local to enable voice.', { status: 500 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?optimize_streaming_latency=4`,
      {
        method: 'POST',
        headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
      },
    );
  } catch (err) {
    return new Response(err instanceof Error ? err.message : 'Could not reach ElevenLabs.', { status: 502 });
  }

  if (!upstream.ok || !upstream.body) {
    const message = await upstream.text().catch(() => 'ElevenLabs request failed.');
    return new Response(message || 'ElevenLabs request failed.', { status: upstream.status || 502 });
  }

  // Pass the upstream stream straight through — no buffering.
  return new Response(upstream.body, {
    headers: { 'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg', 'Cache-Control': 'no-store' },
  });
}
```

## Client-side speak + warm-up — reference implementation

```ts
// On ChatPanel mount: warm the server's connection to ElevenLabs.
const warmedRef = useRef(false);
useEffect(() => {
  if (warmedRef.current) return;
  warmedRef.current = true;
  fetch(`/api/tts?text=${encodeURIComponent('Hi')}&voiceId=${encodeURIComponent(voiceId)}`)
    .then((res) => res.body?.cancel())
    .catch(() => {});
}, []); // eslint-disable-line react-hooks/exhaustive-deps

// Speaking a finished reply — one call, full text, streaming URL.
const speak = useCallback(async (id: string, text: string) => {
  try {
    setSpeakingId(id);
    const streamUrl = `/api/tts?text=${encodeURIComponent(text)}&voiceId=${encodeURIComponent(voiceId)}`;
    await new Promise<void>((resolve, reject) => {
      const audio = new Audio(streamUrl);
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error('Audio playback failed'));
      audio.play().catch(reject);
    });
    setSpeakingId((current) => (current === id ? null : current));
  } catch (err) {
    console.error('ElevenLabs playback failed:', err);
    setSpeakingId((current) => (current === id ? null : current));
  }
}, [voiceId]);

// Fires once per finished assistant message, if voice is on.
useEffect(() => {
  if (!voiceEnabled || status !== 'ready') return;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || spokenIds.current.has(last.id)) return;
  const text = getMessageText(last.parts);
  if (!text) return;
  spokenIds.current.add(last.id);
  queueMicrotask(() => void speak(last.id, text)); // deferred: no setState synchronously in the effect
}, [messages, status, voiceEnabled, speak]);
```

---

## Rejected approaches — do not retry these

Each of these was implemented, measured, and reverted. Listed so a fresh
session doesn't rediscover them the hard way.

1. **Sentence-by-sentence TTS chunking, dispatched eagerly/concurrently.**
   Idea: speak each sentence as soon as it finishes streaming, so audio
   starts before the whole reply is done. In practice, firing 2-3 requests
   to ElevenLabs at nearly the same moment made *each one* slower (measured
   900ms-1.3s per chunk) — they contended for connections instead of
   reusing one warm one. Net worse than a single request.

2. **The same idea, serialized instead** (each chunk's fetch only starts
   once the previous chunk's *playback* finishes). This fixed the
   contention but introduced an audible gap between every sentence — no
   overlap between "chunk 2 loading" and "chunk 1 playing" anymore. Also
   worse overall.

3. **A deliberate two-chunk compromise** (speak just the first sentence
   early, the remainder once the full reply is done — one seam, not many).
   This genuinely worked and was measured faster to first sound. It was
   still dropped in favor of the simpler single-call design once the
   streaming endpoint + connection warm-up + output-length cap closed most
   of the latency gap on their own — the added code complexity (tracking
   per-message "first chunk sent" state, splitting on sentence boundaries)
   wasn't worth it for the remaining gain. Worth reconsidering *only* if,
   after implementing everything else in this document, replies are still
   long enough that "wait for the whole thing" is clearly the bottleneck.

4. **`stopWhen: stepCountIs(3)`** (or any value above the default) to let
   the model "continue after calling a tool." Caused duplicate replies and
   an extra ~2-3 second round trip on every transition turn. See Priority
   Directive #1.

5. **Switching the chat model to `claude-haiku-4-5` for speed.** Measured
   no faster (one transition turn: 2.4s vs Sonnet's 1.6-1.9s) and produced
   worse output (ignored the brevity instruction, stray formatting). If
   latency is ever critical again, look elsewhere first — the model was not
   the bottleneck in the measurements taken here.

---

## Known limitations / not yet built

- No knowledge-base (PDF upload) feature — part of the original broader
  vision for this tool, not implemented in this version.
- No TouchDesigner / OSC trigger authoring — also part of the original
  broader vision, not implemented in this version.
- No multi-user / classroom roster features — this is a single-project,
  single-browser (localStorage) tool. Nothing is shared between students.
- No Figma live-import — reading a FigJam file directly was explored but
  blocked by the connected account's org-level Figma seat license (a
  view-only seat can't be used for API/editor access, regardless of the
  file's own share settings). The practical workaround in use: export the
  diagram as a PNG from Figma and upload it normally, then use
  "Auto-detect blue buttons."
- A truncation-detection safety net (flagging a suspiciously short,
  unpunctuated reply as possibly cut off, with a manual "Retry" button
  calling `regenerate()` from `useChat`) was built and later removed during
  a broader rollback. Worth re-adding if truncated replies are observed
  again — the heuristic used was: text under ~15 characters that doesn't
  end in `.!?"')]`.
