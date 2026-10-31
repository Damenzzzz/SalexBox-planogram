// Выгрузки планограммы и сверок: Excel, PNG шкафа, строки прайс-листа

import { analyse } from './checks';
import { MAKERS, MAKER_ORDER } from './formats';
import { innerW, sortedShelves } from './geometry';
import { irName } from './irExport';
import { compareRows } from './compare';
import { layoutRows } from './versions';
import type { IrRun, Planogram, Sku } from './types';
import type { Cell, Sheet } from './xlsx';

type Get = (id: string) => Sku | undefined;

const STATUS = { draft: 'Черновик', review: 'На согласовании', approved: 'Утверждена', published: 'Опубликована' } as const;

export function planogramSheets(p: Planogram, get: Get): Sheet[] {
  const a = analyse(p, get);
  const fx = p.fixture;
  const layout: Cell[][] = [['Полка снизу', 'IR-ряд', 'Позиция', 'SKU', 'IR-метка', 'Бренд', 'Производитель', 'Формат', 'Фейсингов', 'Цена, ₸']];
  layoutRows(p, get).forEach(r => layout.push([r.shelf, r.irRow, r.pos, r.name, r.label, r.brand, MAKERS[r.maker as keyof typeof MAKERS] ?? r.maker, r.format, r.facings, r.price]));

  const summary: Cell[][] = [
    ['Поле', 'Значение'],
    ['Планограмма', p.name], ['Версия', p.version], ['Статус', STATUS[p.status]], ['Код версии', p.publishedAs ?? irName(p)],
    ['Рынок', p.market], ['Клиент', p.client], ['Точка', p.outlet],
    ['Шкаф', `${fx.code} · ${fx.name}`], ['Размер, мм', `${fx.w}×${fx.h}×${fx.d}`], ['Полок', sortedShelves(fx).length], ['Ширина полки, мм', innerW(fx)],
    ['Фейсингов', a.total], ['Заполнение', `${Math.round(a.fill * 100)}%`], ['SKU', a.placed.length],
    [], ['Производитель', 'Фейсингов', 'Доля', 'Цель'],
  ];
  MAKER_ORDER.forEach(m => {
    const n = a.byMaker[m] ?? 0, t = p.rules.shareTargets[m];
    if (n || t) summary.push([MAKERS[m], n, a.total ? `${(n / a.total * 100).toFixed(1)}%` : '—', t != null ? `${Math.round(t * 100)}%` : '']);
  });

  const rules: Cell[][] = [['Обязательный SKU', 'Минимум фейсингов', 'Стоит', 'Фейсингов']];
  p.rules.mustHave.forEach(id => rules.push([get(id)?.name ?? id, p.rules.minFacings[id] ?? 1, a.facings[id] ? 'да' : 'нет', a.facings[id] ?? 0]));
  if (p.ir.twins.length) {
    rules.push([], ['Близнецы для IR (подмена — ok)', '']);
    p.ir.twins.forEach(([x, y]) => rules.push([get(x)?.name ?? x, get(y)?.name ?? y]));
  }
  const issues: Cell[][] = [['Важность', 'Проверка']];
  const sev = { error: 'Ошибка', contract: 'Контракт', ir: 'IR', info: 'Заметка' } as const;
  a.issues.forEach(i => issues.push([sev[i.sev], i.text]));

  return [
    { name: 'Раскладка', rows: layout, widths: [12, 8, 9, 34, 38, 14, 14, 15, 11, 10] },
    { name: 'Сводка', rows: summary, widths: [28, 34, 10, 10] },
    { name: 'Правила', rows: rules, widths: [36, 30, 8, 11] },
    { name: 'Проверки', rows: issues, widths: [12, 110] },
  ];
}

export function runsSheet(p: Planogram, runs: IrRun[], get: Get): Sheet {
  const rows: Cell[][] = [['Фото', 'Дата', 'Версия', 'Ряд фото', 'Ряд планограммы', 'Позиция', 'Ожидалось', 'IR видит', 'Статус IR', 'Уверенность', 'Проверка', 'На самом деле', 'Пачка на самом деле']];
  runs.forEach(r => compareRows(r).forEach(x => rows.push([
    r.photoName, r.createdAt.slice(0, 16).replace('T', ' '), r.planogramVersion, x.photoRow, x.planogramRow, x.pos,
    x.expected ? get(x.expected)?.name ?? x.expected : '', x.sku ? get(x.sku)?.name ?? x.sku : '', x.status, x.conf,
    x.verdict === 'right' ? 'IR прав' : x.verdict === 'wrong' ? 'ошибся' : '', x.truth ?? '', x.truthSku ? get(x.truthSku)?.name ?? x.truthSku : '',
  ])));
  return { name: `Сверки ${p.name}`, rows, widths: [22, 17, 8, 9, 15, 9, 30, 30, 13, 11, 10, 14, 30] };
}

// Прайс-лист закрытой выкладки (РК, ст. 110 Кодекса о здоровье): текст, по алфавиту, с ценой
export function priceList(p: Planogram, get: Get) {
  const seen = new Map<string, Sku>();
  Object.values(p.rows).flat().forEach(q => { const s = get(q.sku); if (s) seen.set(s.id, s); });
  const all = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return { items: all.filter(s => s.price != null), noPrice: all.filter(s => s.price == null) };
}
