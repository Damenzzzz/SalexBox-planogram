import { evenShelves, uid } from './geometry';
import type { AlignCosts, Fixture, Planogram } from './types';

export const DEFAULT_COSTS: AlignCosts = {
  mismatch: 1.0, missing: 1.0, missing_gap: 0.5, extra: 1.0,
  gap_edge: 0.0, gap_inside: 0.8, brand_only: 0.3, position: 0.4, row_skip: 0.6,
};

const now = () => new Date().toISOString();

function fixture(p: Omit<Fixture, 'id' | 'shelves' | 'version' | 'updatedAt' | 'codeAuto'> & { count: number }): Fixture {
  const { count, ...rest } = p;
  const fx: Fixture = { ...rest, id: uid('fx'), codeAuto: true, shelves: [], version: 1, updatedAt: now() };
  fx.shelves = evenShelves(fx, count, false);
  return fx;
}

// Размеры — из каталогов производителей шкафов (omega-kos, RKS) и замера демо-шкафа
export function seedFixtures(): Fixture[] {
  const common = { side: 20, board: 16, rail: 30, laneMode: 'format' as const, laneWidth: 59 };
  return [
    fixture({ ...common, code: 'С1-96-170', name: 'Шкаф с толкателями', w: 960, h: 1700, d: 350, base: 100, header: 160, doors: 'shutter', material: 'graphite', count: 8 }),
    fixture({ ...common, code: 'С2-96-63', name: 'Навесной над кассой', w: 963, h: 631, d: 350, base: 40, header: 90, doors: 'shutter', material: 'white', count: 3 }),
    fixture({ ...common, code: 'С3-96-204', name: 'Высокий шкаф', w: 963, h: 2040, d: 350, base: 120, header: 180, doors: 'shutter', material: 'graphite', count: 10 }),
    fixture({ ...common, code: 'С4-71-204', name: 'Высокий с нишей для запаса', w: 711, h: 2040, d: 350, base: 520, header: 160, doors: 'shutter', material: 'graphite', count: 7 }),
    fixture({ ...common, code: 'С5-70-180', name: 'Шкаф RKS с раздвижной дверью', w: 700, h: 1800, d: 300, base: 300, header: 120, doors: 'glass', material: 'wood', count: 7 }),
  ];
}

const DEMO_ROWS: [string, number][][] = [
  [['Parliament/Parliament Aqua Blue KS', 4], ['Parliament/Parliament Night Blue KS', 4], ['Sobranie/Sobranie Blacks', 3], ['Marlboro/Marlboro Gold KS', 4]],
  [['Esse/Esse Golden Leaf SS', 4], ['Esse/Esse Special Gold SS', 5], ['Kent/Kent Silver Nano', 5], ['Kent/Kent Crystal', 4]],
  [['Esse/Esse Exchange M SS', 5], ['Esse/Esse Exchange S SS', 5], ['Bohem/Bohem Cavana Demi', 5], ['Chapman/Chapman Gold SS', 4]],
  [['Winston/Winston Blue SS', 7], ['Winston/Winston Xs Blue Nano', 6], ['Camel/Camel Blue Compact', 6]],
  [['Chapman/Chapman Red SS', 6], ['Rothmans/Rothmans Click Demi', 6], ['LD/LD Club Gold', 5]],
  [['Esse/Esse Blue SS', 6], ['Winston/Winston Silver SS', 6], ['Kent/Kent Silver Nano', 7]],
  [['Rothmans/Rothmans Blue Demi', 6], ['L&M/L&M Loft Blue', 5], ['Bond/Bond Blue Compact', 5]],
  [['Bond/Bond Blue Compact', 4], ['L&M/L&M Loft Blue', 4], ['Rothmans/Rothmans Click Demi', 5], ['LD/LD Club Gold', 3]],
];

export function newPlanogram(template: Fixture, name: string): Planogram {
  const fx: Fixture = structuredClone(template);
  const rows: Planogram['rows'] = {};
  fx.shelves.forEach(s => { rows[s.id] = []; });
  return {
    id: uid('plg'), name, status: 'draft', version: 1, market: 'KZ', client: '', outlet: '',
    fixture: fx, templateId: template.id, templateVersion: template.version, rows,
    rules: { mustHave: [], minFacings: {}, shareTargets: {} },
    ir: { twins: [], skipShelves: [], costs: { ...DEFAULT_COSTS } },
    createdAt: now(), updatedAt: now(),
  };
}

export function seedPlanogram(template: Fixture): Planogram {
  const p = newPlanogram(template, 'Алматы · ТТ 014 · табак');
  p.client = 'Дистрибьютор (пример)';
  p.outlet = 'out_014';
  const top = [...p.fixture.shelves].sort((a, b) => b.y - a.y);
  DEMO_ROWS.forEach((row, i) => {
    const sh = top[i];
    if (sh) p.rows[sh.id] = row.map(([sku, facings]) => ({ id: uid('pl'), sku, facings }));
  });
  const must = ['Parliament/Parliament Aqua Blue KS', 'Esse/Esse Special Gold SS', 'Kent/Kent Silver Nano', 'Winston/Winston Blue SS', 'Rothmans/Rothmans Click Demi', 'Marlboro/Marlboro Red KS'];
  p.rules = {
    mustHave: must,
    minFacings: Object.fromEntries(must.map(m => [m, 2])),
    shareTargets: { KTG: 0.24, JTI: 0.25, PMI: 0.22, BAT: 0.15 },
  };
  p.ir.twins = [['Esse/Esse Exchange M SS', 'Esse/Esse Exchange S SS']];
  return p;
}
