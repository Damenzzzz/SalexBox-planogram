import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, jsonBody } from '../domain/api';
import { analyse } from '../domain/checks';
import { clusterTree } from '../domain/clusters';
import { capacity } from '../domain/geometry';
import { irName, toIrYaml } from '../domain/irExport';
import { autoLayout, fitToFixture } from '../domain/layout';
import type { Planogram, Sku, Snapshot } from '../domain/types';
import { ACTION_RU, diffPlanograms, restoreFrom, withEntry, type Change } from '../domain/versions';
import { go, keepSnapshot, runSync, useStore } from '../store';
import { Icon, Modal, SceneThumb } from './common';
import { STATUS_NAME } from './Planograms';

type Get = (id: string) => Sku | undefined;

const STATUS_CHIP = { draft: 'chip', review: 'chip chip-warn', approved: 'chip chip-ok', published: 'chip chip-accent' } as const;

const fmt = (iso: string) => new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });

// ---------- статус и следующее действие ----------
export function WorkflowBar({ p, get }: { p: Planogram; get: Get }) {
  const [modal, setModal] = useState<null | 'review' | 'approve' | 'return' | 'publish'>(null);
  const { savePlanogram, notify } = useStore.getState();
  const act = (action: 'review' | 'approved' | 'returned', note: string) => {
    const status = action === 'review' ? 'review' : action === 'approved' ? 'approved' : 'draft';
    const next = withEntry(p, action, note, status);
    savePlanogram(next);
    if (action !== 'returned') keepSnapshot(next, `v${p.version} · ${STATUS_NAME[status].toLowerCase()}`);
    setModal(null);
    notify(`${ACTION_RU[action]}${note ? `: ${note}` : ''}`);
  };
  return (
    <>
      <span className={STATUS_CHIP[p.status]}>{STATUS_NAME[p.status]}</span>
      <span className="chip">версия {p.version}</span>
      {p.status === 'draft' && <button className="btn btn-sm" onClick={() => setModal('review')}><Icon name="send" size={15} />На согласование</button>}
      {p.status === 'review' && <>
        <button className="btn btn-sm btn-primary" onClick={() => setModal('approve')}><Icon name="check" size={15} />Утвердить</button>
        <button className="btn btn-sm" onClick={() => setModal('return')}>Вернуть</button>
      </>}
      {p.status === 'approved' && <button className="btn btn-sm btn-primary" onClick={() => setModal('publish')}><Icon name="cloud" size={15} />Опубликовать</button>}
      {p.status === 'published' && <button className="btn btn-sm" onClick={() => setModal('publish')} title={p.publishedAs ?? ''}><Icon name="pin" size={15} />Точки · {p.assign.outlets.length + p.assign.clusters.length ? 'назначены' : 'нет'}</button>}
      {(modal === 'review' || modal === 'approve' || modal === 'return') && (
        <NoteModal p={p} get={get} kind={modal} onClose={() => setModal(null)}
          onDone={note => act(modal === 'review' ? 'review' : modal === 'approve' ? 'approved' : 'returned', note)} />
      )}
      {modal === 'publish' && <PublishModal p={p} get={get} onClose={() => setModal(null)} />}
    </>
  );
}

