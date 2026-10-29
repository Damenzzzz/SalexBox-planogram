import type { Look, Sku } from '../domain/types';

// ТР ТС 035/2014: предупреждение в верхней части лицевой стороны, не меньше 50 % площади
export const WARN = { share: 0.5 };

const FONT = {
  serif: (s: number) => `600 ${s}px Georgia, "Times New Roman", serif`,
  wide: (s: number) => `700 ${s}px Unbounded, "Golos Text", Arial, sans-serif`,
  sans: (s: number) => `800 ${s}px "Golos Text", Arial, sans-serif`,
};

export function rr(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const k = Math.max(0, Math.min(r, w / 2, h / 2));
  g.beginPath();
  g.moveTo(x + k, y); g.arcTo(x + w, y, x + w, y + h, k); g.arcTo(x + w, y + h, x, y + h, k);
  g.arcTo(x, y + h, x, y, k); g.arcTo(x, y, x + w, y, k); g.closePath();
}

export function fitFont(g: CanvasRenderingContext2D, text: string, maxW: number, size: number, font: (s: number) => string) {
  g.font = font(size);
  const m = g.measureText(text).width;
  if (m > maxW) { size = Math.max(3, (size * maxW) / m); g.font = font(size); }
  return size;
}

function hash(s: string) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

function drawWarning(g: CanvasRenderingContext2D, W: number, h: number, seed: number) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, '#3d3632'); gr.addColorStop(1, '#231f1d');
  g.fillStyle = gr; g.fillRect(0, 0, W, h);
  const tones = ['rgba(150,110,92,.55)', 'rgba(96,112,120,.5)', 'rgba(170,140,110,.45)', 'rgba(120,80,70,.5)'];
  for (let k = 0; k < 3; k++) {
    const r = (seed >> (k * 5)) & 31;
    const cx = W * (0.2 + (r % 7) / 10), cy = h * (0.25 + (r % 5) / 10), rad = Math.max(W, h) * (0.35 + (r % 3) / 10);
    const rg = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    rg.addColorStop(0, tones[(r + k) % tones.length]); rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg; g.fillRect(0, 0, W, h);
  }
  const sh = h * 0.24;
  g.fillStyle = '#0e0d0c'; g.fillRect(0, h - sh, W, sh);
  g.fillStyle = '#f2f2f2';
  fitFont(g, 'КУРЕНИЕ УБИВАЕТ', W * 0.86, sh * 0.62, FONT.sans);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('КУРЕНИЕ УБИВАЕТ', W / 2, h - sh / 2);
}

function paintFace(g: CanvasRenderingContext2D, L: Look, W: number, H: number, top: number) {
  const bh = H - top;
  g.fillStyle = L.a; g.strokeStyle = L.a;
  switch (L.kind) {
    case 'band': g.fillRect(0, top + bh * 0.34, W, bh * 0.32); break;
    case 'stripe': for (let k = 0; k < 3; k++) g.fillRect(0, top + bh * (0.74 + k * 0.07), W, Math.max(1, bh * 0.025)); break;
    case 'frame': g.lineWidth = Math.max(1, W * 0.035); g.strokeRect(W * 0.1, top + bh * 0.1, W * 0.8, bh * 0.8); break;
    case 'split': g.fillRect(0, top, W * 0.2, bh); break;
    case 'emblem': g.beginPath(); g.arc(W / 2, top + bh * 0.33, Math.min(W, bh) * 0.2, 0, Math.PI * 2); g.fill(); break;
    case 'split-h': g.fillRect(0, top + bh * 0.64, W, bh * 0.36); break;
    case 'grad': {
      const gg = g.createLinearGradient(0, top + bh, W, top);
      gg.addColorStop(0, 'rgba(255,255,255,0)'); gg.addColorStop(1, 'rgba(255,255,255,.32)');
      g.fillStyle = gg; g.fillRect(0, top, W, bh);
      g.fillStyle = L.a; g.fillRect(0, top + bh * 0.8, W, Math.max(1, bh * 0.03));
      break;
    }
  }
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (L.kind === 'emblem') {
    g.fillStyle = L.c[0];
    fitFont(g, L.word[0], W, Math.min(W, bh) * 0.24, FONT.serif);
    g.fillText(L.word[0], W / 2, top + bh * 0.34);
  }
  const wordY = L.kind === 'emblem' ? top + bh * 0.66 : L.kind === 'split-h' ? top + bh * 0.4 : top + bh * 0.48;
  const wordX = L.kind === 'split' ? W * 0.6 : W / 2;
  const maxW = L.kind === 'split' ? W * 0.72 : W * 0.82;
  g.fillStyle = L.ink;
  const ws = fitFont(g, L.word, maxW, Math.min(bh * 0.2, W * 0.3), FONT[L.font]);
  g.fillText(L.word, wordX, wordY);
  g.globalAlpha = 0.85;
  if (L.kind === 'split-h') g.fillStyle = '#ffffff';
  fitFont(g, L.sub, maxW, ws * 0.48, FONT.sans);
  g.fillText(L.sub, wordX, L.kind === 'split-h' ? top + bh * 0.82 : wordY + ws * 0.95);
  g.globalAlpha = 1;
}

