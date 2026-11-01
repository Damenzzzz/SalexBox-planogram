// Версии планограммы и согласование: черновик → на согласовании → утверждена → опубликована.
// Правка утверждённой или опубликованной — новая версия-черновик, старая остаётся снимком.

import { FORMATS } from './formats';
import { shelfIndex, shelvesTopDown, sortedShelves, uid } from './geometry';
import type { JournalAction, Planogram, PlanogramStatus, Sku, Snapshot } from './types';

const now = () => new Date().toISOString();

export const ACTION_RU: Record<JournalAction, string> = {
  created: 'Создана', review: 'Отправлена на согласование', approved: 'Утверждена', returned: 'Возвращена на доработку',
  published: 'Опубликована', version: 'Новая версия', restored: 'Восстановлена из версии',
};

// Автор записей журнала — подпись из подключения к серверу; без неё записи без автора
let author: string | undefined;
export const setAuthor = (name: string | undefined) => { author = name; };

export function withEntry(p: Planogram, action: JournalAction, note = '', status?: PlanogramStatus): Planogram {
  const entry = { at: now(), version: p.version, action, note, ...(author ? { by: author } : {}) };
  return { ...p, status: status ?? p.status, journal: [...p.journal, entry] };
}

export function snapshotOf(p: Planogram, note: string): Snapshot {
  const data: Planogram = structuredClone(p);
  return { id: uid('ver'), planogramId: p.id, version: p.version, status: p.status, savedAt: now(), note, data };
}

// Правка не в черновике: снимок текущей версии и новая версия-черновик
export function needsNewVersion(p: Planogram) {
  return p.status !== 'draft';
}
export function nextVersion(p: Planogram, reason = 'правка после согласования'): { next: Planogram; snapshot: Snapshot } {
  const snapshot = snapshotOf(p, `v${p.version} · ${STATUS_SHORT[p.status]}`);
  const bumped: Planogram = { ...structuredClone(p), version: p.version + 1, status: 'draft', publishedAs: null };
  return { next: withEntry(bumped, 'version', reason), snapshot };
}

const STATUS_SHORT: Record<PlanogramStatus, string> = { draft: 'черновик', review: 'на согласовании', approved: 'утверждена', published: 'опубликована' };

// Восстановить содержимое снимка как новую версию-черновик той же планограммы
export function restoreFrom(cur: Planogram, snap: Snapshot): Planogram {
  const d = structuredClone(snap.data);
  const next: Planogram = {
    ...cur, fixture: d.fixture, rows: d.rows, rules: d.rules, ir: d.ir, templateId: d.templateId, templateVersion: d.templateVersion,
    version: cur.version + 1, status: 'draft', publishedAs: null,
  };
  return withEntry(next, 'restored', `содержимое v${snap.version}`);
}

// ---------- сравнение версий ----------

export interface Change { kind: 'added' | 'removed' | 'facings' | 'moved' | 'order' | 'fixture' | 'rules'; text: string }

type Where = Map<number, number>;   // полка снизу → фейсингов

function layout(p: Planogram) {
  const out = new Map<string, Where>();
  const order = new Map<number, string[]>();
  sortedShelves(p.fixture).forEach((sh, i) => {
    const no = i + 1;
    const row = p.rows[sh.id] ?? [];
    order.set(no, row.map(q => q.sku));
    row.forEach(q => {
      const w = out.get(q.sku) ?? new Map<number, number>();
      w.set(no, (w.get(no) ?? 0) + q.facings);
      out.set(q.sku, w);
    });
  });
  return { out, order };
}

const total = (w: Where | undefined) => [...(w?.values() ?? [])].reduce((a, b) => a + b, 0);
const shelvesText = (w: Where) => [...w.keys()].sort((a, b) => a - b).join(', ');

