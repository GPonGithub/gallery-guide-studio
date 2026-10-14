import type { CapacitorConfig } from '@capacitor/cli';

// This app has server-side API routes (/api/chat, /api/tts, etc.) that a
// static export can't include — so unlike a typical Capacitor app, the
// native shell doesn't bundle a built `webDir` at all. It points straight
// at the same dev server this whole project has been tunneled through all
// along (see FIGJAM_PLUGIN_HANDOFF.md), just from a native WKWebView
// instead of Safari. `server.url` is a live pointer — update it here each
// time the tunnel is restarted, since the free-tier URL changes every time.
const DEV_TUNNEL_URL = 'https://buy-condos-tray-organisms.trycloudflare.com';

const config: CapacitorConfig = {
  appId: 'com.galleryguidestudio.app',
  appName: 'Gallery Guide Studio',
  webDir: 'out',
  server: {
    url: `${DEV_TUNNEL_URL}/phone`,
    cleartext: false,
  },
  // Keep the page clear of the notch/status bar and home indicator.
  ios: { contentInset: 'always' },
};

export default config;
