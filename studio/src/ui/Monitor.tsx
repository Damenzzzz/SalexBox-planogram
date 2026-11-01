import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api, ROLE_RU, type Role } from '../domain/api';
import { demoReport, type MonitorReport } from '../domain/monitor';
import { XLSX_TYPE, downloadBytes, xlsx, type Sheet } from '../domain/xlsx';
import { useStore } from '../store';
import { Donut, HBars, VBars } from './Charts';
import { Icon, Seg, pct } from './common';

// Мониторинг: фото агентов с назначенных точек, сверенные с планограммами, и работа команды в
// Studio — по дням, точкам, кластерам и людям. Считает сервер (GET /v1/studio/compliance) в пределах
// клиента. Демо-режим показывает сгенерированные данные с плашкой «Демо-данные» и в базу не пишет.

// Пороги статуса точки: в норме от 90 %, внимание 80–90 %, ниже 80 % — нарушение
const GOOD = 0.9, WARN = 0.8;
type Level = 'ok' | 'warn' | 'bad';
const level = (v: number | null): Level => (v == null || v >= GOOD ? 'ok' : v >= WARN ? 'warn' : 'bad');
const LEVEL_RU: Record<Level, string> = { ok: 'в норме', warn: 'внимание', bad: 'нарушение' };
const LEVEL_ICON: Record<Level, string> = { ok: 'check', warn: 'minus', bad: 'x' };
const LEVEL_COLOR: Record<Level, string> = { ok: 'var(--st-ok)', warn: 'var(--st-misplaced)', bad: 'var(--st-missing)' };

function Status({ v }: { v: number | null }) {
  const l = level(v);
  return <span className={`status status-${l}`}><Icon name={LEVEL_ICON[l]} size={12} />{pct(v)}<span className="sr">{LEVEL_RU[l]}</span></span>;
}

const dayRu = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
const whenRu = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
const skuName = (id: string) => id.split('/').pop() ?? id;
const DEMO_KEY = 'planogram-studio.demo-monitor';

// Плитка-показатель: число, полоса доли и пояснение
function Kpi({ label, value, share, note, color = 'var(--accent)' }: { label: string; value: string; share?: number | null; note: string; color?: string }) {
  return (
    <div className="kpi">
      <span className="l"><i style={{ background: color }} />{label}</span>
      <span className="v">{value}</span>
      {share != null && <span className="kpi-bar"><span style={{ width: `${Math.max(2, Math.min(100, share * 100))}%`, background: color }} /></span>}
      <span className="n">{note}</span>
    </div>
  );
}

