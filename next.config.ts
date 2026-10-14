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
  // The default bottom-left spot covers the phone app's Restart button.
  devIndicators: { position: 'top-left' },
};

export default nextConfig;
