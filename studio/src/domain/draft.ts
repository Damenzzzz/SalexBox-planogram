// Черновик планограммы по фото точки: ряды главного стеллажа из ShelfReport, пачки — из распознавания.
// Подходит и для фото готовой выкладки, и для картинки планограммы, которую прислал клиент.
// Шкаф подгоняется под фото: ширина — по самому длинному ряду (с неузнанными пачками), высота
// полки — по пачкам ряда. Стиль шкафа (дверцы, материал, ряды толкателя) берётся из шаблона.

import { skuFromLabel } from './catalog';
import { FORMATS } from './formats';
import { autoCode, uid } from './geometry';
import { newPlanogram } from './templates';
import type { Fixture, Placement, Planogram, Sku } from './types';

interface ShelfRowIn { shelf: number; det_ids: number[] }
interface FixtureIn { id: number; in_scope?: boolean; facings: number; rows: ShelfRowIn[] }
export interface PhotoResultIn {
  photo?: string;
  shelf?: { fixtures: FixtureIn[] } | null;
  recognition?: { detection_id: number; status: string; label: string | null; score?: number }[] | null;
  detection?: { image?: { width: number; height: number }; detections: { id: number; box: [number, number, number, number] }[] } | null;
}

export interface DraftResult {
  planogram: Planogram;
  notes: string[];
  newSkus: Sku[];                                   // меток не было в каталоге — добавить
  faces: Map<string, [number, number, number, number]>;   // SKU → лучший бокс на фото для лицевой стороны
}

const CLEAR_ABOVE = 25;   // мм над пачкой до следующей полки

