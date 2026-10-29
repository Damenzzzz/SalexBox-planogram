import { load } from 'js-yaml';
import { evenShelves, laneOf, shelfIndex, shelvesTopDown, uid } from './geometry';
import { DEFAULT_COSTS, newPlanogram } from './templates';
import type { AlignCosts, Fixture, Placement, Planogram, Sku } from './types';

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch', ы: 'y', э: 'e', ю: 'yu', я: 'ya',
  ә: 'a', ғ: 'g', қ: 'q', ң: 'n', ө: 'o', ұ: 'u', ү: 'u', һ: 'h', і: 'i',
};
export const slug = (s: string) =>
  [...s.toLowerCase()].map(ch => TR[ch] ?? ch).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const irName = (p: Planogram) => `plg-${slug(p.name) || p.id}-v${p.version}`;

// Метка, которую увидит align.py: для SKU без галереи — «Бренд/Название»
export const irLabel = (s: Sku | undefined, id: string) => (s ? s.label ?? `${s.brand}/${s.name}` : id);

const q = (s: string) => (/^[\w .&/-]+$/u.test(s) && !/^[\d.-]/.test(s) && !s.includes(': ') ? s : JSON.stringify(s));

export interface Zone { brand: string; range: [number, number]; mm: [number, number] }

// Непрерывные блоки бренда → доли занятой ширины ряда (как zones в configs/planograms)
export function zonesOf(fx: Fixture, shelfId: string, row: Placement[], sku: (id: string) => Sku | undefined): Zone[] {
  const sh = fx.shelves.find(s => s.id === shelfId);
  if (!sh) return [];
  const parts = row.map(p => { const s = sku(p.sku); return { brand: s?.brand ?? p.sku.split('/')[0], w: s ? laneOf(fx, sh, s) * p.facings : 0 }; });
  const total = parts.reduce((a, b) => a + b.w, 0);
  if (!total) return [];
  const out: { brand: string; a: number; b: number }[] = [];
  let x = 0;
  parts.forEach(({ brand, w }) => {
    const last = out[out.length - 1];
    if (last && last.brand === brand) last.b = x + w; else out.push({ brand, a: x, b: x + w });
    x += w;
  });
  return out.map(z => ({ brand: z.brand, range: [+(z.a / total).toFixed(2), +(z.b / total).toFixed(2)], mm: [z.a, z.b] }));
}

export function toIrYaml(p: Planogram, sku: (id: string) => Sku | undefined): string {
  const fx = p.fixture;
  const L: string[] = [
    // без даты: опубликованная версия неизменна, один и тот же YAML для одной версии
    '# configs/planograms/<client_id>/<outlet_id|default>.yaml — Planogram Studio',
    `# ${p.name} · версия ${p.version} · шкаф ${fx.code} ${fx.w}×${fx.h}×${fx.d} мм`,
    `name: ${q(irName(p))}`,
    'category: cigarettes',
    '',
    'shelves:                       # 1 = верхняя полка',
  ];
  shelvesTopDown(fx).forEach(sh => {
    if (p.ir.skipShelves.includes(sh.id)) return;
    const { irRow, fromBottom } = shelfIndex(fx, sh.id);
    const row = p.rows[sh.id] ?? [];
    L.push(`  - shelf: ${irRow}                    # полка ${fromBottom} снизу`, '    order:');
    if (!row.length) L[L.length - 1] = '    order: []';
    row.forEach(pl => { for (let k = 0; k < pl.facings; k++) L.push(`      - ${q(irLabel(sku(pl.sku), pl.sku))}`); });
    const zones = zonesOf(fx, sh.id, row, sku).filter(z => z.range[1] - z.range[0] >= 0.1);
    if (zones.length > 1 || (zones.length === 1 && row.length > 1)) {
      L.push('    zones:');
      zones.forEach(z => L.push(`      - {name: ${slug(z.brand) || 'zone'}, range: [${z.range[0].toFixed(2)}, ${z.range[1].toFixed(2)}], brand: ${q(z.brand)}}`));
    }
  });
  const fm = Object.entries(p.rules.minFacings).filter(([, n]) => n > 0);
  L.push('', fm.length ? 'facings_min:' : 'facings_min: {}');
  fm.forEach(([id, n]) => L.push(`  ${q(irLabel(sku(id), id))}: ${n}`));
  L.push('', p.rules.mustHave.length ? 'required:' : 'required: []');
  p.rules.mustHave.forEach(id => L.push(`  - ${q(irLabel(sku(id), id))}`));
  if (p.ir.twins.length) {
    L.push('', 'twins:                         # IR их путает: подмена внутри пары считается ok');
    p.ir.twins.forEach(([a, b]) => L.push(`  - [${q(irLabel(sku(a), a))}, ${q(irLabel(sku(b), b))}]`));
  }
  L.push('', 'costs:                         # стоимости выравнивания Needleman–Wunsch');
  (Object.keys(DEFAULT_COSTS) as (keyof AlignCosts)[]).forEach(k => L.push(`  ${k}: ${p.ir.costs[k].toFixed(1)}`));
  return L.join('\n') + '\n';
}

// Обратно: YAML из configs/planograms → планограмма на шаблоне шкафа
export function fromIrYaml(text: string, template: Fixture): Planogram {
  const doc = load(text) as {
    name?: string; shelves?: { shelf: number; order?: string[] }[];
    facings_min?: Record<string, number>; required?: string[]; costs?: Partial<AlignCosts>; twins?: [string, string][];
  };
  if (!doc || !Array.isArray(doc.shelves)) throw new Error('В файле нет списка shelves — это не планограмма IR');
  const count = Math.max(...doc.shelves.map(s => s.shelf), doc.shelves.length);
  const fx: Fixture = structuredClone(template);
  fx.shelves = evenShelves(fx, count);
  const p = newPlanogram(fx, doc.name ? `Импорт · ${doc.name}` : 'Импорт из YAML');
  const top = shelvesTopDown(p.fixture);
  doc.shelves.forEach(s => {
    const sh = top[s.shelf - 1];
    if (!sh) return;
    const row: Placement[] = [];
    (s.order ?? []).forEach(label => {
      const last = row[row.length - 1];
      if (last && last.sku === label) last.facings++;
      else row.push({ id: uid('pl'), sku: label, facings: 1 });
    });
    p.rows[sh.id] = row;
  });
  p.rules.mustHave = doc.required ?? [];
  p.rules.minFacings = doc.facings_min ?? {};
  p.ir.costs = { ...DEFAULT_COSTS, ...(doc.costs ?? {}) };
  p.ir.twins = doc.twins ?? [];
  return p;
}
