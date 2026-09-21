'use client';

import { useEffect, useState } from 'react';
import { PlaybookCanvas } from '@/components/PlaybookCanvas';
import { PlaybookEditorModal } from '@/components/PlaybookEditorModal';
import { MasterPlaybookModal } from '@/components/MasterPlaybookModal';
import { ApiKeysModal } from '@/components/ApiKeysModal';
import { ChatPanel } from '@/components/ChatPanel';
import { defaultState, loadState, saveState } from '@/lib/storage';
import type { StudioState } from '@/lib/types';
import { buttonOutline, buttonPrimary } from '@/lib/styles';

export default function Home() {
  const [state, setState] = useState<StudioState>(defaultState);
  const [hydrated, setHydrated] = useState(false);
  const [editingBoxId, setEditingBoxId] = useState<string | null>(null);
  const [masterOpen, setMasterOpen] = useState(false);
  const [keysOpen, setKeysOpen] = useState(false);
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

  const editingBox = state.boxes.find((b) => b.id === editingBoxId) ?? null;

  const generatePlaybooks = async () => {
    const references = state.boxes.filter((b) => b.instructions.trim());
    const targets = state.boxes.filter((b) => !b.instructions.trim());
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
          references: references.map((b) => ({ label: b.label, instructions: b.instructions })),
          targets: targets.map((b) => ({ label: b.label, x: b.x, y: b.y })),
          imageDataUrl: state.imageDataUrl,
          anthropicApiKey: state.anthropicApiKey,
        }),
      });
      const data = (await res.json()) as { playbooks: string[]; error?: string };
      if (!res.ok || data.error) {
        window.alert(data.error ?? 'Generation failed.');
        return;
      }
      setState((s) => {
        const targetIds = targets.map((b) => b.id);
        const updates = new Map(targetIds.map((id, i) => [id, data.playbooks[i]]));
        return {
          ...s,
          boxes: s.boxes.map((b) => (updates.has(b.id) ? { ...b, instructions: updates.get(b.id) ?? b.instructions } : b)),
        };
      });
    } catch {
      window.alert('Generation failed. Check your connection and API key.');
    } finally {
      setIsGenerating(false);
    }
  };

  const generateSinglePlaybook = async (boxId: string) => {
    const target = state.boxes.find((b) => b.id === boxId);
    if (!target) return;
    const references = state.boxes.filter((b) => b.id !== boxId && b.instructions.trim());
    if (references.length === 0 && !state.masterPlaybook.trim()) {
      window.alert(
        "Add a master playbook first (or write at least one other playbook by hand) — there's no context to generate from yet.",
      );
      return;
    }
    if (
      target.instructions.trim() &&
      !window.confirm('This will replace the current instructions for this playbook. Continue?')
    ) {
      return;
    }
    try {
      const res = await fetch('/api/generate-playbooks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          masterPlaybook: state.masterPlaybook,
          references: references.map((b) => ({ label: b.label, instructions: b.instructions })),
          targets: [{ label: target.label, x: target.x, y: target.y }],
          imageDataUrl: state.imageDataUrl,
          anthropicApiKey: state.anthropicApiKey,
        }),
      });
      const data = (await res.json()) as { playbooks: string[]; error?: string };
      if (!res.ok || data.error || !data.playbooks?.[0]) {
        window.alert(data.error ?? 'Generation failed.');
        return;
      }
      const generated = data.playbooks[0];
      setState((s) => ({
        ...s,
        boxes: s.boxes.map((b) => (b.id === boxId ? { ...b, instructions: generated } : b)),
      }));
    } catch {
      window.alert('Generation failed. Check your connection and API key.');
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
          <button onClick={generatePlaybooks} disabled={isGenerating} className={buttonPrimary}>
            {isGenerating ? 'Generating…' : 'Generate playbook content'}
          </button>
        </div>
      </header>

      <main className="grid flex-1 grid-cols-1 gap-6 p-6 lg:grid-cols-[minmax(0,191fr)_minmax(0,49fr)]">
        <PlaybookCanvas
          imageDataUrl={state.imageDataUrl}
          imageName={state.imageName}
          boxes={state.boxes}
          activeBoxId={state.activeBoxId}
          anthropicApiKey={state.anthropicApiKey}
          figmaApiKey={state.figmaApiKey}
          figmaFileUrl={state.figmaFileUrl}
          onImageChange={(dataUrl, name) => setState((s) => ({ ...s, imageDataUrl: dataUrl, imageName: name }))}
          onBoxesChange={(boxes) => setState((s) => ({ ...s, boxes }))}
          onSelectBox={(id) => setState((s) => ({ ...s, activeBoxId: id }))}
          onOpenEditor={(id) => {
            setState((s) => ({ ...s, activeBoxId: id }));
            setEditingBoxId(id);
          }}
          onClearAll={() =>
            setState((s) => ({ ...s, imageDataUrl: null, imageName: null, boxes: [], activeBoxId: null }))
          }
          onFigmaFileUrlChange={(figmaFileUrl) => setState((s) => ({ ...s, figmaFileUrl }))}
        />

        <div className="min-h-[420px] min-w-0 border-2 border-ink bg-paper p-4">
          <ChatPanel
            boxes={state.boxes}
            activeBoxId={state.activeBoxId}
            masterPlaybook={state.masterPlaybook}
            voiceId={state.voiceId}
            voiceSettings={state.voiceSettings}
            voicePresets={state.voicePresets}
            anthropicApiKey={state.anthropicApiKey}
            elevenLabsApiKey={state.elevenLabsApiKey}
            onActiveBoxChange={(id) => setState((s) => ({ ...s, activeBoxId: id }))}
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
          box={editingBox}
          onChange={(instructions) =>
            setState((s) => ({
              ...s,
              boxes: s.boxes.map((b) => (b.id === editingBox.id ? { ...b, instructions } : b)),
            }))
          }
          onGeneratePrompt={() => generateSinglePlaybook(editingBox.id)}
          onClose={() => setEditingBoxId(null)}
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
          onChangeAnthropicApiKey={(anthropicApiKey) => setState((s) => ({ ...s, anthropicApiKey }))}
          onChangeElevenLabsApiKey={(elevenLabsApiKey) => setState((s) => ({ ...s, elevenLabsApiKey }))}
          onChangeFigmaApiKey={(figmaApiKey) => setState((s) => ({ ...s, figmaApiKey }))}
          onChangeVoiceId={(voiceId) => setState((s) => ({ ...s, voiceId }))}
          onClearKeys={() => setState((s) => ({ ...s, anthropicApiKey: '', elevenLabsApiKey: '', figmaApiKey: '' }))}
          onClose={() => setKeysOpen(false)}
        />
      )}
    </div>
  );
}
