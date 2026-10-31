import type { ShelfResult } from '../domain/compare';
import { ghostSku } from '../domain/catalog';
import { FORMATS } from '../domain/formats';
import { ceilingOf, clearanceOf, innerW, laneOf, lanesFor, packFloor, shelfIndex, sortedShelves } from '../domain/geometry';
import type { FormatId, Fixture, IrSlot, Placement, Sku, SlotStatus } from '../domain/types';
import { fitFont, rr, texture, WARN } from './textures';

export type Mode = 'texture' | 'schema' | 'ir';

export const MARGIN = { l: 150, r: 190, t: 90, b: 60 };
export const sceneSize = (fx: Fixture) => ({ w: fx.w + MARGIN.l + MARGIN.r, h: fx.h + MARGIN.t + MARGIN.b });

export interface HitRect {
  kind: 'placement' | 'shelf' | 'slot' | 'handle' | 'edge-w' | 'edge-h';
  id: string;
  shelfId: string;
  x0: number; y0: number; x1: number; y1: number;
  key?: string;
}

export interface SceneOpts {
  fx: Fixture;
  rows: Record<string, Placement[]> | null;
  sku: (id: string) => Sku | undefined;
  mode: Mode;
  warn: boolean;
  dims: boolean;
  S: number;
  DPR: number;
  selPlacement?: string | null;
  selShelf?: string | null;
  hover?: string | null;
  caret?: { shelfId: string; mm: number } | null;
  compare?: Map<string, ShelfResult> | null;
  truth?: (key: string, slot: IrSlot) => SlotStatus;
  selSlot?: string | null;
  sampleFill?: FormatId | null;
  closed?: boolean;
  skip?: string[];
  constructorMode?: boolean;
  zones?: (shelfId: string) => { brand: string; range: [number, number]; mm: [number, number] }[];
}

const MATERIAL = {
  graphite: { body: ['#24272d', '#3a3f47', '#22252a'], back: ['#1b1e23', '#121417'], plinth: '#17191d', lines: 'rgba(255,255,255,.025)' },
  wood: { body: ['#4a2e1c', '#6e462b', '#422816'], back: ['#2b1b11', '#1d120b'], plinth: '#24170e', lines: 'rgba(255,220,180,.035)' },
  white: { body: ['#c9ced5', '#eef1f4', '#c4c9d0'], back: ['#2a2e35', '#1e2127'], plinth: '#aeb5be', lines: 'rgba(255,255,255,.03)' },
};

export const STATUS_TOKEN: Record<SlotStatus, string> = {
  ok: '--st-ok', misplaced: '--st-misplaced', wrong_shelf: '--st-wrong', missing: '--st-missing', extra: '--st-extra', needs_review: '--st-review',
};

