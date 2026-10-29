import { useMemo, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { buildCatalog } from './domain/catalog';
import { autoCode, uid } from './domain/geometry';
import type { ImportResult } from './domain/io';
import { seedFixtures, seedPlanogram } from './domain/templates';
import type { Fixture, IrRun, Planogram, Sku, SkuPatch } from './domain/types';

export interface Settings { apiBase: string; apiKey: string; warn: boolean }

interface Data {
  fixtures: Fixture[];
  planograms: Planogram[];
  patches: Record<string, SkuPatch>;
  custom: Sku[];
  runs: IrRun[];
  settings: Settings;
}

interface State extends Data {
  toast: { text: string; id: number } | null;
  notify: (text: string) => void;
  saveFixture: (fx: Fixture) => void;
  deleteFixture: (id: string) => void;
  duplicateFixture: (id: string) => string;
  createFixture: () => string;
  savePlanogram: (p: Planogram) => void;
  deletePlanogram: (id: string) => void;
  duplicatePlanogram: (id: string) => string;
  patchSku: (id: string, patch: SkuPatch) => void;
  resetSku: (id: string) => void;
  saveCustomSku: (s: Sku) => void;
  deleteCustomSku: (id: string) => void;
  addRun: (r: IrRun) => void;
  updateRun: (id: string, fn: (r: IrRun) => IrRun) => void;
  deleteRun: (id: string) => void;
  setSettings: (p: Partial<Settings>) => void;
  applyImport: (r: ImportResult) => void;
}

const KEY = 'planogram-studio.v2';
const now = () => new Date().toISOString();

function load(): Data {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Data>;
      if (d.fixtures && d.planograms) {
        return {
          fixtures: d.fixtures, planograms: d.planograms, patches: d.patches ?? {}, custom: d.custom ?? [],
          runs: d.runs ?? [], settings: { apiBase: '', apiKey: '', warn: true, ...(d.settings ?? {}) },
        };
      }
    }
  } catch { /* пустое или битое хранилище — начинаем с примеров */ }
  const fixtures = seedFixtures();
  return { fixtures, planograms: [seedPlanogram(fixtures[0])], patches: {}, custom: [], runs: [], settings: { apiBase: '', apiKey: '', warn: true } };
}

export const useStore = create<State>((set, get) => ({
  ...load(),
  toast: null,
  notify: text => set({ toast: { text, id: Date.now() } }),

  saveFixture: fx => set(s => {
    const next = { ...fx, updatedAt: now() };
    const i = s.fixtures.findIndex(f => f.id === fx.id);
    return { fixtures: i >= 0 ? s.fixtures.map(f => (f.id === fx.id ? next : f)) : [...s.fixtures, next] };
  }),
  deleteFixture: id => set(s => ({ fixtures: s.fixtures.filter(f => f.id !== id) })),
  duplicateFixture: id => {
    const src = get().fixtures.find(f => f.id === id);
    if (!src) return '';
    const n = get().fixtures.length + 1;
    const copy: Fixture = { ...structuredClone(src), id: uid('fx'), name: `${src.name} (копия)`, version: 1, updatedAt: now() };
    if (copy.codeAuto) copy.code = autoCode(copy, n);
    else copy.code = `${src.code}-2`;
    set(s => ({ fixtures: [...s.fixtures, copy] }));
    return copy.id;
  },
  createFixture: () => {
    const n = get().fixtures.length + 1;
    const fx: Fixture = {
      id: uid('fx'), code: '', codeAuto: true, name: 'Новый шкаф', w: 900, h: 1600, d: 350, base: 100, header: 140, side: 20,
      board: 16, rail: 30, doors: 'shutter', material: 'graphite', laneMode: 'format', laneWidth: 59, version: 1, updatedAt: now(),
      shelves: [],
    };
    fx.code = autoCode(fx, n);
    const pitch = (fx.h - fx.base - fx.header) / 7;
    fx.shelves = Array.from({ length: 7 }, (_, i) => ({ id: uid('sh'), y: Math.round(fx.base + i * pitch), depth: null, lane: null }));
    set(s => ({ fixtures: [...s.fixtures, fx] }));
    return fx.id;
  },

  savePlanogram: p => set(s => {
    const next = { ...p, updatedAt: now() };
    const i = s.planograms.findIndex(q => q.id === p.id);
    return { planograms: i >= 0 ? s.planograms.map(q => (q.id === p.id ? next : q)) : [next, ...s.planograms] };
  }),
  deletePlanogram: id => set(s => ({ planograms: s.planograms.filter(p => p.id !== id), runs: s.runs.filter(r => r.planogramId !== id) })),
  duplicatePlanogram: id => {
    const src = get().planograms.find(p => p.id === id);
    if (!src) return '';
    const copy: Planogram = { ...structuredClone(src), id: uid('plg'), name: `${src.name} (копия)`, status: 'draft', version: 1, createdAt: now(), updatedAt: now() };
    set(s => ({ planograms: [copy, ...s.planograms] }));
    return copy.id;
  },

  patchSku: (id, patch) => set(s => ({ patches: { ...s.patches, [id]: { ...s.patches[id], ...patch } } })),
  resetSku: id => set(s => { const rest = { ...s.patches }; delete rest[id]; return { patches: rest }; }),
  saveCustomSku: sku => set(s => ({ custom: s.custom.some(c => c.id === sku.id) ? s.custom.map(c => (c.id === sku.id ? sku : c)) : [...s.custom, sku] })),
  deleteCustomSku: id => set(s => ({ custom: s.custom.filter(c => c.id !== id) })),

  addRun: r => set(s => ({ runs: [r, ...s.runs].slice(0, 200) })),
  updateRun: (id, fn) => set(s => ({ runs: s.runs.map(r => (r.id === id ? fn(r) : r)) })),
  deleteRun: id => set(s => ({ runs: s.runs.filter(r => r.id !== id) })),

  setSettings: p => set(s => ({ settings: { ...s.settings, ...p } })),

  applyImport: r => set(s => ({
    planograms: [...r.planograms, ...s.planograms],
    fixtures: [...s.fixtures, ...r.fixtures],
    custom: [...s.custom.filter(c => !r.customSkus.some(n => n.id === c.id)), ...r.customSkus],
  })),
}));

// Сохранение в браузере с задержкой: правки на холсте идут пачками
function persist(s: State) {
  const data: Data = { fixtures: s.fixtures, planograms: s.planograms, patches: s.patches, custom: s.custom, runs: s.runs, settings: s.settings };
  try { localStorage.setItem(KEY, JSON.stringify(data)); }
  catch { s.notify('Не удалось сохранить в браузере: место закончилось. Выгрузите JSON и удалите старые сверки'); }
}
let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe(s => {
  clearTimeout(timer);
  timer = setTimeout(() => persist(s), 300);
});
persist(useStore.getState());   // примеры при первом запуске тоже сохраняем

export function useCatalog() {
  const patches = useStore(s => s.patches);
  const custom = useStore(s => s.custom);
  return useMemo(() => {
    const list = buildCatalog(patches, custom);
    const byId = new Map(list.map(s => [s.id, s]));
    return { list, byId, get: (id: string) => byId.get(id) };
  }, [patches, custom]);
}

// ---- хеш-маршруты: #/planograms, #/planogram/<id>, #/fixtures, #/fixture/<id>, #/catalog, #/compare/<id> ----
function subscribeHash(cb: () => void) { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); }
export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  return useMemo(() => hash.replace(/^#\/?/, '').split('/').filter(Boolean), [hash]);
}
export const go = (path: string) => { location.hash = '#/' + path; };
