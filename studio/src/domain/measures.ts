// Замеры пачек, цены и продажи таблицей: выгрузить шаблон, заполнить в Excel, загрузить обратно.
// CSV с разделителем «;» или «,»; первая строка — заголовки. SKU ищется по коду, EAN или названию.

import type { Sku, SkuPatch } from './types';

const COLS: Record<string, keyof Row> = {
  sku: 'sku', 'код': 'sku', label: 'sku', 'метка': 'sku',
  ean: 'ean', 'штрихкод': 'ean',
  name: 'name', 'название': 'name',
  w: 'w', 'ширина': 'w', h: 'h', 'высота': 'h', d: 'd', 'глубина': 'd',
  price: 'price', 'цена': 'price', sales: 'sales', 'продажи': 'sales', 'продажи/нед': 'sales',
};
interface Row { sku: string; ean: string; name: string; w: string; h: string; d: string; price: string; sales: string }

const HEAD = ['sku', 'ean', 'name', 'w', 'h', 'd', 'price', 'sales'] as const;
const cell = (v: string | number | null | undefined) => {
  const s = v == null ? '' : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Шаблон: все SKU каталога с текущими значениями; заголовки по-английски, чтобы файл читался везде
export function measuresTemplate(list: Sku[]): string {
  const lines = [HEAD.join(';'), ...list.map(s => [s.id, s.ean, s.name, s.w, s.h, s.d, s.price, s.sales].map(cell).join(';'))];
  return '﻿' + lines.join('\n') + '\n';   // BOM: Excel откроет кириллицу без кракозябр
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '', quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

const num = (v: string) => {
  const n = Number(v.replace(/\s/g, '').replace(',', '.'));
  return v.trim() && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
};

export interface MeasuresResult { patches: [string, SkuPatch][]; missing: string[]; measured: number }

// Разобрать таблицу и сопоставить строки с каталогом. Ширина, высота и глубина вместе — это замер
export function parseMeasures(text: string, list: Sku[]): MeasuresResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('в файле нет строк с данными');
  const sep = (lines[0].match(/;/g)?.length ?? 0) >= (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const head = splitLine(lines[0], sep).map(h => COLS[h.toLowerCase()]);
  if (!head.some(Boolean)) throw new Error('не узнал заголовки: нужны sku или ean или name и w, h, d, price, sales');
  const byId = new Map(list.map(s => [s.id.toLowerCase(), s]));
  const byEan = new Map(list.filter(s => s.ean).map(s => [s.ean, s]));
  const byName = new Map(list.map(s => [s.name.toLowerCase(), s]));
  const patches: [string, SkuPatch][] = [];
  const missing: string[] = [];
  let measured = 0;
  for (const line of lines.slice(1)) {
    const cells = splitLine(line, sep);
    const r: Partial<Row> = {};
    head.forEach((k, i) => { if (k) r[k] = cells[i] ?? ''; });
    const s = (r.ean && byEan.get(r.ean)) || (r.sku && byId.get(r.sku.toLowerCase())) || (r.name && byName.get(r.name.toLowerCase()));
    if (!s) { missing.push(r.sku || r.ean || r.name || line.slice(0, 40)); continue; }
    const patch: SkuPatch = {};
    const w = num(r.w ?? ''), h = num(r.h ?? ''), d = num(r.d ?? '');
    if (w && h && d && (w !== s.w || h !== s.h || d !== s.d || !s.measured)) { Object.assign(patch, { w, h, d, measured: true }); measured++; }
    const price = num(r.price ?? ''), sales = num(r.sales ?? '');
    if (price && price !== s.price) patch.price = price;
    if (sales && sales !== s.sales) patch.sales = sales;
    if (r.ean && r.ean !== s.ean && /^\d{8,14}$/.test(r.ean)) patch.ean = r.ean;
    if (Object.keys(patch).length) patches.push([s.id, patch]);
  }
  return { patches, missing, measured };
}