// Лицевая сторона пачки: фирменные цвета, крышка, объём, целлофан, зона предупреждения
export function makeTexture(sku: Sku, W: number, H: number, warn: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(6, Math.round(W)); c.height = Math.max(6, Math.round(H));
  W = c.width; H = c.height;
  const g = c.getContext('2d')!;
  const L = sku.look;
  const flat = H < W;     // блистер лежит плашмя
  rr(g, 0, 0, W, H, Math.max(1, Math.min(W, H) * 0.05)); g.save(); g.clip();
  const base = g.createLinearGradient(0, 0, W * 0.4, H);
  base.addColorStop(0, L.c[0]); base.addColorStop(1, L.c[1]);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const wh = warn && !flat ? H * WARN.share : 0;
  paintFace(g, L, W, H, wh);
  if (wh) drawWarning(g, W, wh, hash(sku.id));
  if (!flat) {
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, H * 0.235, W, Math.max(1, H * 0.008));
    g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(0, H * 0.235 + Math.max(1, H * 0.008), W, Math.max(1, H * 0.005));
  }
  const sh = g.createLinearGradient(0, 0, W, 0);
  sh.addColorStop(0, 'rgba(255,255,255,.12)'); sh.addColorStop(0.18, 'rgba(255,255,255,0)');
  sh.addColorStop(0.8, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,.24)');
  g.fillStyle = sh; g.fillRect(0, 0, W, H);
  const tv = g.createLinearGradient(0, 0, 0, H);
  tv.addColorStop(0, 'rgba(255,255,255,.18)'); tv.addColorStop(0.06, 'rgba(255,255,255,0)');
  tv.addColorStop(0.9, 'rgba(0,0,0,0)'); tv.addColorStop(1, 'rgba(0,0,0,.2)');
  g.fillStyle = tv; g.fillRect(0, 0, W, H);
  g.beginPath(); g.moveTo(W * 0.58, 0); g.lineTo(W * 0.8, 0); g.lineTo(W * 0.3, H); g.lineTo(W * 0.08, H); g.closePath();
  g.fillStyle = 'rgba(255,255,255,.07)'; g.fill();
  g.restore();
  rr(g, 0.5, 0.5, W - 1, H - 1, Math.max(1, Math.min(W, H) * 0.05));
  g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1; g.stroke();
  return c;
}

const cache = new Map<string, HTMLCanvasElement>();
export function texture(sku: Sku, W: number, H: number, warn: boolean) {
  const key = `${sku.id}|${sku.look.c[0]}|${sku.look.a}|${Math.round(W)}|${Math.round(H)}|${warn ? 1 : 0}`;
  let t = cache.get(key);
  if (!t) {
    if (cache.size > 2500) cache.clear();
    t = makeTexture(sku, W, H, warn);
    cache.set(key, t);
  }
  return t;
}
export const clearTextures = () => cache.clear();

const thumbs = new Map<string, string>();
export function thumbURL(sku: Sku, scale = 1.6, warn = false) {
  const key = `${sku.id}|${sku.w}|${sku.h}|${sku.look.c[0]}|${scale}|${warn}`;
  let u = thumbs.get(key);
  if (!u) { u = makeTexture(sku, sku.w * scale, sku.h * scale, warn).toDataURL(); thumbs.set(key, u); }
  return u;
}
export const clearThumbs = () => thumbs.clear();