export function Monitor() {
  const me = useStore(s => s.me);
  const [days, setDays] = useState<'7' | '30' | '90'>('30');
  const [cluster, setCluster] = useState('');
  const [live, setLive] = useState<MonitorReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const [demo, setDemo] = useState(() => localStorage.getItem(DEMO_KEY) === '1');
  const demoData = useMemo(() => (demo ? demoReport() : null), [demo]);
  const data = demo ? demoData : live;

  useEffect(() => { try { localStorage.setItem(DEMO_KEY, demo ? '1' : '0'); } catch { /* не критично */ } }, [demo]);
  useEffect(() => {
    if (!me || demo) return;
    let alive = true;
    api<MonitorReport>({}, `/v1/studio/compliance?days=${days}&tz=${-new Date().getTimezoneOffset()}`)
      .then(r => { if (alive) { setLive(r); setError(null); } })
      .catch(e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [me, days, rev, demo]);

  const outlets = useMemo(() => {
    if (!data) return [];
    const name = data.by_cluster.find(c => c.cluster_id === cluster)?.cluster;
    return name ? data.by_outlet.filter(o => o.clusters.includes(name)) : data.by_outlet;
  }, [data, cluster]);

  const head = (
    <div className="page-head">
      <div>
        <h1>Мониторинг {demo && <span className="demo-badge">Демо-данные</span>}</h1>
        <p>Каждое фото агента с назначенной точки сравнивается с её планограммой. Соответствие — доля мест на полке, где стоит нужная пачка; наличие — доля обязательных SKU на полке; покрытие — сколько назначенных точек прислали фото.</p>
      </div>
      <div className="actions">
        {!demo && <Seg<'7' | '30' | '90'> label="Период" value={days} options={[['7', '7 дней'], ['30', '30 дней'], ['90', '90 дней']]} onChange={setDays} />}
        <button className="btn btn-sm" aria-pressed={demo} onClick={() => setDemo(v => !v)} title="Сгенерированные данные для показа; в базу не пишутся"><Icon name="chart" size={15} />{demo ? 'Выключить демо' : 'Демо'}</button>
        {data && <button className="btn btn-sm" onClick={() => exportExcel(data, demo)}><Icon name="download" size={15} />Excel</button>}
        {!demo && me && <button className="btn btn-sm" onClick={() => setRev(r => r + 1)}><Icon name="refresh" size={15} />Обновить</button>}
      </div>
    </div>
  );

  if (!me && !demo) {
    return (
      <div className="page monitor">{head}
        <div className="empty"><p>Мониторинг строится по фото с точек на сервере. Войдите кнопкой «Войти» справа вверху.</p></div></div>
    );
  }

  const levels = data ? data.by_outlet.reduce((acc, o) => { acc[level(o.last)]++; return acc; }, { ok: 0, warn: 0, bad: 0 } as Record<Level, number>) : null;
  const act = data?.activity;
  const sum = data?.summary;
  const period = demo ? '5 дней' : `${days} дней`;
  return (
    <div className="page monitor">
      {head}
      {error && !demo && <p className="chip chip-err" style={{ whiteSpace: 'normal', padding: '6px 9px' }}>{error}</p>}
      {!data && !error && <p className="hint" role="status">Загружаю…</p>}
      {data && sum && !sum.photos && !act?.active_users && (
        <div className="empty"><p>За {period} фото с назначенных точек не приходили. Опубликуйте планограмму и назначьте её точкам: каждое фото агента с них попадёт сюда.</p>
          <a className="btn" href="#/outlets"><Icon name="pin" size={15} />К точкам</a></div>
      )}
      {data && sum && (sum.photos > 0 || (act?.active_users ?? 0) > 0) && levels && (
        <>
          <div className="kpis">
            <Kpi label="Соответствие" value={pct(sum.compliance)} share={sum.compliance} note={`среднее по ${sum.photos} фото`} color={LEVEL_COLOR[level(sum.compliance)]} />
            <Kpi label="Наличие must-have" value={pct(sum.osa)} share={sum.osa} note="обязательные SKU на полке" color="var(--seg-3)" />
            <Kpi label="Покрытие точек" value={sum.coverage != null ? pct(sum.coverage) : `${sum.outlets}`} share={sum.coverage ?? null}
              note={sum.assigned_outlets ? `${sum.outlets} из ${sum.assigned_outlets} назначенных прислали фото` : 'точек с фото'} color="var(--seg-1)" />
            <Kpi label="Фото проверено" value={String(sum.photos)} note={`за ${period} · ${sum.outlets} точек`} color="var(--seg-2)" />
            <Kpi label="Команда в Studio" value={String(act?.active_users ?? '—')} note={act ? `входов ${act.by_day.reduce((a, d) => a + d.logins, 0)} · правок ${act.by_day.reduce((a, d) => a + d.edits, 0)}` : 'появится после обновления сервера'} color="var(--ir)" />
          </div>

          <div className="mon-grid">
            <section className="panel">
              <h2>Статус точек</h2>
              <p className="hint">По последнему фото каждой точки.</p>
              <Donut total={data.by_outlet.length} caption="точек" parts={[
                { label: 'В норме, от 90 %', value: levels.ok, color: LEVEL_COLOR.ok },
                { label: 'Внимание, 80–90 %', value: levels.warn, color: LEVEL_COLOR.warn },
                { label: 'Нарушение, ниже 80 %', value: levels.bad, color: LEVEL_COLOR.bad },
              ]} />
            </section>
            <section className="panel">
              <h2>Соответствие по дням</h2>
              <DayChart days={data.by_day} />
            </section>
          </div>

          <div className="mon-grid even">
            <section className="panel">
              <div className="section-head"><h2>Фото агентов по дням</h2><b className="hint">{sum.photos} за период</b></div>
              <VBars unit="фото" data={data.by_day.map(d => ({ label: dayRu(d.day), value: d.photos, hint: `соответствие ${pct(d.compliance)}` }))} color="var(--seg-2)" />
            </section>
            <section className="panel">
              <div className="section-head"><h2>Команда по дням</h2><b className="hint">{act ? `${act.active_users} человек` : ''}</b></div>
              {act?.by_day.length
                ? <VBars unit="человек" data={act.by_day.map(d => ({ label: dayRu(d.day), value: d.users, hint: `входов ${d.logins}, правок ${d.edits}, публикаций ${d.publishes}, проверок ${d.checks}` }))} color="var(--ir)" />
                : <p className="hint">Сервер начнёт считать активность после обновления.</p>}
            </section>
          </div>

          <div className="mon-grid even">
            <section className="panel">
              <h2>Что чаще всего не так</h2>
              <p className="hint">SKU планограммы, которых нет на полке или они стоят не на своём месте: мест за период.</p>
              {data.problems?.length
                ? <HBars data={data.problems.map(p => ({ label: skuName(p.sku), value: p.slots, note: `на ${p.photos} фото` }))} format={v => String(v)} color="var(--st-missing)" />
                : <p className="hint">Нарушений по SKU пока нет.</p>}
            </section>
            <section className="panel">
              <h2>Кластеры</h2>
              <p className="hint">Среднее соответствие по фото точек кластера.</p>
              {data.by_cluster.length
                ? <HBars max={1} data={data.by_cluster.map(c => ({ label: c.cluster, value: c.compliance ?? 0, note: `${c.outlets_seen} из ${c.outlets} точек · ${c.photos} фото`, color: LEVEL_COLOR[level(c.compliance)] }))} format={v => pct(v)} />
                : <p className="hint">Кластеров нет. Их заводят в разделе <a href="#/outlets">«Точки»</a>.</p>}
            </section>
          </div>

          {act && act.users.length > 0 && (
            <section className="panel">
              <div className="section-head"><h2>Команда · {act.users.length}</h2></div>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Кто</th><th>Роль</th><th>Входов</th><th>Правок</th><th>Публикаций</th><th>Проверок фото</th><th>Последний раз</th></tr></thead>
                  <tbody>{act.users.map(u => (
                    <tr key={u.login}><td><b>{u.name}</b> <span className="hint mono">{u.login}</span></td><td>{u.role ? ROLE_RU[u.role as Role] ?? u.role : '—'}</td>
                      <td>{u.login_count}</td><td>{u.edits}</td><td>{u.publishes}</td><td>{u.checks}</td><td>{whenRu(u.last_seen)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </section>
          )}

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

          <section className="panel">
            <h2>Версии планограмм</h2>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Планограмма</th><th>Фото</th><th>Соответствие</th></tr></thead>
              <tbody>{data.by_planogram.map(p => (
                <tr key={p.name}><td>{titleOf(data, p.name)}</td><td>{p.photos}</td><td><Status v={p.compliance} /></td></tr>
              ))}</tbody>
            </table></div>
          </section>
        </>
      )}
    </div>
  );
}

// Выгрузка мониторинга: сводка, точки, кластеры, проблемные SKU, команда, по дням
function exportExcel(d: MonitorReport, demo: boolean) {
  const p = (v: number | null | undefined) => (v == null ? '' : Math.round(v * 1000) / 10);
  const sheets: Sheet[] = [
    { name: 'Сводка', rows: [
      ['Показатель', 'Значение'], ...(demo ? [['Данные', 'демо, сгенерированы для показа'] as [string, string]] : []),
      ['Период, дней', d.days], ['Соответствие, %', p(d.summary.compliance)], ['Наличие must-have, %', p(d.summary.osa)],
      ['Фото', d.summary.photos], ['Точек с фото', d.summary.outlets], ['Назначено точек', d.summary.assigned_outlets ?? ''], ['Покрытие, %', p(d.summary.coverage)],
      ['Активных пользователей', d.activity?.active_users ?? ''],
    ] },
    { name: 'По дням', rows: [['День', 'Фото', 'Соответствие, %', 'Пользователей', 'Входов', 'Правок', 'Публикаций', 'Проверок'],
      ...d.by_day.map(x => { const a = d.activity?.by_day.find(y => y.day === x.day); return [x.day, x.photos, p(x.compliance), a?.users ?? '', a?.logins ?? '', a?.edits ?? '', a?.publishes ?? '', a?.checks ?? '']; })] },
    { name: 'Точки', rows: [['Точка', 'Кластеры', 'Последнее фото', 'Последнее, %', 'Среднее, %', 'Фото', 'Планограмма'],
      ...d.by_outlet.map(o => [o.outlet_id, o.clusters.join(', '), o.last_at.slice(0, 16).replace('T', ' '), p(o.last), p(o.compliance), o.photos, o.planogram ?? ''])] },
    { name: 'Кластеры', rows: [['Кластер', 'Точек', 'С фото', 'Фото', 'Соответствие, %'], ...d.by_cluster.map(c => [c.cluster, c.outlets, c.outlets_seen, c.photos, p(c.compliance)])] },
    { name: 'Проблемные SKU', rows: [['SKU', 'Мест не так', 'Фото'], ...(d.problems ?? []).map(x => [x.sku, x.slots, x.photos])] },
    { name: 'Команда', rows: [['Имя', 'Логин', 'Роль', 'Входов', 'Правок', 'Публикаций', 'Проверок', 'Последний раз'],
      ...(d.activity?.users ?? []).map(u => [u.name, u.login, u.role ?? '', u.login_count, u.edits, u.publishes, u.checks, u.last_seen.slice(0, 16).replace('T', ' ')])] },
  ];
  downloadBytes(`мониторинг${demo ? ' (демо)' : ''} ${new Date().toISOString().slice(0, 10)}.xlsx`, xlsx(sheets), XLSX_TYPE);
}

function titleOf(data: MonitorReport, name: string | null) {
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
function DayChart({ days }: { days: MonitorReport['by_day'] }) {
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
  // ось от ближайших 10 % ниже минимума: изменения в пару пунктов видны, а не прижаты к верху
  const lo = Math.max(0, Math.floor((Math.min(WARN, ...pts.map(d => d.compliance!)) - 0.05) * 10) / 10);
  const y = (v: number) => pad.t + (1 - (v - lo) / (1 - lo)) * ih;
  const ticks = [lo, (lo + 1) / 2, 1];
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
        {ticks.map(v => (
          <g key={v}><line x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} className="grid" /><text x={pad.l - 6} y={y(v) + 4} className="axis" textAnchor="end">{Math.round(v * 100)} %</text></g>
        ))}
        <line x1={pad.l} x2={w - pad.r} y1={y(WARN)} y2={y(WARN)} className="threshold" />
        <text x={pad.l + 4} y={y(WARN) - 5} className="axis" textAnchor="start">порог {WARN * 100} %</text>
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
