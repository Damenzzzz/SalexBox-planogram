import { MAKERS, MAKER_ORDER } from './formats';
import { clearanceOf, innerW, laneOf, shelfIndex, shelvesTopDown, usedWidth } from './geometry';
import type { Maker, Planogram, Sku } from './types';

export type Severity = 'error' | 'contract' | 'ir' | 'info';

export interface Issue {
  sev: Severity;
  text: string;
  shelfId?: string;
  placementId?: string;
  addSku?: string;      // кнопка «Добавить»
  skuId?: string;
  tech?: boolean;       // про галерею и метки IR: видно только инженеру
}

export interface Analysis {
  issues: Issue[];
  facings: Record<string, number>;
  byMaker: Partial<Record<Maker, number>>;
  total: number;
  fill: number;
  placed: string[];
  measured: number; // SKU на шкафу с замеренными размерами
  ready: number;   // SKU с 3+ эталонами
  thin: number;    // SKU с 1–2 эталонами
  noRefs: number;
}

// Пороги распознавания полок табака
export const IR_LIMITS = { minOuterItems: 3, aspect: [1.3, 2.4] as const, minAspect: 0.9, readyRefs: 3 };

// Справочный размер пачки расходится с реальным на 2–3 мм. Пока пачка не замерена, перебор в
// эти миллиметры — не ошибка, а повод замерить
export const SIZE_TOLERANCE = 3;

