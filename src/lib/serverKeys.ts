/**
 * Keys set on the server (in .env.local) are a convenience for running the
 * app on your own computer. On a hosted copy (Vercel sets VERCEL=1) anyone
 * with the link could otherwise spend them — so there, every student must
 * use their own key, entered in the app, and the server's are never used.
 */
export const isHosted = Boolean(process.env.VERCEL);

/** A key from the server's environment — only when running locally. */
export function serverKey(name: 'ANTHROPIC_API_KEY' | 'ELEVENLABS_API_KEY'): string | undefined {
  return isHosted ? undefined : process.env[name]?.trim() || undefined;
}
