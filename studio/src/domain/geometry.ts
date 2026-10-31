import { FORMATS } from './formats';
import type { Fixture, Placement, Shelf, Sku } from './types';

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export const sortedShelves = (fx: Fixture) => [...fx.shelves].sort((a, b) => a.y - b.y);

// Полки сверху вниз — порядок IR-рядов (1 = верхняя)
export const shelvesTopDown = (fx: Fixture) => sortedShelves(fx).reverse();

export function shelfIndex(fx: Fixture, id: string) {
  const s = sortedShelves(fx);
  const i = s.findIndex(q => q.id === id);
  return { fromBottom: i + 1, irRow: s.length - i, count: s.length };
}

export const innerW = (fx: Fixture) => fx.w - 2 * fx.side;
export const packFloor = (fx: Fixture, sh: Shelf) => sh.y + fx.board;

export function ceilingOf(fx: Fixture, sh: Shelf): number {
  const s = sortedShelves(fx);
  const i = s.findIndex(q => q.id === sh.id);
  return i < s.length - 1 ? s[i + 1].y : fx.h - fx.header;
}
export const clearanceOf = (fx: Fixture, sh: Shelf) => ceilingOf(fx, sh) - packFloor(fx, sh);
export const depthOf = (fx: Fixture, sh: Shelf) => sh.depth ?? fx.d - 20;

// Ширина, которую занимает один фейсинг SKU на этой полке
export function laneOf(fx: Fixture, sh: Shelf, sku: Sku): number {
  const fixed = sh.lane ?? (fx.laneMode === 'fixed' ? fx.laneWidth : null);
  if (fixed) return Math.ceil((sku.w + 2) / fixed) * fixed;
  return Math.max(FORMATS[sku.format].lane, sku.w + 3);
}

export const usedWidth = (fx: Fixture, sh: Shelf, row: Placement[], sku: (id: string) => Sku | undefined) =>
  row.reduce((a, p) => { const s = sku(p.sku); return a + (s ? laneOf(fx, sh, s) * p.facings : 0); }, 0);

export function lanesFor(fx: Fixture, sh: Shelf, formatW: number, formatLane: number) {
  const fixed = sh.lane ?? (fx.laneMode === 'fixed' ? fx.laneWidth : null);
  const lane = fixed ? Math.ceil((formatW + 2) / fixed) * fixed : formatLane;
  return Math.floor(innerW(fx) / lane);
}

export const packsDeep = (fx: Fixture, sh: Shelf, sku: Sku) => Math.max(1, Math.floor((depthOf(fx, sh) - 20) / sku.d));

// Код шаблона: С{номер}-{ширина, см}-{высота, см}
export function autoCode(fx: Pick<Fixture, 'w' | 'h'>, n: number) {
  return `С${n}-${Math.round(fx.w / 10)}-${Math.round(fx.h / 10)}`;
}

// Развести полки равномерно между цоколем и лайтбоксом
export function evenShelves(fx: Fixture, count: number, keepIds = true): Shelf[] {
  const s = sortedShelves(fx);
  const top = fx.h - fx.header, bottom = fx.base;
  const pitch = (top - bottom) / count;
  return Array.from({ length: count }, (_, i) => ({
    id: keepIds && s[i] ? s[i].id : uid('sh'),
    y: Math.round(bottom + i * pitch),
    depth: s[i]?.depth ?? null,
    lane: s[i]?.lane ?? null,
  }));
}

// Новая полка — посередине самого большого промежутка
export function addShelf(fx: Fixture): Shelf[] {
  const s = sortedShelves(fx);
  const edges = [fx.base - fx.board, ...s.map(q => q.y), fx.h - fx.header];
  let best = 0, gap = -1;
  for (let i = 0; i < edges.length - 1; i++) {
    const g = edges[i + 1] - edges[i];
    if (g > gap) { gap = g; best = i; }
  }
  const y = Math.round((edges[best] + edges[best + 1]) / 2 / 5) * 5;
  return [...s, { id: uid('sh'), y: Math.max(fx.base, y), depth: null, lane: null }].sort((a, b) => a.y - b.y);
}

export const MIN_CLEAR = 60;

// Высота полки при перетаскивании: между соседями с запасом
export function clampShelfY(fx: Fixture, id: string, y: number): number {
  const s = sortedShelves(fx);
  const i = s.findIndex(q => q.id === id);
  const lo = i > 0 ? s[i - 1].y + fx.board + MIN_CLEAR : fx.base;
  const hi = i < s.length - 1 ? s[i + 1].y - fx.board - MIN_CLEAR : fx.h - fx.header - fx.board - MIN_CLEAR;
  return Math.round(Math.max(lo, Math.min(hi, y)) / 5) * 5;
}

export function capacity(fx: Fixture) {
  const ks = FORMATS.KS, ss = FORMATS.SS;
  return sortedShelves(fx).reduce(
    (a, sh) => {
      const ksLanes = lanesFor(fx, sh, ks.w, ks.lane);
      a.ksLanes += ksLanes;
      a.ssLanes += lanesFor(fx, sh, ss.w, ss.lane);
      a.packs += ksLanes * Math.max(1, Math.floor((depthOf(fx, sh) - 20) / ks.d));
      return a;
    },
    { ksLanes: 0, ssLanes: 0, packs: 0 },
  );
}

// Ужать шкаф под раскладку: ширина — по самому заполненному ряду, каждая полка — по высоте своих
// пачек с запасом сверху. Id полок сохраняются: раскладка остаётся на своих местах
export function compactFixture(fx: Fixture, rows: Record<string, Placement[]>, sku: (id: string) => Sku | undefined, clearAbove = 25): Fixture {
  const next: Fixture = structuredClone(fx);
  const shelves = sortedShelves(next);
  const used = Math.max(0, ...shelves.map(sh => usedWidth(next, sh, rows[sh.id] ?? [], sku)));
  if (used > 0) next.w = Math.ceil((used + 2 * next.side + 10) / 10) * 10;
  let y = next.base;
  shelves.forEach(sh => {
    const tallest = Math.max(0, ...(rows[sh.id] ?? []).map(p => sku(p.sku)?.h ?? 0));
    sh.y = y;
    y += (tallest || clearanceOf(fx, fx.shelves.find(q => q.id === sh.id)!)) + clearAbove + next.board;
  });
  next.h = Math.ceil((y + next.header) / 10) * 10;
  if (next.codeAuto) next.code = next.code.replace(/-\d+-\d+$/, `-${Math.round(next.w / 10)}-${Math.round(next.h / 10)}`);
  return next;
}
