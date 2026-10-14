import type { Viewport } from 'next';

// iOS zooms in whenever an input with text under 16px is focused (the API
// key fields) and stays zoomed afterward, leaving the conversation cut off
// at both edges. Pinning the scale stops that for the phone page only —
// the studio on the computer keeps the default viewport.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function PhoneLayout({ children }: { children: React.ReactNode }) {
  return children;
}
