import gallery from '../data/gallery.json';
import { FORMATS, formatFromLabel, makerOf, segmentOf } from './formats';
import type { Look, LookFont, LookKind, Sku, SkuPatch } from './types';


// Цвета по словам в названии модели. Порядок важен: первое совпадение задаёт фон.
const COLOR_WORDS: [RegExp, string][] = [
  [/night/i, '#0b1a3c'], [/aqua|azure/i, '#1f9fc4'], [/crystal/i, '#bfe7f2'], [/blue|блю/i, '#1f4fa3'],
  [/platinum|plat\b/i, '#c7ccd3'], [/silver/i, '#aab2bd'], [/gold|golden|голд/i, '#c9a24a'],
  [/ruby/i, '#9b1b30'], [/red|рэд/i, '#c4161c'], [/black|блэк|noire/i, '#151517'], [/white/i, '#f2f2ef'],
  [/green|lime|menthol|fresh|menthe/i, '#2e7d4f'], [/purple|violet|виолет|amethyst/i, '#6b3fa0'],
  [/brown|браун|cavana|кофе|капучино|crema/i, '#6a4128'], [/yellow|sunny/i, '#e2b021'], [/amber/i, '#d98b2b'],
  [/coral|summer/i, '#ef6f5e'], [/pink|kiss/i, '#e86fa0'], [/вишн|черешн|cherry/i, '#8e1b3b'],
  [/ванил/i, '#e9d8a6'], [/виски|ром/i, '#8a4b1d'], [/виноград/i, '#5b2a6e'], [/orange|tropical/i, '#ef7d22'],
];

interface BrandStyle { kind: LookKind; base?: string; accent: string; font: LookFont }
const BRAND_STYLE: Record<string, BrandStyle> = {
  Parliament: { kind: 'frame', base: '#0d1f45', accent: '#7fd3f0', font: 'serif' },
  Marlboro: { kind: 'split-h', base: '#f6f3ea', accent: '#c4161c', font: 'sans' },
  Sobranie: { kind: 'frame', base: '#121214', accent: '#c9a54a', font: 'serif' },
  Esse: { kind: 'stripe', accent: '#d8b25a', font: 'wide' },
  Kent: { kind: 'grad', accent: '#1e4fa3', font: 'sans' },
  Winston: { kind: 'band', accent: '#ffffff', font: 'sans' },
  Camel: { kind: 'emblem', accent: '#c8a46a', font: 'sans' },
  Chapman: { kind: 'frame', accent: '#e9cf8f', font: 'serif' },
  Rothmans: { kind: 'split', base: '#16357a', accent: '#e23a3a', font: 'sans' },
  LD: { kind: 'stripe', accent: '#d4af37', font: 'wide' },
  Bond: { kind: 'band', base: '#0e2a5c', accent: '#ffffff', font: 'sans' },
  'L&M': { kind: 'grad', accent: '#ffffff', font: 'wide' },
  Bohem: { kind: 'emblem', base: '#3a2418', accent: '#e8cf9b', font: 'serif' },
  Davidoff: { kind: 'frame', accent: '#d9c08a', font: 'serif' },
  Dunhill: { kind: 'frame', base: '#5a1220', accent: '#d9b25a', font: 'serif' },
  Cigaronne: { kind: 'frame', accent: '#d9b25a', font: 'serif' },
  Corsar: { kind: 'band', accent: '#f1e2b8', font: 'serif' },
  Dakota: { kind: 'emblem', accent: '#e8cf9b', font: 'serif' },
  'Captain Black': { kind: 'frame', base: '#121214', accent: '#c9a54a', font: 'serif' },
  'K.Ritter': { kind: 'emblem', accent: '#f0d48a', font: 'serif' },
  Richmond: { kind: 'frame', base: '#1b1b1d', accent: '#c9a54a', font: 'serif' },
  Glamour: { kind: 'grad', base: '#e86fa0', accent: '#ffffff', font: 'serif' },
  Vogue: { kind: 'stripe', base: '#f2f2ef', accent: '#2e7d4f', font: 'serif' },
};
const KINDS: LookKind[] = ['band', 'stripe', 'frame', 'split', 'emblem', 'grad'];
const FALLBACK = ['#1f4fa3', '#8e1b1b', '#1d3a29', '#2b2b30', '#6a4128'];

