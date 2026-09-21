'use client';

import { buttonGhost, buttonPrimary, fieldInput, fieldLabel } from '@/lib/styles';

type Props = {
  anthropicApiKey: string;
  elevenLabsApiKey: string;
  voiceId: string;
  onChangeAnthropicApiKey: (value: string) => void;
  onChangeElevenLabsApiKey: (value: string) => void;
  onChangeVoiceId: (value: string) => void;
  onClearKeys: () => void;
  onClose: () => void;
};

export function ApiKeysModal({
  anthropicApiKey,
  elevenLabsApiKey,
  voiceId,
  onChangeAnthropicApiKey,
  onChangeElevenLabsApiKey,
  onChangeVoiceId,
  onClearKeys,
  onClose,
}: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/60 p-4">
      <div className="flex w-full max-w-md flex-col gap-4 border-2 border-ink bg-paper p-6">
        <div className="flex items-center justify-between border-b-2 border-ink pb-3">
          <h2 className="font-display text-xl tracking-tight text-ink">API keys</h2>
          <button
            onClick={onClose}
            className="text-xl leading-none text-ink transition-colors duration-100 hover:text-muted-ink"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="font-body text-sm italic text-muted-ink">
          Stored only in this browser&rsquo;s local storage. Never sent anywhere except directly to Anthropic and
          ElevenLabs when you test the agent.
        </p>

        <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
          Anthropic API key
          <input
            type="password"
            autoComplete="off"
            value={anthropicApiKey}
            onChange={(e) => onChangeAnthropicApiKey(e.target.value)}
            placeholder="sk-ant-…"
            className={fieldInput}
          />
        </label>

        <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
          ElevenLabs API key
          <input
            type="password"
            autoComplete="off"
            value={elevenLabsApiKey}
            onChange={(e) => onChangeElevenLabsApiKey(e.target.value)}
            placeholder="xi-…"
            className={fieldInput}
          />
        </label>

        <label className={`flex flex-col gap-1.5 ${fieldLabel}`}>
          ElevenLabs voice ID
          <input
            type="text"
            autoComplete="off"
            value={voiceId}
            onChange={(e) => onChangeVoiceId(e.target.value)}
            placeholder="21m00Tcm4TlvDq8ikWAM"
            className={fieldInput}
          />
        </label>

        <div className="flex items-center justify-between border-t-2 border-ink pt-4">
          <button onClick={onClearKeys} className={buttonGhost}>
            Clear all keys
          </button>
          <button onClick={onClose} className={buttonPrimary}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
