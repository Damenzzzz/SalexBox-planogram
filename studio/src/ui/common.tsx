import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Fixture } from '../domain/types';
import { drawScene, sceneSize, type HitRect, type SceneOpts } from '../render/scene';
import { useStore } from '../store';

// ---------- иконки ----------
const PATHS: Record<string, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 19h14',
  upload: 'M12 16V5m0 0-4 4m4-4 4 4M5 19h14',
  back: 'M15 18l-6-6 6-6',
  cabinet: 'M5 3h14v18H5zM5 9h14M5 15h14',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  box: 'M8 3h8v18H8zM8 8h8',
  scan: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4M7 12h10',
  check: 'm5 12 5 5 9-10',
  x: 'M6 6l12 12M18 6 6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  arrowLeft: 'M19 12H5m0 0 6-6m-6 6 6 6',
  arrowRight: 'M5 12h14m0 0-6-6m6 6-6 6',
  arrowUp: 'M12 19V5m0 0-6 6m6-6 6 6',
  arrowDown: 'M12 5v14m0 0-6-6m6 6 6-6',
  spread: 'M4 4h16M4 20h16M8 9h8M8 15h8',
  camera: 'M4 8h4l2-3h4l2 3h4v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
  file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  cloud: 'M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.2 9.1 4.5 4.5 0 0 0 7 18z',
  refresh: 'M20 11a8 8 0 0 0-14.7-4M4 5v4h4M4 13a8 8 0 0 0 14.7 4M20 19v-4h-4',
  history: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4M12 8v4l3 2',
  print: 'M7 9V4h10v5M7 17H5v-6h14v6h-2M8 14h8v6H8z',
  pin: 'M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  wand: 'M5 19 15 9m2-5v3m-1.5-1.5h3M19 11v2m-1-1h2M8 4v2M7 5h2',
  send: 'M4 12 20 4l-6 16-3-7-7-1z',
  layers: 'm12 4 8 4-8 4-8-4 8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  image: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15.5 9.5h.01',
};
export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}

// ---------- поля ----------
export function NumField({ value, onChange, min = -Infinity, max = Infinity, step = 5, unit = 'мм', label, id, placeholder, allowNull = false, compact = false }: {
  value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; step?: number; unit?: string;
  label?: string; id?: string; placeholder?: string; allowNull?: boolean; compact?: boolean;
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value));
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value == null ? '' : String(value)); }, [value]);
  const commit = (raw: string) => {
    if (raw.trim() === '' && allowNull) { onChange(null); return; }
    const n = Number(raw.replace(',', '.'));
    if (!Number.isFinite(n)) { setDraft(value == null ? '' : String(value)); return; }
    const v = Math.max(min, Math.min(max, Math.round(n)));
    setDraft(String(v));
    if (v !== value) onChange(v);
  };
  const bump = (d: number) => commit(String((value ?? 0) + d));
  const input = (
    <div className="num">
      <input id={id} inputMode="numeric" value={draft} placeholder={placeholder} aria-label={label}
        onFocus={() => { focused.current = true; }}
        onBlur={e => { focused.current = false; commit(e.target.value); }}
        onChange={e => setDraft(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          if (e.key === 'ArrowUp') { e.preventDefault(); bump(e.shiftKey ? step * 10 : step); }
          if (e.key === 'ArrowDown') { e.preventDefault(); bump(e.shiftKey ? -step * 10 : -step); }
        }} />
      {unit && <span className="unit">{unit}</span>}
      {!compact && <button type="button" tabIndex={-1} aria-label="Меньше" onClick={() => bump(-step)}>−</button>}
      {!compact && <button type="button" tabIndex={-1} aria-label="Больше" onClick={() => bump(step)}>+</button>}
    </div>
  );
  if (!label || compact) return input;
  return <label className="field"><span>{label}</span>{input}</label>;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={v === value} onClick={() => onChange(v)}>{text}</button>
      ))}
    </div>
  );
}

