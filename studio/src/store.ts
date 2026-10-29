import { useMemo, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { buildCatalog } from './domain/catalog';
import { applyRemote, markSeed, resetSyncMeta, syncOnce } from './domain/sync';
import { connectGallery, setGalleryListener } from './render/gallery';
import { clearTextures, clearThumbs, setPhotos } from './render/textures';
import { autoCode, uid } from './domain/geometry';
import type { ImportResult } from './domain/io';
import { normalizePlanogram, seedFixtures, seedPlanogram } from './domain/templates';
import { snapshotOf } from './domain/versions';
import type { Cluster, Fixture, IrRun, Planogram, Sku, SkuPatch, Snapshot } from './domain/types';

export interface Settings {
  apiBase: string; apiKey: string; warn: boolean;
  sync: boolean;               // хранить шкафы, планограммы и сверки в IR-сервисе
  galleryTextures: boolean;    // фото эталонов вместо нарисованных пачек, если сервис их отдаёт
}

const DEFAULT_SETTINGS: Settings = { apiBase: '', apiKey: '', warn: true, sync: false, galleryTextures: true };

export interface Data {
  fixtures: Fixture[];
  planograms: Planogram[];
  snapshots: Snapshot[];
  clusters: Cluster[];
  patches: Record<string, SkuPatch>;
  custom: Sku[];
  runs: IrRun[];
  settings: Settings;
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

interface State extends Data {
  toast: { text: string; id: number } | null;
  sync: { status: SyncStatus; at: string | null; error: string | null };
  texRev: number;              // меняется, когда догрузились фото эталонов: холсты перерисуются
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
  saveSnapshot: (s: Snapshot) => void;
  saveCluster: (c: Cluster) => void;
  deleteCluster: (id: string) => void;
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
          fixtures: d.fixtures, planograms: d.planograms.map(normalizePlanogram), snapshots: d.snapshots ?? [], clusters: d.clusters ?? [],
          patches: d.patches ?? {}, custom: d.custom ?? [], runs: d.runs ?? [], settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
        };
      }
    }
  } catch { /* пустое или битое хранилище — начинаем с примеров */ }
  const fixtures = seedFixtures();
  const seed: Data = { fixtures, planograms: [seedPlanogram(fixtures[0])], snapshots: [], clusters: [], patches: {}, custom: [], runs: [], settings: { ...DEFAULT_SETTINGS } };
  markSeed(seed);
  return seed;
}

export const useStore = create<State>((set, get) => ({
  ...load(),
  toast: null,
  sync: { status: 'off', at: null, error: null },
  texRev: 0,
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
  deletePlanogram: id => set(s => ({
    planograms: s.planograms.filter(p => p.id !== id), runs: s.runs.filter(r => r.planogramId !== id), snapshots: s.snapshots.filter(v => v.planogramId !== id),
  })),
  duplicatePlanogram: id => {
    const src = get().planograms.find(p => p.id === id);
    if (!src) return '';
    const copy: Planogram = {
      ...structuredClone(src), id: uid('plg'), name: `${src.name} (копия)`, status: 'draft', version: 1, publishedAs: null, assign: { clusters: [], outlets: [] },
      journal: [{ at: now(), version: 1, action: 'created', note: `копия «${src.name}» v${src.version}` }], createdAt: now(), updatedAt: now(),
    };
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
    planograms: [...r.planograms.map(normalizePlanogram), ...s.planograms],
    fixtures: [...s.fixtures, ...r.fixtures],
    custom: [...s.custom.filter(c => !r.customSkus.some(n => n.id === c.id)), ...r.customSkus],
  })),

  saveSnapshot: v => set(s => ({ snapshots: [v, ...s.snapshots.filter(x => x.id !== v.id)] })),
  saveCluster: c => set(s => {
    const next = { ...c, updatedAt: now() };
    return { clusters: s.clusters.some(x => x.id === c.id) ? s.clusters.map(x => (x.id === c.id ? next : x)) : [...s.clusters, next] };
  }),
  deleteCluster: id => set(s => ({
    clusters: s.clusters.filter(c => c.id !== id),
    planograms: s.planograms.map(p => (p.assign.clusters.includes(id) ? { ...p, assign: { ...p.assign, clusters: p.assign.clusters.filter(x => x !== id) } } : p)),
  })),
}));

