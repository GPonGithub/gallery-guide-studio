import type { PlaybookBox, VoiceSettings } from './types';

/**
 * What the phone testing companion (`/phone`) actually needs to run a
 * conversation — deliberately NOT the full StudioState. No image/canvas
 * data (the phone never edits the diagram, only talks through it), no
 * Figma connection details, and no API keys — keys are typed directly into
 * the phone once and stored there (see phone/page.tsx), never embedded in
 * a link that might get forwarded, screenshotted, or logged by a messaging
 * app.
 */
export type PhonePayload = {
  boxes: PlaybookBox[];
  masterPlaybook: string;
  voiceId: string;
  voiceSettings: VoiceSettings;
  voicePresets: (VoiceSettings | null)[];
  /** Missing (older links/sends) means on — the default. */
  smartJumps?: boolean;
};

// Plain base64 can contain +, /, = — fine inside a URL fragment technically,
// but some messaging apps mangle those when "linkifying" text. base64url
// (- and _ instead, no padding) survives copy/paste and AirDrop cleanly.
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  const binary = atob(withPadding);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function encodePhonePayload(payload: PhonePayload): string {
  const json = JSON.stringify(payload);
  return toBase64Url(new TextEncoder().encode(json));
}

export function decodePhonePayload(encoded: string): PhonePayload | null {
  try {
    const json = new TextDecoder().decode(fromBase64Url(encoded));
    return JSON.parse(json) as PhonePayload;
  } catch {
    return null;
  }
}
