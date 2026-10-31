import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { FORMATS } from '../domain/formats';
import {
  addShelf, autoCode, capacity, clampShelfY, clearanceOf, depthOf, evenShelves, lanesFor, MIN_CLEAR, shelfIndex, shelvesTopDown, sortedShelves,
} from '../domain/geometry';
import { newPlanogram } from '../domain/templates';
import type { Doors, FormatId, Fixture, LaneMode, Material } from '../domain/types';
import { MARGIN } from '../render/scene';
import { go, useStore, useTech } from '../store';
import { Icon, NumField, Seg, Stage, useHistory, type StageHandle } from './common';
import { DOORS, MATERIALS } from './Fixtures';

const SAMPLE: [FormatId | 'none', string][] = [['none', 'Нет'], ['KS', 'KS'], ['SS', 'SS'], ['CMP', 'Compact'], ['NANO', 'Nano'], ['KS100', 'KS 100']];
const codeNumber = (code: string) => Number(/^[СC](\d+)/i.exec(code)?.[1]) || null;

export function Constructor({ id }: { id: string }) {
  const fx = useStore(s => s.fixtures.find(f => f.id === id));
  if (!fx) {
    return <div className="page"><div className="empty"><p>Шкаф не найден. Возможно, его удалили.</p><a className="btn" href="#/fixtures">К библиотеке шкафов</a></div></div>;
  }
  return <ConstructorView fx={fx} />;
}

type Drag = { kind: 'shelf'; id: string } | { kind: 'w' | 'h'; startX: number; startY: number; w: number; h: number };

