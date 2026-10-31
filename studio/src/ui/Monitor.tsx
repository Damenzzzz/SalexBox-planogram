import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../domain/api';
import { useStore } from '../store';
import { Icon, Seg, pct } from './common';

// Мониторинг: фото агентов с назначенных точек, сверенные с планограммами, — по дням, точкам,
// кластерам и версиям. Считает сервер (GET /v1/studio/compliance) в пределах клиента.

interface Outlet { outlet_id: string; photos: number; compliance: number | null; last: number; last_at: string; planogram: string | null; trend: number[]; clusters: string[] }
interface Report {
  days: number;
  summary: { photos: number; outlets: number; compliance: number | null; osa: number | null };
  by_day: { day: string; photos: number; compliance: number | null }[];
  by_outlet: Outlet[];
  by_cluster: { cluster_id: string; cluster: string; outlets: number; outlets_seen: number; photos: number; compliance: number | null }[];
  by_planogram: { name: string; title: string | null; version: number | null; photos: number; compliance: number | null }[];
}

// Пороги статуса точки: в норме от 90 %, внимание 80–90 %, ниже 80 % — нарушение
const GOOD = 0.9, WARN = 0.8;
type Level = 'ok' | 'warn' | 'bad';
const level = (v: number | null): Level => (v == null || v >= GOOD ? 'ok' : v >= WARN ? 'warn' : 'bad');
const LEVEL_RU: Record<Level, string> = { ok: 'в норме', warn: 'внимание', bad: 'нарушение' };
const LEVEL_ICON: Record<Level, string> = { ok: 'check', warn: 'minus', bad: 'x' };

function Status({ v }: { v: number | null }) {
  const l = level(v);
  return <span className={`status status-${l}`}><Icon name={LEVEL_ICON[l]} size={12} />{pct(v)}<span className="sr">{LEVEL_RU[l]}</span></span>;
}

const dayRu = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const whenRu = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

