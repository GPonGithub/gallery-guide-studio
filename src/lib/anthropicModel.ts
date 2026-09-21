import { anthropic, createAnthropic } from '@ai-sdk/anthropic';

/**
 * Prefers a key the student entered in the API keys panel (sent with the
 * request) over ANTHROPIC_API_KEY in .env.local, which stays as a fallback.
 */
export function anthropicModel(clientApiKey: string | undefined, modelId = 'claude-sonnet-5') {
  const key = clientApiKey?.trim();
  const provider = key ? createAnthropic({ apiKey: key }) : anthropic;
  return provider(modelId);
}