// known — SKU из каталога Studio по id; метки, которых там нет, станут своими SKU
export function draftFromPhoto(result: PhotoResultIn, template: Fixture, name: string, find: (id: string) => Sku | undefined = () => undefined): DraftResult {
  const fixtures = result.shelf?.fixtures ?? [];
  if (!fixtures.length) throw new Error('на фото не нашёлся стеллаж: IR не выделил ни одного ряда');
  const scope = fixtures.filter(f => f.in_scope);
  const main = (scope.length ? scope : fixtures).reduce((a, b) => (b.facings > a.facings ? b : a));
  const labels = new Map((result.recognition ?? []).filter(m => m.status === 'ok' && m.label).map(m => [m.detection_id, m.label!]));
  const boxes = new Map((result.detection?.detections ?? []).map(d => [d.id, d.box]));
  const rows = [...main.rows].sort((a, b) => a.shelf - b.shelf);   // 1 = верхний

  // каталог: известные SKU и новые по меткам IR
  const newSkus = new Map<string, Sku>();
  const skuOf = (label: string): Sku => find(label) ?? newSkus.get(label) ?? (() => { const s = skuFromLabel(label, 0, true); newSkus.set(label, s); return s; })();

  // ряды фото → блоки пачек слева направо; неузнанные и узнанные только по бренду — пустые места
  const faces = new Map<string, [number, number, number, number]>();
  const area = (b: [number, number, number, number]) => (b[2] - b[0]) * (b[3] - b[1]);
  let unknown = 0, packs = 0, brandOnly = 0;
  const parsed = rows.map(row => {
    const ids = [...row.det_ids].sort((a, b) => (boxes.get(a)?.[0] ?? 0) - (boxes.get(b)?.[0] ?? 0));
    const placements: Placement[] = [];
    const skus: (Sku | null)[] = [];
    ids.forEach(id => {
      const label = labels.get(id);
      if (!label) { unknown++; skus.push(null); return; }
      if (!label.includes('/')) { brandOnly++; skus.push(null); return; }
      const s = skuOf(label);
      skus.push(s); packs++;
      const b = boxes.get(id);
      if (b && (!faces.has(s.id) || area(b) > area(faces.get(s.id)!))) faces.set(s.id, b);
      const last = placements[placements.length - 1];
      if (last && last.sku === s.id) last.facings++;
      else placements.push({ id: uid('pl'), sku: s.id, facings: 1 });
    });
    return { placements, skus };
  });

  // шкаф по фото: ширина ряда — пачки со своими рядами толкателя, пустые места — как средняя пачка ряда
  const lane = (s: Sku) => (template.laneMode === 'fixed' ? Math.ceil((s.w + 2) / template.laneWidth) * template.laneWidth : Math.max(FORMATS[s.format].lane, s.w + 3));
  const widths = parsed.map(r => {
    const known = r.skus.filter((s): s is Sku => !!s);
    const avg = known.length ? known.reduce((a, s) => a + lane(s), 0) / known.length : FORMATS.KS.lane;
    return r.skus.reduce((a, s) => a + (s ? lane(s) : avg), 0);
  });
  const heights = parsed.map(r => Math.max(FORMATS.KS.h, ...r.skus.filter((s): s is Sku => !!s).map(s => s.h)));
  const fx: Fixture = structuredClone(template);
  fx.w = Math.ceil((Math.max(...widths, 200) + 2 * fx.side + 10) / 10) * 10;
  const base = Math.min(fx.base, 120);
  const header = fx.header ? Math.min(fx.header, 120) : 0;
  const pitches = heights.map(h => h + CLEAR_ABOVE + fx.board);
  fx.base = base; fx.header = header;
  fx.h = Math.ceil((base + pitches.reduce((a, b) => a + b, 0) + header) / 10) * 10;
  // полки снизу вверх: нижний ряд фото — нижняя полка
  let y = base;
  fx.shelves = [...pitches].reverse().map(pitch => { const sh = { id: uid('sh'), y, depth: null, lane: null }; y += pitch; return sh; });
  fx.id = uid('fx'); fx.version = 1; fx.codeAuto = true; fx.updatedAt = new Date().toISOString();
  fx.code = autoCode(fx, 0).replace(/^С0/, 'Ф');
  fx.name = `По фото ${result.photo ?? ''}`.trim();

  const p = newPlanogram(fx, name);
  p.templateId = null; p.templateVersion = null;   // шкаф свой, по фото; шаблон дал только стиль
  p.journal = [{ at: new Date().toISOString(), version: 1, action: 'created', note: `черновик по фото ${result.photo ?? ''}, стиль шкафа ${template.code}`.trim() }];
  const bottomUp = [...fx.shelves];   // y по возрастанию
  parsed.forEach((r, i) => { p.rows[bottomUp[bottomUp.length - 1 - i].id] = r.placements; });

  const notes = [`${rows.length} полок, ${packs} пачек; шкаф ${Math.round(fx.w / 10)}×${Math.round(fx.h / 10)} см по фото`];
  if (unknown) notes.push(`${unknown} пачек IR не узнал: на их месте пусто, добавьте вручную`);
  if (brandOnly) notes.push(`${brandOnly} пачек узнаны только по бренду: модель выберите сами`);
  if (newSkus.size) notes.push(`в каталог добавлено SKU: ${newSkus.size}`);
  if (fixtures.length > 1) notes.push(`на фото ${fixtures.length} стеллажа, взят главный`);
  return { planogram: p, notes, newSkus: [...newSkus.values()], faces };
}

// Лицевые стороны пачек из самого фото: вырезка лучшего бокса каждого SKU, JPEG ~90 px шириной
export async function cropFaces(file: Blob, faces: Map<string, [number, number, number, number]>, expect?: { width: number; height: number }): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const bmp = await createImageBitmap(file);   // EXIF-поворот браузер применяет сам, как и IR
  try {
    if (expect && (Math.abs(bmp.width - expect.width) > 2 || Math.abs(bmp.height - expect.height) > 2)) return out;
    faces.forEach(([x1, y1, x2, y2], id) => {
      const w = x2 - x1, h = y2 - y1;
      if (w < 8 || h < 8) return;
      const W = 90, H = Math.round((h / w) * W);
      const c = document.createElement('canvas');
      c.width = W; c.height = H;
      c.getContext('2d')!.drawImage(bmp, x1, y1, w, h, 0, 0, W, H);
      out.set(id, c.toDataURL('image/jpeg', 0.82));
    });
  } finally { bmp.close(); }
  return out;
}