// Снимок версии один на номер версии: повторное согласование той же версии его обновляет
export function keepSnapshot(p: Planogram, note: string) {
  const { snapshots, saveSnapshot } = useStore.getState();
  const old = snapshots.find(v => v.planogramId === p.id && v.version === p.version);
  const snap = snapshotOf(p, note);
  saveSnapshot({ ...snap, id: old?.id ?? snap.id });
}

export const dataOf = (s: Data): Data => ({
  fixtures: s.fixtures, planograms: s.planograms, snapshots: s.snapshots, clusters: s.clusters,
  patches: s.patches, custom: s.custom, runs: s.runs, settings: s.settings,
});

// Сохранение в браузере с задержкой: правки на холсте идут пачками
function persist(s: State) {
  try { localStorage.setItem(KEY, JSON.stringify(dataOf(s))); }
  catch { s.notify('Не удалось сохранить в браузере: место закончилось. Выгрузите JSON и удалите старые сверки'); }
}
let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe(s => {
  clearTimeout(timer);
  timer = setTimeout(() => persist(s), 300);
});
persist(useStore.getState());   // примеры при первом запуске тоже сохраняем

// ---- хранение в IR-сервисе: проход при включении, через 2 с после правки и раз в 15 с ----
let syncing = false, again = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
export async function runSync() {
  const s = useStore.getState();
  if (!s.settings.sync) { useStore.setState({ sync: { status: 'off', at: null, error: null } }); return; }
  if (syncing) { again = true; return; }
  syncing = true;
  useStore.setState(st => ({ sync: { ...st.sync, status: 'syncing' } }));
  try {
    const r = await syncOnce(s.settings, () => useStore.getState());
    useStore.setState(st => {
      const d = applyRemote(st, [...r.applied, ...r.dropped.map(x => ({ ...x, body: null, deleted: true }))]);
      return { ...d, planograms: [...r.copies, ...d.planograms], sync: { status: 'idle', at: now(), error: null } };
    });
    if (r.conflicts.length) {
      const n = r.copies.length;
      s.notify(`На сервере правили те же документы (${r.conflicts.length}): взята серверная версия${n ? `, ваши правки сохранены копией (${n})` : ''}`);
    }
  } catch (e) {
    useStore.setState({ sync: { status: 'error', at: now(), error: (e as Error).message } });
  } finally {
    syncing = false;
    if (again) { again = false; scheduleSync(500); }
  }
}
export const scheduleSync = (ms = 2000) => { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); };
export const resetSync = () => { resetSyncMeta(); scheduleSync(0); };

const DOC_KEYS = ['fixtures', 'planograms', 'snapshots', 'clusters', 'patches', 'custom', 'runs'] as const;
useStore.subscribe((s, prev) => {
  if (s.settings !== prev.settings) {
    const conn = s.settings.apiBase !== prev.settings.apiBase || s.settings.apiKey !== prev.settings.apiKey;
    if (s.settings.sync !== prev.settings.sync || (s.settings.sync && conn)) scheduleSync(0);
    if (conn || s.settings.galleryTextures !== prev.settings.galleryTextures || s.settings.sync !== prev.settings.sync) refreshGallery();
    return;
  }
  if (s.settings.sync && DOC_KEYS.some(k => s[k] !== prev[k])) scheduleSync();
});
setInterval(() => { if (useStore.getState().settings.sync) runSync(); }, 15_000);

// ---- фото эталонов как текстуры ----
setGalleryListener(() => { clearTextures(); clearThumbs(); useStore.setState(st => ({ texRev: st.texRev + 1 })); });
let galleryTimer: ReturnType<typeof setTimeout> | undefined;
function refreshGallery() {
  clearTimeout(galleryTimer);
  galleryTimer = setTimeout(() => {
    const st = useStore.getState().settings;
    // фото берём у того же сервиса, где хранится Studio: без подключения — рисованные пачки
    const on = st.galleryTextures && st.sync;
    setPhotos(on);
    connectGallery(on ? st : null);
  }, 400);
}
refreshGallery();
if (useStore.getState().settings.sync) scheduleSync(300);

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
