// Все длины — миллиметры. Начало координат шкафа — левый нижний угол, y вверх.

export type FormatId =
  | 'KS' | 'KS100' | 'KSSL' | 'CMP' | 'CMP100' | 'NANO' | 'DEMI' | 'SS' | 'MINI' | 'BLISTER';

export type Maker = 'PMI' | 'JTI' | 'BAT' | 'KTG' | 'IMP' | 'OTH';
export type Segment = 'premium' | 'mid' | 'economy';
export type Market = 'KZ' | 'KG' | 'UZ' | 'RU';

export type LookKind = 'band' | 'stripe' | 'frame' | 'split' | 'emblem' | 'split-h' | 'grad';
export type LookFont = 'serif' | 'wide' | 'sans';

export interface Look {
  kind: LookKind;
  c: [string, string];  // фон: верх-лево → низ-право
  a: string;            // акцент
  ink: string;          // цвет надписи
  word: string;         // бренд
  sub: string;          // вариант
  font: LookFont;
}

export interface Sku {
  id: string;               // для SKU из галереи — сама IR-метка
  label: string | null;     // IR-метка «Бренд/Модель»; null — SKU не в галерее
  brand: string;
  name: string;
  maker: Maker;
  segment: Segment;
  format: FormatId;
  w: number; h: number; d: number;
  measured: boolean;        // размеры сняты с пачки, а не из справочника
  formatGuessed: boolean;   // формат не удалось вывести из метки
  refs: number;             // эталонов в галерее
  price: number | null;     // ₸
  ean: string;
  look: Look;
  custom: boolean;          // добавлен вручную
}

export type SkuPatch = Partial<Pick<Sku, 'maker' | 'segment' | 'format' | 'w' | 'h' | 'd' | 'measured' | 'price' | 'ean' | 'name'>>;

export type Doors = 'none' | 'glass' | 'shutter';
export type Material = 'graphite' | 'wood' | 'white';
export type LaneMode = 'format' | 'fixed';

export interface Shelf {
  id: string;
  y: number;              // низ доски от пола
  depth: number | null;   // null — глубина шкафа
  lane: number | null;    // своя ширина ряда толкателя; null — как у шкафа
}

export interface Fixture {
  id: string;
  code: string;           // например «С1-96-170»
  codeAuto: boolean;      // код пересобирается из размеров
  name: string;
  w: number; h: number; d: number;
  base: number;           // цоколь
  header: number;         // лайтбокс; 0 — нет
  side: number;           // боковины
  board: number;          // толщина полки
  rail: number;           // высота ценникодержателя
  doors: Doors;
  material: Material;
  laneMode: LaneMode;
  laneWidth: number;      // для laneMode = fixed
  shelves: Shelf[];       // снизу вверх
  version: number;
  updatedAt: string;
}

export interface Placement {
  id: string;
  sku: string;
  facings: number;
}

export interface AlignCosts {
  mismatch: number; missing: number; missing_gap: number; extra: number;
  gap_edge: number; gap_inside: number; brand_only: number; position: number; row_skip: number;
}

export type PlanogramStatus = 'draft' | 'review' | 'approved' | 'published';

export type JournalAction = 'created' | 'review' | 'approved' | 'returned' | 'published' | 'version' | 'restored';

export interface JournalEntry {
  at: string;
  version: number;
  action: JournalAction;
  note: string;
  by?: string;          // кто сделал шаг (имя вошедшего пользователя)
}

// Кому назначена планограмма: кластеры Studio и отдельные точки (outlet_id)
export interface Assign { clusters: string[]; outlets: string[] }

export interface Planogram {
  id: string;
  name: string;
  status: PlanogramStatus;
  version: number;
  market: Market;
  client: string;
  outlet: string;
  fixture: Fixture;                       // своя копия шаблона
  templateId: string | null;
  templateVersion: number | null;
  rows: Record<string, Placement[]>;      // shelfId → слева направо
  rules: {
    mustHave: string[];
    minFacings: Record<string, number>;
    shareTargets: Partial<Record<Maker, number>>;
  };
  ir: {
    twins: [string, string][];            // IR путает: подмена внутри пары — ok
    skipShelves: string[];
    costs: AlignCosts;
  };
  journal: JournalEntry[];                // согласование и версии, новые в конце
  assign: Assign;
  publishedAs: string | null;             // имя версии в IR (plg-…-vN), если опубликована
  createdAt: string;
  updatedAt: string;
}

// Сохранённая версия планограммы: снимок на момент согласования, утверждения или правки после них
export interface Snapshot {
  id: string;
  planogramId: string;
  version: number;
  status: PlanogramStatus;
  savedAt: string;
  note: string;
  data: Planogram;
}

export interface Cluster {
  id: string;
  name: string;
  outlets: string[];
  updatedAt: string;
}

// ---- Ответ IR (PlanogramReport из salesbox_contracts/planogram.py) ----

export type SlotStatus = 'ok' | 'misplaced' | 'wrong_shelf' | 'missing' | 'extra' | 'needs_review';
export type Box = [number, number, number, number];

export interface IrSlot {
  pos: number;
  status: SlotStatus;
  sku: string | null;
  expected_sku: string | null;
  expected_on_shelf?: number | null;
  conf?: number | null;
  det_id?: number | null;
  box?: Box | null;
}

export interface IrRow {
  fixture: number;
  shelf: number;
  planogram_shelf: number | null;
  box: Box;
  fill_rate: number;
  compliance: number | null;
  slots: IrSlot[];
}

export interface IrPlanogramReport {
  schema_version: string;
  photo: string;
  planogram: string;
  fixture: number;
  compliance: number | null;
  share_of_shelf: Record<string, number>;
  osa: Record<string, boolean>;
  counts: Partial<Record<SlotStatus, number>>;
  needs_review: number;
  rows: IrRow[];
}

export type Verdict = 'right' | 'wrong';

export interface IrRun {
  id: string;
  planogramId: string;
  planogramVersion: number;
  photoName: string;
  createdAt: string;
  source: 'api' | 'file';
  photoId: string | null;
  models: string;
  report: IrPlanogramReport;
  imageSize: [number, number] | null;
  verdicts: Record<string, SlotVerdict>;   // ключ — `${row}:${pos}`
}

export interface SlotVerdict {
  v: Verdict;
  truth?: SlotStatus;     // статус на самом деле, если IR ошибся
  truthSku?: string;      // какая пачка стоит на самом деле (для эталонов галереи и путаниц)
}
