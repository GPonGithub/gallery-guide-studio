import type { TourStep } from './OnboardingTour';

// The "Onboard Me" tour, in order. Each step points at a control marked
// data-tour="…" in the interface and opens the panels listed in `open`.
// Links open in a new tab, so the app stays where it is.

const link = (href: string, text: string) => (
  <a href={href} target="_blank" rel="noopener noreferrer">
    {text}
  </a>
);
const ANTHROPIC = 'https://console.anthropic.com/';
const ELEVENLABS = 'https://elevenlabs.io/';

export const ONBOARDING_STEPS: TourStep[] = [
  {
    title: 'Welcome to Chatbot Designer',
    body: (
      <p>
        This guided tour shows you how to set up Chatbot Designer and start building interactive chatbot conversations.
        We&rsquo;ll walk you through connecting your accounts, choosing voices, adding music, importing Scenes,
        generating conversations, and creating FigJam flowcharts.
      </p>
    ),
  },

  // --- Accounts ----------------------------------------------------------
  {
    title: 'Connect your AI services',
    target: 'keys-panel',
    open: ['keys-button'],
    body: (
      <>
        <p>
          Chatbot Designer uses Anthropic to write conversations and ElevenLabs to speak them. You need an API key (a
          kind of password for apps) from each.
        </p>
        <ol>
          <li>
            Sign in to the {link(ANTHROPIC, 'Anthropic Console')} and to {link(ELEVENLABS, 'ElevenLabs')} (each opens in a
            new tab).
          </li>
          <li>Create an API key in each.</li>
          <li>Paste each key into its box here.</li>
          <li>Click Done. Keys are saved as you type.</li>
        </ol>
        <p className="text-xs text-muted-ink">
          Keys show as dots, stay in this browser only, and are never written to your Google Sheet or put in Scene
          exports. No ElevenLabs account yet? Carry on — the chatbot can reply in text only.
        </p>
      </>
    ),
  },

  // --- Voice ---------------------------------------------------------------
  {
    title: 'Choose your chatbot’s voice',
    target: 'voice-list',
    open: ['voice-button'],
    body: (
      <p>
        Each chatbot can have its own voice. You choose a voice from ElevenLabs, add its Voice ID, and test how it sounds
        before saving. The round button beside a voice picks the one the chatbot uses.
      </p>
    ),
  },
  {
    title: 'Add a voice from ElevenLabs',
    target: 'voice-id',
    open: ['voice-button', 'voice-fold'],
    missing: 'Click the name of the voice in use to show its Voice ID box.',
    body: (
      <>
        <ol>
          <li>Open {link(ELEVENLABS, 'ElevenLabs')} in a new tab.</li>
          <li>Go to Voices and pick one.</li>
          <li>Copy its Voice ID.</li>
          <li>Paste it into this box.</li>
        </ol>
        <p className="text-xs text-muted-ink">
          With your ElevenLabs key added, you can also pick one of your voices from the list above this box.
        </p>
      </>
    ),
  },
  {
    title: 'Test the voice',
    target: 'voice-tests',
    open: ['voice-button', 'voice-fold'],
    missing: 'Click the name of the voice in use to show its Test buttons.',
    body: (
      <>
        <p>Click Test and Test expressive to compare the two ways the voice can speak.</p>
        <ul>
          <li>
            <b>Test</b> plays the basic voice. The sliders change how it sounds.
          </li>
          <li>
            <b>Test expressive</b> plays a livelier version that can laugh or whisper. The sliders don&rsquo;t affect it.
          </li>
        </ul>
        <p>The one you test last is the way this voice will speak.</p>
      </>
    ),
  },
  {
    title: 'Adjust the basic voice',
    target: 'voice-sliders',
    open: ['voice-button'],
    body: (
      <p>
        These sliders shape the basic voice only. Move a slider, then click Test again to hear the difference.
      </p>
    ),
  },
  {
    title: 'Save the voice settings',
    target: 'voice-save',
    open: ['voice-button', 'voice-fold'],
    missing: 'Click the name of the voice in use to show its Save settings button.',
    body: (
      <>
        <p>When you&rsquo;re happy with the voice, click Save settings.</p>
        <p>
          Moving a slider doesn&rsquo;t keep it. Test, then Save settings — that&rsquo;s what keeps the slider positions
          and the basic or expressive choice for this voice.
        </p>
      </>
    ),
  },
  {
    title: 'Pause before sending',
    target: 'voice-pause',
    open: ['voice-button'],
    body: (
      <p>
        This is how long the chatbot waits after you stop speaking before it sends what you said. You usually
        don&rsquo;t need to change it. If the chatbot cuts in before you&rsquo;ve finished, make the pause longer.
      </p>
    ),
  },

  // --- Music ---------------------------------------------------------------
  {
    title: 'Add music to your Scene',
    target: 'music-drop',
    open: ['music-button'],
    body: (
      <>
        <p>Drag an MP3 file onto this area to add background music. Music is optional — you can leave it empty.</p>
        <ul>
          <li>The music starts when the Scene starts.</li>
          <li>It gets quieter while the chatbot speaks, then comes back up. This is called audio ducking.</li>
        </ul>
      </>
    ),
  },

  // --- Scenes (a demonstration) ------------------------------------------
  // The pointer does each action in the real Scenes window. Your own open work
  // is put aside first and comes back untouched; the demo scenes are deleted
  // when you move on (see sceneDemo.ts).
  {
    title: 'Scenes: name and save',
    group: 'scenes-demo',
    run: 'scenes-name',
    body: (
      <>
        <p>
          Each conversation you build is a <b>Scene</b>. Watch: the Scenes window opens, the scene is named{' '}
          <b>Test Scene Number 1</b>, and Save keeps it.
        </p>
        <p className="text-xs text-muted-ink">
          This is only a demonstration — your own work is put aside, and the test scenes are removed when you move on.
        </p>
      </>
    ),
  },
  {
    title: 'Start another scene',
    group: 'scenes-demo',
    run: 'scenes-new',
    body: (
      <>
        <p>
          <b>New blank scene</b> starts a fresh one. Here it&rsquo;s named <b>Test Scene Number 2</b> and saved.
        </p>
        <p>
          New scenes appear at the top of the list. Watch it being dragged by its <b>⋮⋮</b> handle to below{' '}
          <b>Test Scene Number 1</b> — the scene lifts while it&rsquo;s being moved.
        </p>
      </>
    ),
  },
  {
    title: 'Put scenes in order',
    group: 'scenes-demo',
    run: 'scenes-reorder',
    body: (
      <>
        <p>
          Scenes are numbered in list order. To change it, drag a scene by its <b>⋮⋮</b> handle. Watch{' '}
          <b>Test Scene Number 2</b> being dragged above <b>Test Scene Number 1</b>.
        </p>
        <p className="text-xs text-muted-ink">Scenes from a Google Sheet keep the sheet&rsquo;s numbers wherever they&rsquo;re dragged.</p>
      </>
    ),
  },
  {
    title: 'Archive a scene',
    group: 'scenes-demo',
    run: 'scenes-archive',
    body: (
      <>
        <p>
          <b>Archive</b> moves a scene to the Archived list. It&rsquo;s kept, and you can still open or unarchive it —
          but generating scenes from your Google Sheet will never change it.
        </p>
        <p>Use it for a scene you want to keep exactly as it is. Watch <b>Test Scene Number 1</b> being archived.</p>
        <p className="text-[#b91c1c]">
          The archive function isn&rsquo;t required when importing scenes from Google Sheets. It&rsquo;s intended for
          experimenting with scene design within the app.
        </p>
        <p className="text-xs text-muted-ink">When you click Next, the test scenes are removed and your own work comes back.</p>
      </>
    ),
  },

  // --- Design Process ---------------------------------------------------
  {
    title: 'Make more room',
    target: 'resize-border',
    run: 'resize-border',
    missing: 'Widen the window to see the Design Process and the chat side by side — the border between them can then be dragged.',
    body: (
      <>
        <p>
          The border between <b>Design Process</b> and the chat can be dragged. Watch it being pulled wider, then back.
        </p>
        <p>Drag it yourself whenever you want more room for either side. Double-click it to go back to the standard width.</p>
      </>
    ),
  },
  {
    title: 'Import your Scenes',
    target: 'sheet-url',
    open: ['design-1'],
    body: (
      <>
        <p>Your Scenes live in a Google Sheet. Each Scene is one column, with everything needed to make its conversation.</p>
        <ol>
          <li>Open your Google Sheet, laid out like the Scene template.</li>
          <li>Click Share → General access → &ldquo;Anyone with the link&rdquo; → Viewer.</li>
          <li>Copy the sheet&rsquo;s link and paste it here.</li>
        </ol>
        <p className="text-xs text-muted-ink">
          Viewer is enough: the sheet doesn&rsquo;t need to be editable by anyone else.
        </p>
      </>
    ),
  },
  {
    title: 'Connect the sheet for saving (once)',
    target: 'sheet-setup',
    open: ['design-1', 'sheet-saving', 'sheet-setup'],
    body: (
      <>
        <p>
          To save what conversations collect back into your sheet, the sheet needs a small Google Apps Script. You do
          this once per sheet.
        </p>
        <ol>
          <li>Follow the steps in &ldquo;Set it up&rdquo;.</li>
          <li>Paste the link it gives you into the Apps Script link box.</li>
          <li>Click Test the connection.</li>
        </ol>
        <p className="text-xs text-muted-ink">
          Apps Script runs inside Google Sheets, so it works on any computer. It can only write to row 7 of your Scene
          columns. You can skip this and come back later.
        </p>
      </>
    ),
  },
  {
    title: 'Generate your Scenes',
    target: 'generate-scenes',
    open: ['design-1'],
    body: (
      <>
        <p>Click Generate Scenes. Chatbot Designer makes a Scene for each filled-in column of the sheet, with its:</p>
        <ul>
          <li>name and number</li>
          <li>conversation description</li>
          <li>information it can use, should save, and must not use</li>
        </ul>
        <p>Empty columns are skipped. When it&rsquo;s done, move on to step 2.</p>
      </>
    ),
  },
  {
    title: 'Pick a Scene',
    target: 'scene-buttons',
    open: ['design-2'],
    missing:
      'No Scenes yet. Click Generate Scenes (outlined) first — the Scene buttons then appear in section 2, and this card moves to them.',
    fallback: { target: 'generate-scenes', open: ['design-1'] },
    body: (
      <>
        <p>Each Scene has its own conversation description: what the chatbot should achieve and what to talk about.</p>
        <p>Each number is a Scene from your sheet. Click one to see its description. You can edit it here before generating.</p>
      </>
    ),
  },
  {
    title: 'Conversation stages',
    target: 'stages',
    open: ['design-2'],
    body: (
      <>
        <p>
          A conversation is split into stages, like &ldquo;welcome&rdquo; or &ldquo;book a time&rdquo;. Click a stage
          number to see and edit its details. Click it again to close it.
        </p>
        <p>
          <b>Master</b> holds what applies to the whole conversation: who the chatbot is, its rules, and the ways out
          that work from any stage.
        </p>
        <p className="text-xs text-muted-ink">You&rsquo;ll also see the conversation as a FigJam flowchart — that comes later in this tour.</p>
      </>
    ),
  },
  {
    title: 'Generate your conversation',
    target: 'generate-conversation',
    open: ['design-2'],
    body: (
      <>
        <p>
          Click Generate New Conversation to turn the description into a conversation you can talk to. It takes one to
          two minutes.
        </p>
        <ul>
          <li>
            <b>Red — Generate New Conversation:</b> not generated yet, or the description has changed since.
          </li>
          <li>
            <b>Green — Conversation Generated:</b> up to date.
          </li>
        </ul>
        <p className="text-xs text-muted-ink">
          Update This Scene does it all again: it re-reads the sheet, regenerates, and redraws in FigJam.
        </p>
      </>
    ),
  },
  {
    title: 'Give your chatbot information',
    target: 'can-use',
    open: ['design-3'],
    body: (
      <>
        <p>This is what your chatbot may use in this Scene to answer questions and help — for example:</p>
        <ul>
          <li>appointment details and available services</li>
          <li>patient preferences and records relevant to this Scene</li>
        </ul>
        <p>
          It comes from your Google Sheet. What the patient said in earlier Scenes is added below it — and is used in
          place of older details here when they differ.
        </p>
      </>
    ),
  },
  {
    title: 'Remember important information',
    target: 'save-info',
    open: ['design-4'],
    body: (
      <>
        <p>
          Your chatbot can remember what a patient tells it and use it in later Scenes. This is what makes the Scenes one
          continuing story instead of separate calls.
        </p>
        <p>
          This box (from your sheet) says what to remember. For example, if a patient says they prefer Dr. Rappaport, a
          later Scene already knows.
        </p>
      </>
    ),
  },
  {
    title: 'What the chatbot saved',
    target: 'saved-list',
    open: ['design-4'],
    body: (
      <>
        <p>As the conversation goes, what&rsquo;s collected appears here as labelled lines, for example:</p>
        <ul>
          <li>Preferred Doctor: Dr. Jan Rappaport</li>
          <li>Appointment Date: October 22, 2026</li>
          <li>Text Reminder Requested: Yes</li>
        </ul>
        <p>
          The same lines are saved to row 7 of this Scene&rsquo;s column in your sheet (once the sheet is connected).
          Later Scenes can use them when they&rsquo;re allowed to.
        </p>
      </>
    ),
  },
  {
    title: 'Protect sensitive information',
    target: 'cannot-use',
    open: ['design-5'],
    body: (
      <>
        <p>This is information the chatbot must not use or bring up in this Scene — for example:</p>
        <ul>
          <li>restricted medical records or therapy notes</li>
          <li>anything that needs the patient&rsquo;s extra permission</li>
        </ul>
        <p>
          It comes from your sheet. Even if an earlier Scene saved something like this, the chatbot never sees it here.
        </p>
      </>
    ),
  },
  {
    title: 'Choose a FigJam board',
    target: 'choose-board',
    open: ['design-6'],
    body: (
      <>
        <p>Chatbot Designer can draw your conversation as a flowchart on a FigJam board.</p>
        <ol>
          <li>Open Choose Board.</li>
          <li>Pick a saved board, or Your own board and paste its link.</li>
          <li>Click Select This Board. It turns green: Board Selected.</li>
        </ol>
      </>
    ),
  },
  {
    title: 'Draw the flowchart',
    target: 'figjam-actions',
    open: ['design-6'],
    body: (
      <>
        <p>Once a Scene&rsquo;s conversation is generated, click Write to FigJam to draw it on the board.</p>
        <ul>
          <li>Each Scene gets its own flowchart, placed so they don&rsquo;t overlap.</li>
          <li>It shows the stages and how they connect.</li>
          <li>View in FigJam opens the board in a new tab.</li>
        </ul>
        <p className="text-xs text-muted-ink">
          Drawing needs the FigJam plugin running in the Figma desktop app — the dot below says whether it is, and
          &ldquo;First time?&rdquo; explains how to start it.
        </p>
      </>
    ),
  },
  {
    title: 'You’re ready to begin!',
    body: (
      <>
        <p>
          You&rsquo;ve seen how to connect your AI services, set up voices and music, import Scenes from Google Sheets,
          generate conversations, manage information, and see your flows in FigJam.
        </p>
        <p>You&rsquo;re ready to start designing your own chatbot experiences!</p>
        <p className="text-xs text-muted-ink">Click Onboard Me at any time to see this tour again.</p>
      </>
    ),
  },
];
