import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../domain/api';
import { uid } from '../domain/geometry';
import type { Cluster, Planogram } from '../domain/types';
import { useStore } from '../store';
import { Icon } from './common';
import { STATUS_NAME } from './Planograms';

const parse = (s: string) => [...new Set(s.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];

interface Assignment { outlet_id: string; planogram: string; assigned_at: string; via?: 'outlet' | 'cluster'; cluster?: string | null }

export function Outlets() {
  const clusters = useStore(s => s.clusters);
  const planograms = useStore(s => s.planograms);
  const snapshots = useStore(s => s.snapshots);
  const { saveCluster, deleteCluster, notify } = useStore.getState();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [live, setLive] = useState<Assignment[] | null>(null);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLiveErr(null);
    try { setLive((await api<{ items: Assignment[] }>({}, '/v1/assignments')).items); }
    catch (e) { setLive(null); setLiveErr((e as Error).message); }
  }, []);
  const me = useStore(s => s.me);
  useEffect(() => { if (me) load(); else setLive(null); }, [me, load]);

  // имя в IR → планограмма Studio: текущая версия или сохранённая (после публикации могли начать следующую)
  const byName = useMemo(() => {
    const m = new Map<string, { p: Planogram; version: number }>();
    snapshots.forEach(v => { const p = planograms.find(q => q.id === v.planogramId); if (p && v.data.publishedAs) m.set(v.data.publishedAs, { p, version: v.version }); });
    planograms.forEach(p => { if (p.publishedAs) m.set(p.publishedAs, { p, version: p.version }); });
    return m;
  }, [planograms, snapshots]);
  const clusterOf = useMemo(() => {
    const m = new Map<string, string[]>();
    clusters.forEach(c => c.outlets.forEach(o => m.set(o, [...(m.get(o) ?? []), c.name])));
    return m;
  }, [clusters]);
  const rows = (live ?? []).filter(a => !q || a.outlet_id.toLowerCase().includes(q.toLowerCase()) || a.planogram.includes(q));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Точки</h1>
          <p>Кластер — группа точек с одной планограммой: сеть, город, формат магазина. При публикации планограмму назначают кластерам и отдельным точкам, и IR сверяет фото этих точек с ней сам.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => saveCluster({ id: uid('cl'), name: `Кластер ${clusters.length + 1}`, outlets: [], updatedAt: '' })}><Icon name="plus" />Новый кластер</button>
        </div>
      </div>

      {!clusters.length && <div className="empty"><p>Кластеров пока нет. Заведите, например, «Алматы · АЗС» и вставьте список outlet_id из Salesbox.</p></div>}
      <div className="cards cluster-cards">
        {clusters.map(c => <ClusterCard key={c.id} c={c} onSave={saveCluster}
          onDelete={() => { if (confirm === c.id) { deleteCluster(c.id); setConfirm(null); notify('Кластер удалён'); } else setConfirm(c.id); }}
          confirm={confirm === c.id} used={planograms.filter(p => p.assign.clusters.includes(c.id)).map(p => `${p.name} v${p.version}`)} />)}
      </div>

      <section className="panel">
        <div className="section-head">
          <h2>Что назначено точкам</h2>
          <div className="row-actions">
            <input className="input" type="search" placeholder="outlet_id или планограмма" value={q} onChange={e => setQ(e.target.value)} aria-label="Поиск по точкам" style={{ width: 220 }} />
            <button className="btn btn-sm" onClick={load}><Icon name="refresh" size={15} />С сервера</button>
          </div>
        </div>
        {liveErr && <p className="hint">Сервер не ответил: {liveErr}. Ниже — назначения из этого браузера.</p>}
        {live ? (
          rows.length ? (
            <table className="table">
              <thead><tr><th>Точка</th><th>Кластеры</th><th>Как назначена</th><th>Планограмма</th><th>Назначено</th></tr></thead>
              <tbody>{rows.map(a => {
                const hit = byName.get(a.planogram);
                return (
                  <tr key={a.outlet_id}>
                    <td className="mono">{a.outlet_id}</td><td>{clusterOf.get(a.outlet_id)?.join(', ') ?? '—'}</td>
                    <td>{a.via === 'cluster' ? `через кластер «${a.cluster}»` : 'напрямую'}</td>
                    <td>{hit ? <a href={`#/planogram/${hit.p.id}`}>{hit.p.name} · v{hit.version}{hit.p.version !== hit.version ? ` (в работе v${hit.p.version})` : ` · ${STATUS_NAME[hit.p.status]}`}</a> : <span className="mono hint">{a.planogram}</span>}</td>
                    <td>{new Date(a.assigned_at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          ) : <p className="hint">На сервере назначений нет{q ? ' по этому поиску' : ''}. Их создаёт публикация планограммы.</p>
        ) : (
          <table className="table">
            <thead><tr><th>Планограмма</th><th>Опубликована как</th><th>Кластеры</th><th>Точки</th></tr></thead>
            <tbody>{planograms.filter(p => p.publishedAs || p.assign.clusters.length || p.assign.outlets.length).map(p => (
              <tr key={p.id}>
                <td><a href={`#/planogram/${p.id}`}>{p.name}</a> · v{p.version}</td><td className="mono">{p.publishedAs ?? '—'}</td>
                <td>{p.assign.clusters.map(id => clusters.find(c => c.id === id)?.name ?? id).join(', ') || '—'}</td>
                <td className="mono">{p.assign.outlets.join(', ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ClusterCard({ c, onSave, onDelete, confirm, used }: { c: Cluster; onSave: (c: Cluster) => void; onDelete: () => void; confirm: boolean; used: string[] }) {
  const [text, setText] = useState(c.outlets.join('\n'));
  useEffect(() => { setText(c.outlets.join('\n')); }, [c.outlets]);
  return (
    <article className="lib-card cluster">
      <div className="lib-body">
        <input className="input cluster-name" aria-label="Название кластера" value={c.name} onChange={e => onSave({ ...c, name: e.target.value })} />
        <label className="field"><span>Точки (outlet_id) · {c.outlets.length}</span>
          <textarea className="input mono" rows={5} value={text} placeholder="out_014&#10;out_015" onChange={e => setText(e.target.value)}
            onBlur={() => { const next = parse(text); if (next.join('|') !== c.outlets.join('|')) onSave({ ...c, outlets: next }); }} /></label>
        <p className="hint">{used.length ? `В планограммах: ${used.join(', ')}` : 'Пока не выбран ни в одной планограмме'}</p>
        <div className="lib-actions">
          <button className={`btn btn-sm ${confirm ? 'btn-danger' : ''}`} onClick={onDelete}><Icon name="trash" size={15} />{confirm ? 'Точно удалить' : 'Удалить'}</button>
        </div>
      </div>
    </article>
  );
}
