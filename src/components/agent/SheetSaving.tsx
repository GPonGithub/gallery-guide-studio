'use client';

import { useState } from 'react';
import { isScriptUrl, SHEET_SCRIPT } from '@/lib/agent/sheetScript';
import { buttonOutline, fieldInput, fieldLabel } from '@/lib/styles';
import { DropdownArrow } from './DropdownArrow';

/**
 * Connecting the Google Sheet for saving: the link of the sheet's Apps
 * Script (see lib/agent/sheetScript.ts), a way to test it, and the one-time
 * setup steps. Folded away once it's set up.
 */
export function SheetSaving({
  scriptUrl,
  onScriptUrlChange,
  spreadsheetId,
}: {
  scriptUrl: string;
  onScriptUrlChange: (url: string) => void;
  /** The sheet the scenes came from — the script must belong to it. */
  spreadsheetId: string | null;
}) {
  const connected = isScriptUrl(scriptUrl);
  const [open, setOpen] = useState(!connected);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);

  const runTest = async () => {
    setTesting(true);
    setTest(null);
    try {
      const res = await fetch('/api/sheets/saved', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scriptUrl, spreadsheetId }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; name?: string };
      setTest(data.ok ? { ok: true, message: `Connected to “${data.name}”.` } : { ok: false, message: data.error ?? 'Not connected.' });
    } catch {
      setTest({ ok: false, message: 'Couldn’t reach the app’s server.' });
    } finally {
      setTesting(false);
    }
  };

  const copyScript = async () => {
    try {
      await navigator.clipboard.writeText(SHEET_SCRIPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      setTest({ ok: false, message: 'Copying was blocked by the browser.' });
    }
  };

  return (
    <div className="border-2 border-ink">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        data-tour="sheet-saving"
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/40"
      >
        <span className={`flex items-center gap-2 ${fieldLabel}`}>
          <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${connected ? 'bg-[#15803d]' : 'bg-[#b91c1c]'}`} aria-hidden="true" />
          Save to the sheet (row 7){connected ? ' · link added' : ' · not set up'}
        </span>
        <DropdownArrow open={open} className="text-ink" />
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t-2 border-ink p-3">
          <p className="font-body text-xs italic text-muted-ink">
            What each scene&rsquo;s conversation saves is written into row 7 of that scene&rsquo;s column, as
            &ldquo;Label: value&rdquo; lines. The only other thing it changes is the media list, on the Media tab.
          </p>
          <label className={`flex flex-col gap-1 ${fieldLabel}`}>
            Apps Script link
            <input
              value={scriptUrl}
              onChange={(e) => {
                onScriptUrlChange(e.target.value.trim());
                setTest(null);
              }}
              placeholder="https://script.google.com/macros/s/…/exec"
              aria-invalid={scriptUrl !== '' && !connected}
              className={`w-full font-label text-[12px] normal-case tracking-normal ${fieldInput} ${
                scriptUrl !== '' && !connected ? 'border-[#b91c1c]' : ''
              }`}
            />
          </label>
          <button onClick={() => void runTest()} disabled={!connected || testing} className={`self-start ${buttonOutline}`}>
            {testing ? 'Testing…' : 'Test the connection'}
          </button>
          {test && (
            <p className={`font-body text-xs ${test.ok ? 'text-[#15803d]' : 'text-[#b91c1c]'}`}>
              {test.ok ? '✓ ' : '✗ '}
              {test.message}
            </p>
          )}
          <details className="font-body text-xs text-ink" data-tour="sheet-setup">
            <summary className="cursor-pointer font-label text-[10px] uppercase tracking-wide text-muted-ink">
              Set it up (once per sheet)
            </summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 leading-snug">
              <li>
                Make sure cell <b>A7</b> says <b>List of Saved Information from this scene</b> — the script only writes to
                that row.
              </li>
              <li>
                <button onClick={() => void copyScript()} className="font-label text-[10px] uppercase tracking-widest underline">
                  {copied ? 'Copied ✓' : 'Copy the script'}
                </button>
              </li>
              <li>
                In the sheet: <b>Extensions → Apps Script</b>. Replace everything in the editor with the script, then save.
              </li>
              <li>
                Click <b>Run</b> (with <b>doGet</b> chosen beside it). Google asks for permission:{' '}
                <b>Review permissions</b> → choose your account → <b>Advanced</b> → <b>Go to … (unsafe)</b> →{' '}
                <b>Allow</b>. This lets Apps Script connect to your Google account — once only.
              </li>
              <li>
                <b>Deploy → New deployment</b> → type <b>Web app</b>. Execute as <b>Me</b>, Who has access <b>Anyone</b> →{' '}
                <b>Deploy</b>, and allow access when Google asks.
              </li>
              <li>
                Copy the <b>Web app URL</b> it gives you, paste it above, and click Test the connection.
              </li>
            </ol>
            <p className="mt-2 leading-snug text-muted-ink">
              Anyone with the link can only write row 7 of scene columns and the Media tab — but keep it to yourself and
              your students.
              Don&rsquo;t put real patients&rsquo; details in a shared sheet.
            </p>
          </details>
        </div>
      )}
    </div>
  );
}
