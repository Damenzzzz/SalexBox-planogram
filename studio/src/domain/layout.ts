// «Подогнать под шкаф» и «Разложить по правилам»: черновики, которые человек потом правит руками

import { MAKER_ORDER } from './formats';
import { clearanceOf, innerW, laneOf, shelfIndex, shelvesTopDown, uid, usedWidth } from './geometry';
import type { Fixture, Maker, Placement, Planogram, Shelf, Sku } from './types';

type Get = (id: string) => Sku | undefined;
export interface LayoutResult { planogram: Planogram; notes: string[] }

const now = () => new Date().toISOString();

function merged(row: Placement[]): Placement[] {
  const out: Placement[] = [];
  row.forEach(q => {
    const last = out[out.length - 1];
    if (last && last.sku === q.sku) last.facings += q.facings;
    else out.push({ ...q });
  });
  return out;
}

const minOf = (p: Planogram, id: string) => (p.rules.mustHave.includes(id) ? Math.max(1, p.rules.minFacings[id] ?? 1) : 1);

// Ужать ряд до ширины полки: сначала с самых широких блоков (не ниже минимума), потом убрать необязательные справа
function shrink(p: Planogram, fx: Fixture, sh: Shelf, row: Placement[], get: Get, notes: string[], label: string) {
  const W = innerW(fx);
  let guard = 500;
  while (usedWidth(fx, sh, row, get) > W && guard--) {
    const cand = row.filter(q => q.facings > minOf(p, q.sku)).sort((a, b) => b.facings - a.facings)[0];
    if (cand) { cand.facings--; continue; }
    const drop = [...row].reverse().find(q => !p.rules.mustHave.includes(q.sku)) ?? row[row.length - 1];
    if (!drop) break;
    row.splice(row.indexOf(drop), 1);
    notes.push(`${label}: не поместился ${get(drop.sku)?.name ?? drop.sku}`);
  }
}

// Перенести планограмму на другой шкаф: полки сверху вниз, фейсинги — по новой ширине
export function fitToFixture(p: Planogram, target: Fixture, get: Get): LayoutResult {
  const notes: string[] = [];
  const fx: Fixture = structuredClone(target);
  const oldTop = shelvesTopDown(p.fixture), newTop = shelvesTopDown(fx);
  const n = oldTop.length, m = newTop.length;
  const rows: Planogram['rows'] = Object.fromEntries(newTop.map(sh => [sh.id, [] as Placement[]]));
  // больше полок — сверху вниз один к одному; меньше — соседние полки сливаются равномерно
  oldTop.forEach((sh, i) => {
    const j = m >= n ? i : Math.min(m - 1, Math.floor((i * m) / n));
    if (newTop[j]) rows[newTop[j].id].push(...(p.rows[sh.id] ?? []).map(q => ({ ...q, id: uid('pl') })));
  });
  if (m < n) notes.push(`Полок ${n} → ${m}: соседние полки объединены`);
  if (m > n) notes.push(`Полок ${n} → ${m}: нижние ${m - n} пустые`);
  const ratio = innerW(fx) / innerW(p.fixture);

  // пачки выше просвета — на ближайшую полку, где они встают
  newTop.forEach(sh => {
    const keep: Placement[] = [];
    rows[sh.id].forEach(q => {
      const s = get(q.sku);
      if (!s || s.h <= clearanceOf(fx, sh)) { keep.push(q); return; }
      const alt = newTop.find(o => s.h <= clearanceOf(fx, o));
      if (alt) { rows[alt.id].push(q); notes.push(`${s.name}: выше просвета полки ${shelfIndex(fx, sh.id).fromBottom}, перенесён на ${shelfIndex(fx, alt.id).fromBottom}`); }
      else notes.push(`${s.name}: выше любого просвета в шкафу ${fx.code}, убран`);
    });
    rows[sh.id] = keep;
  });

  newTop.forEach(sh => {
    const label = `Полка ${shelfIndex(fx, sh.id).fromBottom}`;
    let row = merged(rows[sh.id]);
    if (ratio > 1.05) row.forEach(q => { q.facings = Math.max(1, Math.round(q.facings * ratio)); });
    shrink(p, fx, sh, row, get, notes, label);
    row = merged(row);
    rows[sh.id] = row;
  });

  const before = Object.values(p.rows).flat().reduce((a, q) => a + q.facings, 0);
  const after = Object.values(rows).flat().reduce((a, q) => a + q.facings, 0);
  notes.unshift(`Шкаф ${p.fixture.code} → ${fx.code}: ширина ${innerW(p.fixture)} → ${innerW(fx)} мм, фейсингов ${before} → ${after}`);
  const planogram: Planogram = {
    ...structuredClone(p), id: uid('plg'), name: `${p.name} · ${fx.code}`, fixture: fx, rows, templateId: target.id, templateVersion: target.version,
    version: 1, status: 'draft', publishedAs: null, assign: { clusters: [], outlets: [] }, ir: { ...structuredClone(p.ir), skipShelves: [] },
    journal: [{ at: now(), version: 1, action: 'created', note: `подогнана с «${p.name}» v${p.version} (${p.fixture.code}) под ${fx.code}` }],
    createdAt: now(), updatedAt: now(),
  };
  return { planogram, notes };
}

export interface AutoOptions { skus: string[] }