export function Monitor() {
  const me = useStore(s => s.me);
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [cluster, setCluster] = useState('');
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);

  useEffect(() => {
    if (!me) return;
    let alive = true;
    api<Report>({}, `/v1/studio/compliance?days=${days}&tz=${-new Date().getTimezoneOffset()}`)
      .then(r => { if (alive) { setData(r); setError(null); } })
      .catch(e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [me, days, rev]);

  const outlets = useMemo(() => {
    if (!data) return [];
    const name = data.by_cluster.find(c => c.cluster_id === cluster)?.cluster;
    return name ? data.by_outlet.filter(o => o.clusters.includes(name)) : data.by_outlet;
  }, [data, cluster]);

  if (!me) {
    return (
      <div className="page"><div className="page-head"><div><h1>Мониторинг</h1>
        <p>Как точки держат планограмму: процент соответствия по каждому фото агента, по дням, точкам и кластерам.</p></div></div>
        <div className="empty"><p>Мониторинг строится по фото с точек на сервере. Войдите кнопкой «Войти» справа вверху.</p></div></div>
    );
  }

  const bad = data ? data.by_outlet.filter(o => level(o.last) === 'bad').length : 0;
  return (
    <div className="page monitor">
      <div className="page-head">
        <div>
          <h1>Мониторинг</h1>
          <p>Каждое фото агента с назначенной точки сравнивается с её планограммой. Процент соответствия — доля мест на полке, где стоит нужная пачка. Наличие — доля обязательных SKU, которые есть на полке.</p>
        </div>
        <div className="actions">
          <Seg<'7' | '30' | '90'> label="Период" value={days} options={[['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней']]} onChange={setDays} />
          <button className="btn btn-sm" onClick={() => setRev(r => r + 1)}><Icon name="refresh" size={15} />Обновить</button>
        </div>
      </div>
      {error && <p className="chip chip-err" style={{ whiteSpace: 'normal', padding: '6px 9px' }}>{error}</p>}
      {!data && !error && <p className="hint" role="status">Загружаю…</p>}
      {data && !data.summary.photos && (
        <div className="empty"><p>За {days} дней фото с назначенных точек не приходили. Опубликуйте планограмму и назначьте её точкам: каждое фото агента с них попадёт сюда.</p>
          <a className="btn" href="#/outlets"><Icon name="pin" size={15} />К точкам</a></div>
      )}
      {data && data.summary.photos > 0 && (
        <>
          <div className="tiles">
            <div className="tile"><span className="l">Соответствие</span><span className="v">{pct(data.summary.compliance)}</span><span className="n">среднее по {data.summary.photos} фото</span></div>
            <div className="tile"><span className="l">Наличие must-have</span><span className="v">{pct(data.summary.osa)}</span><span className="n">обязательные SKU на полке</span></div>
            <div className="tile"><span className="l">Точек с фото</span><span className="v">{data.summary.outlets}</span><span className="n">за {days} дней</span></div>
            <div className="tile"><span className="l">Ниже {Math.round(WARN * 100)} %</span><span className="v">{bad}</span><span className="n">точек по последнему фото</span></div>
          </div>

          <section className="panel">
            <h2>Соответствие по дням</h2>
            <DayChart days={data.by_day} />
          </section>

          <section className="panel">
            <div className="section-head">
              <h2>Точки · {outlets.length}</h2>
              {data.by_cluster.length > 0 && (
                <select className="select" style={{ width: 220 }} aria-label="Кластер" value={cluster} onChange={e => setCluster(e.target.value)}>
                  <option value="">Все кластеры</option>
                  {data.by_cluster.map(c => <option key={c.cluster_id} value={c.cluster_id}>{c.cluster}</option>)}
                </select>
              )}
            </div>
            <p className="hint">Сверху — точки с худшим последним фото. Статус: в норме от {Math.round(GOOD * 100)} %, внимание от {Math.round(WARN * 100)} %, ниже — нарушение.</p>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Точка</th><th>Кластеры</th><th>Последнее фото</th><th>Соответствие</th><th>Среднее</th><th>Динамика</th><th>Фото</th><th>Планограмма</th></tr></thead>
                <tbody>{outlets.map(o => (
                  <tr key={o.outlet_id}>
                    <td className="mono">{o.outlet_id}</td>
                    <td>{o.clusters.join(', ') || '—'}</td>
                    <td>{whenRu(o.last_at)}</td>
                    <td><Status v={o.last} /></td>
                    <td>{pct(o.compliance)}</td>
                    <td><Spark values={o.trend} /></td>
                    <td>{o.photos}</td>
                    <td>{titleOf(data, o.planogram)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>

          <div className="grid2 monitor-pair">
            <section className="panel">
              <h2>Кластеры</h2>
              {data.by_cluster.length ? (
                <table className="table">
                  <thead><tr><th>Кластер</th><th>Точек с фото</th><th>Фото</th><th>Соответствие</th></tr></thead>
                  <tbody>{data.by_cluster.map(c => (
                    <tr key={c.cluster_id}><td>{c.cluster}</td><td>{c.outlets_seen} из {c.outlets}</td><td>{c.photos}</td><td>{c.photos ? <Status v={c.compliance} /> : '—'}</td></tr>
                  ))}</tbody>
                </table>
              ) : <p className="hint">Кластеров нет. Их заводят в разделе <a href="#/outlets">«Точки»</a>.</p>}
            </section>
            <section className="panel">
              <h2>Версии планограмм</h2>
              <table className="table">
                <thead><tr><th>Планограмма</th><th>Фото</th><th>Соответствие</th></tr></thead>
                <tbody>{data.by_planogram.map(p => (
                  <tr key={p.name}><td>{titleOf(data, p.name)}</td><td>{p.photos}</td><td><Status v={p.compliance} /></td></tr>
                ))}</tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function titleOf(data: Report, name: string | null) {
  if (!name) return '—';
  const p = data.by_planogram.find(x => x.name === name);
  return p?.title ? `${p.title}${p.version ? ` · v${p.version}` : ''}` : <span className="mono hint">{name}</span>;
}

// Мини-график последних фото точки: одна линия, без осей
function Spark({ values }: { values: number[] }) {
  const w = 84, h = 22;
  if (values.length < 2) return <span className="hint">—</span>;
  const x = (i: number) => (i / (values.length - 1)) * (w - 4) + 2;
  const y = (v: number) => h - 2 - v * (h - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const last = values[values.length - 1];
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Динамика: ${values.map(v => Math.round(v * 100)).join(', ')} %`}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={x(values.length - 1)} cy={y(last)} r={2.5} className={`dot-${level(last)}`} />
    </svg>
  );
}

// Соответствие по дням: линия 0–100 %, пунктир — порог; наведение показывает день
function DayChart({ days }: { days: Report['by_day'] }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(800);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const h = 200, pad = { l: 40, r: 12, t: 10, b: 24 };
  const pts = days.filter(d => d.compliance != null);
  if (!pts.length) return <p className="hint">Нет данных.</p>;
  const iw = Math.max(1, w - pad.l - pad.r), ih = h - pad.t - pad.b;
  const x = (i: number) => pad.l + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v: number) => pad.t + (1 - v) * ih;
  const path = pts.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.compliance!).toFixed(1)}`).join('');
  const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(iw / 70))));
  const near = (clientX: number) => {
    const r = box.current!.getBoundingClientRect();
    const i = Math.round(((clientX - r.left - pad.l) / iw) * (pts.length - 1));
    return Math.min(pts.length - 1, Math.max(0, i));
  };
  const hv = hover != null ? pts[hover] : null;
  return (
    <div className="chart" ref={box} onPointerMove={e => setHover(near(e.clientX))} onPointerLeave={() => setHover(null)}>
      <svg width={w} height={h} role="img" aria-label={`Соответствие по дням: ${pts.map(d => `${dayRu(d.day)} ${Math.round(d.compliance! * 100)} %`).join('; ')}`}>
        {[0, 0.5, 1].map(v => (
          <g key={v}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="grid" /><text x={pad.l - 6} y={y(v) + 4} className="axis" textAnchor="end">{v * 100} %</text></g>
        ))}
        <line x1={pad.l} x2={w - pad.r} y1={y(WARN)} y2={y(WARN)} className="threshold" />
        <text x={w - pad.r} y={y(WARN) - 4} className="axis" textAnchor="end">порог {WARN * 100} %</text>
        {pts.map((d, i) => (i % step === 0 || i === pts.length - 1) && (
          <text key={d.day} x={x(i)} y={h - 6} className="axis" textAnchor={pts.length > 1 && i === pts.length - 1 ? 'end' : i === 0 && pts.length > 1 ? 'start' : 'middle'}>{dayRu(d.day)}</text>
        ))}
        <path d={path} className="line" />
        {pts.length < 40 && pts.map((d, i) => <circle key={d.day} cx={x(i)} cy={y(d.compliance!)} r={3} className="pt" />)}
        {hv && <><line x1={x(hover!)} x2={x(hover!)} y1={pad.t} y2={pad.t + ih} className="cross" /><circle cx={x(hover!)} cy={y(hv.compliance!)} r={5} className="pt pt-on" /></>}
      </svg>
      {hv && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(x(hover!) - 70, 0), w - 150) }}>
          <b>{dayRu(hv.day)}</b><span>соответствие {pct(hv.compliance)}</span><span>фото: {hv.photos}</span>
        </div>
      )}
    </div>
  );
}
