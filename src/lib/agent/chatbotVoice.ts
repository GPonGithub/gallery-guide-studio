'use client';

import { kindOf } from './media';
import { currentMediaLinks, currentMediaScene, subscribeMediaLinks, type MediaLink } from './mediaFolder';
import { clampSoundVolume, setVoicePlacement } from './mediaPlayback';
import { currentShowing, onShowingChange } from './mediaShow';
import { panOf, type Pan } from './spatialAudio';

/**
 * Chatbots on the timeline (AI characters): while one is showing in the room, the chatbot's voice
 * comes from that chatbot's place in the room (set in Spatialized Audio by clicking its bar, and
 * remembered like a sound's) at its bar's volume, 0–400%. With none showing, the voice plays evenly on
 * every speaker at its usual level. If two are showing, the first one placed decides.
 */

export const isChatbot = (link: MediaLink) => (link.assetKind ?? kindOf(link.assetName ?? '')) === 'character';

// Live changes while a slider or the dot is being dragged (not saved yet), per chatbot.
const movingVolume = new Map<string, number>();
const movingPan = new Map<string, Pan>();

function sceneLinks(): MediaLink[] {
  const scene = currentMediaScene();
  const at = scene?.lastIndexOf('#') ?? -1;
  const links = currentMediaLinks();
  if (!scene || at < 0) return links;
  const sheetId = scene.slice(0, at);
  const number = scene.slice(at + 1);
  return links.filter((l) => l.sheetId === sheetId && l.sceneNumber === number);
}

function update() {
  const shown = currentShowing().find((s) => s.kind === 'character');
  if (!shown) return setVoicePlacement(null, 1);
  const links = sceneLinks().filter((l) => l.assetId === shown.assetId);
  const link = links.find((l) => l.action === shown.action) ?? links[0];
  const volume = movingVolume.get(shown.assetId) ?? clampSoundVolume(link?.volume);
  const pan = movingPan.get(shown.assetId) ?? panOf(shown.assetId);
  setVoicePlacement(pan, volume);
}

let started = false;
/** Starts following what's showing and the timeline (once; the page calls it). */
export function startChatbotVoice() {
  if (started || typeof window === 'undefined') return;
  started = true;
  onShowingChange(update);
  subscribeMediaLinks(update);
  update();
}

/** A chatbot bar's volume slider moving (before it's saved on the bar). */
export function previewChatbotVolume(assetId: string, volume: number | null) {
  if (volume === null) movingVolume.delete(assetId);
  else movingVolume.set(assetId, volume);
  update();
}

/** A chatbot's dot being dragged in Spatialized Audio (before it's saved). */
export function previewChatbotPan(assetId: string, pan: Pan | null) {
  if (pan === null) movingPan.delete(assetId);
  else movingPan.set(assetId, pan);
  update();
}
