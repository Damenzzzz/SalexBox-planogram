import { useRef, useState } from 'react';
import { analyse } from '../domain/checks';
import { runStats } from '../domain/compare';
import { download, importText, toBundle } from '../domain/io';
import { capacity, sortedShelves } from '../domain/geometry';
import { newPlanogram } from '../domain/templates';
import type { Market, Planogram, PlanogramStatus } from '../domain/types';
import { go, useCatalog, useStore } from '../store';
import { Icon, Modal, SceneThumb, pct } from './common';

export const STATUS_NAME: Record<PlanogramStatus, string> = { draft: 'Черновик', review: 'На согласовании', approved: 'Утверждена', published: 'Опубликована' };
const STATUS_CHIP: Record<PlanogramStatus, string> = { draft: 'chip', review: 'chip chip-warn', approved: 'chip chip-ok', published: 'chip chip-accent' };

export function Planograms() {
  const planograms = useStore(s => s.planograms);
  const fixtures = useStore(s => s.fixtures);
  const runs = useStore(s => s.runs);
  const custom = useStore(s => s.custom);
  const { list, byId, get } = useCatalog();
  const { savePlanogram, deletePlanogram, duplicatePlanogram, applyImport, notify } = useStore.getState();
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const onImport = async (f: File) => {
    try {
      const res = importText(await f.text(), f.name, byId, fixtures[0]);
      applyImport(res);
      notify(`Импорт: ${res.note}`);
    } catch (e) {
      notify(`Не получилось импортировать «${f.name}»: ${(e as Error).message}`);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Планограммы</h1>
          <p>Шкаф из библиотеки плюс раскладка пачек. Готовую планограмму выбирают в сверке IR, и распознавание проверяет фото по ней.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => file.current?.click()}><Icon name="upload" />Импорт</button>
          <button className="btn" onClick={() => download(`planogram-studio-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(toBundle(planograms, fixtures, custom), null, 2))}><Icon name="download" />Выгрузить всё</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />Новая планограмма</button>
          <input ref={file} type="file" accept=".json,.yaml,.yml" hidden onChange={e => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ''; }} />
        </div>
      </div>

      {!planograms.length && (
        <div className="empty"><p>Планограмм пока нет. Создайте первую на одном из шкафов или импортируйте JSON, YAML для IR или файл прототипа v1.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Icon name="plus" />Новая планограмма</button></div>
      )}

      <div className="cards">
        {planograms.map(p => {
          const a = analyse(p, get);
          const last = runs.find(r => r.planogramId === p.id);
          const errors = a.issues.filter(i => i.sev === 'error').length;
          return (
            <article className="lib-card" key={p.id}>
              <button className="lib-thumb" onClick={() => go(`planogram/${p.id}`)} aria-label={`Открыть ${p.name}`}>
                <SceneThumb width={240} height={220} scene={{ fx: p.fixture, rows: p.rows, sku: get, mode: 'texture', warn: true, dims: false }} />
              </button>
              <div className="lib-body">
                <div className="lib-title"><h3 title={p.name}>{p.name}</h3><span className="code">{p.fixture.code}</span></div>
                <div className="meta">
                  <span className={STATUS_CHIP[p.status]}>{STATUS_NAME[p.status]}</span>
                  <span>версия <b>{p.version}</b></span>
                  <span><b>{a.total}</b> фейс.</span>
                  <span><b>{sortedShelves(p.fixture).length}</b> полок</span>
                </div>
                <div className="meta">
                  {errors ? <span className="chip chip-err">{errors} ошиб.</span> : <span className="chip chip-ok">проверки ок</span>}
                  <span>IR-готовность <b>{a.ready}/{a.placed.length}</b></span>
                  {last && <span>сверка <b>{pct(runStats(last).truthCompliance ?? runStats(last).irCompliance)}</b></span>}
                </div>
                <div className="lib-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => go(`planogram/${p.id}`)}>Открыть</button>
                  <button className="btn btn-sm" onClick={() => go(`compare/${p.id}`)}><Icon name="scan" size={15} />Сверка</button>
                  <button className="btn btn-sm icon-btn" title="Дублировать" aria-label="Дублировать" onClick={() => { duplicatePlanogram(p.id); notify('Копия создана'); }}><Icon name="copy" size={15} /></button>
                  {confirm === p.id
                    ? <button className="btn btn-sm btn-danger" onClick={() => { deletePlanogram(p.id); setConfirm(null); notify('Планограмма удалена'); }}>Точно удалить</button>
                    : <button className="btn btn-sm icon-btn" title="Удалить" aria-label="Удалить" onClick={() => setConfirm(p.id)}><Icon name="trash" size={15} /></button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {creating && (
        <NewPlanogram onClose={() => setCreating(false)} onCreate={p => { savePlanogram(p); setCreating(false); go(`planogram/${p.id}`); }} />
      )}
      <p className="hint">Каталог: {list.length} SKU из галереи recognition_ref. Всё хранится в этом браузере; для обмена — «Выгрузить всё» и «Импорт».</p>
    </div>
  );
}

function NewPlanogram({ onClose, onCreate }: { onClose: () => void; onCreate: (p: Planogram) => void }) {
  const fixtures = useStore(s => s.fixtures);
  const [tpl, setTpl] = useState(fixtures[0]?.id ?? '');
  const [name, setName] = useState('Новая планограмма');
  const [market, setMarket] = useState<Market>('KZ');
  const [outlet, setOutlet] = useState('');
  const fx = fixtures.find(f => f.id === tpl);
  const create = () => {
    if (!fx) return;
    const p = newPlanogram(fx, name.trim() || 'Новая планограмма');
    p.market = market; p.outlet = outlet.trim();
    onCreate(p);
  };
  return (
    <Modal title="Новая планограмма" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" disabled={!fx} onClick={create}>Создать</button>
    </>}>
      <div className="grid2">
        <label className="field"><span>Название</span><input className="input" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') create(); }} /></label>
        <div className="grid2">
          <label className="field"><span>Рынок</span>
            <select className="select" value={market} onChange={e => setMarket(e.target.value as Market)}>
              <option value="KZ">Казахстан</option><option value="KG">Кыргызстан</option><option value="UZ">Узбекистан</option><option value="RU">Россия</option>
            </select></label>
          <label className="field"><span>Точка (outlet_id)</span><input className="input" value={outlet} placeholder="необязательно" onChange={e => setOutlet(e.target.value)} /></label>
        </div>
      </div>
      <div className="field"><span>Шкаф из библиотеки</span>
        <div className="tpl-pick">
          {fixtures.map(f => {
            const cap = capacity(f);
            return (
              <button key={f.id} type="button" aria-pressed={f.id === tpl} onClick={() => setTpl(f.id)}>
                <div className="lib-thumb"><SceneThumb width={130} height={115} scene={{ fx: f, rows: null, sku: () => undefined, mode: 'texture', warn: false, dims: false, sampleFill: 'KS' }} /></div>
                <span className="code" style={{ justifySelf: 'start' }}>{f.code}</span>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{f.name}</span>
                <span className="hint">{f.w}×{f.h}×{f.d} · {f.shelves.length} полок · {cap.ksLanes} рядов KS</span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="hint">Планограмма получает свою копию шкафа. Если потом поменять шаблон в конструкторе, планограмма предложит обновиться.</p>
    </Modal>
  );
}
