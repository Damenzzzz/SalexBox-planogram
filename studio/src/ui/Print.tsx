import { useEffect, useMemo, useState } from 'react';
import { analyse } from '../domain/checks';
import { priceList } from '../domain/exports';
import { MAKERS, MAKER_ORDER } from '../domain/formats';
import { sortedShelves } from '../domain/geometry';
import { layoutRows } from '../domain/versions';
import { drawScene, sceneSize } from '../render/scene';
import { useCatalog, useStore } from '../store';
import { Icon } from './common';
import { STATUS_NAME } from './Planograms';

// Печатная схема для мерчендайзера: шкаф, раскладка по полкам, правила. «Сохранить как PDF» — из диалога печати
export function PrintView({ id }: { id: string }) {
  const p = useStore(s => s.planograms.find(q => q.id === id));
  const warn = useStore(s => s.settings.warn);
  const texRev = useStore(s => s.texRev);
  const { get } = useCatalog();
  const [img, setImg] = useState<string | null>(null);
  useEffect(() => {
    if (!p) return;
    const size = sceneSize(p.fixture);
    const S = Math.min(1, 1400 / size.h);
    const c = document.createElement('canvas');
    c.width = Math.round(size.w * S * 2); c.height = Math.round(size.h * S * 2);
    const draw = () => { drawScene(c.getContext('2d')!, { fx: p.fixture, rows: p.rows, sku: get, mode: 'texture', warn, dims: true, S, DPR: 2 }); setImg(c.toDataURL('image/png')); };
    if (document.fonts?.ready) document.fonts.ready.then(draw); else draw();
  }, [p, get, warn, texRev]);
  const a = useMemo(() => (p ? analyse(p, get) : null), [p, get]);
  if (!p || !a) return <div className="page"><p>Планограмма не найдена.</p></div>;
  const rows = layoutRows(p, get);
  const shelves = [...new Set(rows.map(r => r.shelf))].sort((x, y) => y - x);
  return (
    <div className="print-page">
      <div className="print-bar no-print">
        <a className="btn" href={`#/planogram/${p.id}`}><Icon name="back" />К редактору</a>
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="print" />Печать / PDF</button>
        <span className="hint">В диалоге печати выберите «Сохранить как PDF». Альбомная ориентация, A4.</span>
      </div>
      <header className="print-head">
        <div>
          <h1>{p.name}</h1>
          <p>Версия {p.version} · {STATUS_NAME[p.status]} · {new Date().toLocaleDateString('ru-RU')}</p>
        </div>
        <div className="print-meta">
          <span>Шкаф <b>{p.fixture.code}</b> · {p.fixture.name}</span>
          <span>{p.fixture.w}×{p.fixture.h}×{p.fixture.d} мм · {sortedShelves(p.fixture).length} полок</span>
          <span>{a.total} фейсингов · {a.placed.length} SKU{p.outlet ? ` · точка ${p.outlet}` : ''}</span>
        </div>
      </header>
      <div className="print-body">
        <figure className="print-fig">{img ? <img src={img} alt={`Шкаф ${p.fixture.code} с раскладкой`} /> : <p className="hint">Рисую шкаф…</p>}</figure>
        <div className="print-tables">
          {shelves.map(no => (
            <table key={no} className="table print-table">
              <thead><tr><th colSpan={4}>Полка {no} снизу</th></tr></thead>
              <tbody>{rows.filter(r => r.shelf === no).map(r => (
                <tr key={`${r.shelf}-${r.pos}`}><td className="mono">{r.pos}</td><td>{r.name}</td><td>{r.format}</td><td className="mono">{r.facings} ф.</td></tr>
              ))}</tbody>
            </table>
          ))}
          {p.rules.mustHave.length > 0 && <p><b>Обязательные:</b> {p.rules.mustHave.map(id => get(id)?.name ?? id).join(', ')}</p>}
          {Object.keys(p.rules.shareTargets).length > 0 && (
            <p><b>Доли по контракту:</b> {MAKER_ORDER.filter(m => p.rules.shareTargets[m]).map(m => `${MAKERS[m]} ≥ ${Math.round(p.rules.shareTargets[m]! * 100)}% (сейчас ${a.total ? Math.round((a.byMaker[m] ?? 0) / a.total * 100) : 0}%)`).join(', ')}</p>
          )}
          <p className="hint">Полки считаются снизу. Версия {p.version}.</p>
        </div>
      </div>
    </div>
  );
}

// Прайс-лист для закрытой выкладки (РК: ст. 110 Кодекса «О здоровье народа»): только текст, чёрный по белому,
// по алфавиту, с ценой, без изображений, лист не больше 40×30 см на одно место продажи. A4 — 29,7×21 см
export function PriceListView({ id }: { id: string }) {
  const p = useStore(s => s.planograms.find(q => q.id === id));
  const { get } = useCatalog();
  const [title, setTitle] = useState('Табачные изделия в продаже');
  if (!p) return <div className="page"><p>Планограмма не найдена.</p></div>;
  const { items, noPrice } = priceList(p, get);
  const fmt = new Intl.NumberFormat('ru-RU');
  return (
    <div className="print-page">
      <div className="print-bar no-print">
        <a className="btn" href={`#/planogram/${p.id}`}><Icon name="back" />К редактору</a>
        <button className="btn btn-primary" onClick={() => window.print()}><Icon name="print" />Печать / PDF</button>
        <label className="field" style={{ minWidth: 260 }}><span>Заголовок</span><input className="input" value={title} onChange={e => setTitle(e.target.value)} /></label>
      </div>
      <div className="no-print price-notes">
        <p>Лист по требованиям закрытой выкладки: только текст, чёрный по белому, по алфавиту, с ценой, без изображений и логотипов. A4 (29,7 × 21 см) укладывается в предел 40 × 30 см на одно место продажи. Печатайте без масштабирования.</p>
        {noPrice.length > 0 && <p className="chip chip-warn" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>Без цены и поэтому не в листе ({noPrice.length}): {noPrice.map(s => s.name).join(', ')}. Цену задают в «Каталоге SKU».</p>}
      </div>
      <article className="price-sheet">
        <h1>{title}</h1>
        <table>
          <thead><tr><th>Наименование</th><th>Цена, ₸</th></tr></thead>
          <tbody>{items.map(s => <tr key={s.id}><td>{s.name}</td><td>{fmt.format(s.price!)}</td></tr>)}</tbody>
        </table>
      </article>
    </div>
  );
}
