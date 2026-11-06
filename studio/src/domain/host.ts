// Studio внутри кабинета SalesBox: кабинет открывает её во фрейме с того же адреса и передаёт
// токен сообщением. Токен лежит только в памяти: ни ключа, ни localStorage, ни своего входа.
//
//   Studio → кабинет  { type: 'studio:ready' }           готова принять сессию
//   кабинет → Studio  { type: 'studio:session', … }      токен, организация, имя, адрес API
//   Studio → кабинет  { type: 'studio:token-expired' }   сервер ответил 401: нужен новый токен

export interface HostSession {
  token: string;
  organizationId: string;
  userName: string;
  apiBase: string;
}

interface HostWindow {
  parent: unknown;
  location: { origin: string };
  addEventListener: (type: 'message', fn: (e: MessageEvent) => void) => void;
}

export interface HostLink {
  waitSession: () => Promise<HostSession>;
  token: () => string | null;
  refresh: () => Promise<string | null>;
}

const WAIT_MS = 10_000;

export const wantsHost = (search: string) => new URLSearchParams(search).get('host') === 'salesbox';

function readSession(data: unknown): HostSession | null {
  const d = (data ?? {}) as Record<string, unknown>;
  if (d.type !== 'studio:session') return null;
  const { token, organizationId, userName, apiBase } = d;
  if (typeof token !== 'string' || !token || typeof organizationId !== 'string' || !organizationId) return null;
  return {
    token,
    organizationId,
    userName: typeof userName === 'string' ? userName : '',
    apiBase: typeof apiBase === 'string' ? apiBase : '',
  };
}

export function createHostLink(win: HostWindow, waitMs = WAIT_MS): HostLink {
  const parent = win.parent as { postMessage: (data: unknown, origin: string) => void };
  const origin = win.location.origin;
  let current: HostSession | null = null;
  let waiters: ((s: HostSession | null) => void)[] = [];
  let refreshing: Promise<string | null> | null = null;

  // Только свой родитель и только с нашего адреса: чужая страница токен не подсунет
  win.addEventListener('message', e => {
    if (e.source !== win.parent || e.origin !== origin) return;
    const session = readSession(e.data);
    if (!session) return;
    current = session;
    const done = waiters;
    waiters = [];
    done.forEach(fn => fn(session));
  });

  const nextSession = () => new Promise<HostSession | null>(resolve => {
    const timer = setTimeout(() => {
      waiters = waiters.filter(fn => fn !== finish);
      resolve(null);
    }, waitMs);
    const finish = (s: HostSession | null) => { clearTimeout(timer); resolve(s); };
    waiters.push(finish);
  });

  return {
    waitSession: async () => {
      const wait = nextSession();
      parent.postMessage({ type: 'studio:ready' }, origin);
      const session = await wait;
      if (!session) throw new Error('кабинет не передал сессию');
      return session;
    },
    token: () => current?.token ?? null,
    // Пачка запросов получила 401 разом: новый токен просим один раз
    refresh: () => {
      refreshing ??= (async () => {
        const wait = nextSession();
        parent.postMessage({ type: 'studio:token-expired' }, origin);
        const session = await wait;
        refreshing = null;
        current = session;
        return session?.token ?? null;
      })();
      return refreshing;
    },
  };
}

export const connectHost = (link: HostLink) => link.waitSession();
