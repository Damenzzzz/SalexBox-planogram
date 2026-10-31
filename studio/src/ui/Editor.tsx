import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { analyse, visibleIssues, type Analysis, type Issue } from '../domain/checks';
import { FORMATS, FORMAT_ORDER, MAKERS, MAKER_ORDER, SEGMENTS } from '../domain/formats';
import { clampShelfY, clearanceOf, compactFixture, innerW, laneOf, packFloor, packsDeep, shelfIndex, shelvesTopDown, sortedShelves, uid, usedWidth } from '../domain/geometry';
import { planogramSheets } from '../domain/exports';
import { download, toBundle } from '../domain/io';
import { fileName, irName, toIrYaml, zonesOf } from '../domain/irExport';
import type { AlignCosts, FormatId, Maker, Placement, Planogram, Sku } from '../domain/types';
import { needsNewVersion, nextVersion } from '../domain/versions';
import { XLSX_TYPE, downloadBytes, xlsx } from '../domain/xlsx';
import { thumbURL } from '../render/textures';
import { MARGIN, drawScene, sceneSize, type HitRect } from '../render/scene';
import { go, useCatalog, useStore, useTech } from '../store';
import { Icon, Menu, NumField, Seg, Stage, facingsWord, pct, useHistory, type StageHandle } from './common';
import { AutoModal, FitModal, VersionsPanel, WorkflowBar } from './Workflow';

type Mode = 'texture' | 'schema' | 'ir';
type DragState = { id: string | null; sku: string; sx: number; sy: number; moved: boolean; target: { shelfId: string; idx: number; mm: number } | null };

export function Editor({ id }: { id: string }) {
  const p = useStore(s => s.planograms.find(q => q.id === id));
  if (!p) return <div className="page"><div className="empty"><p>Планограмма не найдена.</p><a className="btn" href="#/planograms">К списку</a></div></div>;
  return <EditorView p={p} />;
}

