import { makeLookFor } from './catalog';
import { FORMATS } from './formats';
import type { FormatId, Maker, Sku } from './types';

// IR пока различает напитки только по бренду: coca-cola, fanta и other (всё остальное). Объём и
// вкус он не видит, поэтому у всех SKU одного бренда одна метка: сверка проверяет бренд на месте,
// а объём и вкус нужны человеку и для расчёта, что помещается на полке.
export type DrinkLabel = 'coca-cola' | 'fanta' | 'other';

interface Line { label: DrinkLabel; name: string; format: FormatId; base: string; accent: string }

const COKE = { base: '#c8102e', accent: '#ffffff' };
const ZERO = { base: '#17181a', accent: '#e4002b' };
const FANTA = { base: '#f47b20', accent: '#1d4fa3' };
const SPRITE = { base: '#00843d', accent: '#f4d03f' };
const FUSE = { base: '#d9a441', accent: '#3a7d44' };
const BONAQUA = { base: '#1f8fd6', accent: '#ffffff' };
const SCHWEPPES = { base: '#e8c547', accent: '#17324d' };

const line = (label: DrinkLabel, name: string, style: { base: string; accent: string }, formats: [FormatId, string][]): Line[] =>
  formats.map(([format, size]) => ({ label, name: `${name} ${size}`, format, ...style }));

const LINES: Line[] = [
  ...line('coca-cola', 'Classic', COKE, [['GL025', '0.25 стекло'], ['CANSL', '0.33 банка'], ['PET05', '0.5'], ['PET1', '1'], ['PET15', '1.5'], ['PET2', '2']]),
  ...line('coca-cola', 'Zero', ZERO, [['CANSL', '0.33 банка'], ['PET05', '0.5'], ['PET1', '1'], ['PET15', '1.5']]),
  ...line('fanta', 'Orange', FANTA, [['CANSL', '0.33 банка'], ['PET05', '0.5'], ['PET1', '1'], ['PET15', '1.5']]),
  ...line('other', 'Sprite', SPRITE, [['CANSL', '0.33 банка'], ['PET05', '0.5'], ['PET1', '1'], ['PET15', '1.5']]),
  ...line('other', 'Fuse Tea', FUSE, [['PET05', '0.5'], ['PET1', '1']]),
  ...line('other', 'BonAqua', BONAQUA, [['PET05', '0.5'], ['PET1', '1']]),
  ...line('other', 'Schweppes', SCHWEPPES, [['CANSL', '0.33 банка'], ['PET1', '1']]),
];

const BRAND_NAME: Record<DrinkLabel, string> = { 'coca-cola': 'Coca-Cola', fanta: 'Fanta', other: 'Другой напиток' };

// В каталоге только марки Coca-Cola; общая метка other у них от того, что IR не различает эти марки
const makerOf = (name: string): Maker => (name === 'Другой напиток' ? 'OTH' : 'CCI');

function drink(id: string, label: DrinkLabel, name: string, format: FormatId, base: string, accent: string): Sku {
  const f = FORMATS[format];
  return {
    id, label, brand: label, name, maker: makerOf(name), segment: 'mid', format,
    w: f.w, h: f.h, d: f.d, measured: false, formatGuessed: false, refs: 0, price: null, ean: '',
    look: makeLookFor(BRAND_NAME[label], name, base, accent), custom: false, category: 'beverages',
  };
}

// Первые три — только бренд: такой id приходит от IR в ответе сверки
// Список строится при первом обращении: catalog.ts и этот файл импортируют друг друга
let skus: Sku[] | null = null;
export function beverageSkus(): Sku[] {
  skus ??= [
    drink('coca-cola', 'coca-cola', 'Coca-Cola, любой объём', 'PET05', COKE.base, COKE.accent),
    drink('fanta', 'fanta', 'Fanta, любой объём', 'PET05', FANTA.base, FANTA.accent),
    drink('other', 'other', 'Другой напиток', 'PET05', '#5c6470', '#ffffff'),
    ...LINES.map(l => drink(`${l.label}/${l.name}`, l.label, l.name, l.format, l.base, l.accent)),
  ];
  return skus;
}
