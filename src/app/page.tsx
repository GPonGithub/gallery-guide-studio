'use client';

import { useEffect, useState } from 'react';
import { PlaybookCanvas } from '@/components/PlaybookCanvas';
import { PlaybookEditorModal } from '@/components/PlaybookEditorModal';
import { MasterPlaybookModal } from '@/components/MasterPlaybookModal';
import { ApiKeysModal } from '@/components/ApiKeysModal';
import { ChatPanel } from '@/components/ChatPanel';
import { DesignerIdTableModal } from '@/components/DesignerIdTableModal';
import { EditPlaybooksModal } from '@/components/EditPlaybooksModal';
import { FlowSnapshotModal } from '@/components/FlowSnapshotModal';
import { PhoneTestingModal } from '@/components/PhoneTestingModal';
import { defaultState, loadState, saveState } from '@/lib/storage';
import type { PlaybookStep, StepOption, StudioState } from '@/lib/types';
import { buttonOutline, buttonPrimary } from '@/lib/styles';

function makeStepId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `step-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type GeneratedStep = { option: StepOption; instruction: string; navTarget?: string; variable?: string };

export default function Home() {
  const [state, setState] = useState<StudioState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [masterOpen, setMasterOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
  const [designerIdTableOpen, setDesignerIdTableOpen] = useState(false);
  const [editPlaybooksOpen, setEditPlaybooksOpen] = useState(false);
  const [flowSnapshotOpen, setFlowSnapshotOpen] = useState(false);
  const [phoneTestingOpen, setPhoneTestingOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage hydration, must not run during SSR/first paint
    setState(loadState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    saveState(state);
  }, [state, hydrated]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center font-label text-[11px] uppercase tracking-widest text-muted-ink">
        Loading…
      </div>
    );
  }

  const editingBoxIndex = state.boxes.findIndex((b) => b.id === editingBoxId);
  const editingBox = editingBoxIndex >= 0 ? state.boxes[editingBoxIndex] : null;

  const openEditor = (id: string) => {
    setState((s) => ({ ...s, activeBoxId: id, activeStepIndex: 0 }));
    setEditingBoxId(id);
  };

  const generatePlaybooks = async () => {
    const references = state.boxes.filter((b) => b.steps.length > 0);
    const targets = state.boxes.filter((b) => b.steps.length === 0);
    if (references.length === 0 && !state.masterPlaybook.trim()) {
      window.alert(
        "Add a master playbook first (or write at least one playbook by hand) — there's no context to generate from yet.",
      );
      return;
    }
    if (targets.length === 0) {
      window.alert('Every playbook already has content — nothing to generate.');
      return;
    }
    setIsGenerating(true);
    try {
      const res = await fetch('/api/generate-playbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterPlaybook: state.masterPlaybook,
          references: references.map((b) => ({ label: b.label, steps: b.steps })),
          targets: targets.map((b) => ({
            id: b.id,
            label: b.label,
            x: b.x,
            y: b.y,
            leadsTo: b.leadsTo,
            instructionPrompt: b.instructionPrompt,
          })),
          allBoxes: state.boxes.map((b) => ({ id: b.id, label: b.label })),
          imageDataUrl: state.imageDataUrl,
          anthropicApiKey: state.anthropicApiKey,
        }),
      });
      const data = (await res.json()) as { playbooks: GeneratedStep[][]; error?: string };
      if (!res.ok || data.error) {
        window.alert(data.error ?? 'Generation failed.');
        return;
      }
      setState((s) => {
        const targetIds = targets.map((b) => b.id);
        const updates = new Map<string, PlaybookStep[]>(
          targetIds.map((id, i) => [id, (data.playbooks[i] ?? []).map((step) => ({ ...step, id: makeStepId() }))]),
        );
        return {
          ...s,
          boxes: s.boxes.map((b) => (updates.has(b.id) ? { ...b, steps: updates.get(b.id) ?? b.steps } : b)),
        };
      });
    } catch {
      window.alert('Generation failed. Check your connection and API key.');
    } finally {
      setIsGenerating(false);
    }
  };

  // Returns the generated steps instead of committing them — the editor
  // modal stages this as a draft (like every other edit there now); an
  // explicit Save is still required to actually replace the table.
  const generateSinglePlaybook = async (boxId: string): Promise<PlaybookStep[] | null> => {
    const target = state.boxes.find((b) => b.id === boxId);
    if (!target) return null;
    const references = state.boxes.filter((b) => b.id !== boxId && b.steps.length > 0);
    if (references.length === 0 && !state.masterPlaybook.trim()) {
      window.alert(
        "Add a master playbook first (or write at least one other playbook by hand) — there's no context to generate from yet.",
      );
      return null;
    }
    try {
      const res = await fetch('/api/generate-playbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterPlaybook: state.masterPlaybook,
          references: references.map((b) => ({ label: b.label, steps: b.steps })),
          targets: [
            {
              id: target.id,
              label: target.label,
              x: target.x,
              y: target.y,
              leadsTo: target.leadsTo,
              instructionPrompt: target.instructionPrompt,
            },
          ],
          allBoxes: state.boxes.map((b) => ({ id: b.id, label: b.label })),
          imageDataUrl: state.imageDataUrl,
          anthropicApiKey: state.anthropicApiKey,
        }),
      });
      const data = (await res.json()) as { playbooks: GeneratedStep[][]; error?: string };
      if (!res.ok || data.error || !data.playbooks?.[0]) {
        window.alert(data.error ?? 'Generation failed.');
        return null;
      }
      return data.playbooks[0].map((step) => ({ ...step, id: makeStepId() }));
    } catch {
      window.alert('Generation failed. Check your connection and API key.');
      return null;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b-4 border-ink px-6 py-4">
        <h1 className="font-display text-2xl tracking-tight text-ink">CONVERSATION GENERATOR</h1>
        <div className="flex items-center gap-2">
          <button onClick={() => setKeysOpen(true)} className={buttonOutline}>
            API keys
          </button>
          <button onClick={() => setMasterOpen(true)} className={buttonOutline}>
            {state.masterPlaybook.trim() ? 'Edit master playbook' : 'Add master playbook'}
          </button>
          <button
            onClick={() => setDesignerIdTableOpen(true)}
            className={buttonOutline}
            title="Live view of every step's auto-generated Designer ID"
          >
            Designer ID table
          </button>
          <button
            onClick={() => setEditPlaybooksOpen(true)}
            className={buttonOutline}
            title="Auto-detected list of every playbook — click one to open its editor"
          >
            Edit Playbooks
          </button>
          <button
            onClick={() => setFlowSnapshotOpen(true)}
            className={buttonOutline}
            title="Readable text of every playbook and step, with your current test position marked — for debugging"
          >
            Flow Snapshot
          </button>
          <button
            onClick={() => setPhoneTestingOpen(true)}
            className={buttonOutline}
            title="Get a link to test the current conversation on your phone"
          >
            📱 Phone testing
          </button>
          <button onClick={generatePlaybooks} disabled={isGenerating} className={buttonPrimary}>
            {isGenerating ? 'Generating…' : 'Generate playbook content'}
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,191fr)_minmax(0,49fr)]">
        <PlaybookCanvas
          imageDataUrl={state.imageDataUrl}
          imageName={state.imageName}
          imagePixelSize={state.imagePixelSize}
          boxes={state.boxes}
          activeBoxId={state.activeBoxId}
          designerInitials={state.designerInitials}
          anthropicApiKey={state.anthropicApiKey}
          figmaApiKey={state.figmaApiKey}
          figmaFileUrl={state.figmaFileUrl}
          figmaWriteDirty={state.figmaWriteDirty}
          onImageChange={(dataUrl, name) => setState((s) => ({ ...s, imageDataUrl: dataUrl, imageName: name }))}
          onImagePixelSizeChange={(imagePixelSize) => setState((s) => ({ ...s, imagePixelSize }))}
          onBoxesChange={(boxes) => setState((s) => ({ ...s, boxes }))}
          onOpenEditor={openEditor}
          onClearImage={() => setState((s) => ({ ...s, imageDataUrl: null, imageName: null }))}
          onFigmaFileUrlChange={(figmaFileUrl) => setState((s) => ({ ...s, figmaFileUrl }))}
          onFigmaWriteDirtyChange={(figmaWriteDirty) => setState((s) => ({ ...s, figmaWriteDirty }))}
        />

        <div className="min-h-[420px] min-w-0 border-2 border-ink bg-paper p-4">
          <ChatPanel
            boxes={state.boxes}
            activeBoxId={state.activeBoxId}
            activeStepIndex={state.activeStepIndex}
            variables={state.variables}
            masterPlaybook={state.masterPlaybook}
            voiceId={state.voiceId}
            voiceSettings={state.voiceSettings}
            voicePresets={state.voicePresets}
            anthropicApiKey={state.anthropicApiKey}
            elevenLabsApiKey={state.elevenLabsApiKey}
            onPositionChange={(boxId, stepIndex, variableUpdates) =>
              setState((s) => ({
                ...s,
                activeBoxId: boxId,
                activeStepIndex: stepIndex,
                variables: { ...s.variables, ...variableUpdates },
              }))
            }
            onVoiceSettingsChange={(voiceSettings) => setState((s) => ({ ...s, voiceSettings }))}
            onSaveVoicePreset={(index, settings) =>
              setState((s) => {
                const voicePresets = [...s.voicePresets];
                voicePresets[index] = settings;
                return { ...s, voicePresets };
              })
            }
          />
        </div>
      </main>

      {editingBox && (
        <PlaybookEditorModal
          key={editingBox.id}
          box={editingBox}
          boxIndex={editingBoxIndex}
          allBoxes={state.boxes}
          designerInitials={state.designerInitials}
          onChange={(steps) =>
            setState((s) => ({
              ...s,
              figmaWriteDirty: true,
              boxes: s.boxes.map((b) => (b.id === editingBox.id ? { ...b, steps } : b)),
            }))
          }
          onChangeInstructionPrompt={(instructionPrompt) =>
            setState((s) => ({
              ...s,
              figmaWriteDirty: true,
              boxes: s.boxes.map((b) => (b.id === editingBox.id ? { ...b, instructionPrompt } : b)),
            }))
          }
          onGeneratePrompt={() => generateSinglePlaybook(editingBox.id)}
          onClose={() => setEditingBoxId(null)}
        />
      )}

      {designerIdTableOpen && (
        <DesignerIdTableModal
          boxes={state.boxes}
          designerInitials={state.designerInitials}
          onClose={() => setDesignerIdTableOpen(false)}
        />
      )}

      {editPlaybooksOpen && (
        <EditPlaybooksModal boxes={state.boxes} onSelectBox={openEditor} onClose={() => setEditPlaybooksOpen(false)} />
      )}

      {flowSnapshotOpen && (
        <FlowSnapshotModal
          boxes={state.boxes}
          activeBoxId={state.activeBoxId}
          activeStepIndex={state.activeStepIndex}
          designerInitials={state.designerInitials}
          onClose={() => setFlowSnapshotOpen(false)}
        />
      )}

      {phoneTestingOpen && (
        <PhoneTestingModal
          boxes={state.boxes}
          masterPlaybook={state.masterPlaybook}
          voiceId={state.voiceId}
          voiceSettings={state.voiceSettings}
          voicePresets={state.voicePresets}
          onClose={() => setPhoneTestingOpen(false)}
        />
      )}

      {masterOpen && (
        <MasterPlaybookModal
          value={state.masterPlaybook}
          onChange={(masterPlaybook) => setState((s) => ({ ...s, masterPlaybook }))}
          onClose={() => setMasterOpen(false)}
        />
      )}

      {keysOpen && (
        <ApiKeysModal
          anthropicApiKey={state.anthropicApiKey}
          elevenLabsApiKey={state.elevenLabsApiKey}
          figmaApiKey={state.figmaApiKey}
          voiceId={state.voiceId}
          designerInitials={state.designerInitials}
          onChangeAnthropicApiKey={(anthropicApiKey) => setState((s) => ({ ...s, anthropicApiKey }))}
          onChangeElevenLabsApiKey={(elevenLabsApiKey) => setState((s) => ({ ...s, elevenLabsApiKey }))}
          onChangeFigmaApiKey={(figmaApiKey) => setState((s) => ({ ...s, figmaApiKey }))}
          onChangeVoiceId={(voiceId) => setState((s) => ({ ...s, voiceId }))}
          onChangeDesignerInitials={(designerInitials) => setState((s) => ({ ...s, designerInitials }))}
          onClearKeys={() => setState((s) => ({ ...s, anthropicApiKey: '', elevenLabsApiKey: '', figmaApiKey: '' }))}
          onClose={() => setKeysOpen(false)}
        />
      )}
    </div>
  );
}
