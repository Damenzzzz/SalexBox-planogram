import { shelvesTopDown, uid } from './geometry';
import type { IrRow, IrRun, IrSlot, Placement, Planogram, SlotStatus } from './types';

export interface FacingResult {
  key: string;            // `${planogram_shelf}:${pos}` — ключ вердикта
  slot: IrSlot;
}

export interface ShelfResult {
  irRow: number;
  photoRow: number;
  facings: (FacingResult | null)[];          // по развёрнутому order полки; null — IR этот фейсинг не сверял
  extras: { after: number; res: FacingResult }[];
  compliance: number | null;
}

export const slotKey = (row: number | string, pos: number) => `${row}:${pos}`;

// Ряд фото без пары в планограмме (planogram_shelf = null) — ключ по номеру ряда на фото
export const rowKey = (row: IrRow) => (row.planogram_shelf != null ? String(row.planogram_shelf) : `фото${row.shelf}`);

// Слоты PlanogramReport → фейсинги планограммы. align.py идёт слева направо, extra вставлены между ожидаемыми
export function mapReport(p: Planogram, run: IrRun): Map<string, ShelfResult> {
  const out = new Map<string, ShelfResult>();
  const top = shelvesTopDown(p.fixture);
  run.report.rows.forEach(row => {
    if (row.planogram_shelf == null) return;
    const sh = top[row.planogram_shelf - 1];
    if (!sh) return;
    const expected = (p.rows[sh.id] ?? []).reduce((a, q) => a + q.facings, 0);
    const res: ShelfResult = { irRow: row.planogram_shelf, photoRow: row.shelf, facings: Array(expected).fill(null), extras: [], compliance: row.compliance };
    let ptr = 0;
    row.slots.forEach(slot => {
      const r = { key: slotKey(row.planogram_shelf!, slot.pos), slot };
      if (slot.expected_sku != null && ptr < expected) res.facings[ptr++] = r;
      else res.extras.push({ after: ptr, res: r });
    });
    out.set(sh.id, res);
  });
  return out;
}

export function truthStatus(run: IrRun, key: string, slot: IrSlot): SlotStatus {
  const v = run.verdicts[key];
  if (!v || v.v === 'right') return slot.status;
  return v.truth ?? (slot.status === 'ok' ? 'misplaced' : 'ok');
}

export function runStats(run: IrRun) {
  const slots = run.report.rows.flatMap(r => r.slots.map(s => ({ key: slotKey(rowKey(r), s.pos), s })));
  const expected = slots.filter(x => x.s.expected_sku != null).length;
  const verified = slots.filter(x => run.verdicts[x.key]);
  const right = verified.filter(x => run.verdicts[x.key].v === 'right').length;
  const okIr = slots.filter(x => x.s.status === 'ok').length;
  const okTruth = slots.filter(x => truthStatus(run, x.key, x.s) === 'ok').length;
  const irCompliance = run.report.compliance ?? (expected ? okIr / expected : null);
  const truthCompliance = expected ? okTruth / expected : null;
  return {
    slots: slots.length, expected, verified: verified.length, right,
    accuracy: verified.length ? right / verified.length : null,
    irCompliance, truthCompliance,
    error: irCompliance != null && truthCompliance != null && verified.length ? Math.abs(irCompliance - truthCompliance) : null,
  };
}

// «Обновить по фото»: новая версия, где раскладка взята из того, что IR увидел.
// Пустые слоты оставляем как в плане: пустота — это нет товара, а не другая раскладка.
export function planogramFromRun(p: Planogram, run: IrRun): Planogram {
  const next: Planogram = structuredClone(p);
  next.id = uid('plg');
  next.version = p.version + 1;
  next.status = 'draft';
  next.name = `${p.name} · по фото`;
  next.createdAt = next.updatedAt = new Date().toISOString();
  const top = shelvesTopDown(next.fixture);
  run.report.rows.forEach(row => {
    if (row.planogram_shelf == null) return;
    const sh = top[row.planogram_shelf - 1];
    if (!sh) return;
    const seq: string[] = [];
    row.slots.forEach(s => {
      const sku = s.status === 'missing' || s.sku == null ? s.expected_sku : s.sku;
      if (sku) seq.push(sku);
    });
    const placements: Placement[] = [];
    seq.forEach(sku => {
      const last = placements[placements.length - 1];
      if (last && last.sku === sku) last.facings++;
      else placements.push({ id: uid('pl'), sku, facings: 1 });
    });
    next.rows[sh.id] = placements;
  });
  return next;
}
