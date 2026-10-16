'use client';

import { run } from '@/lib/browserDb';
import { compareSceneNumbers } from './sheetScenes';

/**
 * Cross-scene memory. Everything a scene's conversation picks up that its
 * "Information saved from the scene" asks for is saved to the patient being
 * talked to, tagged with the scene it came from. A later scene (numbered
 * after it) can then use it — except anything its "Information this scene
 * cannot use" rules out, which is removed before the agent ever sees it
 * (see /api/agent/memory-filter).
 *
 * Kept in this browser, so it survives switching scenes, closing dialogs and
 * reopening the app.
 */

export type MemoryItem = {
  id: string;
  /** What it is, e.g. "symptoms" or "preferred doctor". */
  label: string;
  value: string;
  sceneId: string;
  /** The scene's number as the sheet gives it ('' for a scene without one). */
  sceneNumber: string;
  sceneName: string;
  savedAt: number;
};

export type Patient = { id: string; name: string; createdAt: number; items: MemoryItem[] };

export type SceneRef = { id: string; number: string; name: string };

export async function listPatients(): Promise<Patient[]> {
  const patients = await run<Patient[]>('patients', 'readonly', (store) => store.getAll());
  return patients.sort((a, b) => a.createdAt - b.createdAt);
}

export async function getPatient(id: string): Promise<Patient | null> {
  return (await run<Patient | undefined>('patients', 'readonly', (store) => store.get(id))) ?? null;
}

async function putPatient(patient: Patient): Promise<void> {
  await run('patients', 'readwrite', (store) => store.put(patient, patient.id));
}

export async function createPatient(name: string): Promise<Patient> {
  const patient: Patient = { id: crypto.randomUUID(), name: name.trim() || 'Patient', createdAt: Date.now(), items: [] };
  await putPatient(patient);
  return patient;
}

export async function renamePatient(id: string, name: string): Promise<void> {
  const patient = await getPatient(id);
  if (patient && name.trim()) await putPatient({ ...patient, name: name.trim() });
}

export async function deletePatient(id: string): Promise<void> {
  await run('patients', 'readwrite', (store) => store.delete(id));
}

/** Forgets everything a patient's scenes have saved (the patient stays). */
export async function clearMemory(id: string): Promise<void> {
  const patient = await getPatient(id);
  if (patient) await putPatient({ ...patient, items: [] });
}

/** Forgets what one scene saved for a patient; other scenes' saves stay. */
export async function clearSceneMemory(id: string, sceneId: string): Promise<void> {
  const patient = await getPatient(id);
  if (patient) await putPatient({ ...patient, items: patient.items.filter((it) => it.sceneId !== sceneId) });
}

const sameLabel = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Saves what a scene's conversation just picked up. The same thing saved
 * again in the same scene replaces the earlier value; saved in another scene
 * it's kept separately (each scene's record stays its own).
 */
export async function saveToMemory(
  patientId: string,
  scene: SceneRef,
  saved: { label: string; value: string }[],
): Promise<Patient | null> {
  const patient = await getPatient(patientId);
  if (!patient || saved.length === 0) return patient;
  const items = [...patient.items];
  for (const { label, value } of saved) {
    if (!label.trim() || !value.trim()) continue;
    const item: MemoryItem = {
      id: crypto.randomUUID(),
      label: label.trim(),
      value: value.trim(),
      sceneId: scene.id,
      sceneNumber: scene.number,
      sceneName: scene.name,
      savedAt: Date.now(),
    };
    const i = items.findIndex((it) => it.sceneId === scene.id && sameLabel(it.label, label));
    if (i >= 0) items[i] = { ...item, id: items[i].id };
    else items.push(item);
  }
  const updated = { ...patient, items };
  await putPatient(updated);
  return updated;
}

/**
 * What a scene may draw on from the patient's earlier scenes: everything
 * saved by scenes numbered before it — and where two of them saved the same
 * thing, just the later scene's (or, between unnumbered ones, the newer). (A scene without a number — not from
 * a sheet — may use what any other scene saved.) Restrictions are applied
 * after this, by /api/agent/memory-filter.
 */
export function earlierMemory(patient: Patient | null, scene: SceneRef): MemoryItem[] {
  if (!patient) return [];
  const earlier = patient.items.filter((it) => {
    if (it.sceneId === scene.id) return false;
    if (!scene.number) return true;
    return it.sceneNumber !== '' && compareSceneNumbers(it.sceneNumber, scene.number) < 0;
  });
  // The same thing saved by more than one scene: only the most recent scene's answer is current.
  const latest = new Map<string, MemoryItem>();
  for (const it of earlier) {
    const key = it.label.trim().toLowerCase();
    const held = latest.get(key);
    const newer =
      !held ||
      (it.sceneNumber && held.sceneNumber ? compareSceneNumbers(it.sceneNumber, held.sceneNumber) : 0) > 0 ||
      (it.sceneNumber === held.sceneNumber && it.savedAt > held.savedAt);
    if (newer) latest.set(key, it);
  }
  return earlier.filter((it) => latest.get(it.label.trim().toLowerCase()) === it);
}

/** What a scene itself has saved for this patient. */
export function savedInScene(patient: Patient | null, sceneId: string | null): MemoryItem[] {
  return patient && sceneId ? patient.items.filter((it) => it.sceneId === sceneId) : [];
}
