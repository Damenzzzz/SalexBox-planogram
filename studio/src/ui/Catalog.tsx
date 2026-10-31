import { useMemo, useState } from 'react';
import { makeLook } from '../domain/catalog';
import { FORMATS, FORMAT_ORDER, MAKERS, MAKER_ORDER, SEGMENTS } from '../domain/formats';
import { uid } from '../domain/geometry';
import type { FormatId, Maker, Segment, Sku, SkuPatch } from '../domain/types';
import { thumbURL } from '../render/textures';
import { useCatalog, useStore, useTech } from '../store';
import { Icon, Modal } from './common';

export function Catalog() {
  const { list } = useCatalog();
  const patches = useStore(s => s.patches);
  const tech = useTech();
  const { patchSku, resetSku, saveCustomSku, deleteCustomSku, notify } = useStore.getState();
  const [query, setQuery] = useState('');
  const [maker, setMaker] = useState<Maker | 'ALL'>('ALL');
  const [view, setView] = useState<'all' | 'guessed' | 'norefs' | 'edited'>('all');
  const [adding, setAdding] = useState(false);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list.filter(s => (maker === 'ALL' || s.maker === maker)
      && (view === 'all' || (view === 'guessed' && s.formatGuessed) || (view === 'norefs' && s.refs < 3) || (view === 'edited' && (patches[s.id] || s.custom)))
      && (!q || s.id.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)));
  }, [list, query, maker, view, patches]);

  const edit = (s: Sku, patch: SkuPatch) => {
    if (s.custom) {
      const next = { ...s, ...patch };
      if (patch.format && patch.w === undefined) { const f = FORMATS[patch.format]; Object.assign(next, { w: f.w, h: f.h, d: f.d }); }
      saveCustomSku(next);
    } else {
      if (patch.format && patch.w === undefined && !s.measured) { const f = FORMATS[patch.format]; patch = { ...patch, w: f.w, h: f.h, d: f.d }; }
      patchSku(s.id, patch);
    }
  };
  const num = (v: string) => { const n = Number(v.replace(',', '.')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };

  return (
    <div className="page" style={{ maxWidth: 1500 }}>
      <div className="page-head">
        <div>
          <h1>Каталог SKU</h1>
          <p>Сигареты, из которых собираются планограммы: производитель, сегмент, формат, размеры пачки, цена и EAN. Размеры по умолчанию справочные; после замера пачки отметьте «замер», и редактор будет считать по нему.</p>
        </div>
        <div className="actions"><button className="btn btn-primary" onClick={() => setAdding(true)}><Icon name="plus" />Свой SKU</button></div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
        <input className="input" style={{ maxWidth: 320 }} type="search" placeholder="Поиск по названию" value={query} onChange={e => setQuery(e.target.value)} aria-label="Поиск SKU" />
        <div className="filters" role="group" aria-label="Производитель">
          {(['ALL', ...MAKER_ORDER] as (Maker | 'ALL')[]).map(m => <button key={m} type="button" aria-pressed={maker === m} onClick={() => setMaker(m)}>{m === 'ALL' ? 'Все' : MAKERS[m]}</button>)}
        </div>
        <div className="filters" role="group" aria-label="Показать">
          {([['all', 'Все'], ['guessed', 'Формат не ясен'], ...(tech ? [['norefs', 'Мало эталонов']] as const : []), ['edited', 'Изменённые и свои']] as const).map(([k, v]) => <button key={k} type="button" aria-pressed={view === k} onClick={() => setView(k)}>{v}</button>)}
        </div>
        <span className="hint">{rows.length} в списке</span>
      </div>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th /><th>SKU</th><th>Производитель</th><th>Сегмент</th><th>Формат</th><th>Ш</th><th>В</th><th>Г</th><th>Замер</th><th>Цена ₸</th><th title="Продаж в неделю, пачек">Продажи/нед</th><th>EAN</th>{tech && <th>Эталоны</th>}<th /></tr></thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.id}>
                <td><img src={thumbURL(s, 1)} alt="" /></td>
                <td className="name"><b>{s.name}</b>{tech ? <div className="hint mono">{s.label ?? 'свой SKU, без IR-метки'}</div> : s.custom ? <div className="hint">свой SKU</div> : null}</td>
                <td><select className="select" value={s.maker} aria-label="Производитель" onChange={e => edit(s, { maker: e.target.value as Maker })}>{MAKER_ORDER.map(m => <option key={m} value={m}>{MAKERS[m]}</option>)}</select></td>
                <td><select className="select" value={s.segment} aria-label="Сегмент" onChange={e => edit(s, { segment: e.target.value as Segment })}>{Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></td>
                <td><select className="select" value={s.format} aria-label="Формат" onChange={e => edit(s, { format: e.target.value as FormatId })}>{FORMAT_ORDER.map(f => <option key={f} value={f}>{FORMATS[f].name}{s.formatGuessed && f === s.format ? ' ?' : ''}</option>)}</select></td>
                {(['w', 'h', 'd'] as const).map(k => (
                  <td key={k} className="w-num"><input className="input" defaultValue={s[k]} key={`${s.id}-${k}-${s[k]}`} aria-label={k}
                    onBlur={e => { const v = num(e.target.value); if (v && v !== s[k]) edit(s, { [k]: v, measured: true }); else e.target.value = String(s[k]); }} /></td>
                ))}
                <td><input type="checkbox" checked={s.measured} aria-label="Размеры сняты с пачки" onChange={e => edit(s, { measured: e.target.checked })} /></td>
                <td className="w-num"><input className="input" defaultValue={s.price ?? ''} key={`${s.id}-p-${s.price}`} aria-label="Цена" onBlur={e => edit(s, { price: num(e.target.value) })} /></td>
                <td className="w-num"><input className="input" defaultValue={s.sales ?? ''} key={`${s.id}-s-${s.sales}`} aria-label="Продаж в неделю" placeholder="—" onBlur={e => edit(s, { sales: num(e.target.value) })} /></td>
                <td style={{ width: 150 }}><input className="input mono" defaultValue={s.ean} key={`${s.id}-e-${s.ean}`} aria-label="EAN" onBlur={e => { if (e.target.value !== s.ean) edit(s, { ean: e.target.value.trim() }); }} /></td>
                {tech && <td>{s.refs === 0 ? <span className="chip chip-err">0</span> : s.refs < 3 ? <span className="chip chip-warn">{s.refs}</span> : <span className="chip chip-ok">{s.refs}</span>}</td>}
                <td>
                  {s.custom
                    ? <button className="btn btn-sm btn-ghost icon-btn" aria-label="Удалить свой SKU" onClick={() => { deleteCustomSku(s.id); notify('SKU удалён'); }}><Icon name="trash" size={14} /></button>
                    : patches[s.id] ? <button className="btn btn-sm btn-ghost" onClick={() => resetSku(s.id)}>Сбросить</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {adding && <NewSku onClose={() => setAdding(false)} onSave={s => { saveCustomSku(s); setAdding(false); notify(`${s.name} добавлен в каталог`); }} />}
    </div>
  );
}

function NewSku({ onClose, onSave }: { onClose: () => void; onSave: (s: Sku) => void }) {
  const tech = useTech();
  const [brand, setBrand] = useState('');
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [format, setFormat] = useState<FormatId>('KS');
  const [maker, setMaker] = useState<Maker>('OTH');
  const [segment, setSegment] = useState<Segment>('mid');
  const ok = brand.trim() && name.trim();
  const save = () => {
    if (!ok) return;
    const f = FORMATS[format];
    const full = name.trim().startsWith(brand.trim()) ? name.trim() : `${brand.trim()} ${name.trim()}`;
    onSave({
      id: `custom:${uid('sku')}`, label: label.trim() || null, brand: brand.trim(), name: full, maker, segment, format,
      w: f.w, h: f.h, d: f.d, measured: false, formatGuessed: false, refs: 0, price: null, ean: '', look: makeLook(brand.trim(), full), custom: true,
    });
  };
  return (
    <Modal title="Свой SKU" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Отмена</button><button className="btn btn-primary" disabled={!ok} onClick={save}>Добавить</button></>}>
      <div className="grid2">
        <label className="field"><span>Бренд</span><input className="input" value={brand} onChange={e => setBrand(e.target.value)} placeholder="Kent" /></label>
        <label className="field"><span>Название</span><input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Kent Crystal Ice SS" /></label>
        <label className="field"><span>Формат</span><select className="select" value={format} onChange={e => setFormat(e.target.value as FormatId)}>{FORMAT_ORDER.map(f => <option key={f} value={f}>{FORMATS[f].name}</option>)}</select></label>
        <label className="field"><span>Производитель</span><select className="select" value={maker} onChange={e => setMaker(e.target.value as Maker)}>{MAKER_ORDER.map(m => <option key={m} value={m}>{MAKERS[m]}</option>)}</select></label>
        <label className="field"><span>Сегмент</span><select className="select" value={segment} onChange={e => setSegment(e.target.value as Segment)}>{Object.entries(SEGMENTS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
        {tech && <label className="field"><span>IR-метка, если уже есть в галерее</span><input className="input mono" value={label} onChange={e => setLabel(e.target.value)} placeholder="Kent/Kent Crystal Ice SS" /></label>}
      </div>
      <p className="hint">Новую пачку распознавание сначала узнаёт по бренду. Чтобы оно узнавало именно эту модель, передайте инженеру IR несколько фото пачки с полки.</p>
    </Modal>
  );
}