export function analyse(p: Planogram, sku: (id: string) => Sku | undefined): Analysis {
  const fx = p.fixture;
  const issues: Issue[] = [];
  const facings: Record<string, number> = {};
  const byMaker: Partial<Record<Maker, number>> = {};
  let total = 0, fillSum = 0;
  const shelves = shelvesTopDown(fx);
  const twins = new Set(p.ir.twins.map(([a, b]) => [a, b].sort().join('|')));

  shelves.forEach((sh, si) => {
    const row = p.rows[sh.id] ?? [];
    const { fromBottom } = shelfIndex(fx, sh.id);
    const name = `Полка ${fromBottom}`;
    const used = usedWidth(fx, sh, row, sku);
    fillSum += Math.min(1, used / innerW(fx));
    if (used > innerW(fx)) {
      const over = Math.ceil(used - innerW(fx));
      const rough = row.reduce((a, q) => a + (sku(q.sku)?.measured ? 0 : q.facings), 0);
      if (rough && over <= rough * SIZE_TOLERANCE) {
        issues.push({ sev: 'info', shelfId: sh.id, text: `${name}: по справочным размерам не хватает ${over} мм. Пачки на полке не замерены, реальная ширина может уложиться — замерьте` });
      } else {
        issues.push({ sev: 'error', shelfId: sh.id, text: `${name}: не помещается ${over} мм. Уберите фейсинг или выберите SKU уже` });
      }
    }
    const n = row.reduce((a, q) => a + q.facings, 0);
    if (!row.length && !p.ir.skipShelves.includes(sh.id)) {
      issues.push({ sev: 'info', shelfId: sh.id, text: `${name} пустая. На фото она будет пустым рядом, если не исключить её из проверки` });
    } else if ((si === 0 || si === shelves.length - 1) && n > 0 && n < IR_LIMITS.minOuterItems) {
      issues.push({ sev: 'ir', shelfId: sh.id, text: `${name}: всего ${n} пачки на крайней полке. Ряд из 1–2 пачек распознавание не считает полкой, поставьте хотя бы 3` });
    }
    row.forEach((q, i) => {
      const s = sku(q.sku);
      if (!s) { issues.push({ sev: 'error', shelfId: sh.id, placementId: q.id, text: `${name}: SKU «${q.sku}» нет в каталоге` }); return; }
      facings[s.id] = (facings[s.id] ?? 0) + q.facings;
      byMaker[s.maker] = (byMaker[s.maker] ?? 0) + q.facings;
      total += q.facings;
      const tall = s.h - clearanceOf(fx, sh), wide = s.w - laneOf(fx, sh, s);
      const rough = !s.measured;
      if (tall > 0) {
        issues.push(rough && tall <= SIZE_TOLERANCE
          ? { sev: 'info', shelfId: sh.id, placementId: q.id, text: `${name}: ${s.name} по справочной высоте выше просвета на ${Math.ceil(tall)} мм. Замерьте пачку` }
          : { sev: 'error', shelfId: sh.id, placementId: q.id, text: `${name}: ${s.name} (${s.h} мм) выше просвета ${Math.round(clearanceOf(fx, sh))} мм` });
      }
      if (wide > 0) {
        issues.push(rough && wide <= SIZE_TOLERANCE
          ? { sev: 'info', shelfId: sh.id, placementId: q.id, text: `${name}: ${s.name} по справочной ширине шире ряда на ${Math.ceil(wide)} мм. Замерьте пачку` }
          : { sev: 'error', shelfId: sh.id, placementId: q.id, text: `${name}: ${s.name} шире ряда толкателя` });
      }
      const next = row[i + 1];
      if (next && next.sku !== q.sku && twins.has([q.sku, next.sku].sort().join('|'))) {
        issues.push({ sev: 'ir', shelfId: sh.id, placementId: next.id, text: `${name}: ${s.name} и ${sku(next.sku)?.name ?? next.sku} похожи и стоят рядом. Распознавание может их перепутать, лучше разнести` });
      }
    });
  });

  const placed = Object.keys(facings);
  p.rules.mustHave.forEach(id => {
    if (!facings[id]) issues.push({ sev: 'error', addSku: id, text: `Нет обязательного SKU: ${sku(id)?.name ?? id}` });
  });
  Object.entries(p.rules.minFacings).forEach(([id, min]) => {
    if (facings[id] && facings[id] < min) issues.push({ sev: 'contract', skuId: id, text: `${sku(id)?.name ?? id}: ${facings[id]} фейсинг(а), по правилам не меньше ${min}` });
  });
  MAKER_ORDER.forEach(m => {
    const target = p.rules.shareTargets[m];
    if (!target) return;
    const share = total ? (byMaker[m] ?? 0) / total : 0;
    if (share < target) issues.push({ sev: 'contract', text: `Доля ${MAKERS[m]} ${(share * 100).toFixed(1)}% — по контракту не меньше ${Math.round(target * 100)}%` });
  });

  let ready = 0, thin = 0, noRefs = 0;
  placed.forEach(id => {
    const s = sku(id);
    if (!s) return;
    if (!s.label) issues.push({ sev: 'ir', skuId: id, tech: true, text: `${s.name}: нет IR-метки. IR сверит только бренд` });
    else if (s.refs === 0) { noRefs++; issues.push({ sev: 'ir', skuId: id, tech: true, text: `${s.name}: нет эталонов в галерее. Добавьте 3+ фото с полки` }); }
    else if (s.refs < IR_LIMITS.readyRefs) thin++;
    else ready++;
    const aspect = s.h / s.w;
    if (aspect < IR_LIMITS.minAspect) issues.push({ sev: 'ir', skuId: id, text: `${s.name}: пачка лежит на боку (высота меньше ширины). Распознавание такие пачки не считает` });
    else if (aspect < IR_LIMITS.aspect[0] || aspect > IR_LIMITS.aspect[1]) issues.push({ sev: 'ir', skuId: id, text: `${s.name}: необычные пропорции пачки. Проверьте размеры в каталоге` });
    if (s.formatGuessed) issues.push({ sev: 'info', skuId: id, text: `${s.name}: формат не указан в метке, взят King Size. Проверьте в каталоге` });
  });

  const order: Record<Severity, number> = { error: 0, contract: 1, ir: 2, info: 3 };
  issues.sort((a, b) => order[a.sev] - order[b.sev]);
  const measured = placed.filter(id => sku(id)?.measured).length;
  return { issues, facings, byMaker, total, fill: shelves.length ? fillSum / shelves.length : 0, placed, measured, ready, thin, noRefs };
}

// Проверки, которые видит пользователь: технические про галерею IR — только в режиме инженера
export const visibleIssues = (a: Analysis, tech: boolean) => (tech ? a.issues : a.issues.filter(i => !i.tech));