export function drawScene(ctx: CanvasRenderingContext2D, o: SceneOpts): HitRect[] {
  const { fx, S, DPR } = o;
  const cs = getComputedStyle(document.documentElement);
  const tok = (n: string) => cs.getPropertyValue(n).trim();
  const X = (mm: number) => (MARGIN.l + mm) * S;
  const Y = (mm: number) => (MARGIN.t + fx.h - mm) * S;
  const size = sceneSize(fx);
  const W = size.w * S, H = size.h * S;
  const schema = o.mode === 'schema';
  const hits: HitRect[] = [];
  const g = ctx;
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);
  const shelves = sortedShelves(fx);
  const xL = X(fx.side), xR = X(fx.w - fx.side);

  // ---- фон ----
  if (schema) {
    g.fillStyle = tok('--surface'); g.fillRect(0, 0, W, H);
    g.strokeStyle = tok('--grid'); g.lineWidth = 1;
    for (let mm = 0; mm <= size.w; mm += 50) { g.beginPath(); g.moveTo(mm * S + 0.5, 0); g.lineTo(mm * S + 0.5, H); g.stroke(); }
    for (let mm = 0; mm <= size.h; mm += 50) { g.beginPath(); g.moveTo(0, mm * S + 0.5); g.lineTo(W, mm * S + 0.5); g.stroke(); }
  } else {
    const bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, tok('--wall-1')); bg.addColorStop(1, tok('--wall-2'));
    g.fillStyle = bg; g.fillRect(0, 0, W, H);
    const spot = g.createRadialGradient(X(fx.w / 2), Y(fx.h * 0.7), 0, X(fx.w / 2), Y(fx.h * 0.7), Math.max(fx.w, fx.h * 0.6) * S);
    spot.addColorStop(0, tok('--wall-spot')); spot.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = spot; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,.28)';
    g.beginPath(); g.ellipse(X(fx.w / 2), Y(0) + 6 * S, fx.w * S * 0.56, 22 * S, 0, 0, Math.PI * 2); g.fill();
  }

  // ---- корпус ----
  const mat = MATERIAL[fx.material];
  if (schema) {
    g.strokeStyle = tok('--ink-2'); g.lineWidth = 1.5;
    g.strokeRect(X(0), Y(fx.h), fx.w * S, fx.h * S);
    g.strokeRect(xL, Y(fx.h - fx.header), xR - xL, (fx.h - fx.header - fx.base) * S);
    g.fillStyle = tok('--ink-3'); g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `500 ${Math.max(9, 26 * S)}px "JetBrains Mono", monospace`;
    if (fx.header > 30) g.fillText(`ЛАЙТБОКС · ${fx.header} мм`, X(fx.w / 2), Y(fx.h - fx.header / 2));
    if (fx.base > 30) g.fillText(`ЦОКОЛЬ · ${fx.base} мм`, X(fx.w / 2), Y(fx.base / 2));
  } else {
    const body = g.createLinearGradient(X(0), 0, X(fx.w), 0);
    body.addColorStop(0, mat.body[0]); body.addColorStop(0.5, mat.body[1]); body.addColorStop(1, mat.body[2]);
    g.fillStyle = body; g.fillRect(X(0), Y(fx.h), fx.w * S, fx.h * S);
    const by0 = Y(fx.h - fx.header), by1 = Y(fx.base);
    const back = g.createLinearGradient(0, by0, 0, by1);
    back.addColorStop(0, mat.back[0]); back.addColorStop(1, mat.back[1]);
    g.fillStyle = back; g.fillRect(xL, by0, xR - xL, by1 - by0);
    g.fillStyle = mat.lines;
    for (let mm = fx.side + 30; mm < fx.w - fx.side; mm += 60) g.fillRect(X(mm), by0, Math.max(1, 2 * S), by1 - by0);
    if (fx.header > 30) {
      const hy0 = Y(fx.h) + 8 * S, hy1 = Y(fx.h - fx.header) - 8 * S;
      const lb = g.createLinearGradient(0, hy0, 0, hy1);
      lb.addColorStop(0, '#f4f1ea'); lb.addColorStop(1, '#d9d4c8');
      g.fillStyle = lb; rr(g, xL, hy0, xR - xL, hy1 - hy0, 6 * S); g.fill();
      g.fillStyle = '#1f2a44'; g.textAlign = 'center'; g.textBaseline = 'middle';
      fitFont(g, 'ТАБАК · TEMEKI', (xR - xL) * 0.8, Math.min(46 * S, (hy1 - hy0) * 0.42), s => `700 ${s}px Unbounded, "Golos Text", sans-serif`);
      g.fillText('ТАБАК · TEMEKI', X(fx.w / 2), (hy0 + hy1) / 2 - (hy1 - hy0) * 0.08);
      g.fillStyle = '#5a6172';
      fitFont(g, 'Продажа лицам старше 21 года', (xR - xL) * 0.7, Math.min(20 * S, (hy1 - hy0) * 0.18), s => `500 ${s}px "Golos Text", sans-serif`);
      g.fillText('Продажа лицам старше 21 года', X(fx.w / 2), (hy0 + hy1) / 2 + (hy1 - hy0) * 0.26);
    }
    g.fillStyle = mat.plinth; g.fillRect(X(0), Y(fx.base), fx.w * S, fx.base * S);
    g.fillStyle = 'rgba(255,255,255,.06)'; g.fillRect(X(0) + 3 * S, Y(fx.h), 4 * S, fx.h * S);
  }

  // ---- полки ----
  shelves.forEach(sh => {
    const fy = packFloor(fx, sh), cy = ceilingOf(fx, sh);
    const skipped = o.skip?.includes(sh.id);
    if (!schema) {
      const led = g.createLinearGradient(0, Y(cy), 0, Y(cy) + 70 * S);
      led.addColorStop(0, 'rgba(255,236,200,.30)'); led.addColorStop(1, 'rgba(255,236,200,0)');
      g.fillStyle = led; g.fillRect(xL, Y(cy), xR - xL, Math.min(70, cy - fy) * S);
    }
    hits.push({ kind: 'shelf', id: sh.id, shelfId: sh.id, x0: xL, x1: xR, y0: Y(cy), y1: Y(sh.y - 14) });

    if (o.rows) drawRow(sh.id);
    else if (o.sampleFill) drawSample(sh.id, o.sampleFill);

    // доска и ценникодержатель
    if (schema) {
      g.fillStyle = tok('--ink-2'); g.fillRect(xL, Y(fy), xR - xL, Math.max(1.5, fx.board * S));
    } else {
      const ry0 = Y(fy) - 4 * S, ry1 = Y(sh.y - 14);
      g.fillStyle = fx.material === 'wood' ? '#8a6040' : '#c9ced6'; g.fillRect(xL, Y(fy), xR - xL, Math.max(1, ry1 - Y(fy)));
      const railTop = Y(sh.y + fx.board + Math.min(fx.rail, 40) * 0.2);
      const rail = g.createLinearGradient(0, railTop, 0, ry1);
      rail.addColorStop(0, '#24345e'); rail.addColorStop(1, '#16213f');
      g.fillStyle = rail; g.fillRect(xL, Math.min(railTop, ry0 + 6 * S), xR - xL, ry1 - Math.min(railTop, ry0 + 6 * S));
      g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(xL, Math.min(railTop, ry0 + 6 * S), xR - xL, Math.max(1, S));
      if (o.rows) drawPrices(sh.id, Math.min(railTop, ry0 + 6 * S), ry1);
    }
    if (skipped) {
      g.fillStyle = 'rgba(120,120,120,.35)';
      g.fillRect(xL, Y(cy), xR - xL, Y(fy) - Y(cy));
      g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `600 ${Math.max(10, 22 * S)}px "Golos Text", sans-serif`;
      g.fillText('не сверяется IR', X(fx.w / 2), Y((fy + cy) / 2));
    }
  });

  // ---- двери ----
  if (!schema && fx.doors !== 'none') drawDoors();

  // ---- оверлеи ----
  if (o.mode === 'ir' && o.rows) drawIr();
  if (o.dims || schema || o.constructorMode) drawDims();
  if (o.constructorMode) drawHandles();
  drawSelection();
  if (o.caret) {
    const sh = fx.shelves.find(s => s.id === o.caret!.shelfId);
    if (sh) {
      g.fillStyle = tok('--accent');
      g.fillRect(X(fx.side + o.caret.mm) - 2, Y(ceilingOf(fx, sh)) + 10 * S, 4, (ceilingOf(fx, sh) - packFloor(fx, sh) - 10) * S);
    }
  }
  return hits;

  // ===== функции отрисовки =====
  function drawRow(shelfId: string) {
    const sh = fx.shelves.find(s => s.id === shelfId)!;
    const row = o.rows![shelfId] ?? [];
    const fy = packFloor(fx, sh), cy = ceilingOf(fx, sh);
    const res = o.compare?.get(shelfId);
    let x = fx.side, k = 0;
    row.forEach(pl => {
      const s = o.sku(pl.sku) ?? ghostSku(pl.sku);   // нет в каталоге — рисуем по метке
      const lane = laneOf(fx, sh, s);
      if (schema) {
        const x0 = X(x), x1 = X(x + lane * pl.facings), y0 = Y(fy + Math.min(s.h, cy - fy)), y1 = Y(fy);
        const segTok = tok(s.segment === 'premium' ? '--seg-1' : s.segment === 'mid' ? '--seg-2' : '--seg-3');
        g.fillStyle = segTok; g.globalAlpha = 0.2; g.fillRect(x0 + 1, y0, x1 - x0 - 2, y1 - y0); g.globalAlpha = 1;
        g.strokeStyle = segTok; g.lineWidth = 1.5; g.strokeRect(x0 + 1.75, y0 + 0.75, x1 - x0 - 3.5, y1 - y0 - 1.5);
        g.setLineDash([2, 3]); g.lineWidth = 1;
        for (let f = 1; f < pl.facings; f++) { const lx = X(x + lane * f); g.beginPath(); g.moveTo(lx, y0 + 4); g.lineTo(lx, y1 - 4); g.stroke(); }
        g.setLineDash([]);
        g.fillStyle = tok('--ink'); g.textAlign = 'center'; g.textBaseline = 'middle';
        const cx = (x0 + x1) / 2, w = x1 - x0 - 8;
        fitFont(g, s.name, w, Math.max(9, 20 * S), z => `600 ${z}px "Golos Text", sans-serif`);
        g.fillText(s.name, cx, (y0 + y1) / 2 - 10 * S);
        g.fillStyle = tok('--ink-2');
        const meta = `${FORMATS[s.format].name} · ${pl.facings}×${lane} мм`;
        fitFont(g, meta, w, Math.max(8, 16 * S), z => `500 ${z}px "JetBrains Mono", monospace`);
        g.fillText(meta, cx, (y0 + y1) / 2 + 14 * S);
        k += pl.facings;
      } else {
        for (let f = 0; f < pl.facings; f++, k++) {
          const r = res?.facings[k] ?? null;
          const st = r ? (o.truth ? o.truth(r.key, r.slot) : r.slot.status) : null;
          let shown: Sku | undefined = s;
          if (r && (st === 'misplaced' || st === 'wrong_shelf') && r.slot.sku) shown = o.sku(r.slot.sku) ?? s;
          const lx = x + lane * f;
          drawPack(shown, lx, lane, fy, cy, st, r?.key);
        }
      }
      hits.push({ kind: 'placement', id: pl.id, shelfId, x0: X(x), x1: X(x + lane * pl.facings), y0: Y(cy), y1: Y(fy) });
      x += lane * pl.facings;
    });
    if (res && !schema) {
      res.extras.forEach(e => {
        const s = e.res.slot.sku ? o.sku(e.res.slot.sku) : undefined;
        const lane = s ? laneOf(fx, sh, s) : 59;
        drawPack(s, x, lane, fy, cy, o.truth ? o.truth(e.res.key, e.res.slot) : e.res.slot.status, e.res.key);
        x += lane;
      });
    }
    const used = x - fx.side;
    if (used > innerW(fx)) {
      g.fillStyle = tok('--st-missing'); g.globalAlpha = 0.3;
      g.fillRect(xR, Y(cy), X(fx.side + used) - xR, Y(fy) - Y(cy)); g.globalAlpha = 1;
    }
  }

  function drawPack(s: Sku | undefined, lx: number, lane: number, fy: number, cy: number, st: SlotStatus | null, key?: string) {
    const x0 = X(lx), x1 = X(lx + lane);
    const empty = st === 'missing' || !s;
    if (empty) {
      const h = Math.min(86, cy - fy) * 0.5 * S, w = x1 - x0 - 4 * S;
      g.fillStyle = 'rgba(235,240,245,.92)'; rr(g, x0 + 2 * S, Y(fy) - h, w, h, 2); g.fill();
      g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x0 + 2 * S, Y(fy) - h, w, Math.max(1, h * 0.04));
    } else {
      const ph = Math.min(s.h, cy - fy - 2) * S, pw = Math.min(s.w, lane) * S;
      const px = x0 + (x1 - x0 - pw) / 2, py = Y(fy) - ph;
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(px + 2 * S, py + 3 * S, pw, ph);
      g.drawImage(texture(s, pw * DPR, ph * DPR, o.warn), px, py, pw, ph);
      g.fillStyle = 'rgba(190,225,255,.16)'; g.fillRect(px - S, Y(fy) - 9 * S, pw + 2 * S, 9 * S);
      g.fillStyle = 'rgba(160,205,255,.55)'; g.fillRect(px - S, Y(fy) - 9 * S, pw + 2 * S, Math.max(1, 1.2 * S));
      if (o.mode === 'ir') {
        const wh = o.warn && s.h > s.w ? ph * WARN.share : 0;
        g.fillStyle = 'rgba(8,10,14,.62)'; g.fillRect(px, py, pw, wh);
        g.strokeStyle = tok('--st-ok'); g.lineWidth = 1.2; g.strokeRect(px, py, pw, ph);
        g.setLineDash([3, 2]); g.strokeStyle = tok('--ir'); g.lineWidth = 1;
        g.strokeRect(px + 1.5, py + wh + 1.5, pw - 3, ph - wh - 3); g.setLineDash([]);
      }
    }
    if (st && st !== 'ok') {
      const ph = empty ? Math.min(86, cy - fy) * 0.5 * S : Math.min(s!.h, cy - fy - 2) * S;
      const pw = empty ? x1 - x0 - 4 * S : Math.min(s!.w, lane) * S;
      const px = x0 + (x1 - x0 - pw) / 2, py = Y(fy) - ph;
      g.strokeStyle = tok(STATUS_TOKEN[st]); g.lineWidth = 2.5;
      if (st === 'needs_review') g.setLineDash([4, 3]);
      g.strokeRect(px - 1.5, py - 1.5, pw + 3, ph + 3); g.setLineDash([]);
      badge(px + pw, py, st);
    }
    if (key) {
      hits.push({ kind: 'slot', id: key, key, shelfId: '', x0, x1, y0: Y(cy), y1: Y(fy) });
      if (o.selSlot === key) {
        g.strokeStyle = tok('--accent'); g.lineWidth = 3;
        rr(g, x0 - 1, Y(cy) + 6 * S, x1 - x0 + 2, (cy - fy - 4) * S, 4); g.stroke();
      }
    }
  }

  function badge(xr: number, y: number, st: SlotStatus) {
    const r = Math.max(6, 12 * S), cx = xr - r * 0.4, cy = y + r * 0.2;
    g.fillStyle = tok(STATUS_TOKEN[st]);
    g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1.4, r * 0.22); g.lineCap = 'round';
    g.beginPath();
    const u = r * 0.45;
    if (st === 'missing') { g.moveTo(cx - u, cy - u); g.lineTo(cx + u, cy + u); g.moveTo(cx + u, cy - u); g.lineTo(cx - u, cy + u); }
    else if (st === 'misplaced') { g.moveTo(cx - u, cy - u * 0.4); g.lineTo(cx + u, cy - u * 0.4); g.moveTo(cx + u, cy + u * 0.4); g.lineTo(cx - u, cy + u * 0.4); }
    else if (st === 'wrong_shelf') { g.moveTo(cx, cy - u); g.lineTo(cx, cy + u); g.moveTo(cx - u * 0.6, cy - u * 0.3); g.lineTo(cx, cy - u); g.lineTo(cx + u * 0.6, cy - u * 0.3); }
    else if (st === 'extra') { g.moveTo(cx - u, cy); g.lineTo(cx + u, cy); g.moveTo(cx, cy - u); g.lineTo(cx, cy + u); }
    else { g.moveTo(cx - u * 0.1, cy + u); g.lineTo(cx - u * 0.1, cy + u * 0.95); g.moveTo(cx - u * 0.5, cy - u * 0.4); g.quadraticCurveTo(cx - u * 0.5, cy - u, cx, cy - u); g.quadraticCurveTo(cx + u * 0.6, cy - u, cx + u * 0.5, cy - u * 0.3); g.quadraticCurveTo(cx, cy, cx - u * 0.1, cy + u * 0.35); }
    g.stroke(); g.lineCap = 'butt';
  }

  function drawPrices(shelfId: string, y0: number, y1: number) {
    const sh = fx.shelves.find(s => s.id === shelfId)!;
    let px = fx.side;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `700 ${Math.max(6, 15 * S)}px "JetBrains Mono", monospace`;
    (o.rows![shelfId] ?? []).forEach(pl => {
      const s = o.sku(pl.sku);
      const lane = s ? laneOf(fx, sh, s) : 59;
      for (let f = 0; f < pl.facings; f++) {
        const cx = X(px + lane * f + lane / 2);
        if (lane * S > 18 && s?.price) { g.fillStyle = '#ffffff'; g.fillText(String(s.price), cx, (y0 + y1) / 2); }
        g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(X(px + lane * (f + 1)) - 0.5, y0 + 2 * S, 1, y1 - y0 - 4 * S);
      }
      px += lane * pl.facings;
    });
  }

  function drawSample(shelfId: string, fmt: FormatId) {
    const sh = fx.shelves.find(s => s.id === shelfId)!;
    const f = FORMATS[fmt];
    const n = lanesFor(fx, sh, f.w, f.lane);
    const fixed = sh.lane ?? (fx.laneMode === 'fixed' ? fx.laneWidth : null);
    const lane = fixed ? Math.ceil((f.w + 2) / fixed) * fixed : f.lane;
    const fy = packFloor(fx, sh), cy = ceilingOf(fx, sh);
    const ph = Math.min(f.h, cy - fy - 2);
    const fits = f.h <= cy - fy;
    for (let i = 0; i < n; i++) {
      const x0 = X(fx.side + i * lane + (lane - f.w) / 2);
      const gr = g.createLinearGradient(x0, 0, x0 + f.w * S, 0);
      gr.addColorStop(0, fits ? '#5b6f96' : '#a14545'); gr.addColorStop(1, fits ? '#3d4d6d' : '#7a2f2f');
      g.fillStyle = gr; rr(g, x0, Y(fy + ph), f.w * S, ph * S, 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(x0, Y(fy + ph), f.w * S, ph * S * 0.5);
    }
    g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'middle';
    g.font = `600 ${Math.max(9, 18 * S)}px "Golos Text", sans-serif`;
    const label = fits ? `${n} рядов ${fmt}` : `${fmt} не влезает: ${f.h} мм > ${Math.round(cy - fy)}`;
    const tw = g.measureText(label).width;
    g.fillStyle = 'rgba(10,12,16,.72)'; rr(g, xL + 6, Y(cy) + 8 * S, tw + 14, Math.max(18, 30 * S), 5); g.fill();
    g.fillStyle = '#ffffff'; g.fillText(label, xL + 13, Y(cy) + 8 * S + Math.max(9, 15 * S));
  }

  function drawDoors() {
    const y0 = Y(fx.h - fx.header), y1 = Y(fx.base);
    if (fx.doors === 'glass') {
      g.fillStyle = 'rgba(200,225,255,.06)'; g.fillRect(xL, y0, xR - xL, y1 - y0);
      g.save(); g.beginPath(); g.rect(xL, y0, xR - xL, y1 - y0); g.clip();
      g.fillStyle = 'rgba(255,255,255,.07)';
      for (let k = 0; k < 3; k++) {
        const sx = xL + (xR - xL) * (0.1 + k * 0.35);
        g.beginPath(); g.moveTo(sx, y0); g.lineTo(sx + 60 * S, y0); g.lineTo(sx - 160 * S, y1); g.lineTo(sx - 220 * S, y1); g.closePath(); g.fill();
      }
      g.restore();
      g.fillStyle = 'rgba(30,34,40,.85)'; g.fillRect(X(fx.w / 2) - 3 * S, y0, 6 * S, y1 - y0);
      if (o.closed) { g.fillStyle = 'rgba(170,190,210,.25)'; g.fillRect(xL, y0, xR - xL, y1 - y0); }
    } else if (fx.doors === 'shutter') {
      if (o.closed) {
        const grad = g.createLinearGradient(0, y0, 0, y1);
        grad.addColorStop(0, '#9aa3ad'); grad.addColorStop(1, '#6f7882');
        g.fillStyle = grad; g.fillRect(xL, y0, xR - xL, y1 - y0);
        g.fillStyle = 'rgba(0,0,0,.18)';
        for (let mm = 0; mm < fx.h - fx.header - fx.base; mm += 18) g.fillRect(xL, y0 + mm * S, xR - xL, Math.max(1, 1.5 * S));
        g.fillStyle = '#2b2f36'; rr(g, X(fx.w / 2) - 40 * S, y1 - 26 * S, 80 * S, 12 * S, 4 * S); g.fill();
      } else {
        g.fillStyle = 'rgba(150,158,168,.9)'; g.fillRect(xL, y0, xR - xL, 10 * S);
        g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(xL, y0 + 10 * S, xR - xL, 3 * S);
      }
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(xL - 3 * S, y0, 3 * S, y1 - y0); g.fillRect(xR, y0, 3 * S, y1 - y0);
    }
  }

  function drawIr() {
    shelves.forEach(sh => {
      if (o.skip?.includes(sh.id)) return;
      const yb = Y(ceilingOf(fx, sh)) + 4 * S;
      (o.zones?.(sh.id) ?? []).forEach((z, k) => {
        const zx0 = X(fx.side + z.mm[0]) + 1, zx1 = X(fx.side + z.mm[1]) - 1;
        g.fillStyle = tok('--ir'); g.globalAlpha = k % 2 ? 0.55 : 0.85;
        g.fillRect(zx0, yb, zx1 - zx0, Math.max(3, 5 * S)); g.globalAlpha = 1;
        g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'top';
        g.font = `600 ${Math.max(8, 16 * S)}px "JetBrains Mono", monospace`;
        const label = `${z.brand} ${z.range[0].toFixed(2)}–${z.range[1].toFixed(2)}`;
        if (g.measureText(label).width < zx1 - zx0 - 4) g.fillText(label, zx0 + 3, yb + Math.max(4, 8 * S));
      });
      const { irRow } = shelfIndex(fx, sh.id);
      g.fillStyle = tok('--ir'); g.textAlign = 'right'; g.textBaseline = 'middle';
      g.font = `600 ${Math.max(9, 20 * S)}px "JetBrains Mono", monospace`;
      g.fillText(`ряд ${irRow}`, X(-16), Y((packFloor(fx, sh) + ceilingOf(fx, sh)) / 2));
    });
  }

  function dimLine(x0: number, y0: number, x1: number, y1: number, label: string, vertical: boolean, ink: string, bg: string) {
    g.strokeStyle = ink; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    const t = 5;
    g.beginPath();
    if (vertical) { g.moveTo(x0 - t, y0); g.lineTo(x0 + t, y0); g.moveTo(x1 - t, y1); g.lineTo(x1 + t, y1); }
    else { g.moveTo(x0, y0 - t); g.lineTo(x0, y0 + t); g.moveTo(x1, y1 - t); g.lineTo(x1, y1 + t); }
    g.stroke();
    g.save();
    g.translate((x0 + x1) / 2, (y0 + y1) / 2);
    if (vertical) g.rotate(-Math.PI / 2);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const m = g.measureText(label).width;
    g.fillStyle = bg; g.fillRect(-m / 2 - 5, -9, m + 10, 18);
    g.fillStyle = ink; g.fillText(label, 0, 0);
    g.restore();
  }

  function drawDims() {
    const ink = tok(schema ? '--ink-2' : '--dim-ink');
    const bg = schema ? tok('--surface') : tok('--dim-bg');
    g.font = `500 ${Math.max(10, 20 * S)}px "JetBrains Mono", monospace`;
    dimLine(X(0), Y(fx.h) - 40 * S, X(fx.w), Y(fx.h) - 40 * S, `${fx.w} мм`, false, ink, bg);
    const dx = o.constructorMode ? 125 : 80;
    dimLine(X(0) - dx * S, Y(fx.h), X(0) - dx * S, Y(0), `${fx.h} мм`, true, ink, bg);
    g.font = `500 ${Math.max(9, 17 * S)}px "JetBrains Mono", monospace`;
    shelves.forEach(sh => {
      const xr = X(fx.w) + 22 * S;
      const mid = Y((packFloor(fx, sh) + ceilingOf(fx, sh)) / 2);
      const cl = clearanceOf(fx, sh);
      g.textAlign = 'left'; g.textBaseline = 'middle';
      g.fillStyle = cl < FORMATS.SS.h ? tok('--st-missing') : ink;
      g.fillText(`↕ ${Math.round(cl)}`, xr, mid - 10 * S);
      g.fillStyle = tok('--ink-3');
      g.fillText(`${Math.round(sh.y)} от пола`, xr, mid + 12 * S);
    });
  }

  function drawHandles() {
    shelves.forEach(sh => {
      const yy = Y(sh.y + fx.board / 2);
      const active = o.selShelf === sh.id || o.hover === sh.id;
      const { fromBottom } = shelfIndex(fx, sh.id);
      const hw = Math.max(26, 46 * S), hh = Math.max(18, 26 * S);
      const hx = X(-16) - hw;
      g.fillStyle = active ? tok('--accent') : tok('--surface');
      g.strokeStyle = active ? tok('--accent') : tok('--line-strong');
      g.lineWidth = 1.5;
      rr(g, hx, yy - hh / 2, hw, hh, hh / 2); g.fill(); g.stroke();
      g.fillStyle = active ? tok('--accent-ink') : tok('--ink');
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `700 ${Math.max(10, 15 * S)}px "JetBrains Mono", monospace`;
      g.fillText(String(fromBottom), hx + hw / 2, yy);
      if (active) {
        g.strokeStyle = tok('--accent'); g.lineWidth = 2; g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(X(0), yy); g.lineTo(X(fx.w), yy); g.stroke(); g.setLineDash([]);
      }
      hits.push({ kind: 'handle', id: sh.id, shelfId: sh.id, x0: hx - 4, x1: X(fx.w), y0: yy - Math.max(hh / 2, 8), y1: yy + Math.max(hh / 2, 8) });
    });
    // ручки размеров шкафа
    const ew = Math.max(10, 16 * S);
    g.fillStyle = tok('--accent');
    rr(g, X(fx.w) - ew / 2 + 2, Y(fx.h / 2) - 30 * S, ew, 60 * S, ew / 2); g.fill();
    rr(g, X(fx.w / 2) - 30 * S, Y(fx.h) - ew / 2 - 2, 60 * S, ew, ew / 2); g.fill();
    hits.push({ kind: 'edge-w', id: 'w', shelfId: '', x0: X(fx.w) - 12, x1: X(fx.w) + 12, y0: Y(fx.h), y1: Y(0) });
    hits.push({ kind: 'edge-h', id: 'h', shelfId: '', x0: X(0), x1: X(fx.w), y0: Y(fx.h) - 12, y1: Y(fx.h) + 12 });
  }

  function drawSelection() {
    const p = o.selPlacement ? hits.find(h => h.kind === 'placement' && h.id === o.selPlacement) : null;
    if (p) {
      g.strokeStyle = tok('--accent'); g.lineWidth = 2.5;
      rr(g, p.x0 - 2, p.y0 + 6 * S, p.x1 - p.x0 + 4, p.y1 - p.y0 - 4 * S, 4); g.stroke();
    }
    const h = o.hover && o.hover !== o.selPlacement ? hits.find(q => q.kind === 'placement' && q.id === o.hover) : null;
    if (h) {
      g.strokeStyle = tok('--accent'); g.globalAlpha = 0.5; g.lineWidth = 1.5;
      rr(g, h.x0 - 1, h.y0 + 6 * S, h.x1 - h.x0 + 2, h.y1 - h.y0 - 4 * S, 4); g.stroke(); g.globalAlpha = 1;
    }
    if (o.selShelf && !o.selPlacement && !o.constructorMode) {
      const sh = fx.shelves.find(s => s.id === o.selShelf);
      if (sh) {
        g.strokeStyle = tok('--accent'); g.globalAlpha = 0.55; g.lineWidth = 1.5; g.setLineDash([6, 4]);
        g.strokeRect(xL + 2, Y(ceilingOf(fx, sh)) + 3, xR - xL - 4, (ceilingOf(fx, sh) - packFloor(fx, sh)) * S - 6);
        g.setLineDash([]); g.globalAlpha = 1;
      }
    }
  }
}
