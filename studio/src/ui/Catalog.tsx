import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { makeLook } from '../domain/catalog';
import { download } from '../domain/io';
import { measuresTemplate, parseMeasures } from '../domain/measures';
import { FORMATS, FORMAT_ORDER, MAKERS, MAKER_ORDER, SEGMENTS, formatFromLabel, makerOf, segmentOf } from '../domain/formats';
import { uid } from '../domain/geometry';
import { packPhoto } from '../domain/packPhoto';
import type { FormatId, Maker, Segment, Sku, SkuPatch } from '../domain/types';
import { thumbURL } from '../render/textures';
import { useCatalog, useStore, useTech } from '../store';
import { Icon, Modal } from './common';

const PAGE = 60;   // строк за раз: 270 строк по 10 полей разом заметно тормозят
const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

// Правка SKU: свой — целиком, из галереи — правкой поверх. Смена формата без замера тянет размеры формата
function editSku(s: Sku, patch: SkuPatch) {
  const { saveCustomSku, patchSku } = useStore.getState();
  if (s.custom) {
    const next = { ...s, ...patch };
    if (patch.format && patch.w === undefined) { const f = FORMATS[patch.format]; Object.assign(next, { w: f.w, h: f.h, d: f.d }); }
    saveCustomSku(next);
  } else {
    if (patch.format && patch.w === undefined && !s.measured) { const f = FORMATS[patch.format]; patch = { ...patch, w: f.w, h: f.h, d: f.d }; }
    patchSku(s.id, patch);
  }
}