function NoteModal({ p, get, kind, onClose, onDone }: { p: Planogram; get: Get; kind: 'review' | 'approve' | 'return'; onClose: () => void; onDone: (note: string) => void }) {
  const [note, setNote] = useState('');
  const a = useMemo(() => analyse(p, get), [p, get]);
  const errors = a.issues.filter(i => i.sev === 'error').length, contract = a.issues.filter(i => i.sev === 'contract').length;
  const title = { review: 'Отправить на согласование', approve: 'Утвердить планограмму', return: 'Вернуть на доработку' }[kind];
  const need = kind === 'return' && !note.trim();
  return (
    <Modal title={title} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" disabled={need} onClick={() => onDone(note.trim())}>{kind === 'return' ? 'Вернуть' : kind === 'approve' ? 'Утвердить' : 'Отправить'}</button>
    </>}>
      <p>{p.name} · версия {p.version} · {p.fixture.code}</p>
      {kind !== 'return' && (errors || contract) ? (
        <p className="chip chip-warn" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>
          В планограмме {errors ? `${errors} ошибок` : ''}{errors && contract ? ' и ' : ''}{contract ? `${contract} нарушений контракта` : ''}. Их видно в «Проверках» под холстом.
        </p>
      ) : kind !== 'return' ? <p className="hint">Проверки пройдены.</p> : null}
      <label className="field"><span>{kind === 'return' ? 'Что исправить (обязательно)' : 'Комментарий'}</span>
        <textarea className="input" rows={3} value={note} onChange={e => setNote(e.target.value)} placeholder={kind === 'return' ? 'Например: Marlboro Red на уровень глаз, доля JTI ниже контракта' : 'необязательно'} /></label>
      <p className="hint">{kind === 'approve' ? 'После утверждения правка раскладки начнёт новую версию: эта сохранится в истории без изменений.' : 'Запись попадёт в историю версий.'}</p>
    </Modal>
  );
}

const parseOutlets = (s: string) => [...new Set(s.split(/[\s,;]+/).map(x => x.trim()).filter(Boolean))];

// Ответ сервера на публикацию: что станет с точками. dry_run — то же без записи, для предпросмотра
interface Ref { name: string; title: string | null; version: number | null }
interface PublishPlan {
  outlets: number;
  taken: { outlet_id: string; from: Ref }[];
  kept: { outlet_id: string; by: Ref }[];
  clusters_taken: { cluster_id: string; cluster: string; from: Ref }[];
  dropped: string[];
  unknown_clusters: string[];
}
const refName = (r: Ref) => `«${r.title ?? r.name}»${r.version ? ` v${r.version}` : ''}`;
const listShort = (xs: string[], n = 8) => `${xs.slice(0, n).join(', ')}${xs.length > n ? ` и ещё ${xs.length - n}` : ''}`;

