// Хранилище браузера: IndexedDB, одна запись со всеми данными Studio на каждое пространство:
// «local» — без входа, «u:<логин>:<клиент>» — после входа. У клиентов данные не смешиваются.
// localStorage держит около 5 МБ, а сверки с отчётом IR весят десятки КБ каждая; IndexedDB —
// сотни мегабайт. Если IndexedDB недоступен (редкий приватный режим), остаётся localStorage.

const DB_NAME = 'planogram-studio';
const STORE = 'kv';
const LEGACY_IDB_KEY = 'data';   // первая версия хранила одну запись без пространства
const keyOf = (scope: string) => `data:${scope}`;
export const LEGACY_KEY = 'planogram-studio.v2';   // где данные лежали раньше

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB занят другой вкладкой'));
  });
  return dbp;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(d => new Promise<T>((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? req.error);
    t.onabort = () => reject(t.error ?? new Error('запись прервана'));
  }));
}

let fallback = typeof indexedDB === 'undefined';

// Прочитать данные пространства; для «local» при первом запуске — перенести старые данные
export async function readData(scope: string): Promise<unknown> {
  if (!fallback) {
    try {
      const stored = await tx('readonly', s => s.get(keyOf(scope)));
      if (stored !== undefined || scope !== 'local') return stored ?? null;
      const old = await tx('readonly', s => s.get(LEGACY_IDB_KEY));
      const legacy = old ?? readLegacy();
      if (legacy != null) {
        await tx('readwrite', s => s.put(legacy, keyOf(scope)));
        if (old !== undefined) await tx('readwrite', s => s.delete(LEGACY_IDB_KEY));
        localStorage.removeItem(LEGACY_KEY);
      }
      return legacy;
    } catch {
      fallback = true;
    }
  }
  return scope === 'local' ? readLegacy() : readFallback(scope);
}

const readFallback = (scope: string): unknown => {
  try { const raw = localStorage.getItem(`${LEGACY_KEY}:${scope}`); return raw ? JSON.parse(raw) : null; } catch { return null; }
};

function readLegacy(): unknown {
  try { const raw = localStorage.getItem(LEGACY_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

// Записи идут цепочкой: следующая начинается после предыдущей, порядок сохраняется
let chain: Promise<void> = Promise.resolve();
export function writeData(scope: string, data: unknown): Promise<void> {
  const run = chain.catch(() => undefined).then(async () => {
    if (!fallback) {
      try { await tx('readwrite', s => s.put(data, keyOf(scope))); return; } catch { fallback = true; }
    }
    localStorage.setItem(scope === 'local' ? LEGACY_KEY : `${LEGACY_KEY}:${scope}`, JSON.stringify(data));
  });
  chain = run;
  return run;
}
