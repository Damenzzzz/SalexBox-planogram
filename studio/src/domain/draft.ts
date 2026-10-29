// Черновик планограммы по фото точки: ряды главного стеллажа из ShelfReport, пачки — из распознавания.
// Подходит и для фото готовой выкладки, и для картинки планограммы, которую прислал клиент.

import { evenShelves, shelvesTopDown, uid } from './geometry';
import { newPlanogram } from './templates';
import type { Fixture, Placement, Planogram } from './types';

interface ShelfRowIn { shelf: number; det_ids: number[] }
interface FixtureIn { id: number; in_scope?: boolean; facings: number; rows: ShelfRowIn[] }
export interface PhotoResultIn {
  photo?: string;
  shelf?: { fixtures: FixtureIn[] } | null;
  recognition?: { detection_id: number; status: string; label: string | null }[] | null;
  detection?: { detections: { id: number; box: [number, number, number, number] }[] } | null;
}

export interface DraftResult { planogram: Planogram; notes: string[] }

// known — есть ли SKU в каталоге Studio: метки голов вкуса бывают не из галереи
export function draftFromPhoto(result: PhotoResultIn, template: Fixture, name: string, known: (id: string) => boolean = () => true): DraftResult {
  const fixtures = result.shelf?.fixtures ?? [];
  if (!fixtures.length) throw new Error('на фото не нашёлся стеллаж: IR не выделил ни одного ряда');
  const scope = fixtures.filter(f => f.in_scope);
  const main = (scope.length ? scope : fixtures).reduce((a, b) => (b.facings > a.facings ? b : a));
  const labels = new Map((result.recognition ?? []).filter(m => m.status === 'ok' && m.label).map(m => [m.detection_id, m.label!]));
  const x = new Map((result.detection?.detections ?? []).map(d => [d.id, d.box[0]]));
  const rows = [...main.rows].sort((a, b) => a.shelf - b.shelf);   // 1 = верхний

  const fx: Fixture = structuredClone(template);
  fx.shelves = evenShelves(fx, Math.max(1, rows.length));
  const p = newPlanogram(fx, name);
  p.templateId = template.id;
  p.journal = [{ at: new Date().toISOString(), version: 1, action: 'created', note: `черновик по фото ${result.photo ?? ''}`.trim() }];
  const top = shelvesTopDown(p.fixture);
  let unknown = 0, packs = 0, brandOnly = 0;
  const foreign = new Set<string>();
  rows.forEach((row, i) => {
    const sh = top[i];
    const placements: Placement[] = [];
    [...row.det_ids].sort((a, b) => (x.get(a) ?? 0) - (x.get(b) ?? 0)).forEach(id => {
      const sku = labels.get(id);
      if (!sku) { unknown++; return; }
      if (!sku.includes('/')) { brandOnly++; return; }   // узнан только бренд — модель ставит человек
      if (!known(sku)) foreign.add(sku);
      packs++;
      const last = placements[placements.length - 1];
      if (last && last.sku === sku) last.facings++;
      else placements.push({ id: uid('pl'), sku, facings: 1 });
    });
    p.rows[sh.id] = placements;
  });
  const notes = [`${rows.length} полок, ${packs} пачек на главном стеллаже`];
  if (unknown) notes.push(`${unknown} пачек IR не узнал: на их месте пусто, добавьте вручную`);
  if (brandOnly) notes.push(`${brandOnly} пачек узнаны только по бренду: модель выберите сами`);
  if (foreign.size) notes.push(`меток нет в каталоге: ${[...foreign].slice(0, 4).join(', ')}${foreign.size > 4 ? '…' : ''} — добавьте SKU в «Каталог SKU»`);
  if (fixtures.length > 1) notes.push(`на фото ${fixtures.length} стеллажа, взят главный`);
  return { planogram: p, notes };
}
