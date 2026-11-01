import { useEffect, useState, type FormEvent } from 'react';
import { readData } from '../domain/persist';
import { changeClient, connect, disconnect, importLocal, keyRemembered, resetSync, runSync, savedProfile, setSigner, useStore } from '../store';
import { Icon, Modal } from './common';

const STATUS_RU = { off: 'выключено', idle: 'всё сохранено', syncing: 'сохраняю…', error: 'нет связи' } as const;
const errStyle = { whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' } as const;

// Кнопка в шапке: «Подключить» или чьё подключение и как дела с сохранением
export function ServerButton() {
  const server = useStore(s => s.server);
  const sync = useStore(s => s.sync);
  const lost = useStore(s => s.lost.length);
  const [open, setOpen] = useState(false);
  const label = !server ? 'Подключить' : sync.status === 'error' ? 'Нет связи' : sync.status === 'syncing' ? 'Сохраняю…' : server.name || 'Сервер';
  return (
    <>
      <button className={`btn btn-sm server-btn ${server ? `is-${sync.status}` : ''}`} onClick={() => setOpen(true)} title={sync.error ?? undefined}>
        <Icon name="cloud" size={16} /><span>{label}</span>
        {server && <span className="client-chip">{server.client}</span>}
        {lost > 0 && <span className="badge" title="Правки, уступившие серверу">{lost}</span>}
      </button>
      {open && <ServerModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ServerModal({ onClose }: { onClose: () => void }) {
  const server = useStore(s => s.server);
  return server ? <AccountModal onClose={onClose} /> : <ConnectModal onClose={onClose} />;
}

function ConnectModal({ onClose }: { onClose: () => void }) {
  const { notify } = useStore.getState();
  const [key, setKey] = useState('');
  const [client, setClient] = useState(() => savedProfile().client);
  const [name, setName] = useState(() => savedProfile().name);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await connect({ key, client, name }, remember);
      notify(`Подключено: клиент ${client.trim() || 'default'}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Подключение к серверу" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" type="submit" form="connect-form" disabled={busy || !key.trim()}>{busy ? 'Проверяю ключ…' : 'Подключить'}</button>
    </>}>
      <form id="connect-form" className="grid2" onSubmit={submit}>
        <label className="field"><span>Ключ API</span>
          <input className="input mono" type="password" autoComplete="off" spellCheck={false} autoFocus value={key} onChange={e => setKey(e.target.value)} /></label>
        <label className="field"><span>Клиент</span>
          <input className="input" autoComplete="off" spellCheck={false} placeholder="default" value={client} onChange={e => setClient(e.target.value)} /></label>
        <label className="field"><span>Как вас подписать</span>
          <input className="input" autoComplete="name" placeholder="например, Исламбек" value={name} onChange={e => setName(e.target.value)} /></label>
      </form>
      <label className="check"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
        <span>Запомнить ключ на этом компьютере</span></label>
      {error && <p className="chip chip-err" role="alert" style={errStyle}>{error}</p>}
      <p className="hint">Ключ выдаёт администратор IR. Клиент — пространство данных: у каждого клиента свои шкафы, планограммы и точки. Имя попадает в журнал согласования и в «Команду» мониторинга. Без галочки ключ забудется, когда закроете вкладку; на чужом компьютере галочку не ставьте.</p>
    </Modal>
  );
}

function AccountModal({ onClose }: { onClose: () => void }) {
  const server = useStore(s => s.server)!;
  const settings = useStore(s => s.settings);
  const sync = useStore(s => s.sync);
  const lost = useStore(s => s.lost);
  const { setSettings, notify, restoreLost, dismissLost } = useStore.getState();
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState(0);
  const [client, setClient] = useState(server.client);
  const [name, setName] = useState(server.name);
  useEffect(() => {
    readData('local').then(d => setLocal(((d as { planograms?: unknown[] } | null)?.planograms ?? []).length)).catch(() => setLocal(0));
  }, []);

  const run = async (text: string, fn: () => Promise<unknown>) => {
    setBusy(text);
    try { await fn(); } catch (e) { notify((e as Error).message); } finally { setBusy(null); }
  };
  const clientChanged = client.trim() !== '' && client.trim() !== server.client;

  return (
    <Modal title="Подключение к серверу" onClose={onClose} footer={<>
      <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('Отключаю…', async () => { await disconnect(); notify('Отключено. Studio работает в этом браузере'); onClose(); })}>Отключить</button>
      <button className="btn btn-primary" onClick={onClose}>Готово</button>
    </>}>
      <p className="hint">Ключ API {keyRemembered() ? 'запомнен на этом компьютере' : 'хранится до закрытия вкладки'}.</p>
      <div className="grid2">
        <label className="field"><span>Клиент</span>
          <div className="row-actions">
            <input className="input" spellCheck={false} value={client} disabled={!!busy} onChange={e => setClient(e.target.value)} />
            {clientChanged && <button className="btn btn-sm" disabled={!!busy} onClick={() => run('Переключаю клиента…', () => changeClient(client))}>Сменить</button>}
          </div></label>
        <label className="field"><span>Как вас подписать</span>
          <input className="input" value={name} onChange={e => setName(e.target.value)} onBlur={() => { if (name.trim() !== server.name) setSigner(name); }} /></label>
      </div>

      <div className="row-actions">
        <span className={`chip ${sync.status === 'error' ? 'chip-err' : sync.status === 'idle' ? 'chip-ok' : ''}`}>{STATUS_RU[sync.status]}</span>
        {sync.at && <span className="hint">{new Date(sync.at).toLocaleTimeString('ru-RU')}</span>}
        <button className="btn btn-sm" onClick={() => runSync()}><Icon name="refresh" size={15} />Синхронизировать</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { resetSync(); notify('Studio заново сверит все документы с сервером'); }}>Сверить всё заново</button>
      </div>
      {sync.error && <p className="chip chip-err" style={errStyle}>{sync.error}</p>}
      {busy && <p className="hint" role="status">{busy}</p>}

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

      {local > 0 && (
        <section className="lost">
          <h3>Данные этого браузера</h3>
          <p className="hint">Без сервера здесь собрано планограмм: {local}. Их можно перенести к клиенту {server.client}: появятся у всех, кто к нему подключён.</p>
          <button className="btn btn-sm" disabled={!!busy} onClick={() => run('Переношу…', async () => { const n = await importLocal(); notify(n ? `Перенесено документов: ${n}` : 'Всё уже было у клиента'); })}>Перенести к клиенту</button>
        </section>
      )}

      <label className="check big"><input type="checkbox" checked={settings.galleryTextures} onChange={e => setSettings({ galleryTextures: e.target.checked })} />
        <span><b>Фото пачек вместо рисунков</b><small>Если на сервере есть фото пачки, на шкафу показывается оно. Для остальных остаётся рисунок.</small></span></label>
      <label className="check big"><input type="checkbox" checked={settings.tech} onChange={e => setSettings({ tech: e.target.checked })} />
        <span><b>Технические детали распознавания</b><small>Метки и эталоны галереи, файл для IR, стоимости выравнивания, номера рядов IR. Для инженера IR.</small></span></label>
    </Modal>
  );
}
