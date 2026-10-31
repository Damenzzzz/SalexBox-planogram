import { useMemo, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { buildCatalog } from './domain/catalog';
import { ApiError, api, fetchMe, login as apiLogin, logout as apiLogout, switchClient as apiSwitch, type Me } from './domain/api';
import { applyRemote, markSeed, resetSyncMeta, syncOnce, type Lost } from './domain/sync';
import { connectGallery, setGalleryListener } from './render/gallery';
import { clearTextures, clearThumbs, setPhotos } from './render/textures';
import { autoCode, uid } from './domain/geometry';
import type { ImportResult } from './domain/io';
import { normalizePlanogram, seedFixtures, seedPlanogram } from './domain/templates';
import { readData, writeData } from './domain/persist';
import { setAuthor, snapshotOf } from './domain/versions';
import type { Cluster, Fixture, IrRun, Planogram, Sku, SkuPatch, Snapshot } from './domain/types';

export interface Settings {
  warn: boolean;
  galleryTextures: boolean;    // фото эталонов вместо нарисованных пачек, если сервис их отдаёт
  tech: boolean;               // технические детали IR: метки, эталоны, YAML; действует только у инженера
}

const DEFAULT_SETTINGS: Settings = { warn: true, galleryTextures: true, tech: false };
const pickSettings = (raw: Partial<Settings> | undefined): Settings => ({
  warn: raw?.warn ?? DEFAULT_SETTINGS.warn,
  galleryTextures: raw?.galleryTextures ?? DEFAULT_SETTINGS.galleryTextures,
  tech: raw?.tech ?? DEFAULT_SETTINGS.tech,
});

// Пространство данных браузера: без входа — local, после входа — свой у пользователя и клиента
export const scopeOf = (me: Me | null) => (me ? `u:${me.login}:${me.client}` : 'local');

export interface Data {
  fixtures: Fixture[];
  planograms: Planogram[];
  snapshots: Snapshot[];
  clusters: Cluster[];
  patches: Record<string, SkuPatch>;
  custom: Sku[];
  runs: IrRun[];
  lost: Lost[];                // свои правки, уступившие серверу при синхронизации: только в этом браузере
  settings: Settings;
}

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error';

interface State extends Data {
  me: Me | null;               // кто вошёл; null — работа только в этом браузере
  scope: string;
  refs: Record<string, number> | null;   // эталонов на метку: только инженеру, с сервера
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
  restoreLost: (i: number) => void;
  dismissLost: (i: number) => void;
}

const now = () => new Date().toISOString();
const MAX_RUNS = 500;   // сверок в браузере: в IndexedDB места хватает, старые остаются на сервере

const EMPTY: Data = { fixtures: [], planograms: [], snapshots: [], clusters: [], patches: {}, custom: [], runs: [], lost: [], settings: { ...DEFAULT_SETTINGS } };

// Сохранённые данные → состояние; пусто — примеры для первого запуска. В пространстве клиента
// примеров планограмм нет, только типовые шкафы: на сервер клиента не уходит демо-раскладка
function normalize(raw: unknown, scope: string): Data {
  const d = (raw ?? {}) as Partial<Data>;
  if (Array.isArray(d.fixtures) && Array.isArray(d.planograms)) {
    return {
      fixtures: d.fixtures, planograms: d.planograms.map(normalizePlanogram), snapshots: d.snapshots ?? [], clusters: d.clusters ?? [],
      patches: d.patches ?? {}, custom: d.custom ?? [], runs: d.runs ?? [], lost: d.lost ?? [], settings: pickSettings(d.settings),
    };
  }
  const fixtures = seedFixtures();
  const seed: Data = { ...EMPTY, fixtures, planograms: scope === 'local' ? [seedPlanogram(fixtures[0])] : [] };
  markSeed(seed, scope);
  return seed;
}

export const useStore = create<State>((set, get) => ({
  ...EMPTY,
  me: null,
  scope: 'local',
  refs: null,
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

  addRun: r => set(s => ({ runs: [r, ...s.runs].slice(0, MAX_RUNS) })),
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
  // Вернуть свою правку: она станет текущей и уйдёт на сервер следующим проходом поверх серверной
  restoreLost: i => set(s => {
    const it = s.lost[i];
    if (!it) return {};
    return { ...applyRemote(s, [{ kind: it.kind, id: it.id, body: it.body, deleted: false }]), lost: s.lost.filter((_, k) => k !== i) };
  }),
  dismissLost: i => set(s => ({ lost: s.lost.filter((_, k) => k !== i) })),
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
  patches: s.patches, custom: s.custom, runs: s.runs, lost: s.lost, settings: s.settings,
});

// Сохранение в браузере с задержкой: правки на холсте идут пачками. До загрузки не пишем,
// иначе пустое состояние затёрло бы сохранённое
let hydrated = false;
function persist(s: State) {
  return writeData(s.scope, dataOf(s)).catch(() => s.notify('Не удалось сохранить в браузере: место закончилось. Выгрузите JSON и удалите старые сверки'));
}
let timer: ReturnType<typeof setTimeout> | undefined;
useStore.subscribe(s => {
  if (!hydrated) return;
  clearTimeout(timer);
  timer = setTimeout(() => persist(s), 300);
});

// Кто вошёл, запомненный на случай работы без сети: только имя, роль и клиент, без секретов
const ME_KEY = 'planogram-studio.me';
const rememberMe = (me: Me | null) => { try { if (me) localStorage.setItem(ME_KEY, JSON.stringify(me)); else localStorage.removeItem(ME_KEY); } catch { /* не критично */ } };
const rememberedMe = (): Me | null => { try { return JSON.parse(localStorage.getItem(ME_KEY) ?? 'null'); } catch { return null; } };

// Открыть пространство: дописать текущее, прочитать новое, запустить синхронизацию
async function openScope(me: Me | null) {
  const was = hydrated ? useStore.getState().settings : null;   // настройки браузера общие для всех пространств
  if (hydrated) { clearTimeout(timer); await persist(useStore.getState()); }
  await syncIdle();
  hydrated = false;
  const scope = scopeOf(me);
  const data = normalize(await readData(scope), scope);
  useStore.setState({ ...data, settings: was ?? data.settings, me, scope, refs: null, sync: { status: me ? 'idle' : 'off', at: null, error: null } });
  hydrated = true;
  persist(useStore.getState());   // примеры при первом запуске тоже сохраняем
  rememberMe(me);
  setAuthor(me?.name);
  refreshGallery();
  loadRefs();
  if (me) scheduleSync(300);
}

// Загрузка при старте: main.tsx рисует приложение после неё. Нет сети — работаем в
// пространстве последнего входа, синхронизация догонит; сессия кончилась — без входа
export async function hydrate() {
  let me: Me | null;
  try { me = await fetchMe(); }
  catch (e) { me = e instanceof ApiError && e.status === 0 ? rememberedMe() : null; }
  await openScope(me);
}

export async function signIn(loginName: string, password: string) {
  const me = await apiLogin(loginName, password);
  await openScope(me);
  return me;
}

export async function signOut() {
  try { await apiLogout(); } catch { /* сессия уже кончилась — всё равно выходим */ }
  await openScope(null);
}

export async function changeClient(client: string) {
  const me = await apiSwitch(client);
  await openScope(me);
}

// Данные, накопленные без входа, — в пространство клиента: чего там нет по id, то добавится
export async function importLocal(): Promise<number> {
  const local = normalize(await readData('local'), 'local-import');
  let n = 0;
  useStore.setState(s => {
    const add = <T extends { id: string }>(mine: T[], from: T[]) => {
      const have = new Set(mine.map(x => x.id));
      const extra = from.filter(x => !have.has(x.id));
      n += extra.length;
      return [...mine, ...extra];
    };
    return {
      fixtures: add(s.fixtures, local.fixtures), planograms: add(s.planograms, local.planograms), snapshots: add(s.snapshots, local.snapshots),
      clusters: add(s.clusters, local.clusters), custom: add(s.custom, local.custom), runs: add(s.runs, local.runs),
      patches: { ...local.patches, ...s.patches },
    };
  });
  return n;
}

// ---- хранение на сервере: проход после входа, через 2 с после правки и раз в 15 с ----
let syncing: Promise<void> | null = null, again = false;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
const syncIdle = () => syncing ?? Promise.resolve();
export function runSync(): Promise<void> {
  const s = useStore.getState();
  if (!s.me) { useStore.setState({ sync: { status: 'off', at: null, error: null } }); return Promise.resolve(); }
  if (syncing) { again = true; return syncing; }
  syncing = pass(s.scope).finally(() => {
    syncing = null;
    if (again) { again = false; scheduleSync(500); }
  });
  return syncing;
}
async function pass(scope: string) {
  const s = useStore.getState();
  useStore.setState(st => ({ sync: { ...st.sync, status: 'syncing' } }));
  try {
    const r = await syncOnce({}, scope, () => useStore.getState());
    if (useStore.getState().scope !== scope) return;   // пока шёл проход, сменили клиента
    useStore.setState(st => {
      const d = applyRemote(st, [...r.applied, ...r.dropped.map(x => ({ ...x, body: null, deleted: true }))]);
      return { ...d, planograms: [...r.copies, ...d.planograms], lost: [...r.lost, ...st.lost].slice(0, 100), sync: { status: 'idle', at: now(), error: null } };
    });
    if (r.conflicts.length) {
      const parts = [r.copies.length && `планограммы сохранены копией (${r.copies.length})`, r.lost.length && `остальное — в «Подключении», можно вернуть (${r.lost.length})`].filter(Boolean);
      s.notify(`На сервере правили те же документы (${r.conflicts.length}): взята серверная версия${parts.length ? `; ваши правки: ${parts.join(', ')}` : ', подтверждения сверок объединены'}`);
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {   // сессия кончилась: дальше без сервера, пока не войдут снова
      useStore.setState({ sync: { status: 'error', at: now(), error: 'Сессия закончилась: войдите снова' } });
      return;
    }
    useStore.setState({ sync: { status: 'error', at: now(), error: (e as Error).message } });
  }
}
export const scheduleSync = (ms = 2000) => { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); };
export const resetSync = () => { resetSyncMeta(useStore.getState().scope); scheduleSync(0); };

const DOC_KEYS = ['fixtures', 'planograms', 'snapshots', 'clusters', 'patches', 'custom', 'runs'] as const;
useStore.subscribe((s, prev) => {
  if (!hydrated || s.scope !== prev.scope) return;
  if (s.settings !== prev.settings) {
    if (s.settings.galleryTextures !== prev.settings.galleryTextures) refreshGallery();
    if (s.settings.tech !== prev.settings.tech) loadRefs();
    return;
  }
  if (s.me && DOC_KEYS.some(k => s[k] !== prev[k])) scheduleSync();
});
setInterval(() => { if (hydrated && useStore.getState().me) runSync(); }, 15_000);

// ---- фото эталонов как текстуры ----
setGalleryListener(() => { clearTextures(); clearThumbs(); useStore.setState(st => ({ texRev: st.texRev + 1 })); });
let galleryTimer: ReturnType<typeof setTimeout> | undefined;
function refreshGallery() {
  clearTimeout(galleryTimer);
  galleryTimer = setTimeout(() => {
    const { settings, me } = useStore.getState();
    // фото берём у того же сервера, где хранится Studio: без входа — рисованные пачки
    const on = settings.galleryTextures && !!me;
    setPhotos(on);
    connectGallery(on ? {} : null);
  }, 400);
}

// Сколько эталонов у метки — только инженеру: в сборке сайта этих чисел нет
function loadRefs() {
  const { me, settings } = useStore.getState();
  if (me?.role !== 'admin' || !settings.tech) { useStore.setState({ refs: null }); return; }
  api<{ labels: Record<string, number> }>({}, '/v1/gallery/refs')
    .then(r => useStore.setState({ refs: r.labels }))
    .catch(() => useStore.setState({ refs: null }));
}

// Технические блоки IR видны только инженеру; обычный пользователь их не видит
export const useTech = () => useStore(s => s.settings.tech && s.me?.role === 'admin');
// Утверждать и публиковать: руководитель и инженер. Без входа публиковать некуда, а утвердить можно
export const useCanApprove = () => useStore(s => !s.me || s.me.role !== 'editor');

export function useCatalog() {
  const patches = useStore(s => s.patches);
  const custom = useStore(s => s.custom);
  const refs = useStore(s => s.refs);
  return useMemo(() => {
    const list = buildCatalog(patches, custom, refs);
    const byId = new Map(list.map(s => [s.id, s]));
    return { list, byId, get: (id: string) => byId.get(id) };
  }, [patches, custom, refs]);
}

// ---- хеш-маршруты: #/planograms, #/planogram/<id>, #/fixtures, #/fixture/<id>, #/catalog, #/compare/<id> ----
function subscribeHash(cb: () => void) { window.addEventListener('hashchange', cb); return () => window.removeEventListener('hashchange', cb); }
export function useRoute(): string[] {
  const hash = useSyncExternalStore(subscribeHash, () => location.hash);
  return useMemo(() => hash.replace(/^#\/?/, '').split('/').filter(Boolean), [hash]);
}
export const go = (path: string) => { location.hash = '#/' + path; };
