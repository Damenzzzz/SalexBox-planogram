import { strToU8, zipSync } from 'fflate';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { galleryCrops, mapReport, memoryOf, rowKey, rowsFromRun, runStats, slotKey, truthStatus } from '../domain/compare';
import { analyzePhoto } from '../domain/api';
import { runsSheet } from '../domain/exports';
import { shelvesTopDown, uid } from '../domain/geometry';
import { fileName, irLabel, toIrYaml } from '../domain/irExport';
import type { IrPlanogramReport, IrRun, IrSlot, Planogram, SlotStatus, Sku } from '../domain/types';
import { nextVersion } from '../domain/versions';
import { XLSX_TYPE, downloadBytes, xlsx } from '../domain/xlsx';
import { STATUS_TOKEN } from '../render/scene';
import { go, useCatalog, useStore, useTech } from '../store';
import { Icon, Stage, pct } from './common';
import { ServerModal } from './Server';

export const STATUS_RU: Record<SlotStatus, string> = {
  ok: 'на месте', misplaced: 'чужой SKU', wrong_shelf: 'не та полка', missing: 'пусто', extra: 'сверх плана', needs_review: 'на проверку',
};
const STATUSES = Object.keys(STATUS_RU) as SlotStatus[];

// Фото текущей сессии: оригиналы не хранятся ни в сервисе, ни в браузере
const photos = new Map<string, string>();

export function Compare({ planogramId }: { planogramId: string | null }) {
  const planograms = useStore(s => s.planograms);
  const p = planograms.find(q => q.id === planogramId) ?? null;
  return (
    <div className="workspace">
      <div className="toolbar">
        <div className="title">
          <span style={{ fontWeight: 600 }}>Сверка IR</span>
          <select className="select" style={{ width: 'auto', maxWidth: 360 }} aria-label="Планограмма для сверки" value={p?.id ?? ''} onChange={e => go(`compare/${e.target.value}`)}>
            <option value="">Выберите планограмму…</option>
            {planograms.map(q => <option key={q.id} value={q.id}>{q.name} · v{q.version} · {q.fixture.code}</option>)}
          </select>
        </div>
        {p && <a className="btn" href={`#/planogram/${p.id}`}><Icon name="edit" />Открыть в редакторе</a>}
      </div>
      {p ? <CompareView p={p} /> : (
        <div className="page"><div className="empty">
          <p>Выберите готовую планограмму. IR сверит фото агента именно с ней: Studio отправит профиль вместе с фото.</p>
          <div className="row-actions" style={{ justifyContent: 'center' }}>{planograms.slice(0, 6).map(q => <button key={q.id} className="btn" onClick={() => go(`compare/${q.id}`)}>{q.name}</button>)}</div>
        </div></div>
      )}
    </div>
  );
}

