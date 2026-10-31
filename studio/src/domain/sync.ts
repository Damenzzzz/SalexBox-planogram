// Хранение Studio в IR-сервисе: документы целиком, синхронизация по seq, запись поверх rev.
// Браузер остаётся рабочей копией: без сети всё работает, при связи изменения уходят и приходят.
// Конфликт (правили и тут, и на сервере): берём серверную версию, а своя правка не пропадает.
// Планограмма сохраняется копией, у сверки подтверждения слотов объединяются, остальное
// (шкафы, кластеры, каталог, версии) уходит в список «уступили серверу», откуда её можно вернуть.

import { ApiError, api, docPath, jsonBody, type ApiConfig } from './api';
import { uid } from './geometry';
import { normalizePlanogram } from './templates';
import type { Cluster, Fixture, IrRun, Planogram, Sku, SkuPatch, Snapshot } from './types';

export type DocKind = 'fixture' | 'planogram' | 'version' | 'sku' | 'run' | 'cluster';

export interface Docs {
  fixtures: Fixture[];
  planograms: Planogram[];
  snapshots: Snapshot[];
  clusters: Cluster[];
  patches: Record<string, SkuPatch>;
  custom: Sku[];
  runs: IrRun[];
}

interface Doc { kind: DocKind; id: string; body: unknown; src: unknown[] }

export interface RemoteDoc { kind: DocKind; id: string; rev: number; seq: number; updated_at: string; deleted: boolean; body: unknown }

// Своя правка, уступившая серверу: можно вернуть её или отказаться
export interface Lost { kind: DocKind; id: string; title: string; body: unknown; at: string }

const KIND_RU: Record<DocKind, string> = { fixture: 'Шкаф', planogram: 'Планограмма', version: 'Версия', sku: 'SKU', run: 'Сверка', cluster: 'Кластер' };
export function lostTitle(kind: DocKind, id: string, body: unknown): string {
  const b = (body ?? {}) as Record<string, unknown>;
  const name = kind === 'fixture' ? `${b.code ?? ''} ${b.name ?? ''}`.trim()
    : kind === 'cluster' ? b.name
    : kind === 'version' ? `v${b.version}`
    : kind === 'sku' ? ((b.custom as Sku | undefined)?.name ?? id.split('/').pop())
    : id;
  return `${KIND_RU[kind]} ${name || id}`;
}

// Подтверждения слотов с двух сторон: свои поверх серверных, ни одно не теряется
function mergeRun(remote: IrRun, mine: IrRun): IrRun {
  return { ...remote, verdicts: { ...remote.verdicts, ...mine.verdicts } };
}

interface Meta { base: string; seq: number; revs: Record<string, number>; hashes: Record<string, string> }

const META_KEY = 'planogram-studio.sync';
const SEED_KEY = 'planogram-studio.seed';
const key = (kind: string, id: string) => `${kind}:${id}`;

function hashOf(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `${text.length}:${(h >>> 0).toString(36)}`;
}

// Хэш пересчитываем, только когда объект в хранилище заменили: правки иммутабельные
const hashCache = new Map<string, { src: unknown[]; hash: string }>();
function hashDoc(d: Doc) {
  const k = key(d.kind, d.id);
  const c = hashCache.get(k);
  if (c && c.src.length === d.src.length && c.src.every((x, i) => x === d.src[i])) return c.hash;
  const hash = hashOf(JSON.stringify(d.body));
  hashCache.set(k, { src: d.src, hash });
  return hash;
}

export function collect(s: Docs): Map<string, Doc> {
  const out = new Map<string, Doc>();
  const add = (kind: DocKind, id: string, body: unknown, src: unknown[]) => out.set(key(kind, id), { kind, id, body, src });
  s.fixtures.forEach(f => add('fixture', f.id, f, [f]));
  s.planograms.forEach(p => add('planogram', p.id, p, [p]));
  s.snapshots.forEach(v => add('version', v.id, v, [v]));
  s.clusters.forEach(c => add('cluster', c.id, c, [c]));
  s.runs.forEach(r => add('run', r.id, r, [r]));
  const custom = new Map(s.custom.map(c => [c.id, c]));
  new Set([...Object.keys(s.patches), ...custom.keys()]).forEach(id => {
    const patch = s.patches[id], own = custom.get(id);
    const body: { patch?: SkuPatch; custom?: Sku } = {};
    if (patch) body.patch = patch;
    if (own) body.custom = own;
    add('sku', id, body, [patch, own]);
  });
  return out;
}