export function Catalog() {
  const { list } = useCatalog();
  const patches = useStore(s => s.patches);
  const tech = useTech();
  const { notify } = useStore.getState();
  const [query, setQuery] = useState('');
  const [maker, setMaker] = useState<Maker | 'ALL'>('ALL');
  const [view, setView] = useState<'all' | 'guessed' | 'norefs' | 'edited' | 'rough' | 'placed'>('all');
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const photoFor = useRef<Sku | null>(null);
  const planograms = useStore(s => s.planograms);
  const placed = useMemo(() => new Set(planograms.flatMap(p => Object.values(p.rows).flat().map(q => q.sku))), [planograms]);

  // свои SKU — сверху: только что добавленный сразу виден
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = list.filter(s => (maker === 'ALL' || s.maker === maker)
      && (view === 'all' || (view === 'guessed' && s.formatGuessed) || (view === 'norefs' && s.refs < 3) || (view === 'edited' && (patches[s.id] || s.custom))
        || (view === 'rough' && !s.measured) || (view === 'placed' && placed.has(s.id)))
      && (!q || s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
    return [...hit.filter(s => s.custom).reverse(), ...hit.filter(s => !s.custom)];
  }, [list, query, maker, view, patches, placed]);

  const onMeasures = async (f: File) => {
    try {
      const r = parseMeasures(await f.text(), list);
      const byId = new Map(list.map(s => [s.id, s]));
      r.patches.forEach(([id, patch]) => { const s = byId.get(id); if (s) editSku(s, patch); });
      notify(`Обновлено SKU: ${r.patches.length}, из них с замером: ${r.measured}${r.missing.length ? `. Не нашёл в каталоге: ${r.missing.slice(0, 5).join(', ')}${r.missing.length > 5 ? ` и ещё ${r.missing.length - 5}` : ''}` : ''}`);
    } catch (e) { notify(`Файл не прочитан: ${(e as Error).message}`); }
  };
  const roughOnShelves = list.filter(s => placed.has(s.id) && !s.measured).length;
  const askPhoto = useCallback((s: Sku) => { photoFor.current = s; photoInput.current?.click(); }, []);
  const onPhoto = async (f: File) => {
    const s = photoFor.current;
    if (!s) return;
    try { editSku(s, { photo: await packPhoto(f) }); notify(`${s.name}: фото пачки сохранено`); }
    catch { notify('Не удалось прочитать фото: нужен JPEG, PNG или WebP'); }
  };
  const filter = (fn: () => void) => { fn(); setLimit(PAGE); };

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-head">
        <div>
          <h1>Каталог SKU</h1>
          <p>Сигареты, из которых собираются планограммы: производитель, сегмент, формат, размеры пачки, цена, продажи, EAN и фото пачки. Размеры по умолчанию справочные; после замера пачки отметьте «замер». Много замеров удобнее внести таблицей: «Таблица замеров» → заполнить в Excel → «Загрузить замеры». Чтобы поставить фото пачки, нажмите на её картинку.</p>
          {roughOnShelves > 0 && <p className="hint">На шкафах {roughOnShelves} SKU без замера: проверки «не помещается» для них приблизительные.</p>}
        </div>
        <div className="actions">
          <button className="btn" onClick={() => download('замеры пачек.csv', measuresTemplate(view === 'placed' || view === 'rough' ? rows : list), 'text/csv')}><Icon name="download" />Таблица замеров</button>
          <button className="btn" onClick={() => file.current?.click()}><Icon name="upload" />Загрузить замеры</button>
          <input ref={file} type="file" accept=".csv,.txt" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onMeasures(f); e.target.value = ''; }} />
          <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onPhoto(f); e.target.value = ''; }} />
          <button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />Свой SKU</button>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 320 }} type="search" placeholder="Поиск по названию" value={query} onChange={e => filter(() => setQuery(e.target.value))} aria-label="Поиск SKU" />
        <div className="filters" role="group" aria-label="Производитель">
          {(['ALL', ...MAKER_ORDER] as (Maker | 'ALL')[]).map(m => <button key={m} type="button" aria-pressed={maker === m} onClick={() => filter(() => setMaker(m))}>{m === 'ALL' ? 'Все' : MAKERS[m]}</button>)}
        </div>
        <div className="filters" role="group" aria-label="Показать">
          {([['all', 'Все'], ['placed', 'На шкафах'], ['rough', 'Без замера'], ['guessed', 'Формат не ясен'], ...(tech ? [['norefs', 'Мало эталонов']] as const : []), ['edited', 'Изменённые и свои']] as const).map(([k, v]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => filter(() => setView(k))}>{v}</button>)}
        </div>
        <span className="hint">{rows.length} в списке{rows.length > limit ? `, показано ${limit}` : ''}</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Фото</th><th>SKU</th><th>Производитель</th><th>Сегмент</th><th>Формат</th><th>Ш</th><th>В</th><th>Г</th><th>Замер</th><th>Цена ₸</th><th title="Продаж в неделю, пачек">Продажи/нед</th><th>EAN</th>{tech && <th>Эталоны</th>}<th /></tr></thead>
          <tbody>
            {rows.slice(0, limit).map(s => <Row key={s.id} s={s} patched={!!patches[s.id]} tech={tech} onPhoto={askPhoto} />)}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <div className="more"><button className="btn" onClick={() => setLimit(l => l + PAGE * 2)}>Показать ещё {Math.min(PAGE * 2, rows.length - limit)}</button></div>}
      {adding && <NewSku onClose={() => setAdding(false)} onSave={s => {
        useStore.getState().saveCustomSku(s); setAdding(false); setView('all'); setQuery(''); setLimit(PAGE);
        notify(`${s.name} добавлен: он первый в списке`);
      }} />}
    </div>
  );
}