function hash(s: string): number {
  let h = 2166136261;
  for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k > 0 ? v + (255 - v) * k : v * (1 + k))));
  const r = f(n >> 16), g = f((n >> 8) & 255), b = f(n & 255);
  return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const inkOn = (bg: string) => (luminance(bg) > 0.45 ? '#16213f' : '#ffffff');

// Вариант без бренда и без токенов формата: «Esse Exchange M SS» → «EXCHANGE M»
export function variantOf(model: string, brand: string): string {
  return model
    .replace(new RegExp('^' + brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '')
    .replace(/\b(KSSL|KS|SS|Compact|Nano|Demi|Mini|100S?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function makeLook(brand: string, model: string): Look {
  const st = BRAND_STYLE[brand];
  const h = hash(brand + model);
  const word = COLOR_WORDS.find(([re]) => re.test(model));
  const variantColor = word ? word[1] : null;
  const kind = st?.kind ?? KINDS[h % KINDS.length];
  // У рамочных брендов и Marlboro фон фирменный, а цвет варианта уходит в акцент
  const keepBase = !!st?.base && (kind === 'frame' || kind === 'split-h');
  const base = keepBase ? st!.base! : variantColor ?? st?.base ?? FALLBACK[h % FALLBACK.length];
  let accent = st?.accent ?? ['#d9b25a', '#ffffff', '#e23a3a'][h % 3];
  if (keepBase && variantColor && luminance(variantColor) > 0.03) {
    accent = kind === 'split-h' ? variantColor : shade(variantColor, 0.2);
  }
  const ink = kind === 'band' ? inkOn(accent) : kind === 'split-h' ? '#1a1a1a' : inkOn(base);
  return {
    kind,
    c: [base, shade(base, luminance(base) > 0.5 ? -0.12 : 0.14)],
    a: accent,
    ink,
    word: brand.toUpperCase(),
    sub: variantOf(model, brand) || 'CLASSIC',
    font: st?.font ?? (['serif', 'wide', 'sans'] as LookFont[])[h % 3],
  };
}

// SKU по метке IR «Бренд/Модель»: формат, производитель и вид — из названия
export function skuFromLabel(label: string, refs = 0, custom = false): Sku {
  const i = label.indexOf('/');
  const brand = i > 0 ? label.slice(0, i) : label, model = i > 0 ? label.slice(i + 1) : label;
  const { format, guessed } = formatFromLabel(model, brand);
  const f = FORMATS[format];
  return {
    id: label, label, brand, name: model, maker: makerOf(brand), segment: segmentOf(brand), format,
    w: f.w, h: f.h, d: f.d, measured: false, formatGuessed: guessed, refs, price: null, ean: '',
    look: makeLook(brand, model), custom,
  };
}

// refs — эталонов на метку с сервера (только инженеру); без них 0: в сборке сайта этих чисел нет
export function baseCatalog(refs: Record<string, number> | null = null): Sku[] {
  return gallery.labels.map(({ label }) => skuFromLabel(label, refs?.[label] ?? 0));
}

// Пачка, которой нет в каталоге: рисуем её по метке, а не пропускаем молча
const ghosts = new Map<string, Sku>();
export function ghostSku(id: string): Sku {
  let s = ghosts.get(id);
  if (!s) { s = skuFromLabel(id.replace(/^custom:/, '')); s.id = id; ghosts.set(id, s); }
  return s;
}

// Каталог = галерея + правки пользователя + свои SKU
export function buildCatalog(patches: Record<string, SkuPatch>, custom: Sku[], refs: Record<string, number> | null = null): Sku[] {
  const list = baseCatalog(refs).map(s => {
    const p = patches[s.id];
    if (!p) return s;
    const next = { ...s, ...p };
    if (p.format && p.format !== s.format && !p.measured && p.w === undefined) {
      const f = FORMATS[p.format];
      Object.assign(next, { w: f.w, h: f.h, d: f.d, formatGuessed: false });
    }
    if (p.format) next.formatGuessed = false;
    return next;
  });
  return [...list, ...custom];
}