// Применить документы сервера к данным Studio; возвращает новые данные
export function applyRemote(s: Docs, items: { kind: DocKind; id: string; body: unknown; deleted: boolean }[]): Docs {
  const next: Docs = { ...s };
  const upsert = <T extends { id: string }>(list: T[], id: string, body: T | null, front = false) => {
    const rest = list.filter(x => x.id !== id);
    if (!body) return rest;
    const i = list.findIndex(x => x.id === id);
    if (i >= 0) { const copy = [...list]; copy[i] = body; return copy; }
    return front ? [body, ...rest] : [...rest, body];
  };
  for (const it of items) {
    const body = it.deleted ? null : it.body;
    switch (it.kind) {
      case 'fixture': next.fixtures = upsert(next.fixtures, it.id, body as Fixture | null); break;
      case 'planogram': next.planograms = upsert(next.planograms, it.id, body ? normalizePlanogram(body as Planogram) : null, true); break;
      case 'version': next.snapshots = upsert(next.snapshots, it.id, body as Snapshot | null, true); break;
      case 'cluster': next.clusters = upsert(next.clusters, it.id, body as Cluster | null); break;
      case 'run': next.runs = upsert(next.runs, it.id, body as IrRun | null, true); break;
      case 'sku': {
        const b = (body ?? {}) as { patch?: SkuPatch; custom?: Sku };
        const patches = { ...next.patches };
        if (b.patch) patches[it.id] = b.patch; else delete patches[it.id];
        next.patches = patches;
        next.custom = upsert(next.custom, it.id, b.custom ?? null);
        break;
      }
    }
  }
  return next;
}

// Что уже синхронизировано — своё у каждого пространства (пользователь и клиент)
function loadMeta(base: string): Meta {
  try {
    const m = JSON.parse(localStorage.getItem(`${META_KEY}:${base}`) ?? '') as Meta;
    if (m.base === base) return m;
  } catch { /* нет или битое — начинаем заново */ }
  return { base, seq: 0, revs: {}, hashes: {} };
}
const saveMeta = (m: Meta) => { try { localStorage.setItem(`${META_KEY}:${m.base}`, JSON.stringify(m)); } catch { /* место кончилось — синхронизируемся с нуля */ } };
export const resetSyncMeta = (scope: string) => { try { localStorage.removeItem(`${META_KEY}:${scope}`); } catch { /* нечего чистить */ } };

// Примеры, которые Studio создаёт в новом браузере. Если на сервере уже есть данные, нетронутые примеры
// не отправляем и убираем: иначе каждый новый компьютер добавлял бы на сервер ещё одну копию
export function markSeed(s: Docs, scope: string) {
  const hashes: Record<string, string> = {};
  collect(s).forEach((d, k) => { hashes[k] = hashDoc(d); });
  try { localStorage.setItem(`${SEED_KEY}:${scope}`, JSON.stringify(hashes)); } catch { /* без отметки примеры просто уйдут на сервер */ }
}
function takeSeed(scope: string): Record<string, string> {
  try { const k = `${SEED_KEY}:${scope}`; const s = JSON.parse(localStorage.getItem(k) ?? '{}'); localStorage.removeItem(k); return s; } catch { return {}; }
}

export interface SyncResult {
  applied: RemoteDoc[];      // документы сервера: применить к текущим данным (их могли поменять за время прохода)
  copies: Planogram[];       // свои правки планограмм, проигравшие конфликт, — отдельными планограммами
  lost: Lost[];              // остальные свои правки, уступившие серверу
  dropped: { kind: DocKind; id: string }[];   // нетронутые примеры этого браузера: на сервере уже есть данные
  pulled: number; pushed: number; conflicts: string[];
}

