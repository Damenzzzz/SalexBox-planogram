import { useState } from 'react';
import { api } from '../domain/api';
import { resetSync, runSync, useStore } from '../store';
import { Icon, Modal } from './common';

const STATUS_RU = { off: 'выключено', idle: 'всё сохранено', syncing: 'сохраняю…', error: 'нет связи' } as const;

// Кнопка в шапке: состояние хранения на сервере, по клику — настройки подключения
export function ServerButton() {
  const sync = useStore(s => s.sync);
  const on = useStore(s => s.settings.sync);
  const lost = useStore(s => s.lost.length);
  const [open, setOpen] = useState(false);
  const label = !on ? 'Подключить сервер' : sync.status === 'error' ? 'Нет связи' : sync.status === 'syncing' ? 'Сохраняю…' : 'Сохранено';
  return (
    <>
      <button className={`btn btn-sm server-btn ${on ? `is-${sync.status}` : ''}`} onClick={() => setOpen(true)} title={sync.error ?? undefined}>
        <Icon name="cloud" size={16} /><span>{label}</span>{lost > 0 && <span className="badge" title="Правки, уступившие серверу">{lost}</span>}
      </button>
      {open && <ServerModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ServerModal({ onClose }: { onClose: () => void }) {
  const settings = useStore(s => s.settings);
  const sync = useStore(s => s.sync);
  const lost = useStore(s => s.lost);
  const { setSettings, notify, restoreLost, dismissLost } = useStore.getState();
  const [showKey, setShowKey] = useState(false);
  const [check, setCheck] = useState<string | null>(null);

  const test = async () => {
    setCheck('Проверяю…');
    try {
      const ready = await fetch(`${settings.apiBase.replace(/\/$/, '')}/readyz`).then(r => r.json()).catch(() => null);
      await api(settings, '/v1/studio/docs?since=0');
      setCheck(ready?.status === 'ready' ? 'Сервер на связи, распознавание готово.' : 'Сервер на связи, распознавание ещё запускается.');
    } catch (e) {
      const msg = (e as Error).message;
      setCheck(msg.includes('404') ? 'Сервер отвечает, но хранение планограмм на нём не включено.' : `Нет связи: ${msg}`);
    }
  };

  return (
    <Modal title="Подключение к серверу" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Готово</button>}>
      <label className="field"><span>Ключ доступа</span>
        <div style={{ display: 'flex', gap: 6 }}>
          <input className="input mono" type={showKey ? 'text' : 'password'} value={settings.apiKey} autoComplete="off" onChange={e => setSettings({ apiKey: e.target.value.trim() })} />
          <button className="btn btn-sm" type="button" onClick={() => setShowKey(v => !v)}>{showKey ? 'Скрыть' : 'Показать'}</button>
        </div></label>
      <div className="row-actions"><button className="btn btn-sm" onClick={test}><Icon name="refresh" size={15} />Проверить связь</button>{check && <span className="hint" role="status">{check}</span>}</div>

      <label className="check big"><input type="checkbox" checked={settings.sync} onChange={e => setSettings({ sync: e.target.checked })} />
        <span><b>Хранить на сервере</b><small>Шкафы, планограммы, версии, точки и сверки сохраняются на сервере и открываются с любого компьютера. Без сети работа продолжается, изменения уйдут при связи.</small></span></label>
      {settings.sync && (
        <div className="row-actions">
          <span className={`chip ${sync.status === 'error' ? 'chip-err' : sync.status === 'idle' ? 'chip-ok' : ''}`}>{STATUS_RU[sync.status]}</span>
          {sync.at && <span className="hint">{new Date(sync.at).toLocaleTimeString('ru-RU')}</span>}
          <button className="btn btn-sm" onClick={() => runSync()}><Icon name="refresh" size={15} />Синхронизировать</button>
          <button className="btn btn-sm btn-ghost" onClick={() => { resetSync(); notify('Studio заново сверит все документы с сервером'); }}>Сверить всё заново</button>
        </div>
      )}
      {sync.error && settings.sync && <p className="chip chip-err" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>{sync.error}</p>}
      {lost.length > 0 && (
        <section className="lost">
          <h3>Уступили серверу · {lost.length}</h3>
          <p className="hint">Эти документы одновременно правили здесь и на другом компьютере. Сейчас действует серверная версия. «Вернуть мою» сделает текущей вашу правку.</p>
          <ul>{lost.map((it, i) => (
            <li key={`${it.kind}:${it.id}:${it.at}`}>
              <span><b>{it.title}</b><small>{new Date(it.at).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' })}</small></span>
              <button className="btn btn-sm" onClick={() => { restoreLost(i); notify(`${it.title}: ваша правка снова текущая`); }}>Вернуть мою</button>
              <button className="btn btn-sm btn-ghost" onClick={() => dismissLost(i)}>Убрать</button>
            </li>
          ))}</ul>
        </section>
      )}

      <label className="check big"><input type="checkbox" checked={settings.galleryTextures} onChange={e => setSettings({ galleryTextures: e.target.checked })} />
        <span><b>Фото пачек вместо рисунков</b><small>Если на сервере есть фото пачки, на шкафу показывается оно. Для остальных остаётся рисунок.</small></span></label>

      <details className="advanced">
        <summary>Дополнительно</summary>
        <label className="field"><span>Адрес сервера</span>
          <input className="input mono" value={settings.apiBase} placeholder="тот же, что у Studio" onChange={e => setSettings({ apiBase: e.target.value.trim() })} /></label>
        <label className="check"><input type="checkbox" checked={settings.tech} onChange={e => setSettings({ tech: e.target.checked })} />Технические детали распознавания (для инженеров IR)</label>
      </details>
    </Modal>
  );
}
