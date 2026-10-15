import { createAnthropic } from '@ai-sdk/anthropic';
import { serverKey } from './serverKeys';

/**
 * Prefers a key the student entered in the API keys panel (sent with the
 * request). Running locally, ANTHROPIC_API_KEY in .env.local is a fallback;
 * a hosted copy never uses a server key (see serverKeys.ts).
 */
export function anthropicModel(clientApiKey: string | undefined, modelId = 'claude-sonnet-5') {
  const apiKey = clientApiKey?.trim() || serverKey('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('Add your Anthropic API key first (Keys, top right).');
  return createAnthropic({ apiKey })(modelId);
}
