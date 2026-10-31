// Клиент сервера Studio (IR-сервис SalesBox): сверка фото, хранение, публикация.
// Доступ — сессия после входа: HttpOnly-кука, которую скрипт страницы не видит. Ключей в браузере нет.
// Запросы идут на тот же адрес, откуда открыта Studio (в разработке их пересылает Vite).

export interface ApiConfig { apiBase?: string }

// Кто вошёл: роль решает, что видно и какие кнопки доступны
export type Role = 'admin' | 'manager' | 'editor';
export interface Me { login: string; name: string; role: Role; clients: string[]; client: string }
export const ROLE_RU: Record<Role, string> = { admin: 'инженер IR', manager: 'руководитель', editor: 'редактор' };

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const apiUrl = (c: ApiConfig, path: string) => `${(c.apiBase ?? '').replace(/\/$/, '')}${path}`;

// fetch с сессией и понятными ошибками. Тело 409 и 4xx отдаём в ApiError.body: там текущая версия
export async function api<T>(c: ApiConfig, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(apiUrl(c, path), { ...init, headers, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'сервер недоступен: проверьте интернет');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* не JSON — оставляем текст */ }
  if (!res.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? (body as { detail: unknown }).detail : text;
    const text2 = typeof detail === 'string' ? detail.slice(0, 200) : JSON.stringify(detail).slice(0, 200);
    const msg = res.status === 401 ? (path.endsWith('/login') ? text2 : 'нужно войти заново')
      : res.status === 403 ? `нет прав: ${text2}`
      : `сервер ответил ${res.status}: ${text2}`;
    throw new ApiError(res.status, msg, body);
  }
  return body as T;
}

export const jsonBody = (v: unknown) => JSON.stringify(v);

// Путь документа: id SKU содержит «/», сервер принимает его как есть
export const docPath = (kind: string, id: string) => `/v1/studio/docs/${kind}/${id.split('/').map(encodeURIComponent).join('/')}`;

// Фото → IR: POST /v1/photos?wait=true, дальше опрос до done. fields — planogram, outlet_id и др.
export async function analyzePhoto(c: ApiConfig, file: File, fields: Record<string, string>, progress: (text: string) => void) {
  const fd = new FormData();
  fd.append('file', file);
  Object.entries(fields).forEach(([k, v]) => { if (v) fd.append(k, v); });
  type Rec = { photo_id?: string; status: string; error?: string; result?: Record<string, unknown> };
  let rec = await api<Rec>(c, '/v1/photos?wait=true', { method: 'POST', body: fd });
  const t0 = Date.now();
  while (rec.status === 'processing') {
    if (Date.now() - t0 > 120_000) throw new ApiError(0, 'распознавание не ответило за 2 минуты: очередь занята, попробуйте позже');
    progress(`Распознаю фото… ${Math.round((Date.now() - t0) / 1000)} с`);
    await new Promise(r => setTimeout(r, 1500));
    rec = await api<Rec>(c, `/v1/photos/${rec.photo_id}`);
  }
  if (rec.status === 'failed') throw new ApiError(0, rec.error ?? 'прогон упал на сервере');
  return { photoId: rec.photo_id ?? null, result: (rec.result ?? rec) as Record<string, unknown> };
}

// Вход, выход, смена клиента
export const fetchMe = () => api<Me | null>({}, '/v1/studio/me');
export const login = (loginName: string, password: string) =>
  api<Me>({}, '/v1/studio/login', { method: 'POST', body: jsonBody({ login: loginName, password }) });
export const logout = () => api<void>({}, '/v1/studio/logout', { method: 'POST' });
export const switchClient = (client: string) => api<Me>({}, '/v1/studio/client', { method: 'POST', body: jsonBody({ client }) });
