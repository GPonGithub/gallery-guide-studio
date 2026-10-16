'use client';

import { useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { Patient } from '@/lib/agent/memory';
import { buttonOutline, buttonPrimary, fieldInput, fieldLabel } from '@/lib/styles';
import { DropdownArrow } from './DropdownArrow';

// The patient being talked to. What each scene's conversation saves is kept
// for this patient, and their later scenes can use it (see memory.ts).

export function PatientMenu({
  patients,
  activeId,
  onSelect,
  onCreate,
  onClear,
  onDelete,
}: {
  patients: Patient[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  /** Forgets everything the patient's scenes saved. */
  onClear: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirm, setConfirm] = useState<{ kind: 'clear' | 'delete'; patient: Patient } | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const active = patients.find((p) => p.id === activeId) ?? null;

  // Close on a click outside the menu, or Escape (unless a confirmation is up).
  useEffect(() => {
    if (!open || confirm) return;
    const onPointer = (e: MouseEvent) => {
      // Clicks in the onboarding tour's card don't count as outside (it may be explaining this panel).
      if ((e.target as Element).closest?.('[data-tour-ui]')) return;
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, confirm]);

  const create = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
  };

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-10 items-center gap-2 ${buttonOutline}`}
        aria-expanded={open}
        title="The patient being talked to — what their conversations save is kept for their later scenes"
      >
        Patient: {active ? active.name : 'none'}
        {active && active.items.length > 0 && <span className="normal-case tracking-normal"> · {active.items.length} saved</span>}
        <DropdownArrow open={open} />
      </button>
      {open && (
        <div className="fixed inset-x-4 top-24 z-40 flex max-h-[70vh] flex-col gap-3 overflow-y-auto border-2 border-ink bg-paper p-4 shadow-[6px_6px_0_0_rgba(0,0,0,0.15)] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[360px]">
          <p className={fieldLabel}>Patients · what each one’s scenes save is kept for their later scenes</p>
          {patients.length === 0 && (
            <p className="font-body text-xs italic text-muted-ink">
              None yet — one is made automatically the first time a conversation saves something.
            </p>
          )}
          {patients.map((p) => (
            <div key={p.id} className={`flex flex-wrap items-center gap-2 border-2 p-2 ${p.id === activeId ? 'border-ink' : 'border-hair'}`}>
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 font-body text-sm text-ink">
                <input type="radio" name="patient" checked={p.id === activeId} onChange={() => onSelect(p.id)} className="accent-ink" />
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 font-label text-[10px] uppercase tracking-wide text-muted-ink">{p.items.length} saved</span>
              </label>
              <button
                onClick={() => setConfirm({ kind: 'clear', patient: p })}
                disabled={p.items.length === 0}
                className="font-label text-[10px] uppercase tracking-widest text-ink hover:underline disabled:text-muted-ink disabled:no-underline"
              >
                Clear memory
              </button>
              <button
                onClick={() => setConfirm({ kind: 'delete', patient: p })}
                className="font-label text-[10px] uppercase tracking-widest text-[#b91c1c] hover:underline"
              >
                Delete
              </button>
            </div>
          ))}
          <div className="flex gap-2 border-t-2 border-hair pt-3">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
              placeholder="New patient’s name"
              aria-label="New patient’s name"
              className={`min-w-0 flex-1 ${fieldInput}`}
            />
            <button onClick={create} disabled={!newName.trim()} className={buttonPrimary}>
              Add
            </button>
          </div>
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title={confirm.kind === 'clear' ? `Clear ${confirm.patient.name}’s memory?` : `Delete ${confirm.patient.name}?`}
          message={
            confirm.kind === 'clear'
              ? `Everything ${confirm.patient.name}’s scenes have saved (${confirm.patient.items.length} items) will be forgotten. This action cannot be undone.`
              : `${confirm.patient.name} and everything their scenes have saved will be deleted. This action cannot be undone.`
          }
          confirmLabel={confirm.kind === 'clear' ? 'Clear memory' : 'Delete patient'}
          onConfirm={() => {
            if (confirm.kind === 'clear') onClear(confirm.patient.id);
            else onDelete(confirm.patient.id);
            setConfirm(null);
          }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
