import { useState } from 'react';
import { capacity, sortedShelves } from '../domain/geometry';
import { extraFixtures, newPlanogram } from '../domain/templates';
import type { Doors, Material } from '../domain/types';
import { go, useStore } from '../store';
import { Icon, SceneThumb } from './common';

export const DOORS: Record<Doors, string> = { none: 'без дверей', glass: 'стекло', shutter: 'шторка' };
export const MATERIALS: Record<Material, string> = { graphite: 'графит', wood: 'дерево', white: 'белый' };

export function Fixtures() {
  const fixtures = useStore(s => s.fixtures);
  const planograms = useStore(s => s.planograms);
  const { createFixture, duplicateFixture, deleteFixture, savePlanogram, notify } = useStore.getState();
  const [confirm, setConfirm] = useState<string | null>(null);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Шкафы и полки</h1>
          <p>Библиотека шаблонов: размеры шкафа, полки и ряды толкателей. Код вроде С1-96-170 собирается из номера, ширины и высоты в сантиметрах, его можно заменить своим.</p>
        </div>
        <div className="actions">
          <button className="btn" onClick={() => {
            const have = new Set(useStore.getState().fixtures.map(f => f.code));
            const add = extraFixtures().filter(f => !have.has(f.code));
            add.forEach(f => useStore.getState().saveFixture(f));
            notify(add.length ? `Добавлено типовых шкафов: ${add.length}` : 'Все типовые шкафы уже в библиотеке');
          }}><Icon name="cabinet" />Типовые шкафы</button>
          <button className="btn btn-primary" onClick={() => go(`fixture/${createFixture()}`)}><Icon name="plus" />Новый шкаф</button>
        </div>
      </div>
      <div className="cards">
        {fixtures.map(f => {
          const cap = capacity(f);
          const used = planograms.filter(p => p.templateId === f.id).length;
          return (
            <article className="lib-card" key={f.id}>
              <button className="lib-thumb" onClick={() => go(`fixture/${f.id}`)} aria-label={`Открыть ${f.name} в конструкторе`}>
                <SceneThumb width={240} height={220} scene={{ fx: f, rows: null, sku: () => undefined, mode: 'texture', warn: false, dims: false, sampleFill: 'KS' }} />
              </button>
              <div className="lib-body">
                <div className="lib-title"><h3 title={f.name}>{f.name}</h3><span className="code">{f.code}</span></div>
                <div className="meta"><span><b>{f.w}×{f.h}×{f.d}</b> мм</span><span><b>{sortedShelves(f).length}</b> полок</span><span>{DOORS[f.doors]}, {MATERIALS[f.material]}</span></div>
                <div className="meta"><span><b>{cap.ksLanes}</b> рядов KS</span><span><b>{cap.ssLanes}</b> рядов SS</span><span>≈ <b>{cap.packs}</b> пачек KS</span></div>
                <div className="meta"><span>версия <b>{f.version}</b></span><span>в планограммах: <b>{used}</b></span></div>
                <div className="lib-actions">
                  <button className="btn btn-sm btn-primary" onClick={() => go(`fixture/${f.id}`)}>Конструктор</button>
                  <button className="btn btn-sm" onClick={() => { const p = newPlanogram(f, `Планограмма · ${f.code}`); savePlanogram(p); go(`planogram/${p.id}`); }}><Icon name="plus" size={15} />Планограмма</button>
                  <button className="btn btn-sm icon-btn" title="Дублировать" aria-label="Дублировать" onClick={() => { duplicateFixture(f.id); notify('Копия шкафа создана'); }}><Icon name="copy" size={15} /></button>
                  {confirm === f.id
                    ? <button className="btn btn-sm btn-danger" onClick={() => { deleteFixture(f.id); setConfirm(null); notify('Шкаф удалён. Готовые планограммы сохранили свою копию'); }}>Точно удалить</button>
                    : <button className="btn btn-sm icon-btn" title="Удалить" aria-label="Удалить" onClick={() => setConfirm(f.id)}><Icon name="trash" size={15} /></button>}
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
