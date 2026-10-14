'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { PlaybookBox, VoiceSettings } from '@/lib/types';
import { encodePhonePayload } from '@/lib/phonePayload';
import { buttonOutline, buttonPrimary, fieldInput } from '@/lib/styles';

type Props = {
  boxes: PlaybookBox[];
  masterPlaybook: string;
  voiceId: string;
  voiceSettings: VoiceSettings;
  voicePresets: (VoiceSettings | null)[];
  smartJumps: boolean;
  anthropicApiKey: string;
  onClose: () => void;
};

// This whole feature is additive and self-contained on purpose: a new
// route (/phone), a new lib file for the link encoding, and this modal —
// nothing here touches the main editor/canvas/chat components or the
// StudioState they already rely on. Closing this modal (or never opening
// it) leaves the rest of the app exactly as it was.
export function PhoneTestingModal({
  boxes,
  masterPlaybook,
  voiceId,
  voiceSettings,
  voicePresets,
  smartJumps,
  anthropicApiKey,
  onClose,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error' | 'not-local'>('idle');

  const encoded = encodePhonePayload({ boxes, masterPlaybook, voiceId, voiceSettings, voicePresets, smartJumps });
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const link = `${origin}/phone#${encoded}`;
  const isLocalhost = typeof window !== 'undefined' && window.location.hostname === 'localhost';
  const sizeKb = Math.round((encoded.length * 0.75) / 1024);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clearing stale QR state before kicking off this render's async regeneration, not a synchronous derivation
    setQrDataUrl(null);
    setQrError(null);
    QRCode.toDataURL(link, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'L', // maximizes capacity — this is scanned live off a screen, not printed, so resilience to damage doesn't matter here
      color: { dark: '#1a1a1a', light: '#ffffff' },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        // A large flow (many playbooks/steps) can produce a link too long
        // for a QR code to hold at all — the copy-link button below still
        // works regardless of size, so this is a soft fallback, not a dead end.
        if (!cancelled) setQrError('This flow is too large to fit in a QR code — use Copy link instead.');
      });
    return () => {
      cancelled = true;
    };
  }, [link]);

  // The iPhone app always opens the same fixed URL, so instead of a link it
  // fetches whatever was last sent here (see /api/phone-flow).
  const sendToApp = async () => {
    setSendState('sending');
    try {
      const res = await fetch('/api/phone-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ boxes, masterPlaybook, voiceId, voiceSettings, voicePresets, smartJumps }),
      });
      if (!res.ok) {
        setSendState(res.status === 403 ? 'not-local' : 'error');
        return;
      }
      // Work out any smart jumps now, on this computer's key, so the phone
      // never waits on it mid-conversation — the server caches the result
      // for the phone's own requests. Best-effort: the phone still works
      // out anything missing itself.
      if (smartJumps && anthropicApiKey.trim()) {
        await fetch('/api/flow-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ boxes, anthropicApiKey }),
        }).catch(() => {});
      }
      setSendState('sent');
    } catch {
      setSendState('error');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.alert("Couldn't copy automatically — select the link text and copy it by hand.");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex w-full max-w-lg flex-col gap-4 border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl tracking-tight text-ink">Phone testing</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-ink transition-colors duration-100 hover:text-muted-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="flex flex-col gap-2 border-2 border-ink p-3">
          <p className="font-label text-[11px] uppercase tracking-widest text-ink">iPhone app</p>
          <p className="font-body text-sm text-ink">
            Sends the current conversation to the Gallery Guide app on your phone. It picks it up within a few
            seconds — no link needed.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={sendToApp}
              disabled={sendState === 'sending' || boxes.length === 0}
              title={boxes.length === 0 ? 'Detect blue buttons first — there are no playbooks to send yet' : undefined}
              className={buttonPrimary}
            >
              {sendState === 'sending' ? 'Sending…' : 'Send to iPhone app'}
            </button>
            {sendState === 'sent' && (
              <span className="font-label text-[10px] uppercase tracking-wide text-ink">Sent ✓</span>
            )}
            {sendState === 'not-local' && (
              <span className="font-label text-[10px] uppercase tracking-wide text-ink">
                Open the app at localhost:3000 on this computer to send
              </span>
            )}
            {sendState === 'error' && (
              <span className="font-label text-[10px] uppercase tracking-wide text-ink">
                Couldn&rsquo;t send — is the dev server running?
              </span>
            )}
          </div>
        </div>

        <p className="font-label text-[11px] uppercase tracking-widest text-ink">Or: Safari link</p>
        <p className="font-body text-sm text-ink">
          Open this link on your phone to test the conversation there — a stripped-down chat-only view with your
          current playbooks, no editing canvas. It&rsquo;s a one-time snapshot of what&rsquo;s currently built, not
          a live sync: changes you make here afterward won&rsquo;t appear on the phone until you generate a new
          link.
        </p>

        {isLocalhost && (
          <p className="border-l-4 border-ink bg-muted px-3 py-2 font-body text-sm text-ink">
            You&rsquo;re viewing this app at <code>localhost</code> — your phone can&rsquo;t reach that. Open the
            app on this computer via its LAN IP or a tunnel URL (e.g. ngrok) first, <em>then</em> reopen this panel
            so the link below points somewhere your phone can actually load.
          </p>
        )}

        <div className="flex flex-col items-center gap-2">
          {qrDataUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element -- a generated data: URL, not an optimizable remote/local asset */}
              <img
                src={qrDataUrl}
                alt="QR code linking to the phone testing page"
                width={180}
                height={180}
                className="border-2 border-ink"
              />
              <span className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
                Scan with your iPhone&rsquo;s camera to open it directly
              </span>
            </>
          )}
          {qrError && <p className="font-body text-sm text-muted-ink">{qrError}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <input readOnly value={link} onFocus={(e) => e.target.select()} className={fieldInput} />
          <span className="font-label text-[10px] uppercase tracking-wide text-muted-ink">
            ~{sizeKb}KB link — no API keys included; you&rsquo;ll enter your own on the phone, once.
          </span>
        </div>

        <div className="flex justify-end gap-2 border-t-2 border-ink pt-4">
          <button onClick={onClose} className={buttonOutline}>
            Close
          </button>
          <button onClick={copyLink} className={buttonPrimary}>
            {copied ? 'Copied!' : 'Copy link'}
          </button>
        </div>
      </div>
    </div>
  );
}