function PublishModal({ p, get, onClose }: { p: Planogram; get: Get; onClose: () => void }) {
  const server = useStore(s => s.server);
  const clusters = useStore(s => s.clusters);
  const { savePlanogram, notify } = useStore.getState();
  const [chosen, setChosen] = useState<string[]>(p.assign.clusters);
  const [extra, setExtra] = useState((p.assign.outlets.length ? p.assign.outlets : p.outlet ? [p.outlet] : []).join(', '));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PublishPlan | null>(null);
  const [agree, setAgree] = useState(false);
  const name = p.publishedAs ?? irName(p);
  const yaml = useMemo(() => toIrYaml(p, get), [p, get]);
  const outlets = useMemo(() => parseOutlets(extra), [extra]);

  const request = useCallback((dryRun: boolean) => api<PublishPlan>({}, `/v1/planograms/${encodeURIComponent(name)}/publish`, {
    method: 'POST',
    body: jsonBody({ yaml, planogram_id: p.id, version: p.version, title: p.name, clusters: chosen, outlets, dry_run: dryRun }),
  }), [name, yaml, p.id, p.version, p.name, chosen, outlets]);

  // Предпросмотр: сначала кластеры уходят на сервер, потом пробная публикация показывает, что изменится
  useEffect(() => {
    if (!server) return;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        await runSync();
        const r = await request(true);
        if (alive) { setPlan(r); setError(null); setAgree(false); }
      } catch (e) { if (alive) setError((e as Error).message); }
    }, 350);
    return () => { alive = false; clearTimeout(t); };
  }, [server, request]);

  const conflicts = (plan?.taken.length ?? 0) + (plan?.clusters_taken.length ?? 0);
  const publish = async () => {
    setError(null);
    try {
      setBusy('Публикую…');
      const r = await request(false);
      const first = p.status !== 'published';
      const next = withEntry({ ...p, status: 'published', publishedAs: name, assign: { clusters: chosen, outlets } },
        'published', `точек ${r.outlets}${r.taken.length ? `, перехвачено ${r.taken.length}` : ''}${r.dropped.length ? `, снято с ${r.dropped.length}` : ''}`);
      savePlanogram(next);
      if (first) keepSnapshot(next, `v${p.version} · опубликована`);
      notify(`Опубликовано: точек ${r.outlets}. Фото с них проверяются по этой версии`);
      onClose();
    } catch (e) {
      const msg = (e as Error).message;
      setError(msg.includes('409') ? 'Эта версия уже опубликована с другим содержимым. Начните новую версию: любая правка раскладки' : msg);
    } finally { setBusy(null); }
  };

  return (
    <Modal title={p.status === 'published' ? 'Точки опубликованной версии' : 'Опубликовать'} onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" disabled={!!busy || !server || !plan || (conflicts > 0 && !agree)} onClick={publish}><Icon name="cloud" size={15} />{p.status === 'published' ? 'Сохранить точки' : 'Опубликовать'}</button>
    </>}>
      {!server && <p className="chip chip-warn" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>Публикация идёт на сервер: сначала подключите его (кнопка «Подключить» в шапке).</p>}
      <p>Версия <b>{p.version}</b> уйдёт на проверку фото{server ? <> клиента <b>{server.client}</b></> : null}. Опубликованную версию нельзя изменить: правка начнёт следующую.</p>
      <div className="field"><span>Кластеры точек</span>
        {clusters.length ? (
          <div className="check-list">
            {clusterTree(clusters).map(n => (
              <label key={n.c.id} className="check" style={{ paddingLeft: n.depth * 22 }}><input type="checkbox" checked={chosen.includes(n.c.id)} onChange={e => setChosen(v => (e.target.checked ? [...v, n.c.id] : v.filter(x => x !== n.c.id)))} />
                {n.c.name} <span className="hint">· {n.outlets.length} точек{n.children.length ? ', с подкластерами' : ''}</span></label>
            ))}
          </div>
        ) : <p className="hint">Кластеров пока нет. Их заводят в разделе <a href="#/outlets" onClick={onClose}>«Точки»</a>.</p>}
      </div>
      <label className="field"><span>Отдельные точки (outlet_id через запятую или с новой строки)</span>
        <textarea className="input mono" rows={3} value={extra} onChange={e => setExtra(e.target.value)} placeholder="out_014, out_015" /></label>

      {plan && (
        <div className="publish-plan">
          <p>Точек на этой версии после публикации: <b>{plan.outlets}</b>. Точки, добавленные в выбранные кластеры позже, подключатся сами.</p>
          {plan.taken.length > 0 && <p className="chip chip-warn plan-line">Перейдут с другой планограммы ({plan.taken.length}): {listShort(plan.taken.map(t => `${t.outlet_id} — ${refName(t.from)}`), 6)}</p>}
          {plan.clusters_taken.length > 0 && <p className="chip chip-warn plan-line">Кластеры сейчас у другой планограммы: {plan.clusters_taken.map(c => `${c.cluster} — ${refName(c.from)}`).join('; ')}</p>}
          {plan.kept.length > 0 && <p className="hint">Останутся у другой планограммы, им она назначена напрямую ({plan.kept.length}): {listShort(plan.kept.map(k => `${k.outlet_id} — ${refName(k.by)}`), 6)}</p>}
          {plan.dropped.length > 0 && <p className="hint">Перестанут проверяться по этой планограмме ({plan.dropped.length}): {listShort(plan.dropped)}</p>}
          {plan.unknown_clusters.length > 0 && <p className="hint">Кластеры ещё сохраняются на сервере, подождите пару секунд.</p>}
          {conflicts > 0 && <label className="check"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} />Да, перевести эти точки на эту планограмму</label>}
        </div>
      )}
      {server && !plan && !error && <p className="hint" role="status">Считаю, что изменится…</p>}
      {busy && <p className="hint" role="status">{busy}</p>}
      {error && <p className="chip chip-err" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>{error}</p>}
    </Modal>
  );
}

