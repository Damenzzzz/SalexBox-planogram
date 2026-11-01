import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../domain/api';
import { uid } from '../domain/geometry';
import { clusterTree, parentOptions, type ClusterNode } from '../domain/clusters';
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
  const tree = useMemo(() => clusterTree(clusters), [clusters]);

  const load = useCallback(async () => {
    setLiveErr(null);
    try { setLive((await api<{ items: Assignment[] }>({}, '/v1/assignments')).items); }
    catch (e) { setLive(null); setLiveErr((e as Error).message); }
  }, []);
  const server = useStore(s => s.server);
  useEffect(() => { if (server) load(); else setLive(null); }, [server, load]);

  // имя в IR → планограмма Studio: текущая версия или сохранённая (после публикации могли начать следующую)
  const byName = useMemo(() => {
    const m = new Map<string, { p: Planogram; version: number }>();
    snapshots.forEach(v => { const p = planograms.find(q => q.id === v.planogramId); if (p && v.data.publishedAs) m.set(v.data.publishedAs, { p, version: v.version }); });
    planograms.forEach(p => { if (p.publishedAs) m.set(p.publishedAs, { p, version: p.version }); });
    return m;
  }, [planograms, snapshots]);
  const clusterOf = useMemo(() => {
    const m = new Map<string, string[]>();
    tree.forEach(n => n.outlets.forEach(o => m.set(o, [...(m.get(o) ?? []), n.path])));
    return m;
  }, [tree]);
  const rows = (live ?? []).filter(a => !q || a.outlet_id.toLowerCase().includes(q.toLowerCase()) || a.planogram.includes(q));
  const add = (parentId: string | null, name: string) => saveCluster({ id: uid('cl'), name, outlets: [], parentId, updatedAt: '' });
  const remove = (n: ClusterNode) => {
    // подкластеры не пропадают: поднимаются на уровень удалённого
    clusters.filter(c => c.parentId === n.c.id).forEach(c => saveCluster({ ...c, parentId: n.c.parentId ?? null }));
    deleteCluster(n.c.id);
    setConfirm(null);
    notify(`Кластер «${n.c.name}» удалён${n.children.length ? ', подкластеры поднялись на уровень выше' : ''}`);
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Точки</h1>
          <p>Кластер — группа точек с одной планограммой: город, сеть, формат магазина. Кластеры вкладываются друг в друга: «Алматы» → «Супермаркет Южный». Точки подкластера входят и в родителя, поэтому планограмма «Алматы» действует на все его подкластеры, а своя планограмма подкластера её перекрывает.</p>
        </div>
        <div className="actions">
          <button className="btn btn-primary" onClick={() => add(null, `Кластер ${clusters.length + 1}`)}><Icon name="plus" />Новый кластер</button>
        </div>
      </div>

      {!clusters.length && <div className="empty"><p>Кластеров пока нет. Заведите, например, «Алматы», а внутри него «Супермаркет Южный», и вставьте список outlet_id из Salesbox.</p></div>}
      <div className="cluster-tree">
        {tree.map(n => (
          <ClusterCard key={n.c.id} n={n} tree={tree} onSave={saveCluster} onAddChild={() => add(n.c.id, 'Новый подкластер')}
            onDelete={() => (confirm === n.c.id ? remove(n) : setConfirm(n.c.id))} confirm={confirm === n.c.id}
            used={planograms.filter(p => p.assign.clusters.includes(n.c.id)).map(p => `${p.name} v${p.version}`)} />
        ))}
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
                <td>{p.assign.clusters.map(id => tree.find(n => n.c.id === id)?.path ?? id).join(', ') || '—'}</td>
                <td className="mono">{p.assign.outlets.join(', ') || '—'}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function ClusterCard({ n, tree, onSave, onAddChild, onDelete, confirm, used }: {
  n: ClusterNode; tree: ClusterNode[]; onSave: (c: Cluster) => void; onAddChild: () => void; onDelete: () => void; confirm: boolean; used: string[];
}) {
  const c = n.c;
  const [text, setText] = useState(c.outlets.join('\n'));
  useEffect(() => { setText(c.outlets.join('\n')); }, [c.outlets]);
  const parents = useMemo(() => parentOptions(tree, c.id), [tree, c.id]);
  const parent = tree.find(x => x.c.id === c.parentId);
  const sub = n.outlets.length - c.outlets.length;
  return (
    <article className={`cluster-node depth-${Math.min(n.depth, 4)}`} style={{ marginLeft: n.depth * 28 }}>
      <div className="cluster-head">
        <input className="input cluster-name" aria-label="Название кластера" value={c.name} onChange={e => onSave({ ...c, name: e.target.value })} />
        <span className="chip">{n.outlets.length} точек{sub > 0 ? ` · ${sub} в подкластерах` : ''}</span>
      </div>
      {parent && <p className="hint">Входит в «{parent.path}»</p>}
      <div className="cluster-body">
        <label className="field"><span>Свои точки (outlet_id, через запятую или с новой строки) · {c.outlets.length}</span>
          <textarea className="input mono" rows={3} value={text} placeholder="out_014&#10;out_015" onChange={e => setText(e.target.value)}
            onBlur={() => { const next = parse(text); if (next.join('|') !== c.outlets.join('|')) onSave({ ...c, outlets: next }); }} /></label>
        <label className="field"><span>Входит в</span>
          <select className="select" value={c.parentId ?? ''} onChange={e => onSave({ ...c, parentId: e.target.value || null })}>
            <option value="">— верхний уровень —</option>
            {parents.map(x => <option key={x.c.id} value={x.c.id}>{'  '.repeat(x.depth)}{x.path}</option>)}
          </select></label>
      </div>
      <p className="hint">{used.length ? `Планограммы: ${used.join(', ')}` : parent ? 'Своей планограммы нет: действует планограмма родителя, если она назначена' : 'Пока не выбран ни в одной планограмме'}</p>
      <div className="lib-actions">
        <button className="btn btn-sm" onClick={onAddChild}><Icon name="plus" size={14} />Подкластер</button>
        <button className={`btn btn-sm ${confirm ? 'btn-danger' : 'btn-ghost'}`} onClick={onDelete}><Icon name="trash" size={14} />{confirm ? 'Точно удалить' : 'Удалить'}</button>
      </div>
    </article>
  );
}