export function Toast() {
  const toast = useStore(s => s.toast);
  const [shown, setShown] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    setShown(toast.text);
    const t = setTimeout(() => setShown(null), 2600);
    return () => clearTimeout(t);
  }, [toast]);
  return shown ? <div className="toast" role="status">{shown}</div> : null;
}

export function Modal({ title, children, onClose, footer }: { title: string; children: ReactNode; onClose: () => void; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, button')?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); prev?.focus(); };
  }, [onClose]);
  // в body: окно не наследует стили места, откуда его открыли (шапка редактора и т. п.)
  return createPortal(
    <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <h2>{title}</h2>
        {children}
        {footer && <div className="foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// Выпадающее меню у кнопки: Esc и клик мимо закрывают
export function Menu({ label, icon, items, primary = false }: {
  label: string; icon?: string; primary?: boolean;
  items: ({ label: string; icon?: string; onClick: () => void; disabled?: boolean; hint?: string } | null)[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('mousedown', off); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', off); window.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={`btn${primary ? ' btn-primary' : ''}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(v => !v)}>
        {icon && <Icon name={icon} />}{label}<span className="caret" aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {items.map((it, i) => it ? (
            <button key={i} role="menuitem" disabled={it.disabled} onClick={() => { setOpen(false); it.onClick(); }}>
              {it.icon && <Icon name={it.icon} size={16} />}<span>{it.label}{it.hint && <small>{it.hint}</small>}</span>
            </button>
          ) : <hr key={i} />)}
        </div>
      )}
    </div>
  );
}

// ---------- история отмены для документа ----------
export function useHistory<T>(id: string, current: T, apply: (v: T) => void) {
  const stacks = useRef({ id, past: [] as string[], future: [] as string[] });
  const [, force] = useState(0);
  if (stacks.current.id !== id) stacks.current = { id, past: [], future: [] };
  const commit = useCallback((next: T) => {
    const st = stacks.current;
    st.past.push(JSON.stringify(current)); if (st.past.length > 100) st.past.shift();
    st.future = [];
    apply(next); force(n => n + 1);
  }, [current, apply]);
  const undo = useCallback(() => {
    const st = stacks.current; const prev = st.past.pop();
    if (prev == null) return;
    st.future.push(JSON.stringify(current)); apply(JSON.parse(prev)); force(n => n + 1);
  }, [current, apply]);
  const redo = useCallback(() => {
    const st = stacks.current; const next = st.future.pop();
    if (next == null) return;
    st.past.push(JSON.stringify(current)); apply(JSON.parse(next)); force(n => n + 1);
  }, [current, apply]);
  return { commit, undo, redo, canUndo: stacks.current.past.length > 0, canRedo: stacks.current.future.length > 0 };
}

// ---------- холст сцены ----------
export interface StageHandle {
  locate: (clientX: number, clientY: number) => { x: number; y: number; inside: boolean; hit: HitRect | null; hits: HitRect[] };
  scale: () => number;
  canvas: () => HTMLCanvasElement | null;
}

const PRIORITY: Record<HitRect['kind'], number> = { handle: 0, 'edge-w': 1, 'edge-h': 1, slot: 2, placement: 3, shelf: 4 };
export function hitAt(hits: HitRect[], x: number, y: number) {
  let best: HitRect | null = null;
  for (const h of hits) {
    if (x >= h.x0 && x <= h.x1 && y >= h.y0 && y <= h.y1 && (!best || PRIORITY[h.kind] < PRIORITY[best.kind])) best = h;
  }
  return best;
}

export type StageScene = Omit<SceneOpts, 'S' | 'DPR'>;

export const Stage = forwardRef<StageHandle, {
  scene: StageScene; zoom: number; freeze?: boolean; label: string; cursor?: string; className?: string;
  onPointerDown?: (e: RPointerEvent, p: { x: number; y: number }, hit: HitRect | null) => void;
  onPointerMove?: (e: RPointerEvent, p: { x: number; y: number }, hit: HitRect | null) => void;
  onPointerLeave?: () => void;
  onKeyDown?: (e: RKeyboardEvent) => void;
}>(function Stage({ scene, zoom, freeze, label, cursor, className, onPointerDown, onPointerMove, onPointerLeave, onKeyDown }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const hits = useRef<HitRect[]>([]);
  const [S, setS] = useState(0.4);
  const [boxSize, setBoxSize] = useState({ w: 800, h: 600 });
  const [theme, setTheme] = useState(0);
  const fx: Fixture = scene.fx;
  const size = sceneSize(fx);
  useStore(s => s.texRev);   // догрузились фото эталонов — перерисовать

  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setBoxSize({ w: r.width, h: r.height }); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(t => t + 1);
    mq.addEventListener('change', on);
    document.fonts?.ready.then(on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useEffect(() => {
    if (freeze) return;
    const fit = Math.max(0.12, Math.min((boxSize.w - 8) / size.w, (boxSize.h - 8) / size.h));
    setS(fit * zoom);
  }, [boxSize, size.w, size.h, zoom, freeze]);

  useLayoutEffect(() => {
    const c = cv.current; if (!c) return;
    const DPR = Math.min(2.5, window.devicePixelRatio || 1);
    const w = size.w * S, h = size.h * S;
    if (c.width !== Math.round(w * DPR) || c.height !== Math.round(h * DPR)) {
      c.width = Math.round(w * DPR); c.height = Math.round(h * DPR);
    }
    c.style.width = `${w}px`; c.style.height = `${h}px`;
    hits.current = drawScene(c.getContext('2d')!, { ...scene, S, DPR });
  });
  void theme;

  const locate = useCallback((clientX: number, clientY: number) => {
    const r = cv.current!.getBoundingClientRect();
    const x = clientX - r.left, y = clientY - r.top;
    const inside = x >= 0 && y >= 0 && x <= r.width && y <= r.height;
    return { x, y, inside, hit: inside ? hitAt(hits.current, x, y) : null, hits: hits.current };
  }, []);
  useImperativeHandle(ref, () => ({ locate, scale: () => S, canvas: () => cv.current }), [locate, S]);

  return (
    <div className={`stage ${className ?? ''}`} ref={box} tabIndex={0} aria-label={label} onKeyDown={onKeyDown}>
      <canvas ref={cv} role="img" aria-label={label} style={{ cursor }}
        onPointerDown={e => { box.current?.focus({ preventScroll: true }); const l = locate(e.clientX, e.clientY); onPointerDown?.(e, l, l.hit); }}
        onPointerMove={e => { const l = locate(e.clientX, e.clientY); onPointerMove?.(e, l, l.hit); }}
        onPointerLeave={() => onPointerLeave?.()} />
    </div>
  );
});

// Маленький рендер шкафа для карточек
export function SceneThumb({ scene, width, height }: { scene: StageScene; width: number; height: number }) {
  const cv = useRef<HTMLCanvasElement>(null);
  const [theme, setTheme] = useState(0);
  useStore(s => s.texRev);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(t => t + 1);
    mq.addEventListener('change', on);
    document.fonts?.ready.then(on);
    return () => mq.removeEventListener('change', on);
  }, []);
  useLayoutEffect(() => {
    const c = cv.current; if (!c) return;
    const size = sceneSize(scene.fx);
    const S = Math.min(width / size.w, height / size.h);
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(size.w * S * DPR); c.height = Math.round(size.h * S * DPR);
    c.style.width = `${size.w * S}px`; c.style.height = `${size.h * S}px`;
    drawScene(c.getContext('2d')!, { ...scene, S, DPR });
  });
  void theme;
  return <canvas ref={cv} aria-hidden="true" />;
}

export const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
export const facingsWord = (n: number) => {
  const a = n % 10, b = n % 100;
  return a === 1 && b !== 11 ? 'фейсинг' : a >= 2 && a <= 4 && (b < 12 || b > 14) ? 'фейсинга' : 'фейсингов';
};
