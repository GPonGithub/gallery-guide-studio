'use client';

/**
 * The AI character: a glowing orb on black that moves with the chatbot's voice.
 * Swirling coloured lobes inside a glass sphere; while the voice speaks they swell, spin
 * faster and twist with its loudness (the low, middle and high parts of the voice each
 * drive one lobe). Silent, it breathes slowly.
 *
 * `color` tints the whole character (any CSS hex colour); null = the multi-colour spectrum.
 * `read` gives the voice reading each frame (default: the chatbot's voice, in this tab or another; voiceLevel.ts).
 */

import { useEffect, useRef } from 'react';
import { currentVoiceReading, type VoiceReading } from '@/lib/agent/voiceLevel';

type Props = {
  color?: string | null;
  read?: () => VoiceReading;
  className?: string;
};

const SPECTRUM = ['#ff3fa4', '#36d6ff', '#5a5cff', '#b44dff'];

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l * 100];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [(h + 360) % 360, s * 100, l * 100];
}

/** Four lobe colours: the spectrum, or shades either side of the chosen colour. */
export function orbPalette(color: string | null | undefined): string[] {
  const hsl = color ? hexToHsl(color) : null;
  if (!hsl) return SPECTRUM;
  const [h, s] = hsl;
  const sat = Math.max(55, s);
  return [
    `hsl(${h} ${sat}% 58%)`,
    `hsl(${(h + 32) % 360} ${sat}% 62%)`,
    `hsl(${(h + 328) % 360} ${sat}% 52%)`,
    `hsl(${h} ${Math.min(100, sat + 10)}% 74%)`,
  ];
}

/** A colour with an alpha, for gradients: works for hex and hsl() strings. */
function withAlpha(c: string, a: number): string {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  return c.replace(/\)$/, ` / ${a})`);
}

export default function AiCharacterOrb({ color = null, read = currentVoiceReading, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colorRef = useRef(color);
  const readRef = useRef(read);
  useEffect(() => {
    colorRef.current = color;
    readRef.current = read;
  }, [color, read]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const off = document.createElement('canvas');
    const octx = off.getContext('2d');
    if (!octx) return;

    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      off.width = Math.max(1, Math.round(canvas.width / 2));
      off.height = Math.max(1, Math.round(canvas.height / 2));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(canvas);

    const smooth: VoiceReading = { level: 0, low: 0, mid: 0, high: 0 };
    let last = performance.now();
    let spin = 0; // turns faster while speaking
    let t = 0;
    let raf = 0;

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (canvas.width < 16 || canvas.height < 16) return; // not laid out yet
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      const voice = readRef.current();
      // Rises at once with the voice, falls back a little more gently: the pulse lands on each syllable.
      for (const k of ['level', 'low', 'mid', 'high'] as const) {
        const rate = voice[k] > smooth[k] ? 28 : 7;
        smooth[k] += (voice[k] - smooth[k]) * (1 - Math.exp(-dt * rate));
      }
      const e = smooth.level;
      spin += dt * (0.35 + 2.6 * e);

      const W = canvas.width;
      const H = canvas.height;
      const cx = W / 2;
      const cy = H / 2;
      const base = Math.min(W, H) * 0.27;
      const breathe = 0.025 * Math.sin(t * 1.4) * (1 - e);
      const R = base * (1 + breathe + 0.13 * e);
      const pal = orbPalette(colorRef.current);

      ctx.globalCompositeOperation = 'source-over';
      ctx.filter = 'none';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);

      // Halo round the sphere, brighter as it speaks.
      const halo = ctx.createRadialGradient(cx, cy, R * 0.7, cx, cy, R * 2.3);
      halo.addColorStop(0, withAlpha(pal[1], 0.1 + 0.32 * e));
      halo.addColorStop(0.45, withAlpha(pal[0], 0.04 + 0.12 * e));
      halo.addColorStop(1, withAlpha(pal[2], 0));
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);

      // The lobes, drawn small and blurred for softness.
      const s = off.width / W;
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.globalCompositeOperation = 'source-over';
      octx.clearRect(0, 0, off.width, off.height);
      octx.globalCompositeOperation = 'lighter';
      const drive = [smooth.low, smooth.mid, smooth.high, e];
      for (let i = 0; i < 4; i++) {
        const amp = drive[i];
        const turn = spin * (i % 2 ? -1 : 1) * (0.8 + i * 0.22) + (i * Math.PI) / 2;
        const ox = cx + Math.cos(t * (0.5 + i * 0.13) + i * 1.7) * R * (0.12 + 0.22 * amp);
        const oy = cy + Math.sin(t * (0.43 + i * 0.11) + i * 2.3) * R * (0.12 + 0.22 * amp);
        octx.beginPath();
        const steps = 72;
        for (let k = 0; k <= steps; k++) {
          const th = (k / steps) * Math.PI * 2;
          const r =
            R *
            (0.4 +
              0.2 * amp +
              (0.07 + 0.2 * amp) * Math.sin(3 * th + t * (1.1 + i * 0.3) + i) +
              (0.03 + 0.1 * amp) * Math.sin(5 * th - t * (1.9 + i * 0.4) + i * 2));
          // Stretched one way, so a lobe reads as a ribbon of light rather than a disc.
          const lx = Math.cos(th) * r * 1.3;
          const ly = Math.sin(th) * r * 0.7;
          const x = ox + lx * Math.cos(turn) - ly * Math.sin(turn);
          const y = oy + lx * Math.sin(turn) + ly * Math.cos(turn);
          if (k === 0) octx.moveTo(x * s, y * s);
          else octx.lineTo(x * s, y * s);
        }
        octx.closePath();
        const g = octx.createRadialGradient(ox * s, oy * s, 0, ox * s, oy * s, R * s * 0.95);
        g.addColorStop(0, withAlpha(pal[i], 0.3 + 0.3 * amp));
        g.addColorStop(0.6, withAlpha(pal[i], 0.16 + 0.22 * amp));
        g.addColorStop(1, withAlpha(pal[i], 0));
        octx.fillStyle = g;
        octx.fill();
      }

      // Inside the sphere.
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
      const body = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      body.addColorStop(0, withAlpha(pal[2], 0.1));
      body.addColorStop(0.75, withAlpha(pal[2], 0.16));
      body.addColorStop(1, withAlpha(pal[0], 0.4));
      ctx.fillStyle = body;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.globalCompositeOperation = 'lighter';
      ctx.filter = `blur(${Math.max(2, R * 0.07)}px)`;
      ctx.drawImage(off, 0, 0, W, H);
      ctx.filter = 'none';
      // A white-hot centre when the voice is loud.
      const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.6);
      core.addColorStop(0, `rgba(255,255,255,${0.02 + 0.1 * e})`);
      core.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = core;
      ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      ctx.restore();

      // Glass: a bright rim and a soft highlight.
      ctx.globalCompositeOperation = 'lighter';
      const rim = ctx.createLinearGradient(cx - R, cy - R, cx + R, cy + R);
      rim.addColorStop(0, `rgba(255,255,255,${0.32 + 0.2 * e})`);
      rim.addColorStop(0.5, withAlpha(pal[1], 0.12));
      rim.addColorStop(1, `rgba(255,255,255,${0.18 + 0.15 * e})`);
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1, R * 0.018);
      ctx.beginPath();
      ctx.arc(cx, cy, R - ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.stroke();
      const hl = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.45, 0, cx - R * 0.35, cy - R * 0.45, R * 0.6);
      hl.addColorStop(0, 'rgba(255,255,255,0.13)');
      hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hl;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.fill();
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} style={{ display: 'block', width: '100%', height: '100%' }} />;
}