// ---------- история и версии ----------
export function VersionsPanel({ p, get, onRestore }: { p: Planogram; get: Get; onRestore: (next: Planogram) => void }) {
  const all = useStore(s => s.snapshots);
  const snaps = useMemo(() => all.filter(v => v.planogramId === p.id).sort((a, b) => b.version - a.version), [all, p.id]);
  const [diff, setDiff] = useState<Snapshot | null>(null);
  return (
    <>
      <section className="section">
        <h3>Сохранённые версии · {snaps.length}</h3>
        {!snaps.length && <p className="hint">Версия сохраняется при отправке на согласование, утверждении, публикации и при правке после них.</p>}
        {snaps.map(v => (
          <div key={v.id} className="ver-row">
            <div><b>v{v.version}</b> <span className={STATUS_CHIP[v.status]}>{STATUS_NAME[v.status]}</span>
              <span className="hint" style={{ display: 'block' }}>{fmt(v.savedAt)}</span></div>
            <div className="row-actions">
              <button className="btn btn-sm" onClick={() => setDiff(v)}>Сравнить</button>
              <button className="btn btn-sm btn-ghost" onClick={() => onRestore(restoreFrom(p, v))} title="Новая версия-черновик с этой раскладкой">Восстановить</button>
            </div>
          </div>
        ))}
      </section>
      <section className="section">
        <h3>История</h3>
        <ol className="journal">
          {[...p.journal].reverse().map((j, i) => (
            <li key={i}><b>{ACTION_RU[j.action]}</b> · v{j.version}<span className="hint"> · {fmt(j.at)}{j.by ? ` · ${j.by}` : ''}</span>{j.note && <p>{j.note}</p>}</li>
          ))}
        </ol>
      </section>
      {diff && <DiffModal a={diff.data} b={p} titleA={`v${diff.version} · ${STATUS_NAME[diff.status]}`} titleB={`сейчас · v${p.version}`} get={get} onClose={() => setDiff(null)} />}
    </>
  );
}

const KIND_RU: Record<Change['kind'], string> = { added: 'добавлен', removed: 'убран', facings: 'фейсинги', moved: 'полка', order: 'порядок', fixture: 'шкаф', rules: 'правила' };

export function DiffModal({ a, b, titleA, titleB, get, onClose }: { a: Planogram; b: Planogram; titleA: string; titleB: string; get: Get; onClose: () => void }) {
  const changes = useMemo(() => diffPlanograms(a, b, get), [a, b, get]);
  return (
    <Modal title="Было и стало" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Закрыть</button>}>
      <div className="diff-thumbs">
        {[[a, titleA], [b, titleB]].map(([q, t]) => (
          <figure key={t as string}><SceneThumb width={300} height={300} scene={{ fx: (q as Planogram).fixture, rows: (q as Planogram).rows, sku: get, mode: 'texture', warn: true, dims: false }} /><figcaption>{t as string}</figcaption></figure>
        ))}
      </div>
      {!changes.length ? <p className="hint">Раскладка и правила совпадают.</p> : (
        <ul className="changes">{changes.map((c, i) => <li key={i} className={`ch-${c.kind}`}><span className="chip">{KIND_RU[c.kind]}</span>{c.text}</li>)}</ul>
      )}
    </Modal>
  );
}

// ---------- подогнать под шкаф ----------
export function FitModal({ p, get, onClose }: { p: Planogram; get: Get; onClose: () => void }) {
  const fixtures = useStore(s => s.fixtures);
  const { savePlanogram, notify } = useStore.getState();
  const others = fixtures.filter(f => f.id !== p.templateId);
  const [tpl, setTpl] = useState(others[0]?.id ?? fixtures[0]?.id ?? '');
  const fx = fixtures.find(f => f.id === tpl);
  const res = useMemo(() => (fx ? fitToFixture(p, fx, get) : null), [p, fx, get]);
  return (
    <Modal title="Подогнать под другой шкаф" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" disabled={!res} onClick={() => { if (!res) return; savePlanogram(res.planogram); notify('Создана планограмма под новый шкаф'); onClose(); go(`planogram/${res.planogram.id}`); }}>Создать планограмму</button>
    </>}>
      <p className="hint">Полки переносятся сверху вниз, фейсинги пересчитываются по ширине нового шкафа, обязательные SKU не опускаются ниже минимума. Исходная планограмма не меняется.</p>
      <div className="tpl-pick">
        {fixtures.map(f => (
          <button key={f.id} type="button" aria-pressed={f.id === tpl} onClick={() => setTpl(f.id)}>
            <div className="lib-thumb"><SceneThumb width={130} height={115} scene={{ fx: f, rows: null, sku: () => undefined, mode: 'texture', warn: false, dims: false, sampleFill: 'KS' }} /></div>
            <span className="code" style={{ justifySelf: 'start' }}>{f.code}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{f.name}{f.id === p.templateId ? ' · текущий' : ''}</span>
            <span className="hint">{f.w}×{f.h} · {f.shelves.length} полок · {capacity(f).ksLanes} рядов KS</span>
          </button>
        ))}
      </div>
      {res && (
        <div className="fit-preview">
          <SceneThumb width={220} height={240} scene={{ fx: res.planogram.fixture, rows: res.planogram.rows, sku: get, mode: 'texture', warn: true, dims: false }} />
          <ul className="changes">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
        </div>
      )}
    </Modal>
  );
}

