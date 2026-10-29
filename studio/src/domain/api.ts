// Клиент IR-сервиса SalesBox: те же адрес и ключ для сверки, хранения Studio и публикации

export interface ApiConfig { apiBase: string; apiKey: string }

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown = null) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export const apiUrl = (c: ApiConfig, path: string) => `${c.apiBase.replace(/\/$/, '')}${path}`;

export const apiHeaders = (c: ApiConfig): Record<string, string> => (c.apiKey ? { 'X-API-Key': c.apiKey } : {});

// fetch с ключом и понятными ошибками. Тело 409 и 4xx отдаём в ApiError.body: там текущая версия
export async function api<T>(c: ApiConfig, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { ...apiHeaders(c), ...(init.headers as Record<string, string> | undefined) };
  if (init.body && typeof init.body === 'string') headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(apiUrl(c, path), { ...init, headers });
  } catch {
    throw new ApiError(0, 'IR-сервис недоступен. Запустите uv run salesbox-api или проверьте адрес');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : null; } catch { /* не JSON — оставляем текст */ }
  if (!res.ok) {
    const detail = body && typeof body === 'object' && 'detail' in body ? (body as { detail: unknown }).detail : text;
    const msg = res.status === 401 || res.status === 403
      ? 'ключ API не подошёл. Введите ключ из SALESBOX_API_KEYS'
      : `сервис ответил ${res.status}: ${typeof detail === 'string' ? detail.slice(0, 200) : JSON.stringify(detail).slice(0, 200)}`;
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
    if (Date.now() - t0 > 120_000) throw new ApiError(0, 'IR не ответил за 2 минуты. Очередь занята, попробуйте позже');
    progress(`IR считает фото… ${Math.round((Date.now() - t0) / 1000)} с`);
    await new Promise(r => setTimeout(r, 1500));
    rec = await api<Rec>(c, `/v1/photos/${rec.photo_id}`);
  }
  if (rec.status === 'failed') throw new ApiError(0, rec.error ?? 'прогон упал на сервере');
  return { photoId: rec.photo_id ?? null, result: (rec.result ?? rec) as Record<string, unknown> };
}
