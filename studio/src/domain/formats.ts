import type { FormatId, Maker, Segment } from './types';

export interface Format {
  name: string;
  w: number; h: number; d: number;  // ориентировочно: источники расходятся на 2–4 мм
  lane: number;                     // ширина ряда толкателя
}

export const FORMATS: Record<FormatId, Format> = {
  KS:      { name: 'King Size',      w: 55, h: 86,  d: 21, lane: 59 },
  KS100:   { name: 'King Size 100',  w: 55, h: 100, d: 21, lane: 59 },
  KSSL:    { name: 'King Size Slim', w: 44, h: 85,  d: 20, lane: 48 },
  CMP:     { name: 'Compact',        w: 49, h: 85,  d: 19, lane: 52 },
  CMP100:  { name: 'Compact 100',    w: 49, h: 97,  d: 19, lane: 52 },
  NANO:    { name: 'Nano',           w: 44, h: 85,  d: 17, lane: 48 },
  DEMI:    { name: 'Demi',           w: 49, h: 85,  d: 19, lane: 52 },
  SS:      { name: 'Super Slims',    w: 42, h: 98,  d: 18, lane: 45 },
  MINI:    { name: 'Mini',           w: 43, h: 89,  d: 18, lane: 45 },
  BLISTER: { name: 'Блистер',        w: 95, h: 24,  d: 14, lane: 100 },
};

export const FORMAT_ORDER: FormatId[] = ['KS', 'KS100', 'KSSL', 'CMP', 'CMP100', 'NANO', 'DEMI', 'SS', 'MINI', 'BLISTER'];

export const MAKERS: Record<Maker, string> = {
  PMI: 'PMI', JTI: 'JTI', BAT: 'BAT', KTG: 'KT&G', IMP: 'Imperial', OTH: 'Другие',
};
export const MAKER_ORDER: Maker[] = ['KTG', 'JTI', 'PMI', 'BAT', 'IMP', 'OTH'];

export const SEGMENTS: Record<Segment, string> = { premium: 'Премиум', mid: 'Средний', economy: 'Эконом' };

// Формат пачки по IR-метке: в названиях моделей галереи он уже есть (SS, KS, Nano, Demi…)
export function formatFromLabel(model: string, brand: string): { format: FormatId; guessed: boolean } {
  const m = ` ${model} `.replace(/\s+/g, ' ');
  const has = (re: RegExp) => re.test(m);
  if (brand === 'Corsar' && has(/Блистер/i)) return { format: 'BLISTER', guessed: false };
  if (has(/ KSSL /i)) return { format: 'KSSL', guessed: false };
  if (has(/ Compact /i)) return { format: has(/ 100S? /i) ? 'CMP100' : 'CMP', guessed: false };
  if (has(/ Nano /i)) return { format: 'NANO', guessed: false };
  if (has(/ Demi /i)) return { format: 'DEMI', guessed: false };
  if (has(/ Mini /i)) return { format: 'MINI', guessed: false };
  if (has(/ SS /) || has(/ Super ?Slims? /i) || has(/ (Ultra|Royal)? ?Slims? /i)) return { format: 'SS', guessed: false };
  if (has(/ KS 100 /i) || has(/ 100S? /i) || has(/ Xl /i)) return { format: 'KS100', guessed: false };
  if (has(/ KS /)) return { format: 'KS', guessed: false };
  return { format: 'KS', guessed: true };
}

const MAKER_BY_BRAND: Record<string, Maker> = {
  Parliament: 'PMI', Marlboro: 'PMI', Bond: 'PMI', 'L&M': 'PMI', 'Philip Morris': 'PMI', Chesterfield: 'PMI',
  Winston: 'JTI', Camel: 'JTI', LD: 'JTI', Sobranie: 'JTI', Glamour: 'JTI', Mevius: 'JTI',
  Kent: 'BAT', Rothmans: 'BAT', Dunhill: 'BAT', Vogue: 'BAT', 'Pall Mall': 'BAT',
  Esse: 'KTG', Bohem: 'KTG', Raison: 'KTG',
  Davidoff: 'IMP', Richmond: 'IMP',
};
export const makerOf = (brand: string): Maker => MAKER_BY_BRAND[brand] ?? 'OTH';

const PREMIUM = new Set(['Parliament', 'Sobranie', 'Davidoff', 'Dunhill', 'Vogue', 'Marlboro', 'Kent', 'Raison', 'Djarum', 'Captain Black']);
const ECONOMY = new Set(['Rothmans', 'LD', 'Bond', 'L&M', 'Philip Morris', 'Chesterfield', 'Democrat', 'NZ', 'Stolichnye', 'Kiss', 'Contact', 'Богатыри', 'Гараж', 'The Bristol']);
export const segmentOf = (brand: string): Segment => (PREMIUM.has(brand) ? 'premium' : ECONOMY.has(brand) ? 'economy' : 'mid');
