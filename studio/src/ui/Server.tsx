import { useState } from 'react';
import { api } from '../domain/api';
import { resetSync, runSync, useStore } from '../store';
import { Icon, Modal } from './common';

const STATUS_RU = { off: 'выключено', idle: 'синхронизировано', syncing: 'синхронизирую…', error: 'ошибка' } as const;

// Кнопка в шапке: состояние хранения на сервере, по клику — настройки подключения
export function ServerButton() {
  const sync = useStore(s => s.sync);
  const on = useStore(s => s.settings.sync);
  const [open, setOpen] = useState(false);
  const label = !on ? 'Только в браузере' : sync.status === 'error' ? 'Сервер: ошибка' : sync.status === 'syncing' ? 'Синхронизация…' : 'На сервере';
  return (
    <>
      <button className={`btn btn-sm server-btn ${on ? `is-${sync.status}` : ''}`} onClick={() => setOpen(true)} title={sync.error ?? undefined}>
        <Icon name="cloud" size={16} /><span>{label}</span>
      </button>
      {open && <ServerModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ServerModal({ onClose }: { onClose: () => void }) {
  const settings = useStore(s => s.settings);
  const sync = useStore(s => s.sync);
  const { setSettings, notify } = useStore.getState();
  const [showKey, setShowKey] = useState(false);
  const [check, setCheck] = useState<string | null>(null);

  const test = async () => {
    setCheck('Проверяю…');
    try {
      const ready = await fetch(`${settings.apiBase.replace(/\/$/, '')}/readyz`).then(r => r.json()).catch(() => null);
      const docs = await api<{ seq: number }>(settings, '/v1/studio/docs?since=0');
      const gal = await api<{ configured: boolean; labels: Record<string, number> }>(settings, '/v1/gallery/images');
      setCheck(`Сервис отвечает${ready?.status === 'ready' ? ', модели загружены' : ready ? ', модели ещё грузятся' : ''}. Документов Studio на сервере: ${docs.seq ? 'есть' : 'пока нет'}. Фото эталонов: ${gal.configured ? Object.keys(gal.labels).length : 'папка не подключена'}.`);
    } catch (e) {
      const msg = (e as Error).message;
      setCheck(msg.includes('404') ? 'Сервис отвечает, но без хранения Studio: нужна ветка islambek/planogram-studio в SalesBox' : msg);
    }
  };

  return (
    <Modal title="IR-сервис и хранение" onClose={onClose} footer={<button className="btn btn-primary" onClick={onClose}>Готово</button>}>
      <div className="grid2">
        <label className="field"><span>Адрес сервиса</span>
          <input className="input mono" value={settings.apiBase} placeholder="пусто — тот же адрес, что у Studio" onChange={e => setSettings({ apiBase: e.target.value.trim() })} /></label>
        <label className="field"><span>Ключ API (X-API-Key)</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <input className="input mono" type={showKey ? 'text' : 'password'} value={settings.apiKey} autoComplete="off" onChange={e => setSettings({ apiKey: e.target.value.trim() })} />
            <button className="btn btn-sm" type="button" onClick={() => setShowKey(v => !v)}>{showKey ? 'Скрыть' : 'Показать'}</button>
          </div></label>
      </div>
      <p className="hint">Пустой адрес: запросы идут туда же, откуда открыта Studio. В разработке их пересылает Vite на 127.0.0.1:8000, в проде Studio открывают с самого сервиса на /studio/.</p>
      <div className="row-actions"><button className="btn btn-sm" onClick={test}><Icon name="refresh" size={15} />Проверить подключение</button>{check && <span className="hint" role="status">{check}</span>}</div>

      <label className="check big"><input type="checkbox" checked={settings.sync} onChange={e => setSettings({ sync: e.target.checked })} />
        <span><b>Хранить на сервере</b><small>Шкафы, планограммы, версии, кластеры и сверки уходят в IR-сервис (studio.sqlite) и приходят с других компьютеров. Браузер остаётся рабочей копией: без сети всё работает.</small></span></label>
      {settings.sync && (
        <div className="row-actions">
          <span className={`chip ${sync.status === 'error' ? 'chip-err' : sync.status === 'idle' ? 'chip-ok' : ''}`}>{STATUS_RU[sync.status]}</span>
          {sync.at && <span className="hint">{new Date(sync.at).toLocaleTimeString('ru-RU')}</span>}
          <button className="btn btn-sm" onClick={() => runSync()}><Icon name="refresh" size={15} />Синхронизировать</button>
          <button className="btn btn-sm btn-ghost" onClick={() => { resetSync(); notify('Синхронизация с нуля: Studio сверит все документы с сервером'); }}>С нуля</button>
        </div>
      )}
      {sync.error && settings.sync && <p className="chip chip-err" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>{sync.error}</p>}

      <label className="check big"><input type="checkbox" checked={settings.galleryTextures} onChange={e => setSettings({ galleryTextures: e.target.checked })} />
        <span><b>Фото эталонов вместо нарисованных пачек</b><small>Если в сервисе подключена папка эталонов (SALESBOX_API_GALLERY_IMAGES_DIR), пачки на холсте — настоящие фото из галереи, как их видит IR. Работает при хранении на сервере.</small></span></label>
      <p className="hint">Публикация планограмм и назначение на точки тоже идут через этот сервис.</p>
    </Modal>
  );
}