// Разложить SKU по правилам: минимумы и must-have, доли производителей по контракту,
// блоки производитель → бренд, премиум выше, близнецов не ставим рядом
export function autoLayout(p: Planogram, get: Get, opt: AutoOptions): LayoutResult {
  const notes: string[] = [];
  const fx = p.fixture;
  const top = shelvesTopDown(fx);
  const skus = [...new Set(opt.skus)].map(get).filter((s): s is Sku => !!s);
  if (!skus.length || !top.length) return { planogram: p, notes: ['Нечего раскладывать: выберите SKU'] };
  const W = innerW(fx);
  const ref = top[0];
  const lane = (s: Sku) => laneOf(fx, ref, s);
  const budget = W * top.length * 0.97;   // мм на всех полках, с запасом на округление

  // 1. фейсинги: минимумы, затем до долей производителей, затем поровну
  const f = new Map<string, number>(skus.map(s => [s.id, minOf(p, s.id)]));
  const used = () => skus.reduce((a, s) => a + lane(s) * f.get(s.id)!, 0);
  if (used() > budget) notes.push('Минимумы must-have не помещаются целиком: часть ужата');
  const byMaker = new Map<Maker, Sku[]>();
  skus.forEach(s => byMaker.set(s.maker, [...(byMaker.get(s.maker) ?? []), s]));
  const makerMm = (m: Maker) => (byMaker.get(m) ?? []).reduce((a, s) => a + lane(s) * f.get(s.id)!, 0);
  const priority = (s: Sku) => (p.rules.mustHave.includes(s.id) ? 0 : 1) + (s.segment === 'premium' ? 0 : s.segment === 'mid' ? 0.3 : 0.6);
  const grow = (pool: Sku[], until: () => boolean) => {
    const order = [...pool].sort((a, b) => priority(a) - priority(b) || a.name.localeCompare(b.name));
    let k = 0, stall = 0;
    while (!until() && stall < order.length) {
      const s = order[k % order.length]; k++;
      if (used() + lane(s) > budget || f.get(s.id)! >= 12) { stall++; continue; }
      stall = 0;
      f.set(s.id, f.get(s.id)! + 1);
    }
  };
  const targets = MAKER_ORDER.filter(m => p.rules.shareTargets[m] && byMaker.has(m));
  // доля считается по фейсингам, бюджет — в мм: цель в фейсингах от ожидаемого общего числа
  const avgLane = skus.reduce((a, s) => a + lane(s), 0) / skus.length;
  const expected = Math.floor(budget / avgLane);
  targets.forEach(m => {
    const want = Math.ceil((p.rules.shareTargets[m] ?? 0) * expected);
    const pool = byMaker.get(m)!;
    grow(pool, () => pool.reduce((a, s) => a + f.get(s.id)!, 0) >= want || makerMm(m) >= budget);
  });
  grow(skus, () => used() + Math.min(...skus.map(lane)) > budget);

  // 2. порядок блоков: производители по цели доли, внутри — бренд, премиум раньше
  const makerRank = (m: Maker) => -(p.rules.shareTargets[m] ?? 0) * 10 + MAKER_ORDER.indexOf(m) / 10;
  const seg = { premium: 0, mid: 1, economy: 2 } as const;
  const queue = [...skus].sort((a, b) => makerRank(a.maker) - makerRank(b.maker) || a.brand.localeCompare(b.brand) || seg[a.segment] - seg[b.segment] || a.name.localeCompare(b.name))
    .map(s => ({ s, left: f.get(s.id)! }));

  // 3. по полкам сверху вниз: блок, который не встаёт по высоте, ждёт полку повыше просветом
  const rows: Planogram['rows'] = Object.fromEntries(fx.shelves.map(sh => [sh.id, [] as Placement[]]));
  top.forEach(sh => {
    let room = W;
    const clear = clearanceOf(fx, sh);
    for (const b of queue) {
      if (!b.left || b.s.h > clear) continue;
      const l = laneOf(fx, sh, b.s);
      const fit = Math.floor(room / l);
      if (fit <= 0) continue;
      // блок целиком или хвост; дробим, только если сюда входит хотя бы половина
      if (fit < b.left && fit < Math.ceil(b.left / 2) && room < W) continue;
      const take = Math.min(fit, b.left);
      rows[sh.id].push({ id: uid('pl'), sku: b.s.id, facings: take });
      b.left -= take; room -= take * l;
      if (room < 40) break;
    }
  });
  const missed = queue.filter(b => b.left > 0);
  missed.forEach(b => notes.push(`${b.s.name}: не поместилось ${b.left} ф.${b.s.h > Math.max(...top.map(sh => clearanceOf(fx, sh))) ? ' (выше любого просвета)' : ''}`));

  // 4. близнецы не рядом: меняем соседа местами со следующим блоком
  const twins = new Set(p.ir.twins.map(([a, b]) => [a, b].sort().join('|')));
  Object.values(rows).forEach(row => {
    for (let i = 0; i + 1 < row.length; i++) {
      if (!twins.has([row[i].sku, row[i + 1].sku].sort().join('|'))) continue;
      if (i + 2 < row.length) [row[i + 1], row[i + 2]] = [row[i + 2], row[i + 1]];
    }
  });

  const next: Planogram = structuredClone(p);
  next.rows = Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, merged(v)]));
  const total = Object.values(next.rows).flat().reduce((a, q) => a + q.facings, 0);
  const fill = top.reduce((a, sh) => a + usedWidth(fx, sh, next.rows[sh.id], get), 0) / (W * top.length);
  notes.unshift(`Разложено ${skus.length - missed.filter(b => b.left === f.get(b.s.id)).length} SKU, ${total} фейсингов, заполнение ${Math.round(fill * 100)}%`);
  return { planogram: next, notes };
}
