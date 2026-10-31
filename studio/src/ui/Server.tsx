import { useEffect, useState, type FormEvent } from 'react';
import { ROLE_RU } from '../domain/api';
import { readData } from '../domain/persist';
import { changeClient, importLocal, resetSync, runSync, signIn, signOut, useStore } from '../store';
import { Icon, Modal } from './common';

const STATUS_RU = { off: 'выключено', idle: 'всё сохранено', syncing: 'сохраняю…', error: 'нет связи' } as const;

// Кнопка в шапке: «Войти» или кто вошёл и как дела с сохранением
export function ServerButton() {
  const me = useStore(s => s.me);
  const sync = useStore(s => s.sync);
  const lost = useStore(s => s.lost.length);
  const [open, setOpen] = useState(false);
  const label = !me ? 'Войти' : sync.status === 'error' ? 'Нет связи' : sync.status === 'syncing' ? 'Сохраняю…' : me.name;
  return (
    <>
      <button className={`btn btn-sm server-btn ${me ? `is-${sync.status}` : ''}`} onClick={() => setOpen(true)} title={sync.error ?? undefined}>
        <Icon name="cloud" size={16} /><span>{label}</span>
        {me && me.clients.length > 1 && <span className="client-chip">{me.client}</span>}
        {lost > 0 && <span className="badge" title="Правки, уступившие серверу">{lost}</span>}
      </button>
      {open && <ServerModal onClose={() => setOpen(false)} />}
    </>
  );
}

export function ServerModal({ onClose }: { onClose: () => void }) {
  const me = useStore(s => s.me);
  return me ? <AccountModal onClose={onClose} /> : <LoginModal onClose={onClose} />;
}

function LoginModal({ onClose }: { onClose: () => void }) {
  const { notify } = useStore.getState();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const me = await signIn(login.trim(), password);
      notify(`Здравствуйте, ${me.name}`);
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Modal title="Вход" onClose={onClose} footer={<>
      <button className="btn" onClick={onClose}>Отмена</button>
      <button className="btn btn-primary" type="submit" form="login-form" disabled={busy || !login.trim() || !password}>{busy ? 'Вхожу…' : 'Войти'}</button>
    </>}>
      <form id="login-form" className="grid2" onSubmit={submit}>
        <label className="field"><span>Логин</span>
          <input className="input" autoComplete="username" autoFocus value={login} onChange={e => setLogin(e.target.value)} /></label>
        <label className="field"><span>Пароль</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      </form>
      {error && <p className="chip chip-err" role="alert" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>{error}</p>}
      <p className="hint">После входа планограммы, шкафы, точки и сверки хранятся на сервере вашей компании и открываются с любого компьютера. Без входа Studio работает только в этом браузере. Логин выдаёт администратор.</p>
    </Modal>
  );
}

function AccountModal({ onClose }: { onClose: () => void }) {
  const me = useStore(s => s.me)!;
  const settings = useStore(s => s.settings);
  const sync = useStore(s => s.sync);
  const lost = useStore(s => s.lost);
  const { setSettings, notify, restoreLost, dismissLost } = useStore.getState();
  const [busy, setBusy] = useState<string | null>(null);
  const [local, setLocal] = useState(0);
  useEffect(() => {
    readData('local').then(d => setLocal(((d as { planograms?: unknown[] } | null)?.planograms ?? []).length)).catch(() => setLocal(0));
  }, []);

  const run = async (text: string, fn: () => Promise<unknown>) => {
    setBusy(text);
    try { await fn(); } catch (e) { notify((e as Error).message); } finally { setBusy(null); }
  };

  return (
    <Modal title={me.name} onClose={onClose} footer={<>
      <button className="btn btn-ghost" disabled={!!busy} onClick={() => run('Выхожу…', async () => { await signOut(); notify('Вы вышли. Studio работает в этом браузере'); onClose(); })}>Выйти</button>
      <button className="btn btn-primary" onClick={onClose}>Готово</button>
    </>}>
      <p className="hint">{ROLE_RU[me.role]} · {me.login}</p>
      {me.clients.length > 1 ? (
        <label className="field"><span>Клиент</span>
          <select className="select" value={me.client} disabled={!!busy} onChange={e => run('Переключаю клиента…', () => changeClient(e.target.value))}>
            {me.clients.map(c => <option key={c} value={c}>{c}</option>)}
          </select></label>
      ) : <p>Клиент: <b>{me.client}</b></p>}

      <div className="row-actions">
        <span className={`chip ${sync.status === 'error' ? 'chip-err' : sync.status === 'idle' ? 'chip-ok' : ''}`}>{STATUS_RU[sync.status]}</span>
        {sync.at && <span className="hint">{new Date(sync.at).toLocaleTimeString('ru-RU')}</span>}
        <button className="btn btn-sm" onClick={() => runSync()}><Icon name="refresh" size={15} />Синхронизировать</button>
        <button className="btn btn-sm btn-ghost" onClick={() => { resetSync(); notify('Studio заново сверит все документы с сервером'); }}>Сверить всё заново</button>
      </div>
      {sync.error && <p className="chip chip-err" style={{ whiteSpace: 'normal', lineHeight: 1.4, padding: '6px 9px' }}>{sync.error}</p>}
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
          <p className="hint">До входа здесь собрано планограмм: {local}. Их можно перенести к клиенту {me.client}: появятся у всех его пользователей.</p>
          <button className="btn btn-sm" disabled={!!busy} onClick={() => run('Переношу…', async () => { const n = await importLocal(); notify(n ? `Перенесено документов: ${n}` : 'Всё уже было у клиента'); })}>Перенести к клиенту</button>
        </section>
      )}

      <label className="check big"><input type="checkbox" checked={settings.galleryTextures} onChange={e => setSettings({ galleryTextures: e.target.checked })} />
        <span><b>Фото пачек вместо рисунков</b><small>Если на сервере есть фото пачки, на шкафу показывается оно. Для остальных остаётся рисунок.</small></span></label>
      {me.role === 'admin' && (
        <label className="check big"><input type="checkbox" checked={settings.tech} onChange={e => setSettings({ tech: e.target.checked })} />
          <span><b>Технические детали распознавания</b><small>Метки и эталоны галереи, файл для IR, стоимости выравнивания, номера рядов IR. Видно только инженеру.</small></span></label>
      )}
    </Modal>
  );
}
