// Фото эталонов галереи из IR-сервиса (GET /v1/gallery/image) — текстуры пачек вместо нарисованных.
// Картинки грузятся по требованию; когда догрузилась новая, слушатель перерисовывает холсты.

import { api, apiUrl, authHeaders, type ApiConfig } from '../domain/api';

let cfg: ApiConfig | null = null;
let labels: Set<string> | null = null;
const images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();
let onLoaded: () => void = () => {};

export const setGalleryListener = (fn: () => void) => { onLoaded = fn; };

// Включить: забрать список меток с фото. Сервис без папки эталонов — 404, тогда остаются рисованные
export async function connectGallery(c: ApiConfig | null): Promise<number> {
  cfg = c; labels = null; images.clear();
  if (!c) { onLoaded(); return 0; }
  try {
    const r = await api<{ labels: Record<string, number> }>(c, '/v1/gallery/images');
    labels = new Set(Object.keys(r.labels));
  } catch { labels = null; }
  onLoaded();
  return labels?.size ?? 0;
}

export const galleryHas = (label: string | null) => !!label && !!labels?.has(label);

export function galleryImage(label: string | null): HTMLImageElement | null {
  if (!label || !cfg || !labels?.has(label)) return null;
  const got = images.get(label);
  if (got instanceof HTMLImageElement) return got;
  if (got) return null;
  images.set(label, 'loading');
  const c = cfg;
  fetch(apiUrl(c, `/v1/gallery/image?label=${encodeURIComponent(label)}`), { headers: authHeaders(), credentials: 'omit' })
    .then(r => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
    .then(b => new Promise<HTMLImageElement>((res, rej) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = rej;
      img.src = URL.createObjectURL(b);
    }))
    .then(img => { if (cfg === c) { images.set(label, img); onLoaded(); } })
    .catch(() => images.set(label, 'failed'));
  return null;
}
