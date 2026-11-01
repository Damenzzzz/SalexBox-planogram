import { useLayoutEffect, useRef, useState } from 'react';

// Небольшие графики мониторинга на SVG: кольцо, вертикальные и горизонтальные столбцы.
// Цвета — токены темы; у каждого значения есть подпись, цвет не единственный носитель смысла.

export function useWidth<T extends HTMLElement>(initial = 600) {
  const ref = useRef<T>(null);
  const [w, setW] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export interface DonutPart { label: string; value: number; color: string }

// Кольцо: доли с зазором 2 px, в центре — итог
export function Donut({ parts, total, caption }: { parts: DonutPart[]; total: number; caption: string }) {
  const size = 150, r = 58, stroke = 20, c = 2 * Math.PI * r;
  const sum = parts.reduce((a, p) => a + p.value, 0) || 1;
  let off = 0;
  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={parts.map(p => `${p.label}: ${p.value}`).join(', ')}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {parts.filter(p => p.value > 0).map(p => {
          const len = (p.value / sum) * c;
          const el = (
            <circle key={p.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={p.color} strokeWidth={stroke}
              strokeDasharray={`${Math.max(0, len - 2)} ${c}`} strokeDashoffset={-off} transform={`rotate(-90 ${size / 2} ${size / 2})`}>
              <title>{`${p.label}: ${p.value} (${Math.round((p.value / sum) * 100)} %)`}</title>
            </circle>
          );
          off += len;
          return el;
        })}
        <text x="50%" y="48%" textAnchor="middle" className="donut-total">{total}</text>
        <text x="50%" y="62%" textAnchor="middle" className="donut-cap">{caption}</text>
      </svg>
      <ul className="donut-legend">
        {parts.map(p => (
          <li key={p.label}><i style={{ background: p.color }} /><span>{p.label}</span><b>{p.value}</b><small>{Math.round((p.value / sum) * 100)} %</small></li>
        ))}
      </ul>
    </div>
  );
}

// Вертикальные столбцы по дням: значение над столбцом, подпись дня под ним
export function VBars({ data, color = 'var(--accent)', format = (v: number) => String(v), unit }: {
  data: { label: string; value: number; hint?: string }[]; color?: string; format?: (v: number) => string; unit: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const h = 170, pad = { t: 22, b: 24, l: 4, r: 4 };
  const max = Math.max(1, ...data.map(d => d.value));
  const n = Math.max(1, data.length);
  const slot = (w - pad.l - pad.r) / n;
  const bw = Math.min(46, slot * 0.62);
  const ih = h - pad.t - pad.b;
  return (
    <div className="vbars" ref={ref}>
      <svg width={w} height={h} role="img" aria-label={data.map(d => `${d.label}: ${format(d.value)} ${unit}`).join('; ')}>
        <line x1={pad.l} x2={w - pad.r} y1={h - pad.b} y2={h - pad.b} className="axis-line" />
        {data.map((d, i) => {
          const bh = (d.value / max) * ih;
          const x = pad.l + i * slot + (slot - bw) / 2, y = h - pad.b - bh;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={bw} height={Math.max(0, bh)} rx={4} fill={color}><title>{`${d.label}: ${format(d.value)} ${unit}${d.hint ? ` · ${d.hint}` : ''}`}</title></rect>
              {(n <= 16 || i === n - 1) && <text x={x + bw / 2} y={y - 6} textAnchor="middle" className="bar-val">{format(d.value)}</text>}
              {(n <= 10 || i % Math.ceil(n / 8) === 0 || i === n - 1) && <text x={x + bw / 2} y={h - 7} textAnchor="middle" className="bar-lab">{d.label}</text>}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// Горизонтальные столбцы-рейтинг: подпись, полоса, значение
export function HBars({ data, max, format, color }: {
  data: { label: string; value: number; note?: string; color?: string }[]; max?: number; format: (v: number) => string; color?: string;
}) {
  const top = max ?? Math.max(1, ...data.map(d => d.value));
  return (
    <ul className="hbars">
      {data.map(d => (
        <li key={d.label} title={`${d.label}: ${format(d.value)}${d.note ? ` · ${d.note}` : ''}`}>
          <span className="hb-label"><span>{d.label}</span>{d.note && <small>{d.note}</small>}</span>
          <span className="hb-track"><span className="hb-fill" style={{ width: `${Math.max(1, (d.value / top) * 100)}%`, background: d.color ?? color ?? 'var(--accent)' }} /></span>
          <b className="hb-val">{format(d.value)}</b>
        </li>
      ))}
    </ul>
  );
}