function ConstructorView({ fx }: { fx: Fixture }) {
  const fixtures = useStore(s => s.fixtures);
  const used = useStore(s => s.planograms.filter(p => p.templateId === fx.id).length);
  const tech = useTech();
  const { saveFixture, duplicateFixture, savePlanogram, notify } = useStore.getState();
  const baseVersion = useRef(fx.version);
  const stage = useRef<StageHandle>(null);
  const [draft, setDraftState] = useState<Fixture | null>(null);
  const draftRef = useRef<Fixture | null>(null);
  const setDraft = (d: Fixture | null) => { draftRef.current = d; setDraftState(d); };
  const [drag, setDrag] = useState<Drag | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState('default');
  const [sample, setSample] = useState<FormatId | 'none'>('KS');
  const [closed, setClosed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const shown = draft ?? fx;

  const apply = useCallback((v: Fixture) => saveFixture(v), [saveFixture]);
  const hist = useHistory(fx.id, fx, apply);
  const { commit } = hist;

  const normalize = useCallback((next: Fixture): Fixture => {
    next.shelves = [...next.shelves].sort((a, b) => a.y - b.y);
    next.version = baseVersion.current + 1;
    if (next.codeAuto) next.code = autoCode(next, codeNumber(next.code) ?? fixtures.findIndex(f => f.id === next.id) + 1);
    return next;
  }, [fixtures]);

  const update = useCallback((fn: (f: Fixture) => void) => {
    const next = structuredClone(fx);
    fn(next);
    commit(normalize(next));
  }, [fx, commit, normalize]);

  // перетаскивание полок и краёв шкафа
  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const st = stage.current; if (!st) return;
      const S = st.scale();
      const next = structuredClone(fx);
      if (drag.kind === 'shelf') {
        const { y } = st.locate(e.clientX, e.clientY);
        const mm = fx.h - (y / S - MARGIN.t) - fx.board / 2;
        const sh = next.shelves.find(s => s.id === drag.id);
        if (sh) sh.y = clampShelfY(fx, drag.id, mm);
      } else if (drag.kind === 'w') {
        next.w = Math.round(Math.max(300, Math.min(3000, drag.w + (e.clientX - drag.startX) / S)) / 5) * 5;
      } else {
        const top = sortedShelves(fx).at(-1);
        const minH = (top ? top.y + fx.board + MIN_CLEAR : fx.base + 100) + fx.header;
        next.h = Math.round(Math.max(minH, Math.min(3000, drag.h + (drag.startY - e.clientY) / S)) / 5) * 5;
      }
      setDraft(next);
    };
    const up = () => {
      const d = draftRef.current;
      if (d && JSON.stringify(d) !== JSON.stringify(fx)) commit(normalize(d));
      setDraft(null);
      setDrag(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [drag, fx, commit, normalize]);

  const selShelf = shown.shelves.find(s => s.id === sel) ?? null;
  const cap = capacity(shown);
  const top = shelvesTopDown(shown);

  const onKey = (e: KeyboardEvent) => {
    const meta = e.metaKey || e.ctrlKey;
    if (meta && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) hist.redo(); else hist.undo(); return; }
    if (!selShelf) return;
    const step = e.shiftKey ? 25 : 5;
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      update(f => { const s = f.shelves.find(q => q.id === selShelf.id)!; s.y = clampShelfY(fx, s.id, s.y + (e.key === 'ArrowUp' ? step : -step)); });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault(); removeShelf(selShelf.id);
    } else if (e.key === 'Escape') setSel(null);
  };

  const removeShelf = (sid: string) => {
    if (fx.shelves.length <= 1) { notify('В шкафу должна остаться хотя бы одна полка'); return; }
    update(f => { f.shelves = f.shelves.filter(s => s.id !== sid); });
    setSel(null);
  };
  const setCount = (n: number) => {
    const count = Math.max(1, Math.min(16, n));
    update(f => { f.shelves = evenShelves(f, count); });
    const tight = evenShelves(fx, count).some((_, i, arr) => {
      const next = arr[i + 1]?.y ?? fx.h - fx.header;
      return next - arr[i].y - fx.board < FORMATS.SS.h;
    });
    if (tight) notify(`При ${count} полках просвет меньше 98 мм: Super Slims не встанут`);
  };

  return (
    <div className="workspace">
      <div className="toolbar">
        <div className="title">
          <a className="btn btn-ghost icon-btn" href="#/fixtures" aria-label="К библиотеке шкафов"><Icon name="back" /></a>
          <span className="code">{fx.code}</span>
          <input aria-label="Название шкафа" value={fx.name} onChange={e => saveFixture({ ...fx, name: e.target.value })} />
        </div>
        <button className="btn icon-btn" onClick={hist.undo} disabled={!hist.canUndo} aria-label="Отменить" title="Отменить (⌘Z)"><Icon name="undo" /></button>
        <button className="btn icon-btn" onClick={hist.redo} disabled={!hist.canRedo} aria-label="Повторить" title="Повторить (⇧⌘Z)"><Icon name="redo" /></button>
        <span className="sep" />
        <button className="btn" onClick={() => { const nid = duplicateFixture(fx.id); notify('Копия создана'); go(`fixture/${nid}`); }}><Icon name="copy" />Дублировать</button>
        <button className="btn btn-primary" onClick={() => { const p = newPlanogram(fx, `Планограмма · ${fx.code}`); savePlanogram(p); go(`planogram/${p.id}`); }}><Icon name="plus" />Планограмма на этом шкафу</button>
        <span className="saved">Сохранено · версия {fx.version}</span>
      </div>

      <div className="split two">
        <div className="center">
          <div className="canvas-bar">
            <span>Пачки для примера</span>
            <Seg label="Пачки для примера" value={sample} options={SAMPLE} onChange={setSample} />
            {fx.doors !== 'none' && <label className="check"><input type="checkbox" checked={closed} onChange={e => setClosed(e.target.checked)} />Закрыть {fx.doors === 'glass' ? 'дверцы' : 'шторку'}</label>}
            <span className="grow" />
            <button className="btn btn-sm icon-btn" aria-label="Отдалить" onClick={() => setZoom(z => Math.max(0.5, z / 1.25))}><Icon name="minus" size={15} /></button>
            <button className="btn btn-sm" onClick={() => setZoom(1)}>Весь шкаф</button>
            <button className="btn btn-sm icon-btn" aria-label="Приблизить" onClick={() => setZoom(z => Math.min(3, z * 1.25))}><Icon name="plus" size={15} /></button>
          </div>
          <Stage
            ref={stage}
            zoom={zoom}
            freeze={drag?.kind === 'w' || drag?.kind === 'h'}
            label="Конструктор шкафа. Номера слева — полки, их можно тянуть вверх и вниз. Стрелки двигают выбранную полку на 5 мм"
            cursor={cursor}
            scene={{ fx: shown, rows: null, sku: () => undefined, mode: 'texture', warn: false, dims: true, sampleFill: sample === 'none' ? null : sample, closed, constructorMode: true, selShelf: sel, hover }}
            onKeyDown={onKey}
            onPointerDown={(e, _p, hit) => {
              if (e.button !== 0) return;
              if (hit?.kind === 'handle') { setSel(hit.id); setDrag({ kind: 'shelf', id: hit.id }); e.preventDefault(); }
              else if (hit?.kind === 'edge-w' || hit?.kind === 'edge-h') { setDrag({ kind: hit.kind === 'edge-w' ? 'w' : 'h', startX: e.clientX, startY: e.clientY, w: fx.w, h: fx.h }); e.preventDefault(); }
              else if (hit?.kind === 'shelf') setSel(hit.id);
              else setSel(null);
            }}
            onPointerMove={(_e, _p, hit) => {
              if (drag) return;
              setHover(hit?.kind === 'handle' ? hit.id : null);
              setCursor(hit?.kind === 'handle' || hit?.kind === 'edge-h' ? 'ns-resize' : hit?.kind === 'edge-w' ? 'ew-resize' : hit?.kind === 'shelf' ? 'pointer' : 'default');
            }}
            onPointerLeave={() => setHover(null)}
          />
          <div className="canvas-bar">
            <span className="hint">Тяните номер полки слева, чтобы поменять высоту. Синие ручки справа и сверху меняют ширину и высоту шкафа. Красный просвет — Super Slims (98 мм) не встанут.</span>
          </div>
        </div>

        <aside className="pane pane-r">
          <div className="pane-scroll">
            <section className="section">
              <h3>Код и название</h3>
              <div className="grid2">
                <label className="field"><span>Код</span>
                  <input className="input mono" value={fx.code} onChange={e => saveFixture({ ...fx, code: e.target.value, codeAuto: false })} /></label>
                <label className="check" style={{ alignSelf: 'end' }}>
                  <input type="checkbox" checked={fx.codeAuto} onChange={e => update(f => { f.codeAuto = e.target.checked; })} />собирать из размеров
                </label>
              </div>
            </section>

            <section className="section">
              <h3>Габариты, мм</h3>
              <div className="grid2">
                <NumField label="Ширина" value={fx.w} min={300} max={3000} onChange={v => update(f => { f.w = v!; })} />
                <NumField label="Высота" value={fx.h} min={300} max={3000} onChange={v => update(f => { f.h = Math.max(v!, (sortedShelves(f).at(-1)?.y ?? 0) + f.board + MIN_CLEAR + f.header); })} />
                <NumField label="Глубина" value={fx.d} min={120} max={900} onChange={v => update(f => { f.d = v!; })} />
                <NumField label="Цоколь" value={fx.base} min={0} max={1200} onChange={v => update(f => { f.base = v!; const lo = sortedShelves(f)[0]; if (lo && lo.y < f.base) lo.y = f.base; })} />
                <NumField label="Лайтбокс" value={fx.header} min={0} max={600} onChange={v => update(f => { f.header = v!; })} />
                <NumField label="Боковины" value={fx.side} min={0} max={80} step={1} onChange={v => update(f => { f.side = v!; })} />
                <NumField label="Полка" value={fx.board} min={4} max={60} step={1} onChange={v => update(f => { f.board = v!; })} />
                <NumField label="Ценник" value={fx.rail} min={0} max={80} step={1} onChange={v => update(f => { f.rail = v!; })} />
              </div>
            </section>

            <section className="section">
              <h3>Вид</h3>
              <div className="field"><span>Дверцы</span><Seg<Doors> label="Дверцы" value={fx.doors} options={Object.entries(DOORS) as [Doors, string][]} onChange={v => update(f => { f.doors = v; })} /></div>
              <div className="field"><span>Материал корпуса</span><Seg<Material> label="Материал" value={fx.material} options={Object.entries(MATERIALS) as [Material, string][]} onChange={v => update(f => { f.material = v; })} /></div>
              {fx.doors !== 'none' && <p className="hint">Закрытая выкладка (Казахстан с 2021): в редакторе и сверке шкаф показан открытым — агент снимает его с открытыми дверцами.</p>}
            </section>

            <section className="section">
              <h3>Ряды толкателей</h3>
              <Seg<LaneMode> label="Ширина ряда" value={fx.laneMode} options={[['format', 'По формату пачки'], ['fixed', 'Одна ширина']]} onChange={v => update(f => { f.laneMode = v; })} />
              {fx.laneMode === 'fixed'
                ? <NumField label="Ширина ряда" value={fx.laneWidth} min={30} max={150} step={1} onChange={v => update(f => { f.laneWidth = v!; })} />
                : <p className="hint">KS — 59 мм, Compact и Demi — 52, Nano и KSSL — 48, Super Slims — 45. Свою ширину для полки можно задать в таблице.</p>}
            </section>

            <section className="section">
              <div className="section-head">
                <h3>Полки</h3>
                <div className="stepper" style={{ gap: 4 }}>
                  <button className="btn btn-sm icon-btn" aria-label="Убрать полку" onClick={() => setCount(fx.shelves.length - 1)}><Icon name="minus" size={15} /></button>
                  <output style={{ minWidth: 28 }}><b style={{ fontSize: 16 }}>{fx.shelves.length}</b></output>
                  <button className="btn btn-sm icon-btn" aria-label="Добавить полку" onClick={() => setCount(fx.shelves.length + 1)}><Icon name="plus" size={15} /></button>
                </div>
              </div>
              <div className="row-actions">
                <button className="btn btn-sm" onClick={() => { update(f => { f.shelves = addShelf(f); }); }}><Icon name="plus" size={15} />В самый большой промежуток</button>
                <button className="btn btn-sm" onClick={() => update(f => { f.shelves = evenShelves(f, f.shelves.length); })}><Icon name="spread" size={15} />Развести равномерно</button>
              </div>
              <table className="shelf-table">
                <thead><tr><th>№</th>{tech && <th>IR</th>}<th>От пола</th><th>Просвет</th><th>Ряд</th><th /></tr></thead>
                <tbody>
                  {top.map(sh => {
                    const { fromBottom, irRow } = shelfIndex(shown, sh.id);
                    const cl = Math.round(clearanceOf(shown, sh));
                    return (
                      <tr key={sh.id} className={sh.id === sel ? 'sel' : ''} onClick={() => setSel(sh.id)}>
                        <td className="n">{fromBottom}</td>
                        {tech && <td className="n" style={{ color: 'var(--ir)' }}>{irRow}</td>}
                        <td style={{ width: 84 }}><NumField compact label={`Высота полки ${fromBottom} от пола`} value={sh.y} unit="" onChange={v => update(f => { const s = f.shelves.find(q => q.id === sh.id)!; s.y = clampShelfY(fx, sh.id, v!); })} /></td>
                        <td className={cl < FORMATS.SS.h ? 'bad mono' : 'mono'}>{cl}</td>
                        <td style={{ width: 72 }}><NumField compact label={`Ширина ряда на полке ${fromBottom}`} value={sh.lane} unit="" allowNull placeholder="авто" step={1} min={30} max={150} onChange={v => update(f => { f.shelves.find(q => q.id === sh.id)!.lane = v; })} /></td>
                        <td><button className="btn btn-sm btn-ghost icon-btn" aria-label={`Удалить полку ${fromBottom}`} onClick={e => { e.stopPropagation(); removeShelf(sh.id); }}><Icon name="trash" size={14} /></button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="hint">№ — счёт полок снизу, как у мерчандайзера.{tech ? ' IR — номер ряда сверху, так считает распознавание.' : ''}</p>
            </section>

            {selShelf && (
              <section className="section">
                <div className="section-head"><h3>Полка {shelfIndex(shown, selShelf.id).fromBottom} снизу</h3>
                  <button className="btn btn-sm btn-ghost" onClick={() => setSel(null)}>Снять выбор</button></div>
                <div className="grid2">
                  <NumField label="Глубина полки" value={selShelf.depth} allowNull placeholder={String(fx.d - 20)} min={100} max={fx.d} onChange={v => update(f => { f.shelves.find(q => q.id === selShelf.id)!.depth = v; })} />
                  <div className="field"><span>Просвет</span><div className="mono" style={{ padding: '7px 0' }}>{Math.round(clearanceOf(shown, selShelf))} мм</div></div>
                </div>
                <div className="cap-grid">
                  {(['KS', 'KS100', 'SS', 'CMP', 'NANO', 'DEMI'] as FormatId[]).map(k => {
                    const f = FORMATS[k];
                    const fits = f.h <= clearanceOf(shown, selShelf);
                    const lanes = lanesFor(shown, selShelf, f.w, f.lane);
                    const deep = Math.max(1, Math.floor((depthOf(shown, selShelf) - 20) / f.d));
                    return <div key={k} className={`cap ${fits ? '' : 'bad'}`}><b>{fits ? lanes : '—'}</b><span>{k} {fits ? `рядов · ${deep} вглубь` : `выше ${f.h} мм`}</span></div>;
                  })}
                </div>
              </section>
            )}

            <section className="section">
              <h3>Вместимость шкафа</h3>
              <div className="cap-grid">
                <div className="cap"><b>{cap.ksLanes}</b><span>рядов KS</span></div>
                <div className="cap"><b>{cap.ssLanes}</b><span>рядов SS</span></div>
                <div className="cap"><b>{cap.packs}</b><span>пачек KS всего</span></div>
              </div>
              <p className="hint">Используется в {used} планограмм(ах). Они хранят свою копию шкафа; после изменений шаблона в редакторе планограммы появится кнопка «Обновить шкаф».</p>
            </section>
          </div>
        </aside>
      </div>
    </div>
  );
}