// Что изменилось от a (было) к b (стало): шкаф, раскладка, правила
export function diffPlanograms(a: Planogram, b: Planogram, get: (id: string) => Sku | undefined): Change[] {
  const name = (id: string) => get(id)?.name ?? id;
  const out: Change[] = [];
  const fa = a.fixture, fb = b.fixture;
  if (fa.code !== fb.code) out.push({ kind: 'fixture', text: `Шкаф ${fa.code} → ${fb.code}` });
  if (fa.w !== fb.w || fa.h !== fb.h || fa.d !== fb.d) out.push({ kind: 'fixture', text: `Размер ${fa.w}×${fa.h}×${fa.d} → ${fb.w}×${fb.h}×${fb.d} мм` });
  if (fa.shelves.length !== fb.shelves.length) out.push({ kind: 'fixture', text: `Полок ${fa.shelves.length} → ${fb.shelves.length}` });

  const A = layout(a), B = layout(b);
  const ids = [...new Set([...A.out.keys(), ...B.out.keys()])].sort((x, y) => name(x).localeCompare(name(y)));
  for (const id of ids) {
    const wa = A.out.get(id), wb = B.out.get(id);
    if (!wa) { out.push({ kind: 'added', text: `${name(id)}: добавлен, ${total(wb)} ф., полка ${shelvesText(wb!)}` }); continue; }
    if (!wb) { out.push({ kind: 'removed', text: `${name(id)}: убран (было ${total(wa)} ф., полка ${shelvesText(wa)})` }); continue; }
    const sa = shelvesText(wa), sb = shelvesText(wb);
    if (sa !== sb) out.push({ kind: 'moved', text: `${name(id)}: полка ${sa} → ${sb}${total(wa) !== total(wb) ? `, ${total(wa)} → ${total(wb)} ф.` : ''}` });
    else if (total(wa) !== total(wb)) out.push({ kind: 'facings', text: `${name(id)}: ${total(wa)} → ${total(wb)} ф. (полка ${sb})` });
  }
  for (const [no, seq] of B.order) {
    const before = A.order.get(no);
    if (!before || before.length !== seq.length) continue;
    const sameSet = [...before].sort().join('|') === [...seq].sort().join('|');
    if (sameSet && before.join('|') !== seq.join('|')) out.push({ kind: 'order', text: `Полка ${no}: другой порядок блоков` });
  }

  const ma = new Set(a.rules.mustHave), mb = new Set(b.rules.mustHave);
  mb.forEach(id => { if (!ma.has(id)) out.push({ kind: 'rules', text: `Обязательный: + ${name(id)}` }); });
  ma.forEach(id => { if (!mb.has(id)) out.push({ kind: 'rules', text: `Обязательный: − ${name(id)}` }); });
  const makers = new Set([...Object.keys(a.rules.shareTargets), ...Object.keys(b.rules.shareTargets)]) as Set<keyof Planogram['rules']['shareTargets']>;
  makers.forEach(m => {
    const x = a.rules.shareTargets[m], y = b.rules.shareTargets[m];
    if (x !== y) out.push({ kind: 'rules', text: `Доля ${m}: ${x != null ? Math.round(x * 100) + '%' : 'нет'} → ${y != null ? Math.round(y * 100) + '%' : 'нет'}` });
  });
  if (a.ir.twins.length !== b.ir.twins.length) out.push({ kind: 'rules', text: `Пар-близнецов ${a.ir.twins.length} → ${b.ir.twins.length}` });
  return out;
}

// Строки для таблиц и печати: полка, позиция, SKU, фейсинги
export function layoutRows(p: Planogram, get: (id: string) => Sku | undefined) {
  const rows: { shelf: number; irRow: number; pos: number; sku: string; label: string; name: string; brand: string; maker: string; format: string; facings: number; price: number | null }[] = [];
  shelvesTopDown(p.fixture).forEach(sh => {
    const { fromBottom, irRow } = shelfIndex(p.fixture, sh.id);
    (p.rows[sh.id] ?? []).forEach((q, i) => {
      const s = get(q.sku);
      rows.push({
        shelf: fromBottom, irRow, pos: i + 1, sku: q.sku, label: s?.label ?? '', name: s?.name ?? q.sku, brand: s?.brand ?? q.sku.split('/')[0],
        maker: s?.maker ?? '', format: s ? FORMATS[s.format].name : '', facings: q.facings, price: s?.price ?? null,
      });
    });
  });
  return rows;
}
