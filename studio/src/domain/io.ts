import { FORMATS } from './formats';
import { fromIrYaml } from './irExport';
import { makeLook } from './catalog';
import { uid } from './geometry';
import { newPlanogram } from './templates';
import type { FormatId, Fixture, Placement, Planogram, Sku } from './types';

export const FORMAT_TAG = 'salesbox.planogram';

export interface Bundle {
  format: typeof FORMAT_TAG;
  version: 2;
  units: 'mm';
  exportedAt: string;
  planograms: Planogram[];
  fixtures: Fixture[];
  skus: Sku[];
}

export function toBundle(planograms: Planogram[], fixtures: Fixture[], skus: Sku[]): Bundle {
  return { format: FORMAT_TAG, version: 2, units: 'mm', exportedAt: new Date().toISOString(), planograms, fixtures, skus };
}

export interface ImportResult { planograms: Planogram[]; fixtures: Fixture[]; customSkus: Sku[]; note: string }

// JSON v1 из прототипа planogram-studio-handoff: сантиметры, полки снизу вверх, произвольные SKU
interface V1 {
  format: 'planogram'; version: 1; name: string;
  fixtures: { id: string; type: string; name: string; width: number; height: number; depth?: number; base: number; header: number; boardThickness: number; laneWidth: number; hanging: boolean; shelves: { id: string; y: number }[] }[];
  skus: { id: string; code: string; name: string; category: string; width: number; height: number }[];
  placements: { fixtureId: string; shelfId: string; skuId: string; x: number; facings: number; packWidth: number; packHeight: number }[];
}

function guessFormat(wmm: number, hmm: number): FormatId {
  if (hmm < wmm) return 'BLISTER';
  if (wmm <= 46) return hmm >= 95 ? 'SS' : 'NANO';
  if (wmm <= 51) return hmm >= 95 ? 'CMP100' : 'CMP';
  return hmm >= 97 ? 'KS100' : 'KS';
}

function fromV1(doc: V1, catalog: Map<string, Sku>): ImportResult {
  const tobacco = doc.fixtures.filter(f => !f.hanging && (f.type === 'gantry' || f.type === 'cabinet'));
  const fixtures = (tobacco.length ? tobacco : doc.fixtures.filter(f => !f.hanging)).slice(0, 10);
  if (!fixtures.length) throw new Error('В файле v1 нет стеллажей с полками');
  const customSkus = new Map<string, Sku>();
  const skuId = (v1id: string): string => {
    const s = doc.skus.find(q => q.id === v1id);
    if (!s) return v1id;
    if (catalog.has(s.code)) return s.code;
    const id = `custom:v1:${s.code || s.id}`;
    if (!customSkus.has(id)) {
      const [brand] = s.name.split(/[ ·]/);
      const w = Math.round(s.width * 10), h = Math.round(s.height * 10);
      const format = guessFormat(w, h);
      customSkus.set(id, {
        id, label: null, brand, name: s.name, maker: 'OTH', segment: 'mid', format, w, h, d: FORMATS[format].d,
        measured: true, formatGuessed: false, refs: 0, price: null, ean: '', look: makeLook(brand, s.name), custom: true,
      });
    }
    return id;
  };
  const planograms = fixtures.map(f => {
    const fx: Fixture = {
      id: uid('fx'), code: `V1-${Math.round(f.width)}-${Math.round(f.height)}`, codeAuto: false, name: f.name,
      w: f.width * 10, h: f.height * 10, d: (f.depth ?? 30) * 10, base: f.base * 10, header: f.header * 10, side: 20,
      board: f.boardThickness * 10, rail: 30, doors: 'none', material: 'graphite',
      laneMode: f.laneWidth > 0 ? 'fixed' : 'format', laneWidth: f.laneWidth > 0 ? f.laneWidth * 10 : 59,
      shelves: f.shelves.map(s => ({ id: s.id, y: s.y * 10, depth: null, lane: null })), version: 1, updatedAt: new Date().toISOString(),
    };
    const p = newPlanogram(fx, `${doc.name} · ${f.name}`);
    p.templateId = null;
    f.shelves.forEach(s => {
      p.rows[s.id] = doc.placements
        .filter(q => q.fixtureId === f.id && q.shelfId === s.id)
        .sort((a, b) => a.x - b.x)
        .map<Placement>(q => ({ id: uid('pl'), sku: skuId(q.skuId), facings: q.facings }));
    });
    return p;
  });
  return { planograms, fixtures: [], customSkus: [...customSkus.values()], note: `JSON v1: ${planograms.length} шкаф(а), см переведены в мм` };
}

export function importText(text: string, name: string, catalog: Map<string, Sku>, template: Fixture): ImportResult {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') || name.endsWith('.yaml') || name.endsWith('.yml')) {
    const p = fromIrYaml(text, template);
    return { planograms: [p], fixtures: [], customSkus: [], note: 'YAML для IR: геометрия взята из шаблона, полки разведены равномерно' };
  }
  const doc = JSON.parse(trimmed);
  if (doc.format === 'planogram' && doc.version === 1) return fromV1(doc as V1, catalog);
  if (doc.format === FORMAT_TAG && doc.version === 2) {
    const b = doc as Bundle;
    const fresh = <T extends { id: string }>(x: T, prefix: string): T => ({ ...structuredClone(x), id: uid(prefix) });
    return {
      planograms: (b.planograms ?? []).map(p => ({ ...fresh(p, 'plg'), name: p.name })),
      fixtures: (b.fixtures ?? []).map(f => fresh(f, 'fx')),
      customSkus: (b.skus ?? []).filter(s => s.custom),
      note: `JSON v2: ${b.planograms?.length ?? 0} планограмм, ${b.fixtures?.length ?? 0} шкафов`,
    };
  }
  throw new Error('Не узнал формат: нужен JSON v2 Studio, JSON v1 прототипа или YAML для IR');
}

export function download(name: string, text: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