function EditorView({ p }: { p: Planogram }) {
  const { list, get } = useCatalog();
  const settings = useStore(s => s.settings);
  const template = useStore(s => (p.templateId ? s.fixtures.find(f => f.id === p.templateId) : undefined));
  const { savePlanogram, setSettings, notify } = useStore.getState();
  const tech = useTech();
  const fx = p.fixture;
  const stage = useRef<StageHandle>(null);
  const [mode, setMode] = useState<Mode>('texture');
  const [dims, setDims] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [selP, setSelP] = useState<string | null>(null);
  const [selS, setSelS] = useState<string>(() => shelvesTopDown(fx)[0]?.id ?? '');
  const [hover, setHover] = useState<string | null>(null);
  const [tab, setTab] = useState<'props' | 'rules' | 'ir' | 'versions'>('props');
  const [tool, setTool] = useState<null | 'fit' | 'auto'>(null);
  const [query, setQuery] = useState('');
  const [maker, setMaker] = useState<Maker | 'ALL'>('ALL');
  const [format, setFormat] = useState<FormatId | 'ALL'>('ALL');
  const [onlyPlaced, setOnlyPlaced] = useState(false);
  const [limit, setLimit] = useState(60);
  const [drag, setDragView] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [showBottom, setShowBottom] = useState(true);
  const [tip, setTip] = useState<{ x: number; y: number; html: { name: string; meta: string } } | null>(null);
  const ghost = useRef<HTMLImageElement>(null);

  const apply = useCallback((v: Planogram) => savePlanogram(v), [savePlanogram]);
  const hist = useHistory(p.id, p, apply);
  const { commit } = hist;
  // Правка не черновика начинает новую версию: прежняя остаётся снимком в «Версиях»
  const update = useCallback((fn: (q: Planogram) => void) => {
    let base = p;
    if (needsNewVersion(p)) {
      const { next: bumped, snapshot } = nextVersion(p);
      const st = useStore.getState();
      if (!st.snapshots.some(v => v.planogramId === p.id && v.version === p.version)) st.saveSnapshot(snapshot);
      base = bumped;
      notify(`Начата версия ${bumped.version}: v${p.version} сохранена в «Версиях» без изменений`);
    }
    const next = structuredClone(base);
    fn(next);
    commit(next);
  }, [p, commit, notify]);

  const a = useMemo(() => analyse(p, get), [p, get]);

  const find = (pid: string) => {
    for (const [sid, row] of Object.entries(p.rows)) {
      const i = row.findIndex(q => q.id === pid);
      if (i >= 0) return { sid, i, pl: row[i] };
    }
    return null;
  };

  // вставка с слиянием одинаковых соседей
  const insert = (q: Planogram, sid: string, idx: number, sku: string, facings: number) => {
    const row = q.rows[sid] ?? (q.rows[sid] = []);
    const left = row[idx - 1], right = row[idx];
    if (left && left.sku === sku) { left.facings += facings; return left.id; }
    if (right && right.sku === sku) { right.facings += facings; return right.id; }
    const pl: Placement = { id: uid('pl'), sku, facings };
    row.splice(idx, 0, pl);
    return pl.id;
  };
  const shelfWithRoom = (q: Planogram, sku: Sku) => {
    let best = selS, room = -Infinity;
    shelvesTopDown(q.fixture).forEach(sh => {
      if (sku.h > clearanceOf(q.fixture, sh)) return;
      const r = innerW(q.fixture) - usedWidth(q.fixture, sh, q.rows[sh.id] ?? [], get);
      if (r > room) { room = r; best = sh.id; }
    });
    return best;
  };
  const addSku = (skuId: string, sid = selS, idx?: number, facings = 2) => {
    const s = get(skuId); if (!s) return;
    let newId = '';
    update(q => { newId = insert(q, sid, idx ?? (q.rows[sid]?.length ?? 0), skuId, facings); });
    setSelP(newId); setSelS(sid);
    notify(`${s.name} · ${facings} ${facingsWord(facings)} на полку ${shelfIndex(fx, sid).fromBottom}`);
  };
  const move = (pid: string, sid: string, idx: number) => {
    const f = find(pid); if (!f) return;
    let newId = pid;
    update(q => {
      const row = q.rows[f.sid];
      const [pl] = row.splice(f.i, 1);
      let k = idx;
      if (f.sid === sid && f.i < idx) k--;
      newId = insert(q, sid, k, pl.sku, pl.facings);
    });
    setSelP(newId); setSelS(sid);
  };
  const facings = (d: number) => {
    const f = selP && find(selP); if (!f) return;
    update(q => {
      const pl = q.rows[f.sid][f.i];
      pl.facings += d;
      if (pl.facings <= 0) q.rows[f.sid].splice(f.i, 1);
    });
    if (f.pl.facings + d <= 0) setSelP(null);
  };
  const shift = (d: number) => {
    const f = selP && find(selP); if (!f) return;
    const j = f.i + d;
    if (j < 0 || j >= p.rows[f.sid].length) return;
    update(q => { const row = q.rows[f.sid]; [row[f.i], row[j]] = [row[j], row[f.i]]; });
  };
  const shiftShelf = (d: number) => {
    const f = selP && find(selP); if (!f) return;
    const top = shelvesTopDown(fx);
    const k = top.findIndex(s => s.id === f.sid) + d;
    if (k < 0 || k >= top.length) return;
    move(f.pl.id, top[k].id, Math.min(f.i, p.rows[top[k].id]?.length ?? 0));
  };
  const remove = () => {
    const f = selP && find(selP); if (!f) return;
    update(q => { q.rows[f.sid].splice(f.i, 1); });
    setSelP(null);
  };

  // ---- перетаскивание: из каталога и по холсту ----
  const targetAt = (clientX: number, clientY: number) => {
    const st = stage.current; if (!st) return null;
    const { inside, hit, hits } = st.locate(clientX, clientY);
    if (!inside || !hit || (hit.kind !== 'placement' && hit.kind !== 'shelf')) return null;
    const sid = hit.shelfId;
    const S = st.scale();
    const pls = hits.filter((h): h is HitRect => h.kind === 'placement' && h.shelfId === sid).sort((x, y) => x.x0 - y.x0);
    const { x } = st.locate(clientX, clientY);
    let idx = pls.length;
    for (let i = 0; i < pls.length; i++) if (x < (pls[i].x0 + pls[i].x1) / 2) { idx = i; break; }
    const sh = fx.shelves.find(s => s.id === sid)!;
    const mm = idx < pls.length ? pls[idx].x0 / S - MARGIN.l - fx.side : usedWidth(fx, sh, p.rows[sid] ?? [], get);
    return { shelfId: sid, idx, mm };
  };
  // Обработчики окна живут дольше рендера, поэтому берут свежие функции из ref
  const latest = useRef({ move, addSku, targetAt });
  latest.current = { move, addSku, targetAt };
  const startDrag = (d: DragState) => {
    dragRef.current = d;
    const mv = (e: PointerEvent) => {
      const cur = dragRef.current; if (!cur) return;
      const moved = cur.moved || Math.hypot(e.clientX - cur.sx, e.clientY - cur.sy) > 5;
      if (ghost.current && moved) {
        const s = get(cur.sku), S = stage.current?.scale() ?? 0.5;
        ghost.current.hidden = false;
        if (s) { ghost.current.src = thumbURL(s); ghost.current.style.width = `${s.w * S * 1.1}px`; }
        ghost.current.style.transform = `translate(${e.clientX + 8}px, ${e.clientY + 8}px)`;
      }
      dragRef.current = { ...cur, moved, target: moved ? latest.current.targetAt(e.clientX, e.clientY) : null };
      if (moved) setDragView(dragRef.current);
    };
    const up = () => {
      window.removeEventListener('pointermove', mv);
      const cur = dragRef.current;
      dragRef.current = null;
      setDragView(null);
      if (ghost.current) ghost.current.hidden = true;
      if (cur?.moved && cur.target) {
        if (cur.id) latest.current.move(cur.id, cur.target.shelfId, cur.target.idx);
        else latest.current.addSku(cur.sku, cur.target.shelfId, cur.target.idx);
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up, { once: true });
  };

  const onKey = (e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); return; }
    if (!selP) return;
    const map: Record<string, () => void> = {
      ArrowLeft: () => shift(-1), ArrowRight: () => shift(1), ArrowUp: () => shiftShelf(-1), ArrowDown: () => shiftShelf(1),
      '+': () => facings(1), '=': () => facings(1), '-': () => facings(-1), Delete: remove, Backspace: remove, Escape: () => setSelP(null),
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };

  const fixIssue = (i: Issue) => {
    if (i.addSku) {
      const s = get(i.addSku); if (!s) { notify('Этого SKU нет в каталоге'); return; }
      const sid = shelfWithRoom(p, s);
      addSku(i.addSku, sid);
    } else if (i.placementId) { setSelP(i.placementId); const f = find(i.placementId); if (f) setSelS(f.sid); setTab('props'); }
    else if (i.skuId) { const f = Object.entries(p.rows).flatMap(([sid, r]) => r.map(pl => ({ sid, pl }))).find(x => x.pl.sku === i.skuId); if (f) { setSelP(f.pl.id); setSelS(f.sid); setTab('props'); } }
    else if (i.shelfId) { setSelP(null); setSelS(i.shelfId); setTab('props'); }
  };

  const updateFromTemplate = () => {
    if (!template) return;
    update(q => {
      const oldTop = shelvesTopDown(q.fixture);
      const nf = structuredClone(template);
      const newTop = shelvesTopDown(nf);
      const rows: Planogram['rows'] = {};
      newTop.forEach((sh, i) => { rows[sh.id] = q.rows[oldTop[i]?.id] ?? []; });
      oldTop.slice(newTop.length).forEach(sh => { const last = newTop[newTop.length - 1]; if (last) rows[last.id].push(...(q.rows[sh.id] ?? [])); });
      q.fixture = nf; q.rows = rows; q.templateVersion = template.version;
      q.ir.skipShelves = [];
    });
    setSelS(shelvesTopDown(template)[0]?.id ?? '');
    setSelP(null);
    notify('Шкаф обновлён из шаблона. Полки сопоставлены сверху вниз');
  };

  // ---- каталог ----
  const filtered = useMemo(() => {
    const qq = query.trim().toLowerCase();
    return list.filter(s => (maker === 'ALL' || s.maker === maker) && (format === 'ALL' || s.format === format)
      && (!onlyPlaced || a.facings[s.id]) && (!qq || s.id.toLowerCase().includes(qq) || s.name.toLowerCase().includes(qq)));
  }, [list, query, maker, format, onlyPlaced, a.facings]);

  const selected = selP ? find(selP) : null;
  const selSku = selected ? get(selected.pl.sku) : undefined;
  const selShelf = fx.shelves.find(s => s.id === (selected?.sid ?? selS));
  const yaml = tab === 'ir' && tech ? toIrYaml(p, get) : '';
  const outdated = template && p.templateVersion != null && template.version > p.templateVersion;

  return (
    <div className="workspace">
      <div className="toolbar">
        <div className="title">
          <a className="btn btn-ghost icon-btn" href="#/planograms" aria-label="К списку планограмм"><Icon name="back" /></a>
          <span className="code">{fx.code}</span>
          <input aria-label="Название планограммы" value={p.name} onChange={e => savePlanogram({ ...p, name: e.target.value })} />
          <WorkflowBar p={p} get={get} />
        </div>
        <button className="btn icon-btn" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Отменить" title="Отменить (⌘Z)"><Icon name="undo" /></button>
        <button className="btn icon-btn" onClick={hist.redo} disabled={!hist.canRedo} aria-label="Повторить" title="Повторить (⇧⌘Z)"><Icon name="redo" /></button>
        <span className="sep" />
        <Menu label="Авто" icon="wand" items={[
          { label: 'Разложить по правилам', icon: 'wand', hint: 'доли, must-have, блоки брендов', onClick: () => setTool('auto') },
          { label: 'Подогнать под другой шкаф', icon: 'cabinet', hint: 'новая планограмма на другом размере', onClick: () => setTool('fit') },
        ]} />
        <Menu label="Выгрузить" icon="download" items={[
          ...(tech ? [{ label: 'YAML для IR', icon: 'file', hint: 'файл планограммы для распознавания', onClick: () => download(`${irName(p)}.yaml`, toIrYaml(p, get), 'text/yaml') }] : []),
          { label: 'Excel', icon: 'grid', hint: 'раскладка, сводка, правила, проверки', onClick: () => downloadBytes(`${fileName(p)}.xlsx`, xlsx(planogramSheets(p, get)), XLSX_TYPE) },
          { label: 'Картинка PNG', icon: 'image', onClick: () => exportPng(p, get, settings.warn) },
          { label: 'Печать и PDF', icon: 'print', hint: 'схема для мерчендайзера', onClick: () => window.open(`#/print/${p.id}`, '_blank') },
          { label: 'Прайс-лист', icon: 'print', hint: 'закрытая выкладка, только текст', onClick: () => window.open(`#/pricelist/${p.id}`, '_blank') },
          null,
          { label: 'JSON Studio', icon: 'download', onClick: () => {
            const used = [...new Set(Object.values(p.rows).flat().map(q => q.sku))].map(get).filter((s): s is Sku => !!s);
            download(`${fileName(p)}.json`, JSON.stringify(toBundle([p], [], used), null, 2));
          } },
        ]} />
        <button className="btn btn-primary" onClick={() => go(`compare/${p.id}`)}><Icon name="scan" />Сверка</button>
      </div>

      <div className="split">
        {/* каталог */}
        <aside className="pane pane-l">
          <div className="pane-head">
            <h2>Каталог · {filtered.length}</h2>
            <input className="input" type="search" placeholder="Поиск: Esse, Kent Nano…" value={query} onChange={e => { setQuery(e.target.value); setLimit(60); }} aria-label="Поиск SKU" />
            <div className="filters" role="group" aria-label="Производитель">
              {(['ALL', ...MAKER_ORDER] as (Maker | 'ALL')[]).map(m => (
                <button key={m} type="button" aria-pressed={maker === m} onClick={() => setMaker(m)}>{m === 'ALL' ? 'Все' : MAKERS[m]}</button>
              ))}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: 8 }}>
              <select className="select" aria-label="Формат" value={format} onChange={e => setFormat(e.target.value as FormatId | 'ALL')}>
                <option value="ALL">Любой формат</option>
                {FORMAT_ORDER.map(f => <option key={f} value={f}>{FORMATS[f].name}</option>)}
              </select>
              <label className="check"><input type="checkbox" checked={onlyPlaced} onChange={e => setOnlyPlaced(e.target.checked)} />на шкафу</label>
            </div>
          </div>
          <div className="pane-scroll">
            <ul className="sku-list" aria-label="SKU: перетащите на полку или нажмите плюс">
              {filtered.slice(0, limit).map(s => (
                <li key={s.id} className="sku-item"
                  onPointerDown={e => { if ((e.target as HTMLElement).closest('button') || e.button !== 0) return; e.preventDefault(); startDrag({ id: null, sku: s.id, sx: e.clientX, sy: e.clientY, moved: false, target: null }); }}>
                  <img src={thumbURL(s)} alt="" draggable={false} />
                  <div style={{ minWidth: 0 }}>
                    <b title={s.id}>{s.name}</b>
                    <span className="sub">
                      {MAKERS[s.maker]} · {FORMATS[s.format].name}
                      {tech && (s.refs === 0 ? <span className="chip chip-err">нет эталонов</span> : s.refs < 3 ? <span className="chip chip-warn">IR {s.refs} эт.</span> : <span className="chip chip-ok">IR {s.refs} эт.</span>)}
                      {a.facings[s.id] ? <span className="mono">{a.facings[s.id]} ф.</span> : null}
                    </span>
                  </div>
                  <button className="btn btn-sm icon-btn" aria-label={`Добавить ${s.name} на полку ${shelfIndex(fx, selS).fromBottom}`} title={`На полку ${shelfIndex(fx, selS).fromBottom}`} onClick={() => addSku(s.id)}><Icon name="plus" size={15} /></button>
                </li>
              ))}
            </ul>
            {filtered.length > limit && <div className="more"><button className="btn btn-sm" onClick={() => setLimit(l => l + 80)}>Показать ещё {Math.min(80, filtered.length - limit)}</button></div>}
            {!filtered.length && <p className="hint" style={{ padding: 14 }}>Ничего не нашлось. Сбросьте фильтры или добавьте SKU в разделе «Каталог SKU».</p>}
          </div>
        </aside>

        {/* холст */}
        <div className="center">
          {outdated && (
            <div className="banner">Шаблон {template!.code} изменился: версия {p.templateVersion} → {template!.version}.
              <button className="btn btn-sm btn-primary" onClick={updateFromTemplate}>Обновить шкаф</button>
              <button className="btn btn-sm" onClick={() => update(q => { q.templateVersion = template!.version; })}>Оставить как есть</button></div>
          )}
          <div className="canvas-bar">
            <Seg<Mode> label="Режим холста" value={mode} options={[['texture', 'Текстура'], ['schema', 'Схема'], ['ir', 'IR-вид']]} onChange={setMode} />
            <label className="check"><input type="checkbox" checked={settings.warn} onChange={e => setSettings({ warn: e.target.checked })} />Предупреждения</label>
            <label className="check"><input type="checkbox" checked={dims} onChange={e => setDims(e.target.checked)} />Размеры</label>
            {mode === 'schema' && <span className="legend">{Object.entries(SEGMENTS).map(([k, v], i) => <span key={k}><i style={{ background: `var(--seg-${i + 1})` }} />{v}</span>)}</span>}
            {mode === 'ir' && <span className="legend"><span><i style={{ border: '1.5px solid var(--st-ok)' }} />бокс</span><span><i style={{ border: '1.5px dashed var(--ir)' }} />зона распознавания</span><span><i style={{ background: 'var(--ir)' }} />зона бренда</span></span>}
            <span className="grow" />
            <button className="btn btn-sm" aria-expanded={showBottom} onClick={() => setShowBottom(v => !v)}>Проверки · {visibleIssues(a, tech).length}</button>
            <button className="btn btn-sm icon-btn" aria-label="Отдалить" onClick={() => setZoom(z => Math.max(0.5, z / 1.25))}><Icon name="minus" size={15} /></button>
            <button className="btn btn-sm" onClick={() => setZoom(1)}>Весь шкаф</button>
            <button className="btn btn-sm icon-btn" aria-label="Приблизить" onClick={() => setZoom(z => Math.min(3, z * 1.25))}><Icon name="plus" size={15} /></button>
          </div>
          <Stage
            ref={stage}
            zoom={zoom}
            label="Холст планограммы. Выберите блок пачек, затем стрелки двигают его, плюс и минус меняют фейсинги"
            cursor={hover ? 'grab' : 'default'}
            scene={{
              fx, rows: p.rows, sku: get, mode, warn: settings.warn, dims, selPlacement: selP, selShelf: selS, hover,
              caret: drag?.moved && drag.target ? { shelfId: drag.target.shelfId, mm: drag.target.mm } : null,
              skip: p.ir.skipShelves, zones: sid => zonesOf(fx, sid, p.rows[sid] ?? [], get),
            }}
            onKeyDown={onKey}
            onPointerDown={(e, _pt, hit) => {
              if (e.button !== 0) return;
              if (hit?.kind === 'placement') {
                setSelP(hit.id); setSelS(hit.shelfId); setTab('props');
                const f = find(hit.id);
                if (f) { e.preventDefault(); startDrag({ id: hit.id, sku: f.pl.sku, sx: e.clientX, sy: e.clientY, moved: false, target: null }); }
              } else if (hit?.kind === 'shelf') { setSelP(null); setSelS(hit.shelfId); }
              else setSelP(null);
            }}
            onPointerMove={(e, _pt, hit) => {
              if (drag) { setTip(null); return; }
              const hid = hit?.kind === 'placement' ? hit.id : null;
              if (hid !== hover) setHover(hid);
              const f = hid ? find(hid) : null;
              const s = f ? get(f.pl.sku) : undefined;
              setTip(s && f ? { x: e.clientX, y: e.clientY, html: { name: s.name, meta: `${FORMATS[s.format].name} · ${f.pl.facings} ф.${s.price ? ` · ${s.price} ₸` : ''}` } } : null);
            }}
            onPointerLeave={() => { setHover(null); setTip(null); }}
          />
          {showBottom ? <Bottom p={p} a={a} tech={tech} onFix={fixIssue} /> : <div />}
        </div>

        {/* инспектор */}
        <aside className="pane pane-r">
          <div className="pane-head">
            <Seg label="Панель" value={tab} options={[['props', 'Свойства'], ['rules', 'Правила'], ['ir', 'Проверка'], ['versions', 'Версии']]} onChange={setTab} />
          </div>
          <div className="pane-scroll">
            {tab === 'props' && (selected && selSku && selShelf ? (
              <section className="section">
                <div className="insp-head">
                  <img src={thumbURL(selSku, 2.2, settings.warn)} alt={selSku.name} />
                  <div>
                    <p className="eyebrow">Полка {shelfIndex(fx, selected.sid).fromBottom}{tech ? ` · IR-ряд ${shelfIndex(fx, selected.sid).irRow}` : ''} · позиция {selected.i + 1}</p>
                    <h4>{selSku.name}</h4>
                    <p className="hint">{MAKERS[selSku.maker]} · {SEGMENTS[selSku.segment]}{selSku.price ? ` · ${selSku.price} ₸` : ''}</p>
                  </div>
                </div>
                <div className="stepper" role="group" aria-label="Фейсинги">
                  <button className="btn icon-btn" aria-label="Убрать фейсинг" onClick={() => facings(-1)}><Icon name="minus" /></button>
                  <output aria-live="polite"><b>{selected.pl.facings}</b> {facingsWord(selected.pl.facings)}</output>
                  <button className="btn icon-btn" aria-label="Добавить фейсинг" onClick={() => facings(1)}><Icon name="plus" /></button>
                </div>
                <dl className="kv">
                  <dt>Формат</dt><dd>{FORMATS[selSku.format].name}{selSku.formatGuessed ? ' (предположение)' : ''}</dd>
                  <dt>Пачка Ш×В×Г</dt><dd>{selSku.w}×{selSku.h}×{selSku.d} мм{selSku.measured ? '' : ' ≈'}</dd>
                  <dt>Ряд толкателя</dt><dd>{laneOf(fx, selShelf, selSku)} мм</dd>
                  <dt>Занимает</dt><dd>{laneOf(fx, selShelf, selSku) * selected.pl.facings} мм</dd>
                  <dt>Вглубь</dt><dd>{packsDeep(fx, selShelf, selSku)} пачек в ряду</dd>
                  {tech && <><dt>IR-метка</dt><dd className="mono">{selSku.label ?? '— нет в галерее'}</dd>
                  <dt>Эталонов</dt><dd>{selSku.refs} {selSku.refs >= 3 ? <span className="chip chip-ok">готов</span> : selSku.refs ? <span className="chip chip-warn">мало</span> : <span className="chip chip-err">не узнает</span>}</dd></>}
                </dl>
                <div className="row-actions">
                  <button className="btn btn-sm" onClick={() => shift(-1)} aria-label="Сдвинуть влево"><Icon name="arrowLeft" size={15} /></button>
                  <button className="btn btn-sm" onClick={() => shift(1)} aria-label="Сдвинуть вправо"><Icon name="arrowRight" size={15} /></button>
                  <button className="btn btn-sm" onClick={() => shiftShelf(-1)} aria-label="На полку выше"><Icon name="arrowUp" size={15} /></button>
                  <button className="btn btn-sm" onClick={() => shiftShelf(1)} aria-label="На полку ниже"><Icon name="arrowDown" size={15} /></button>
                  <button className="btn btn-sm btn-danger" onClick={remove}><Icon name="trash" size={15} />Убрать</button>
                </div>
                <label className="check"><input type="checkbox" checked={p.rules.mustHave.includes(selSku.id)}
                  onChange={e => update(q => {
                    q.rules.mustHave = e.target.checked ? [...q.rules.mustHave, selSku.id] : q.rules.mustHave.filter(x => x !== selSku.id);
                    if (e.target.checked) q.rules.minFacings[selSku.id] ??= 2; else delete q.rules.minFacings[selSku.id];
                  })} />Обязательный SKU (must-have)</label>
              </section>
            ) : selShelf ? (
              <section className="section">
                <p className="eyebrow">Полка {shelfIndex(fx, selShelf.id).fromBottom} снизу{tech ? ` · IR-ряд ${shelfIndex(fx, selShelf.id).irRow}` : ''}</p>
                <h4 style={{ fontSize: 15 }}>{fx.name} {fx.code}</h4>
                <dl className="kv">
                  <dt>Высота от пола</dt><dd>{Math.round(packFloor(fx, selShelf))} мм</dd>
                  <dt>Просвет</dt><dd>{Math.round(clearanceOf(fx, selShelf))} мм</dd>
                  <dt>Занято</dt><dd>{usedWidth(fx, selShelf, p.rows[selShelf.id] ?? [], get)} из {innerW(fx)} мм</dd>
                  <dt>Фейсингов</dt><dd>{(p.rows[selShelf.id] ?? []).reduce((x, q) => x + q.facings, 0)}</dd>
                </dl>
                <label className="check"><input type="checkbox" checked={p.ir.skipShelves.includes(selShelf.id)}
                  onChange={e => update(q => { q.ir.skipShelves = e.target.checked ? [...q.ir.skipShelves, selShelf.id] : q.ir.skipShelves.filter(x => x !== selShelf.id); })} />Не проверять эту полку по фото</label>
                <div className="row-actions">
                  <button className="btn btn-sm btn-danger" disabled={!(p.rows[selShelf.id] ?? []).length} onClick={() => update(q => { q.rows[selShelf.id] = []; })}><Icon name="trash" size={15} />Очистить полку</button>
                  {template && <a className="btn btn-sm" href={`#/fixture/${template.id}`}><Icon name="cabinet" size={15} />Шаблон шкафа</a>}
                </div>
                <p className="hint">Нажмите на блок пачек, чтобы менять фейсинги, или перетащите SKU из каталога. Клавиши: ← → двигают блок, ↑ ↓ меняют полку, + − фейсинги, ⌘Z отмена.</p>
              </section>
            ) : null)}
            {tab === 'props' && !selected && selShelf && <FixtureSize p={p} shelfId={selShelf.id} get={get} update={update} />}

            {tab === 'rules' && <Rules p={p} update={update} get={get} placed={a.placed} />}

            {tab === 'versions' && <VersionsPanel p={p} get={get} onRestore={next => { commit(next); notify(`Версия ${next.version}: раскладка восстановлена`); }} />}

            {tab === 'ir' && <PhotoCheck p={p} yaml={yaml} tech={tech} update={update} onCompare={() => go(`compare/${p.id}`)} />}
          </div>
        </aside>
      </div>
      {tool === 'fit' && <FitModal p={p} get={get} onClose={() => setTool(null)} />}
      {tool === 'auto' && <AutoModal p={p} get={get} list={list} onClose={() => setTool(null)} onApply={next => { update(q => { q.rows = next.rows; }); notify('Разложено по правилам. Отменить — ⌘Z'); }} />}
      <img ref={ghost} className="ghost" alt="" hidden />
      {tip && <div className="tip" style={{ transform: `translate(${tip.x + 14}px, ${tip.y + 14}px)` }}><b>{tip.html.name}</b><span>{tip.html.meta}</span></div>}
    </div>
  );
}

