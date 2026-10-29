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

// «Новая версия по фото»: раскладка полок из того, что увидел IR (shelfId те же, что у p).
// Пустые слоты оставляем как в плане: пустота — это нет товара, а не другая раскладка.
export function rowsFromRun(p: Planogram, run: IrRun): Planogram['rows'] {
  const rows: Planogram['rows'] = structuredClone(p.rows);
  const top = shelvesTopDown(p.fixture);
  run.report.rows.forEach(row => {
    if (row.planogram_shelf == null) return;
    const sh = top[row.planogram_shelf - 1];
    if (!sh) return;
    const seq: string[] = [];
    row.slots.forEach(s => {
      const key = slotKey(row.planogram_shelf!, s.pos);
      const truth = run.verdicts[key]?.truthSku;
      const sku = truth ?? (s.status === 'missing' || s.sku == null ? s.expected_sku : s.sku);
      if (sku) seq.push(sku);
    });
    const placements: Placement[] = [];
    seq.forEach(sku => {
      const last = placements[placements.length - 1];
      if (last && last.sku === sku) last.facings++;
      else placements.push({ id: uid('pl'), sku, facings: 1 });
    });
    rows[sh.id] = placements;
  });
  return rows;
}

// Плоская таблица слотов сверки: для Excel и памяти IR
export interface CompareRow {
  key: string; photoRow: number; planogramRow: number | null; pos: number;
  expected: string | null; sku: string | null; status: SlotStatus; conf: number | null; box: IrSlot['box'];
  verdict: 'right' | 'wrong' | null; truth: SlotStatus | null; truthSku: string | null;
}
export function compareRows(run: IrRun): CompareRow[] {
  return run.report.rows.flatMap(row => row.slots.map(s => {
    const key = slotKey(rowKey(row), s.pos);
    const v = run.verdicts[key];
    return {
      key, photoRow: row.shelf, planogramRow: row.planogram_shelf, pos: s.pos, expected: s.expected_sku, sku: s.sku, status: s.status,
      conf: s.conf ?? null, box: s.box ?? null, verdict: v?.v ?? null, truth: v ? truthStatus(run, key, s) : null, truthSku: v?.truthSku ?? null,
    };
  }));
}

// Какая пачка на самом деле в слоте по проверке человека; null — неизвестно или пусто
export function truePack(x: CompareRow): string | null {
  if (x.truthSku) return x.truthSku;
  if (x.verdict === 'right') return x.sku;
  return null;
}

export interface Tally { verified: number; right: number }
export interface Memory {
  verified: number; right: number;
  bySku: [string, Tally][];                                  // по ожидаемой SKU слота
  byModel: { models: string; runs: number; verified: number; right: number; error: number | null }[];
  confusions: [string, number][];                            // «IR сказал ↔ на самом деле»
}

// Память IR: точность по SKU и по набору моделей, пары-путаницы — только по проверенным слотам
export function memoryOf(runs: IrRun[]): Memory {
  let verified = 0, right = 0;
  const bySku = new Map<string, Tally>();
  const byModel = new Map<string, { runs: number; verified: number; right: number; errs: number[] }>();
  const conf = new Map<string, number>();
  runs.forEach(r => {
    const st = runStats(r);
    const m = byModel.get(r.models || '—') ?? { runs: 0, verified: 0, right: 0, errs: [] };
    m.runs++; m.verified += st.verified; m.right += st.right;
    if (st.error != null) m.errs.push(st.error);
    byModel.set(r.models || '—', m);
    compareRows(r).forEach(x => {
      if (!x.verdict) return;
      verified++;
      if (x.verdict === 'right') right++;
      const id = x.expected ?? x.sku ?? x.truthSku;
      if (id) {
        const t = bySku.get(id) ?? { verified: 0, right: 0 };
        t.verified++; if (x.verdict === 'right') t.right++;
        bySku.set(id, t);
      }
      const truth = x.truthSku ?? (x.verdict === 'wrong' && x.status !== 'ok' ? x.expected : null);
      if (x.verdict === 'wrong' && x.sku && truth && truth !== x.sku) {
        const k = `${x.sku} ↔ ${truth}`;
        conf.set(k, (conf.get(k) ?? 0) + 1);
      }
    });
  });
  return {
    verified, right,
    bySku: [...bySku.entries()].sort((a, b) => a[1].right / a[1].verified - b[1].right / b[1].verified || b[1].verified - a[1].verified),
    byModel: [...byModel.entries()].map(([models, m]) => ({
      models, runs: m.runs, verified: m.verified, right: m.right, error: m.errs.length ? m.errs.reduce((a, b) => a + b, 0) / m.errs.length : null,
    })),
    confusions: [...conf.entries()].sort((a, b) => b[1] - a[1]),
  };
}

// Кропы подтверждённых слотов для пополнения галереи: «бренд/модель» → боксы на фото
export function galleryCrops(run: IrRun): { label: string; box: NonNullable<IrSlot['box']>; key: string }[] {
  return compareRows(run).flatMap(x => {
    const label = truePack(x);
    return label && x.box && label.includes('/') ? [{ label, box: x.box, key: x.key }] : [];
  });
}
