import { evenShelves, shelvesTopDown, uid } from './geometry';
import { newPlanogram } from './templates';
import type { Fixture, Planogram } from './types';

const now = () => new Date().toISOString();

function fridge(code: string, name: string, p: Pick<Fixture, 'w' | 'h' | 'd' | 'base' | 'header' | 'doors' | 'material'>, count: number): Fixture {
  const fx: Fixture = {
    ...p, code, name, id: uid('fx'), codeAuto: false, side: 30, board: 8, rail: 20, laneMode: 'format', laneWidth: 70,
    shelves: [], version: 1, updatedAt: now(), category: 'beverages',
  };
  fx.shelves = evenShelves(fx, count, false);
  return fx;
}

// Типовое оборудование с фото точек: стеклянные холодильники, стеллаж и паллетный дисплей
export function beverageFixtures(): Fixture[] {
  return [
    fridge('Х1-60-200', 'Холодильник, одна дверь', { w: 600, h: 2000, d: 600, base: 150, header: 200, doors: 'glass', material: 'white' }, 5),
    fridge('Х2-120-200', 'Холодильник, две двери', { w: 1200, h: 2000, d: 600, base: 150, header: 200, doors: 'glass', material: 'white' }, 5),
    fridge('Х3-45-85', 'Барный мини-холодильник', { w: 450, h: 850, d: 450, base: 80, header: 60, doors: 'glass', material: 'graphite' }, 3),
    fridge('Х4-60-130', 'Настольный холодильник', { w: 600, h: 1300, d: 500, base: 100, header: 180, doors: 'glass', material: 'white' }, 3),
    fridge('Х5-100-180', 'Открытый стеллаж напитков', { w: 1000, h: 1800, d: 400, base: 100, header: 0, doors: 'none', material: 'graphite' }, 5),
    fridge('Х6-80-120', 'Паллетный дисплей', { w: 800, h: 1200, d: 800, base: 100, header: 0, doors: 'none', material: 'wood' }, 3),
  ];
}

type Row = [string, number][];
interface Sample { name: string; code: string; rows: Row[]; must: string[] }

const SAMPLES: Sample[] = [
  {
    name: 'Холодильник 1 дверь · Coca-Cola', code: 'Х1-60-200', must: ['coca-cola/Classic 0.5', 'coca-cola/Zero 0.5', 'fanta/Orange 0.5'],
    rows: [
      [['coca-cola/Classic 0.33 банка', 5], ['coca-cola/Zero 0.33 банка', 3]],
      [['coca-cola/Classic 0.5', 5], ['coca-cola/Zero 0.5', 2]],
      [['fanta/Orange 0.5', 4], ['other/Sprite 0.5', 3]],
      [['coca-cola/Classic 1', 4], ['fanta/Orange 1', 2]],
      [['coca-cola/Classic 1.5', 3], ['other/Sprite 1.5', 2]],
    ],
  },
  {
    name: 'Холодильник 2 двери · полная матрица', code: 'Х2-120-200', must: ['coca-cola/Classic 0.5', 'coca-cola/Zero 0.5', 'fanta/Orange 0.5', 'other/Sprite 0.5'],
    rows: [
      [['coca-cola/Classic 0.33 банка', 8], ['fanta/Orange 0.33 банка', 5], ['other/Sprite 0.33 банка', 5]],
      [['coca-cola/Classic 0.5', 8], ['coca-cola/Zero 0.5', 4], ['fanta/Orange 0.5', 4]],
      [['other/Sprite 0.5', 5], ['other/Fuse Tea 0.5', 5], ['other/BonAqua 0.5', 6]],
      [['coca-cola/Classic 1', 7], ['fanta/Orange 1', 3], ['other/Sprite 1', 3]],
      [['coca-cola/Classic 1.5', 7], ['fanta/Orange 1.5', 2], ['other/Sprite 1.5', 2]],
    ],
  },
  {
    name: 'Барный мини · банки и стекло', code: 'Х3-45-85', must: ['coca-cola/Classic 0.33 банка'],
    rows: [
      [['coca-cola/Classic 0.25 стекло', 6]],
      [['coca-cola/Classic 0.33 банка', 4], ['coca-cola/Zero 0.33 банка', 2]],
      [['fanta/Orange 0.33 банка', 3], ['other/Sprite 0.33 банка', 3]],
    ],
  },
  {
    name: 'Настольный холодильник · 0.5', code: 'Х4-60-130', must: ['coca-cola/Classic 0.5'],
    rows: [
      [['coca-cola/Classic 0.33 банка', 8]],
      [['coca-cola/Classic 0.5', 4], ['fanta/Orange 0.5', 3]],
      [['coca-cola/Zero 0.5', 3], ['other/Sprite 0.5', 4]],
    ],
  },
  {
    name: 'Стеллаж напитков · большие объёмы', code: 'Х5-100-180', must: ['coca-cola/Classic 1.5', 'coca-cola/Classic 2'],
    rows: [
      [['coca-cola/Classic 0.5', 7], ['fanta/Orange 0.5', 3], ['other/Sprite 0.5', 3]],
      [['coca-cola/Classic 1', 6], ['fanta/Orange 1', 2], ['other/Sprite 1', 2]],
      [['coca-cola/Classic 1.5', 5], ['coca-cola/Zero 1.5', 2], ['fanta/Orange 1.5', 2]],
      [['coca-cola/Classic 1.5', 5], ['other/Sprite 1.5', 4]],
      [['coca-cola/Classic 2', 8]],
    ],
  },
  {
    name: 'Паллетный дисплей · Coca-Cola 1.5', code: 'Х6-80-120', must: ['coca-cola/Classic 1.5'],
    rows: [
      [['coca-cola/Classic 1', 8]],
      [['coca-cola/Classic 1.5', 7]],
      [['coca-cola/Classic 1.5', 4], ['coca-cola/Zero 1.5', 3]],
    ],
  },
];

// Черновики на типовом оборудовании: их правят и отправляют на согласование как обычные
export function beveragePlanograms(fixtures: Fixture[]): Planogram[] {
  return SAMPLES.flatMap(sample => {
    const template = fixtures.find(f => f.code === sample.code);
    if (!template) return [];
    const p = newPlanogram(template, sample.name);
    shelvesTopDown(p.fixture).forEach((sh, i) => {
      p.rows[sh.id] = (sample.rows[i] ?? []).map(([sku, facings]) => ({ id: uid('pl'), sku, facings }));
    });
    p.rules = { mustHave: sample.must, minFacings: Object.fromEntries(sample.must.map(m => [m, 2])), shareTargets: {} };
    return [p];
  });
}