function Rules({ p, update, get, placed }: { p: Planogram; update: (fn: (q: Planogram) => void) => void; get: (id: string) => Sku | undefined; placed: string[] }) {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const options = placed.map(id => get(id)).filter((s): s is Sku => !!s).sort((x, y) => x.name.localeCompare(y.name));
  return (
    <>
      <section className="section">
        <h3>Обязательные SKU и минимум фейсингов</h3>
        {!p.rules.mustHave.length && <p className="hint">Пока нет. Отметьте SKU в «Свойствах» или выберите ниже.</p>}
        {p.rules.mustHave.map(id => (
          <div key={id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 96px 28px', gap: 6, alignItems: 'center' }}>
            <span style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={id}>{get(id)?.name ?? id}</span>
            <NumField value={p.rules.minFacings[id] ?? 1} unit="ф." step={1} min={1} max={40} label={`Минимум фейсингов ${get(id)?.name ?? id}`} onChange={v => update(q => { q.rules.minFacings[id] = v!; })} />
            <button className="btn btn-sm btn-ghost icon-btn" aria-label="Убрать из обязательных" onClick={() => update(q => { q.rules.mustHave = q.rules.mustHave.filter(x => x !== id); delete q.rules.minFacings[id]; })}><Icon name="x" size={14} /></button>
          </div>
        ))}
        <select className="select" value="" aria-label="Добавить обязательный SKU" onChange={e => { const id = e.target.value; if (id) update(q => { if (!q.rules.mustHave.includes(id)) q.rules.mustHave.push(id); q.rules.minFacings[id] ??= 2; }); }}>
          <option value="">+ добавить из стоящих на шкафу</option>
          {options.filter(s => !p.rules.mustHave.includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </section>
      <section className="section">
        <h3>Доли полки по контракту</h3>
        {MAKER_ORDER.filter(m => m !== 'OTH').map(m => (
          <div key={m} style={{ display: 'grid', gridTemplateColumns: '90px minmax(0,1fr)', gap: 8, alignItems: 'center' }}>
            <span>{MAKERS[m]}</span>
            <NumField value={p.rules.shareTargets[m] != null ? Math.round(p.rules.shareTargets[m]! * 100) : null} allowNull unit="%" step={1} min={0} max={100} placeholder="без цели" label={`Цель доли ${MAKERS[m]}`}
              onChange={v => update(q => { if (v == null || v === 0) delete q.rules.shareTargets[m]; else q.rules.shareTargets[m] = v / 100; })} />
          </div>
        ))}
      </section>
      <section className="section">
        <h3>Похожие пачки</h3>
        <p className="hint">Пары, которые распознавание может перепутать. Если они поменялись местами, проверка по фото не считает это ошибкой, а редактор предупредит, если они стоят рядом.</p>
        {p.ir.twins.map(([x, y], i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 28px', gap: 6, alignItems: 'center', fontSize: 13 }}>
            <span>{get(x)?.name ?? x} ↔ {get(y)?.name ?? y}</span>
            <button className="btn btn-sm btn-ghost icon-btn" aria-label="Убрать пару" onClick={() => update(q => { q.ir.twins.splice(i, 1); })}><Icon name="x" size={14} /></button>
          </div>
        ))}
        <div className="grid2">
          <select className="select" value={a} onChange={e => setA(e.target.value)} aria-label="Первый SKU пары"><option value="">SKU 1</option>{options.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select className="select" value={b} onChange={e => setB(e.target.value)} aria-label="Второй SKU пары"><option value="">SKU 2</option>{options.filter(s => s.id !== a).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        </div>
        <button className="btn btn-sm" disabled={!a || !b || a === b} onClick={() => { update(q => { q.ir.twins.push([a, b]); }); setA(''); setB(''); }}><Icon name="plus" size={15} />Добавить пару</button>
      </section>
    </>
  );
}

function Bottom({ p, a, tech, onFix }: { p: Planogram; a: Analysis; tech: boolean; onFix: (i: Issue) => void }) {
  const sev: Record<Issue['sev'], string> = { error: 'Ошибка', contract: 'Контракт', ir: 'Фото', info: 'Заметка' };
  const must = p.rules.mustHave.filter(id => a.facings[id]).length;
  const issues = visibleIssues(a, tech);
  return (
    <div className="bottom">
      <div className="stats">
        <div className="stat"><span className="l">Фейсингов</span><span className="v">{a.total}</span><span className="n">заполнение {pct(a.fill)}</span></div>
        <div className="stat"><span className="l">Обязательные</span><span className="v">{must}/{p.rules.mustHave.length}</span><span className="n">must-have</span></div>
        <div className="stat" title="Проверки «не помещается» точны для замеренных пачек"><span className="l">Замерено</span><span className="v">{a.measured}/{a.placed.length}</span><span className="n">размеры пачек</span></div>
        {tech && <div className="stat"><span className="l">IR-готовность</span><span className="v">{a.ready}/{a.placed.length}</span><span className="n">SKU с 3+ эталонами</span></div>}
        <div className="stat wide">
          <span className="l">Доля полки по производителям · черта — цель контракта</span>
          {MAKER_ORDER.map(m => {
            const share = a.total ? (a.byMaker[m] ?? 0) / a.total : 0;
            const target = p.rules.shareTargets[m];
            if (!share && !target) return null;
            const bad = !!target && share < target;
            return (
              <div key={m} className={`sos-row${bad ? ' bad' : ''}`} title={`${MAKERS[m]}: ${a.byMaker[m] ?? 0} из ${a.total}`}>
                <span>{MAKERS[m]}</span>
                <span className="sos-bar"><span style={{ width: `${(share * 100).toFixed(1)}%` }} />{target ? <em style={{ left: `${target * 100}%` }} /> : null}</span>
                <span className="sos-val">{bad ? `${(share * 100).toFixed(1)}%` : pct(share)}{bad && <small> ниже цели</small>}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className="issues">
        <h3>Проверки <span className="count">{issues.length}</span></h3>
        {!issues.length && <p className="ok-line">Нарушений нет. Можно отправлять на согласование.</p>}
        {issues.slice(0, 60).map((i, k) => (
          <div key={k} className={`issue sev-${i.sev}`}>
            <span className="sev">{sev[i.sev]}</span>
            <span>{i.text}</span>
            {(i.addSku || i.placementId || i.skuId || i.shelfId) && <button className="btn btn-sm" onClick={() => onFix(i)}>{i.addSku ? 'Добавить' : 'Показать'}</button>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Вкладка «Проверка»: что будет сверяться на фото точек. Файл для IR и стоимости — только инженеру
function PhotoCheck({ p, yaml, tech, update, onCompare }: { p: Planogram; yaml: string; tech: boolean; update: (fn: (q: Planogram) => void) => void; onCompare: () => void }) {
  const { notify } = useStore.getState();
  const shelves = shelvesTopDown(p.fixture);
  const outlets = p.assign.outlets.length;
  return (
    <>
      <section className="section">
        <h3>Проверка по фото</h3>
        <p className="hint">Опубликованную планограмму назначают точкам. Каждое фото полки с этих точек сравнивается с ней: на месте ли пачки, нет ли пустот и чужих SKU. Итог — процент соответствия.</p>
        <p>{p.publishedAs
          ? <>Опубликована версия <b>{p.version}</b>{p.assign.clusters.length || outlets ? <>: кластеров {p.assign.clusters.length}, отдельных точек {outlets}.</> : '.'}</>
          : <>Ещё не опубликована. Фото можно проверить вручную.</>}</p>
        <button className="btn btn-sm btn-primary" onClick={onCompare}><Icon name="scan" size={15} />Проверить фото</button>
      </section>
      <section className="section">
        <h3>Какие полки проверять</h3>
        {shelves.map(sh => {
          const n = shelfIndex(p.fixture, sh.id).fromBottom;
          return (
            <label key={sh.id} className="check"><input type="checkbox" checked={!p.ir.skipShelves.includes(sh.id)}
              onChange={e => update(q => { q.ir.skipShelves = e.target.checked ? q.ir.skipShelves.filter(x => x !== sh.id) : [...q.ir.skipShelves, sh.id]; })} />
              Полка {n}{(p.rows[sh.id] ?? []).length ? '' : ' · пустая'}</label>
          );
        })}
        <p className="hint">Снимите отметку с полок, которые на фото обычно закрыты или не относятся к планограмме, например с лайтбокса.</p>
      </section>
      {tech && (
        <details className="section tech">
          <summary>Для инженера IR</summary>
          <div className="row-actions">
            <button className="btn btn-sm" onClick={() => { navigator.clipboard.writeText(yaml).then(() => notify('YAML скопирован'), () => notify('Не удалось скопировать: выделите текст вручную')); }}><Icon name="copy" size={15} />Копировать YAML</button>
            <button className="btn btn-sm" onClick={() => download(`${irName(p)}.yaml`, yaml, 'text/yaml')}><Icon name="download" size={15} />Скачать</button>
          </div>
          {p.publishedAs && <p className="hint">В IR: <code>{p.publishedAs}</code></p>}
          <pre className="code-block">{yaml}</pre>
          <h3>Стоимости выравнивания</h3>
          <div className="grid3">
            {(Object.keys(p.ir.costs) as (keyof AlignCosts)[]).map(k => (
              <label key={k} className="field"><span className="mono">{k}</span>
                <input className="input mono" type="number" step="0.1" min="0" value={p.ir.costs[k]} onChange={e => update(q => { q.ir.costs[k] = Math.max(0, Number(e.target.value) || 0); })} /></label>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

// Размер шкафа этой планограммы: ширина, высота выбранной полки и «ужать по пачкам».
// Меняется копия шкафа в планограмме, шаблон в библиотеке не трогается
function FixtureSize({ p, shelfId, get, update }: { p: Planogram; shelfId: string; get: (id: string) => Sku | undefined; update: (fn: (q: Planogram) => void) => void }) {
  const fx = p.fixture;
  const sh = fx.shelves.find(s => s.id === shelfId)!;
  const minW = Math.max(200, ...sortedShelves(fx).map(s => usedWidth(fx, s, p.rows[s.id] ?? [], get))) + 2 * fx.side;
  const code = (q: Planogram) => { if (q.fixture.codeAuto) q.fixture.code = q.fixture.code.replace(/-\d+-\d+$/, `-${Math.round(q.fixture.w / 10)}-${Math.round(q.fixture.h / 10)}`); };
  return (
    <section className="section">
      <h3>Размер шкафа</h3>
      <div className="grid2">
        <NumField value={fx.w} min={minW} max={3000} step={10} label="Ширина" onChange={v => update(q => { q.fixture.w = Math.max(minW, v ?? fx.w); code(q); })} />
        <NumField value={fx.h} min={fx.base + fx.header + 200} max={3000} step={10} label="Высота" onChange={v => update(q => { q.fixture.h = Math.max(sortedShelves(q.fixture).at(-1)!.y + q.fixture.board + 80 + q.fixture.header, v ?? fx.h); code(q); })} />
        <NumField value={sh.y} step={5} label="Эта полка от пола" onChange={v => update(q => { const s = q.fixture.shelves.find(x => x.id === shelfId)!; s.y = clampShelfY(q.fixture, shelfId, v ?? s.y); })} />
      </div>
      <p className="hint">Уже чем {minW} мм не сделать: не встанут пачки. Шаблон в библиотеке не меняется.</p>
      <button className="btn btn-sm" onClick={() => update(q => { q.fixture = compactFixture(q.fixture, q.rows, get); })}><Icon name="spread" size={15} />Ужать шкаф по пачкам</button>
    </section>
  );
}

// PNG шкафа в хорошем разрешении: ~0.9 px на мм, как печать A4
function exportPng(p: Planogram, get: (id: string) => Sku | undefined, warn: boolean) {
  const size = sceneSize(p.fixture);
  const S = Math.min(1.2, 2400 / size.h);
  const c = document.createElement('canvas');
  c.width = Math.round(size.w * S * 2); c.height = Math.round(size.h * S * 2);
  drawScene(c.getContext('2d')!, { fx: p.fixture, rows: p.rows, sku: get, mode: 'texture', warn, dims: true, S, DPR: 2 });
  c.toBlob(b => {
    if (!b) return;
    const url = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = url; a.download = `${fileName(p)}.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
}
