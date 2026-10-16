import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next.js blocks dev-server requests from origins other than localhost by
  // default (a CSRF-style protection) — without this, the dev server's
  // assets still 200 through a tunnel, but the app hangs on "Loading…"
  // forever because the HMR/dev-client handshake gets silently blocked.
  // Covers both tunnel services used for phone testing (see the "📱 Phone
  // testing" button) — their random subdomain changes every restart, so
  // this needs to stay a wildcard, not a fixed hostname.
  allowedDevOrigins: [
    '*.trycloudflare.com',
    '*.ngrok-free.app',
    '*.ngrok-free.dev',
  ],
  // Next.js's own "N" development badge (never shown on a hosted copy).
  // Bottom-left keeps it clear of the studio's title and header buttons.
  devIndicators: { position: 'bottom-left' },
  // The plugin download (/api/figjam-plugin) reads these files at request time.
  outputFileTracingIncludes: {
    '/api/figjam-plugin': ['./figjam-plugin/**/*'],
  },
  // On a hosted copy the front page is Chatbot Designer itself. (Running
  // locally, / is still the older playbook studio.)
  async redirects() {
    return process.env.VERCEL ? [{ source: '/', destination: '/agent', permanent: false }] : [];
  },
};

export default nextConfig;