function CompareView({ p }: { p: Planogram }) {
  const { get, list } = useCatalog();
  const settings = useStore(s => s.settings);
  const tech = useTech();
  const me = useStore(s => s.me);
  const allRuns = useStore(s => s.runs);
  const runs = useMemo(() => allRuns.filter(r => r.planogramId === p.id), [allRuns, p.id]);
  const { addRun, updateRun, deleteRun, savePlanogram, saveSnapshot, notify } = useStore.getState();
  const skuOptions = useMemo(() => [...list].sort((a, b) => a.name.localeCompare(b.name)), [list]);
  const [runId, setRunId] = useState<string | null>(runs[0]?.id ?? null);
  const [selSlot, setSelSlot] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outlet, setOutlet] = useState(p.outlet);
  const [server, setServer] = useState(false);
  const photoInput = useRef<HTMLInputElement>(null);
  const jsonInput = useRef<HTMLInputElement>(null);
  const run = runs.find(r => r.id === runId) ?? null;
  const mapped = useMemo(() => (run ? mapReport(p, run) : null), [p, run]);
  const stats = run ? runStats(run) : null;

  const slots = useMemo(() => run ? run.report.rows.flatMap(r => r.slots.map(s => ({ key: slotKey(rowKey(r), s.pos), row: r.planogram_shelf != null ? `ряд ${r.planogram_shelf}` : `ряд фото ${r.shelf}, нет в планограмме`, s }))) : [], [run]);
  const unmatched = run ? run.report.rows.filter(r => r.planogram_shelf == null).length : 0;
  const matched = run ? run.report.rows.length - unmatched : 0;
  const sel = slots.find(x => x.key === selSlot) ?? null;

  const save = (report: IrPlanogramReport, source: IrRun['source'], photoName: string, photoId: string | null, models: string, url: string | null, size: [number, number] | null) => {
    const r: IrRun = { id: uid('run'), planogramId: p.id, planogramVersion: p.version, photoName, createdAt: new Date().toISOString(), source, photoId, models, report, imageSize: size, verdicts: {} };
    if (url) photos.set(r.id, url);
    addRun(r); setRunId(r.id); setSelSlot(null);
  };

  const sendPhoto = async (file: File) => {
    const url = URL.createObjectURL(file);
    const size = await imageSize(url);
    setBusy('Отправляю фото в IR…');
    try {
      const { photoId, result } = await analyzePhoto({}, file, { planogram: toIrYaml(p, get), outlet_id: outlet.trim() }, setBusy);
      const report = result.planogram as IrPlanogramReport | undefined;
      if (!report) throw new Error('сервер распознал фото, но не вернул сверку с планограммой');
      save(report, 'api', file.name, photoId, modelsOf(result.models), url, size);
      notify(`Сверка готова: соответствие ${pct(report.compliance)}`);
    } catch (e) {
      notify(`Не получилось: ${(e as Error).message}`);
    } finally { setBusy(null); }
  };

  const loadJson = async (file: File) => {
    try {
      const doc = JSON.parse(await file.text());
      const result = doc.result ?? doc;
      const report: IrPlanogramReport | undefined = result.rows && 'compliance' in result ? result : result.planogram;
      if (!report?.rows) throw new Error('в файле нет PlanogramReport (поле planogram)');
      save(report, 'file', result.photo ?? file.name, doc.photo_id ?? null, modelsOf(result.models), null, null);
      notify('Результат загружен');
    } catch (e) { notify(`Не прочитал «${file.name}»: ${(e as Error).message}`); }
  };

  const verdict = (key: string, v: 'right' | 'wrong', truth?: SlotStatus, truthSku?: string) => {
    if (!run) return;
    updateRun(run.id, r => {
      const old = r.verdicts[key];
      const next = v === 'right' ? { v } : { v, truth: truth ?? old?.truth, truthSku: truthSku === '' ? undefined : truthSku ?? old?.truthSku };
      return { ...r, verdicts: { ...r.verdicts, [key]: next } };
    });
  };
  const clearVerdict = (key: string) => run && updateRun(run.id, r => { const v = { ...r.verdicts }; delete v[key]; return { ...r, verdicts: v }; });

  // Клавиши проверки работают на всём экране, как в evals/golden/review.html
  const onKey = (e: KeyboardEvent) => {
    if (!run || !slots.length || (e.target as HTMLElement).matches('input, select, textarea')) return;
    const i = slots.findIndex(x => x.key === selSlot);
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setSelSlot(slots[Math.min(slots.length - 1, i + 1)].key); }
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setSelSlot(slots[Math.max(0, i - 1)].key); }
    else if (sel && e.key === 'Enter') { e.preventDefault(); verdict(sel.key, 'right'); setSelSlot(slots[Math.min(slots.length - 1, i + 1)].key); }
    else if (sel && (e.key === 'x' || e.key === 'X' || e.key === 'ч')) { e.preventDefault(); verdict(sel.key, 'wrong'); }
  };

  const keyRef = useRef(onKey);
  keyRef.current = onKey;
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  return (
    <div className="compare-grid">
      <div className="center">
        <div className="canvas-bar"><b>Фото агента</b><span className="hint">{run ? run.photoName : 'нет сверки'}</span></div>
        <PhotoView run={run} url={run ? photos.get(run.id) ?? null : null} selSlot={selSlot} onSelect={setSelSlot} />
        <div />
      </div>
      <div className="center">
        <div className="canvas-bar"><b>Планограмма</b><span className="hint">{p.name} · v{p.version}</span>
          {run && run.planogramVersion !== p.version && <span className="chip chip-warn">сверка делалась по версии {run.planogramVersion}</span>}
          <span className="grow" />
          <span className="legend">{STATUSES.filter(s => s !== 'ok').map(s => <span key={s}><i style={{ background: `var(${STATUS_TOKEN[s]})` }} />{STATUS_RU[s]}</span>)}</span>
        </div>
        <Stage zoom={1} label="Планограмма со статусами слотов" cursor="pointer"
          scene={{ fx: p.fixture, rows: p.rows, sku: get, mode: 'texture', warn: settings.warn, dims: false, compare: mapped, truth: run ? (k, s) => truthStatus(run, k, s) : undefined, selSlot, skip: p.ir.skipShelves }}
          onPointerDown={(_e, _pt, hit) => { if (hit?.kind === 'slot') setSelSlot(hit.id); }} />
        <div />
      </div>

      <aside className="pane pane-r">
        <div className="pane-scroll">
          <section className="section">
            <h3>Новая сверка</h3>
            <div className="grid2">
              <button className="btn btn-primary" disabled={!!busy} onClick={() => photoInput.current?.click()}><Icon name="camera" />Фото → IR</button>
              <button className="btn" disabled={!!busy} onClick={() => jsonInput.current?.click()}><Icon name="file" />JSON результата</button>
            </div>
            <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const f = e.target.files?.[0]; if (f) sendPhoto(f); e.target.value = ''; }} />
            <input ref={jsonInput} type="file" accept=".json" hidden onChange={e => { const f = e.target.files?.[0]; if (f) loadJson(f); e.target.value = ''; }} />
            {busy && <p className="hint" role="status">{busy}</p>}
            <label className="field"><span>Точка (outlet_id)</span><input className="input" value={outlet} placeholder="необязательно" onChange={e => setOutlet(e.target.value)} /></label>
            <button className="btn btn-sm btn-ghost" style={{ justifySelf: 'start' }} onClick={() => setServer(true)}><Icon name="cloud" size={15} />{me ? 'Сервер и аккаунт' : 'Войти, чтобы проверять фото'}</button>
            {server && <ServerModal onClose={() => setServer(false)} />}
            <button className="btn btn-sm" onClick={() => { const r = simulate(p, get); save(r, 'file', 'пример без фото', null, 'симуляция в Studio', null, null); notify('Пример сверки создан: статусы условные'); }}>Пример сверки без сервиса</button>
          </section>

          {runs.length > 0 && (
            <section className="section">
              <div className="section-head"><h3>Память сверок · {runs.length}</h3>
                <button className="btn btn-sm" onClick={() => downloadBytes(`${fileName(p)} сверки.xlsx`, xlsx([runsSheet(p, runs, get)]), XLSX_TYPE)}><Icon name="download" size={15} />Excel</button></div>
              {tech && <MemorySummary runs={runs} get={get} />}
              <div className="runs">
                {runs.map(r => {
                  const st = runStats(r);
                  return (
                    <div key={r.id} className={`run ${r.id === runId ? 'sel' : ''}`} role="button" tabIndex={0} onClick={() => { setRunId(r.id); setSelSlot(null); }} onKeyDown={e => { if (e.key === 'Enter') setRunId(r.id); }}>
                      <b title={r.photoName}>{r.photoName}</b><span className="mono">{pct(st.irCompliance)}</span>
                      <span className="hint">{new Date(r.createdAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })} · v{r.planogramVersion}</span>
                      <span className="hint">{st.verified ? `проверено ${st.verified}/${st.slots}` : 'не проверено'}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {run && stats && (
            <section className="section">
              <div className="section-head"><h3>Результат</h3>
                <button className="btn btn-sm btn-ghost btn-danger" onClick={() => { deleteRun(run.id); photos.delete(run.id); setRunId(null); }}><Icon name="trash" size={14} />Удалить</button></div>
              <div className="cap-grid">
                <div className="cap"><b>{pct(stats.irCompliance)}</b><span>соответствие по IR</span></div>
                <div className="cap"><b>{stats.verified ? pct(stats.truthCompliance) : '—'}</b><span>по проверке</span></div>
                <div className="cap"><b>{pct(stats.accuracy)}</b><span>IR прав в слотах</span></div>
                <div className="cap"><b>{stats.error != null ? `${(stats.error * 100).toFixed(1)}` : '—'}</b><span>ошибка, п.п.</span></div>
              </div>
              {!matched && <p className="chip chip-warn" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>IR не сопоставил ни один ряд фото с полками этой планограммы. Скорее всего, на фото другой шкаф или видна только его часть: все пачки ушли в «сверх плана».</p>}
              {matched > 0 && unmatched > 0 && <p className="hint">{unmatched} ряд(а) фото без пары в планограмме: их пачки — «сверх плана».</p>}
              <p className="hint">Проверено {stats.verified} из {stats.slots} слотов. Enter — IR прав, X — ошибся, стрелки — следующий слот. {tech && run.models && `Модели: ${run.models}.`}</p>
              <div className="row-actions">
                <button className="btn btn-sm" onClick={() => {
                  const { next, snapshot } = nextVersion(p, `по фото ${run.photoName}`);
                  if (!useStore.getState().snapshots.some(v => v.planogramId === p.id && v.version === p.version)) saveSnapshot(snapshot);
                  savePlanogram({ ...next, rows: rowsFromRun(next, run) });
                  notify(`Версия ${next.version} по фото: v${p.version} сохранена в «Версиях»`); go(`planogram/${p.id}`);
                }}><Icon name="edit" size={15} />Новая версия по фото</button>
                {tech && <button className="btn btn-sm" disabled={!photos.get(run.id) || !galleryCrops(run).length}
                  title={!photos.get(run.id) ? 'Фото этой сверки не сохранено: кропы режутся из оригинала текущей сессии' : 'Подтверждённые слоты: папки «бренд/модель» для salesbox-gallery'}
                  onClick={() => exportCrops(run, photos.get(run.id)!).then(n => notify(`Эталонов в архиве: ${n}. Передайте его в галерею (salesbox-gallery)`), e => notify(`Не вышло: ${(e as Error).message}`))}>
                  <Icon name="image" size={15} />Эталоны в галерею · {galleryCrops(run).length}</button>}
              </div>
            </section>
          )}

          {run && (
            <section className="section">
              <h3>Слоты · {slots.length}</h3>
              <ul className="slot-list">
                {slots.map(({ key, row, s }) => {
                  const v = run.verdicts[key];
                  const st = truthStatus(run, key, s);
                  return (
                    <li key={key} className={`slot-row ${key === selSlot ? 'sel' : ''}`} onClick={() => setSelSlot(key)}>
                      <span className="dot" style={{ background: `var(${STATUS_TOKEN[st]})` }} />
                      <span style={{ minWidth: 0 }}>
                        <b style={{ fontWeight: 600 }}>{row} · {s.pos}</b> {STATUS_RU[s.status]}{v?.v === 'wrong' ? ` → ${STATUS_RU[st]}` : ''}
                        <span className="hint" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {name(get, s.expected_sku)} {s.status !== 'ok' && s.sku !== s.expected_sku ? `→ ${name(get, s.sku)}` : ''}{s.conf != null ? ` · ${s.conf.toFixed(2)}` : ''}
                        </span>
                      </span>
                      <span className="v">
                        {v?.v === 'right' ? <span className="verdict-right">✓</span> : v?.v === 'wrong' ? <span className="verdict-wrong">✗</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {sel && run && (
            <section className="section" style={{ position: 'sticky', bottom: 0, background: 'var(--surface)', borderTop: '1px solid var(--line)' }}>
              <h3>Слот: {sel.row}, позиция {sel.s.pos}</h3>
              <p style={{ fontSize: 13 }}>Ожидался <b>{name(get, sel.s.expected_sku)}</b>, IR видит <b>{name(get, sel.s.sku)}</b> — {STATUS_RU[sel.s.status]}.</p>
              <div className="row-actions">
                <button className="btn btn-sm" onClick={() => verdict(sel.key, 'right')}><Icon name="check" size={15} />IR прав</button>
                <button className="btn btn-sm" onClick={() => verdict(sel.key, 'wrong')}><Icon name="x" size={15} />Ошибся</button>
                {run.verdicts[sel.key] && <button className="btn btn-sm btn-ghost" onClick={() => clearVerdict(sel.key)}>Сбросить</button>}
              </div>
              {run.verdicts[sel.key]?.v === 'wrong' && (
                <div className="grid2">
                  <label className="field"><span>Как на самом деле</span>
                    <select className="select" value={truthStatus(run, sel.key, sel.s)} onChange={e => verdict(sel.key, 'wrong', e.target.value as SlotStatus)}>
                      {STATUSES.map(s => <option key={s} value={s}>{STATUS_RU[s]}</option>)}
                    </select></label>
                  <label className="field"><span>Какая пачка стоит</span>
                    <select className="select" value={run.verdicts[sel.key]?.truthSku ?? ''} onChange={e => verdict(sel.key, 'wrong', undefined, e.target.value)}>
                      <option value="">не указано</option>
                      {sel.s.expected_sku && <option value={sel.s.expected_sku}>{name(get, sel.s.expected_sku)} (ожидалась)</option>}
                      {skuOptions.filter(s => s.id !== sel.s.expected_sku).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select></label>
                </div>
              )}
              {tech && run.verdicts[sel.key]?.v === 'wrong' && <p className="hint">Пачка нужна для пар-путаниц и для эталонов галереи: кроп уйдёт под правильной меткой.</p>}
            </section>
          )}
        </div>
      </aside>
    </div>
  );
}

function MemorySummary({ runs, get }: { runs: IrRun[]; get: (id: string) => Sku | undefined }) {
  const m = useMemo(() => memoryOf(runs), [runs]);
  const photos = runs.filter(r => runStats(r).verified).length;
  const errs = m.byModel.filter(x => x.error != null);
  const avgErr = errs.length ? errs.reduce((a, x) => a + x.error! * x.runs, 0) / errs.reduce((a, x) => a + x.runs, 0) : null;
  const worst = m.bySku.filter(([, t]) => t.verified >= 2).slice(0, 6);
  return (
    <>
      <div className="cap-grid">
        <div className="cap"><b>{m.verified ? pct(m.right / m.verified) : '—'}</b><span>точность по {m.verified} слотам</span></div>
        <div className="cap"><b>{avgErr != null ? (avgErr * 100).toFixed(1) : '—'}</b><span>ошибка compliance, п.п.</span></div>
        <div className="cap"><b>{photos}/50</b><span>проверенных фото</span></div>
      </div>
      {m.byModel.length > 0 && m.verified > 0 && (
        <table className="mini-table">
          <thead><tr><th>Модели</th><th>фото</th><th>точность</th><th>ошибка</th></tr></thead>
          <tbody>{m.byModel.map(x => (
            <tr key={x.models}><td title={x.models}>{x.models}</td><td>{x.runs}</td><td>{x.verified ? pct(x.right / x.verified) : '—'}</td><td>{x.error != null ? `${(x.error * 100).toFixed(1)}` : '—'}</td></tr>
          ))}</tbody>
        </table>
      )}
      {worst.length > 0 && (
        <table className="mini-table">
          <thead><tr><th>Хуже всего узнаёт</th><th>слотов</th><th>точность</th></tr></thead>
          <tbody>{worst.map(([id, x]) => (
            <tr key={id}><td title={id}>{name(get, id)}</td><td>{x.verified}</td><td>{pct(x.right / x.verified)}</td></tr>
          ))}</tbody>
        </table>
      )}
      {m.confusions.length > 0 && <p className="hint">Путает: {m.confusions.slice(0, 4).map(([k, n]) => `${k.split(' ↔ ').map(x => name(get, x)).join(' → ')} (${n})`).join('; ')}. Такие пары стоит добавить в «Похожие пачки» или дать им эталоны.</p>}
    </>
  );
}

// Кропы подтверждённых слотов из оригинала фото: ZIP с папками «бренд/модель», как ждёт salesbox-gallery
async function exportCrops(run: IrRun, url: string): Promise<number> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('фото не открылось')); i.src = url; });
  const files: Record<string, Uint8Array> = {};
  const safe = (s: string) => s.replace(/[\\:*?"<>|]/g, '_').trim();
  const stem = safe(run.photoName.replace(/\.[^.]+$/, ''));
  for (const c of galleryCrops(run)) {
    const [x1, y1, x2, y2] = c.box;
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, x2 - x1); cv.height = Math.max(1, y2 - y1);
    cv.getContext('2d')!.drawImage(img, x1, y1, x2 - x1, y2 - y1, 0, 0, cv.width, cv.height);
    const blob = await new Promise<Blob | null>(res => cv.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) continue;
    const [brand, ...model] = c.label.split('/');
    files[`${safe(brand)}/${safe(model.join('/'))}/${stem}-${c.key.replace(':', 'p')}.jpg`] = new Uint8Array(await blob.arrayBuffer());
  }
  const n = Object.keys(files).length;
  files['README.txt'] = strToU8(`Эталоны из сверки «${run.photoName}» (${run.createdAt}): слоты, подтверждённые человеком в Planogram Studio.\nЗалить: uv run salesbox-gallery <папка> --config configs/recognition/siglip2-base-224-shelf.yaml --qdrant recognition_ref\n`);
  downloadBytes(`эталоны-${stem}.zip`, zipSync(files, { level: 0 }), 'application/zip');
  return n;
}

function PhotoView({ run, url, selSlot, onSelect }: { run: IrRun | null; url: string | null; selSlot: string | null; onSelect: (k: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState({ w: 600, h: 600 });
  useEffect(() => {
    if (!url) { setImg(null); return; }
    const i = new Image(); i.onload = () => setImg(i); i.src = url;
  }, [url]);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: r.width, h: r.height }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  const k = img ? Math.min((size.w - 8) / img.naturalWidth, (size.h - 8) / img.naturalHeight) : 1;
  useLayoutEffect(() => {
    const c = cv.current; if (!c || !img || !run) return;
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    const w = img.naturalWidth * k, h = img.naturalHeight * k;
    c.width = Math.round(w * DPR); c.height = Math.round(h * DPR); c.style.width = `${w}px`; c.style.height = `${h}px`;
    const g = c.getContext('2d')!;
    g.setTransform(DPR, 0, 0, DPR, 0, 0);
    g.drawImage(img, 0, 0, w, h);
    const cs = getComputedStyle(document.documentElement);
    run.report.rows.forEach(row => row.slots.forEach(s => {
      if (!s.box) return;
      const key = slotKey(rowKey(row), s.pos);
      const st = truthStatus(run, key, s);
      const [x1, y1, x2, y2] = s.box;
      g.strokeStyle = cs.getPropertyValue(STATUS_TOKEN[st]).trim();
      g.lineWidth = key === selSlot ? 4 : st === 'ok' ? 1.5 : 2.5;
      if (st === 'needs_review') g.setLineDash([5, 4]);
      g.strokeRect(x1 * k, y1 * k, (x2 - x1) * k, (y2 - y1) * k);
      g.setLineDash([]);
    }));
  });
  if (!run) return <div className="photo-stage" ref={box}><div className="drop"><Icon name="camera" size={28} /><p>Загрузите фото агента справа: Studio отправит его в IR вместе с этой планограммой и покажет статус каждого слота.</p></div></div>;
  if (!url) return <div className="photo-stage" ref={box}><div className="drop"><p>Фото этой сверки не сохранено: оригиналы не хранятся ни в браузере, ни в сервисе. Статусы видны на планограмме справа и в списке слотов.</p></div></div>;
  return (
    <div className="photo-stage" ref={box}>
      <canvas ref={cv} role="img" aria-label="Фото агента с боксами слотов"
        onPointerDown={e => {
          if (!run) return;
          const r = cv.current!.getBoundingClientRect();
          const x = (e.clientX - r.left) / k, y = (e.clientY - r.top) / k;
          for (const row of run.report.rows) for (const s of row.slots) {
            if (s.box && x >= s.box[0] && x <= s.box[2] && y >= s.box[1] && y <= s.box[3]) { onSelect(slotKey(rowKey(row), s.pos)); return; }
          }
        }} />
    </div>
  );
}

const name = (get: (id: string) => Sku | undefined, id: string | null | undefined) => (id ? get(id)?.name ?? id : '—');

function modelsOf(models: unknown): string {
  if (!models || typeof models !== 'object') return '';
  return Object.entries(models as Record<string, unknown>).slice(0, 4).map(([k, v]) => {
    const o = v as Record<string, unknown> | null;
    const id = o && typeof o === 'object' ? (o.id ?? o.name ?? o.weights ?? '') : v;
    return `${k} ${String(id).slice(0, 24)}`;
  }).join(' · ');
}

function imageSize(url: string): Promise<[number, number] | null> {
  return new Promise(res => { const i = new Image(); i.onload = () => res([i.naturalWidth, i.naturalHeight]); i.onerror = () => res(null); i.src = url; });
}

// Пример ответа align.py по самой планограмме: чтобы опробовать экран без IR-сервиса
function simulate(p: Planogram, get: (id: string) => Sku | undefined): IrPlanogramReport {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const placed = Object.values(p.rows).flat().map(q => q.sku);
  const counts: Partial<Record<SlotStatus, number>> = {};
  let expected = 0, ok = 0;
  const rows = shelvesTopDown(p.fixture).map((sh, i) => {
    const slots: IrSlot[] = [];
    (p.rows[sh.id] ?? []).forEach(pl => {
      for (let f = 0; f < pl.facings; f++) {
        const r = rnd();
        const exp = irLabel(get(pl.sku), pl.sku);
        let status: SlotStatus = 'ok', sku: string | null = exp;
        if (r < 0.05) { status = 'missing'; sku = null; }
        else if (r < 0.1) { status = 'misplaced'; sku = placed[Math.floor(rnd() * placed.length)]; if (sku === pl.sku) status = 'ok'; }
        else if (r < 0.13) { status = 'needs_review'; sku = null; }
        slots.push({ pos: slots.length + 1, status, sku, expected_sku: exp, conf: status === 'ok' ? 0.8 + rnd() * 0.18 : 0.4 + rnd() * 0.3 });
        expected++; if (status === 'ok') ok++;
        counts[status] = (counts[status] ?? 0) + 1;
      }
    });
    return { fixture: 0, shelf: i + 1, planogram_shelf: i + 1, box: [0, 0, 0, 0] as [number, number, number, number], fill_rate: 0.95, compliance: null, slots };
  });
  return {
    schema_version: '1.0', photo: 'пример', planogram: p.name, fixture: 0, compliance: expected ? ok / expected : null,
    share_of_shelf: {}, osa: {}, counts, needs_review: counts.needs_review ?? 0, rows,
  };
}