// Один проход: забрать изменения с сервера, отправить свои
export async function syncOnce(cfg: ApiConfig, scope: string, read: () => Docs): Promise<SyncResult> {
  const meta = loadMeta(scope);
  const conflicts: string[] = [];
  const applied: RemoteDoc[] = [];
  const allCopies: Planogram[] = [];
  const lost: Lost[] = [];
  const merged = new Set<string>();   // объединённые сверки: уйдут на сервер этим же проходом
  let data: Docs | null = null;
  const cur = () => data ?? read();

  const takeRemote = (docs: RemoteDoc[]) => {
    if (!docs.length) return;
    const local = collect(cur());
    const copies: Planogram[] = [];
    const apply: RemoteDoc[] = [];
    for (const d of docs) {
      const k = key(d.kind, d.id);
      const mine = local.get(k);
      const dirty = !!mine && hashDoc(mine) !== meta.hashes[k];
      const known = meta.revs[k];
      if (known === d.rev && !d.deleted) continue;                // это наша же запись
      if (d.deleted && dirty) { meta.revs[k] = 0; delete meta.hashes[k]; continue; }   // удалили там, правили тут — создадим заново
      if (dirty && known !== undefined) {
        conflicts.push(k);
        if (d.kind === 'planogram') {
          const p = mine.body as Planogram;
          copies.push({ ...structuredClone(p), id: uid('plg'), name: `${p.name} (ваша правка)`, publishedAs: null, assign: { clusters: [], outlets: [] } });
        } else if (d.kind === 'run' && !d.deleted) {
          apply.push({ ...d, body: mergeRun(d.body as IrRun, mine.body as IrRun) });
          merged.add(k);
          continue;
        } else {
          lost.push({ kind: d.kind, id: d.id, title: lostTitle(d.kind, d.id, mine.body), body: structuredClone(mine.body), at: new Date().toISOString() });
        }
      }
      apply.push(d);
    }
    if (!apply.length && !copies.length) return;
    applied.push(...apply);
    allCopies.push(...copies);
    let next = applyRemote(cur(), apply);
    if (copies.length) next = { ...next, planograms: [...copies, ...next.planograms] };
    data = next;
    const after = collect(next);
    for (const d of apply) {
      const k = key(d.kind, d.id);
      if (d.deleted) { delete meta.revs[k]; delete meta.hashes[k]; continue; }
      meta.revs[k] = d.rev;
      const doc = after.get(k);
      meta.hashes[k] = doc && !merged.has(k) ? hashDoc(doc) : '';   // пустой хэш — отправить объединённую
    }
  };

  // 1. изменения сервера
  const first = meta.seq === 0 && !Object.keys(meta.revs).length;
  const pulled = await api<{ items: RemoteDoc[]; seq: number }>(cfg, `/v1/studio/docs?since=${meta.seq}`);
  takeRemote(pulled.items);
  meta.seq = pulled.seq;

  // 2. свои изменения; примеры этого браузера — только на пустой сервер
  let pushed = 0;
  const docs = collect(cur());
  const dropped: { kind: DocKind; id: string }[] = [];
  const seed = first ? takeSeed(scope) : {};
  if (first && pulled.items.some(d => !d.deleted)) {
    const keep = new Set<string>();
    docs.forEach((d, k) => {
      const untouched = seed[k] && seed[k] === hashDoc(d);
      if (!untouched && d.kind === 'planogram') { const tpl = (d.body as Planogram).templateId; if (tpl) keep.add(key('fixture', tpl)); }
    });
    docs.forEach((d, k) => {
      if (seed[k] && seed[k] === hashDoc(d) && !keep.has(k) && !meta.revs[k]) { dropped.push({ kind: d.kind, id: d.id }); docs.delete(k); }
    });
  }
  for (const [k, d] of docs) {
    const hash = hashDoc(d);
    if (meta.hashes[k] === hash) continue;
    try {
      const r = await api<RemoteDoc>(cfg, docPath(d.kind, d.id), { method: 'PUT', body: jsonBody({ rev: meta.revs[k] ?? 0, body: d.body }) });
      meta.revs[k] = r.rev; meta.hashes[k] = hash; pushed++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        const current = (e.body as { current?: RemoteDoc | null } | null)?.current;
        if (current) { meta.revs[k] = meta.revs[k] ?? -1; takeRemote([current]); }
        continue;
      }
      throw e;
    }
  }
  for (const k of Object.keys(meta.hashes)) {
    if (docs.has(k)) continue;
    const i = k.indexOf(':');
    const kind = k.slice(0, i), id = k.slice(i + 1);
    try {
      await api(cfg, `${docPath(kind, id)}?rev=${meta.revs[k] ?? 0}`, { method: 'DELETE' });
      pushed++;
    } catch (e) {
      if (!(e instanceof ApiError) || (e.status !== 404 && e.status !== 409 && e.status !== 422)) throw e;
      if (e.status === 409) {
        const current = (e.body as { current?: RemoteDoc | null } | null)?.current;
        if (current) { takeRemote([current]); continue; }
      }
    }
    delete meta.revs[k]; delete meta.hashes[k];
  }
  saveMeta(meta);
  return { applied, copies: allCopies, lost, dropped, pulled: pulled.items.length, pushed, conflicts };
}