// ---------- разложить по правилам ----------
export function AutoModal({ p, get, list, onApply, onClose }: { p: Planogram; get: Get; list: Sku[]; onApply: (next: Planogram) => void; onClose: () => void }) {
  const placed = useMemo(() => [...new Set([...Object.values(p.rows).flat().map(q => q.sku), ...p.rules.mustHave])], [p]);
  const [skus, setSkus] = useState<string[]>(placed);
  const [add, setAdd] = useState('');
  const [eyeLevel, setEyeLevel] = useState(true);
  const [bySales, setBySales] = useState(true);
  const res = useMemo(() => autoLayout(p, get, { skus, eyeLevel, bySales }), [p, get, skus, eyeLevel, bySales]);
  const salesKnown = useMemo(() => skus.filter(id => (get(id)?.sales ?? 0) > 0).length, [skus, get]);
  const options = useMemo(() => list.filter(s => !skus.includes(s.id)).sort((a, b) => a.name.localeCompare(b.name)), [list, skus]);
  return (
    <Modal title="Разложить по правилам" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" disabled={!skus.length} onClick={() => { onApply(res.planogram); onClose(); }}><Icon name="wand" size={15} />Разложить</button>
    </>}>
      <p className="hint">Обязательные SKU получают свой минимум, производители — долю по контракту, остальное делится по продажам или поровну. Блоки идут по производителю и бренду, премиум раньше, похожие пачки не рядом. Отменить — ⌘Z.</p>
      <div className="row-actions">
        <label className="check"><input type="checkbox" checked={eyeLevel} onChange={e => setEyeLevel(e.target.checked)} />Приоритетное — на уровень глаз (120–160 см)</label>
        <label className="check" title={salesKnown ? undefined : 'Продажи заполняются в «Каталоге SKU»'}><input type="checkbox" checked={bySales && salesKnown > 0} disabled={!salesKnown} onChange={e => setBySales(e.target.checked)} />Фейсинги по продажам{salesKnown ? ` (есть у ${salesKnown} из ${skus.length})` : ' — нет данных о продажах'}</label>
      </div>
      <div className="fit-preview">
        <SceneThumb width={220} height={240} scene={{ fx: p.fixture, rows: res.planogram.rows, sku: get, mode: 'texture', warn: true, dims: false }} />
        <div style={{ display: 'grid', gap: 8, alignContent: 'start', minWidth: 0 }}>
          <ul className="changes">{res.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
          <div className="field"><span>SKU · {skus.length}</span>
            <div className="sku-chips">
              {skus.map(id => (
                <span key={id} className={`chip ${p.rules.mustHave.includes(id) ? 'chip-accent' : ''}`}>{get(id)?.name ?? id}
                  {!p.rules.mustHave.includes(id) && <button className="chip-x" aria-label={`Убрать ${get(id)?.name ?? id}`} onClick={() => setSkus(v => v.filter(x => x !== id))}>×</button>}</span>
              ))}
            </div>
            <select className="select" value={add} aria-label="Добавить SKU" onChange={e => { const id = e.target.value; if (id) setSkus(v => [...v, id]); setAdd(''); }}>
              <option value="">+ добавить SKU из каталога</option>
              {options.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>
    </Modal>
  );
}