// Строка каталога: перерисовывается, только когда меняется её SKU
const Row = memo(function Row({ s, patched, tech, onPhoto }: { s: Sku; patched: boolean; tech: boolean; onPhoto: (s: Sku) => void }) {
  const { resetSku, deleteCustomSku, notify } = useStore.getState();
  return (
    <tr>
      <td className="photo-cell">
        <button type="button" className="thumb-btn" onClick={() => onPhoto(s)} title={s.photo ? 'Заменить фото пачки' : 'Загрузить фото пачки'} aria-label={`Фото пачки ${s.name}`}>
          <img src={thumbURL(s, 1)} alt="" loading="lazy" />{!s.photo && <span className="thumb-add"><Icon name="camera" size={12} /></span>}
        </button>
        {s.photo && <button type="button" className="btn btn-sm btn-ghost icon-btn thumb-del" aria-label="Убрать фото" title="Убрать фото" onClick={() => editSku(s, { photo: null })}><Icon name="x" size={12} /></button>}
      </td>
      <td className="name"><b>{s.name}</b>{tech ? <div className="hint mono">{s.label ?? 'свой SKU, без IR-метки'}</div> : s.custom ? <div className="hint">свой SKU</div> : null}</td>
      <td><select className="select" value={s.maker} aria-label="Производитель" onChange={e => editSku(s, { maker: e.target.value as Maker })}>{MAKER_ORDER.map(m => <option key={m} value={m}>{MAKERS[m]}</option>)}</select></td>
      <td><select className="select" value={s.segment} aria-label="Сегмент" onChange={e => editSku(s, { segment: e.target.value as Segment })}>{Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
      <td><select className="select" value={s.format} aria-label="Формат" onChange={e => editSku(s, { format: e.target.value as FormatId })}>{FORMAT_ORDER.map(f => <option key={f} value={f}>{FORMATS[f].name}{s.formatGuessed && f === s.format ? ' ?' : ''}</option>)}</select></td>
      {(['w', 'h', 'd'] as const).map(k => (
        <td key={k} className="w-num"><input className="input" defaultValue={s[k]} key={`${k}-${s[k]}`} aria-label={k}
          onBlur={e => { const v = num(e.target.value); if (v && v !== s[k]) editSku(s, { [k]: v, measured: true }); else e.target.value = String(s[k]); }} /></td>
      ))}
      <td><input type="checkbox" checked={s.measured} aria-label="Размеры сняты с пачки" onChange={e => editSku(s, { measured: e.target.checked })} /></td>
      <td className="w-num"><input className="input" defaultValue={s.price ?? ''} key={`p-${s.price}`} aria-label="Цена" onBlur={e => { const v = num(e.target.value); if (v !== s.price) editSku(s, { price: v }); }} /></td>
      <td className="w-num"><input className="input" defaultValue={s.sales ?? ''} key={`s-${s.sales}`} aria-label="Продаж в неделю" placeholder="—" onBlur={e => { const v = num(e.target.value); if (v !== (s.sales ?? null)) editSku(s, { sales: v }); }} /></td>
      <td style={{ width: 150 }}><input className="input mono" defaultValue={s.ean} key={`e-${s.ean}`} aria-label="EAN" onBlur={e => { if (e.target.value.trim() !== s.ean) editSku(s, { ean: e.target.value.trim() }); }} /></td>
      {tech && <td>{s.refs === 0 ? <span className="chip chip-err">0</span> : s.refs < 3 ? <span className="chip chip-warn">{s.refs}</span> : <span className="chip chip-ok">{s.refs}</span>}</td>}
      <td>
        {s.custom
          ? <button className="btn btn-sm btn-ghost icon-btn" aria-label="Удалить свой SKU" onClick={() => { deleteCustomSku(s.id); notify('SKU удалён'); }}><Icon name="trash" size={14} /></button>
          : patched ? <button className="btn btn-sm btn-ghost" onClick={() => resetSku(s.id)}>Сбросить</button> : null}
      </td>
    </tr>
  );
});

// Свой SKU: производитель, сегмент и формат угадываются по бренду и названию, их можно поправить
function NewSku({ onClose, onSave }: { onClose: () => void; onSave: (s: Sku) => void }) {
  const tech = useTech();
  const [brand, setBrand] = useState('');
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [touched, setTouched] = useState<{ format?: boolean; maker?: boolean; segment?: boolean }>({});
  const [chosen, setChosen] = useState<{ format: FormatId; maker: Maker; segment: Segment }>({ format: 'KS', maker: 'OTH', segment: 'mid' });
  const [price, setPrice] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const b = brand.trim(), n = name.trim();
  const full = !n ? '' : n.toLowerCase().startsWith(b.toLowerCase()) ? n : `${b} ${n}`;
  const guess = { format: full ? formatFromLabel(full, b).format : 'KS' as FormatId, maker: b ? makerOf(b) : 'OTH' as Maker, segment: b ? segmentOf(b) : 'mid' as Segment };
  const val = { format: touched.format ? chosen.format : guess.format, maker: touched.maker ? chosen.maker : guess.maker, segment: touched.segment ? chosen.segment : guess.segment };
  const set = <K extends keyof typeof val>(k: K, v: (typeof val)[K]) => { setChosen(c => ({ ...c, [k]: v })); setTouched(t => ({ ...t, [k]: true })); };
  const ok = !!b && !!n;
  const save = () => {
    if (!ok) return;
    const f = FORMATS[val.format];
    onSave({
      id: `custom:${uid('sku')}`, label: label.trim() || null, brand: b, name: full, maker: val.maker, segment: val.segment, format: val.format,
      w: f.w, h: f.h, d: f.d, measured: false, formatGuessed: false, refs: 0, price: num(price), ean: '', look: makeLook(b, full), custom: true, photo,
    });
  };
  return (
    <Modal title="Свой SKU" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-primary" disabled={!ok} onClick={save}>Добавить</button></>}>
      <div className="grid2">
        <label className="field"><span>Бренд</span><input className="input" autoFocus value={brand} onChange={e => setBrand(e.target.value)} placeholder="Kent" /></label>
        <label className="field"><span>Название</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Crystal Ice SS" /></label>
        <label className="field"><span>Формат{!touched.format && full ? ' · по названию' : ''}</span><select className="select" value={val.format} onChange={e => set('format', e.target.value as FormatId)}>{FORMAT_ORDER.map(f => <option key={f} value={f}>{FORMATS[f].name}</option>)}</select></label>
        <label className="field"><span>Производитель{!touched.maker && b ? ' · по бренду' : ''}</span><select className="select" value={val.maker} onChange={e => set('maker', e.target.value as Maker)}>{MAKER_ORDER.map(m => <option key={m} value={m}>{MAKERS[m]}</option>)}</select></label>
        <label className="field"><span>Сегмент</span><select className="select" value={val.segment} onChange={e => set('segment', e.target.value as Segment)}>{Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        <label className="field"><span>Цена, ₸</span><input className="input" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} placeholder="необязательно" /></label>
        {tech && <label className="field"><span>IR-метка, если уже есть в галерее</span><input className="input mono" value={label} onChange={e => setLabel(e.target.value)} placeholder="Kent/Kent Crystal Ice SS" /></label>}
      </div>
      <div className="field"><span>Фото пачки</span>
        <div className="new-sku-photo">
          {photo ? <img src={photo} alt="Фото пачки" /> : <span className="hint">не выбрано</span>}
          <label className="btn btn-sm"><Icon name="camera" size={15} />{photo ? 'Заменить' : 'Выбрать фото'}
            <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async e => { const f = e.target.files?.[0]; if (f) setPhoto(await packPhoto(f).catch(() => null)); e.target.value = ''; }} /></label>
          {photo && <button className="btn btn-sm btn-ghost" onClick={() => setPhoto(null)}>Убрать</button>}
        </div>
      </div>
      {full && <p className="hint">Будет добавлен как <b>{full}</b>.</p>}
      <p className="hint">Новую пачку распознавание сначала узнаёт по бренду. Чтобы оно узнавало именно эту модель, передайте инженеру IR несколько фото пачки с полки.</p>
    </Modal>
  );
}
