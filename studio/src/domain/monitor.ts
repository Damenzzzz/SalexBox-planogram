// Отчёт мониторинга (GET /v1/studio/compliance) и демо-отчёт для показа.
// Демо собирается в браузере, на сервер не уходит и всегда помечается «Демо-данные».

export interface MonitorOutlet { outlet_id: string; photos: number; compliance: number | null; last: number; last_at: string; planogram: string | null; trend: number[]; clusters: string[] }
export interface MonitorUser { login: string; name: string; role: string | null; login_count: number; edits: number; publishes: number; checks: number; last_seen: string }
export interface MonitorReport {
  days: number;
  summary: { photos: number; outlets: number; compliance: number | null; osa: number | null; assigned_outlets?: number; coverage?: number | null };
  by_day: { day: string; photos: number; compliance: number | null }[];
  by_outlet: MonitorOutlet[];
  by_cluster: { cluster_id: string; cluster: string; outlets: number; outlets_seen: number; photos: number; compliance: number | null }[];
  by_planogram: { name: string; title: string | null; version: number | null; photos: number; compliance: number | null }[];
  problems?: { sku: string; slots: number; photos: number }[];
  activity?: { users: MonitorUser[]; by_day: { day: string; users: number; logins: number; edits: number; publishes: number; checks: number }[]; active_users: number };
}

// Детерминированный генератор: один и тот же показ — одни и те же цифры
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const round = (x: number, d = 4) => Math.round(x * 10 ** d) / 10 ** d;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const PEOPLE: [string, string, string][] = [
  ['aigerim', 'Айгерим Сапарова', 'manager'], ['daniyar', 'Данияр Касымов', 'editor'], ['madina', 'Мадина Тлеуова', 'editor'],
  ['erlan', 'Ерлан Бекетов', 'manager'], ['asel', 'Асель Нурланова', 'editor'], ['timur', 'Тимур Жумабаев', 'editor'],
  ['zhanna', 'Жанна Омарова', 'editor'], ['ruslan', 'Руслан Ахметов', 'editor'], ['dinara', 'Динара Мусина', 'editor'],
  ['nurlan', 'Нурлан Есенов', 'editor'], ['aliya', 'Алия Кенжебаева', 'editor'], ['sergey', 'Сергей Пак', 'admin'],
  ['gulnara', 'Гульнара Ибраева', 'editor'], ['askar', 'Аскар Муканов', 'editor'],
];
const CLUSTERS: [string, string, number][] = [['cl_ast', 'Алматы · АЗС', 9], ['cl_sm', 'Алматы · супермаркеты', 10], ['cl_kiosk', 'Астана · киоски', 8]];
const PLANS: [string, string, number][] = [['plg-azs-v3', 'АЗС · шкаф с толкателями', 3], ['plg-sm-v2', 'Супермаркет · кассовая зона', 2], ['plg-kiosk-v1', 'Киоск · прилавочный диспенсер', 1]];
const SKUS = ['Marlboro/Marlboro Red KS', 'Parliament/Parliament Aqua Blue KS', 'Esse/Esse Exchange M SS', 'Kent/Kent Nano Silver', 'Winston/Winston Blue SS',
  'Bond/Bond Blue Compact', 'Esse/Esse Golden Leaf SS', 'Camel/Camel Blue Compact', 'LD/LD Club Gold', 'Chapman/Chapman Red SS'];

// 5 дней работы: 10–15 человек, три кластера точек, соответствие растёт по мере исправлений
export function demoReport(): MonitorReport {
  const r = rng(20261101);
  const today = new Date();
  const days = Array.from({ length: 5 }, (_, i) => { const d = new Date(today); d.setDate(d.getDate() - (4 - i)); return d; });
  const dayTrend = [0.74, 0.77, 0.8, 0.83, 0.86];

  // точки: у каждой своя планограмма по кластеру, 2–5 фото за 5 дней
  const outlets: MonitorOutlet[] = [];
  const photosByDay = days.map(() => [] as number[]);
  CLUSTERS.forEach(([, name, n], ci) => {
    for (let k = 0; k < n; k++) {
      const id = `out_${(ci + 1) * 100 + k + 1}`;
      const base = 0.72 + r() * 0.24 + (ci === 0 ? 0.03 : ci === 2 ? -0.04 : 0);
      const shots = 2 + Math.floor(r() * 4);
      const trend: number[] = [];
      let lastDay = 0;
      for (let s = 0; s < shots; s++) {
        const di = Math.min(4, Math.floor((s / shots) * 5 + r() * 1.2));
        const v = Math.max(0.35, Math.min(1, base + dayTrend[di] - 0.8 + (r() - 0.5) * 0.1));
        trend.push(round(v, 3)); photosByDay[di].push(v); lastDay = Math.max(lastDay, di);
      }
      const at = new Date(days[lastDay]); at.setHours(9 + Math.floor(r() * 9), Math.floor(r() * 60));
      outlets.push({ outlet_id: id, photos: shots, compliance: round(trend.reduce((a, b) => a + b, 0) / trend.length), last: trend[trend.length - 1], last_at: at.toISOString(), planogram: PLANS[ci][0], trend, clusters: [name] });
    }
  });
  // остальные фото дня — повторные визиты тех же точек
  photosByDay.forEach((list, di) => { const extra = 30 + Math.floor(r() * 18) - list.length; for (let i = 0; i < extra; i++) list.push(Math.max(0.4, Math.min(1, dayTrend[di] + (r() - 0.5) * 0.24))); });
  const mean = (xs: number[]) => (xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const all = photosByDay.flat();
  outlets.sort((a, b) => a.last - b.last || a.outlet_id.localeCompare(b.outlet_id));

  // команда: каждый день заходят 10–14 человек из 14
  const users = PEOPLE.map(([login, name, role]) => ({ login, name, role, login_count: 0, edits: 0, publishes: 0, checks: 0, last_seen: '' }));
  const actDays = days.map(d => {
    const n = 10 + Math.floor(r() * 5);
    const who = [...users].sort(() => r() - 0.5).slice(0, n);
    let logins = 0, edits = 0, publishes = 0, checks = 0;
    who.forEach(u => {
      const l = 1 + Math.floor(r() * 2), e = Math.floor(r() * (u.role === 'editor' ? 18 : 8)), c = Math.floor(r() * 6);
      const p = u.role !== 'editor' && r() > 0.55 ? 1 : 0;
      u.login_count += l; u.edits += e; u.checks += c; u.publishes += p;
      logins += l; edits += e; checks += c; publishes += p;
      const at = new Date(d); at.setHours(9 + Math.floor(r() * 9), Math.floor(r() * 60)); if (at.toISOString() > u.last_seen) u.last_seen = at.toISOString();
    });
    return { day: iso(d), users: who.length, logins, edits, publishes, checks };
  });

  const byCluster = CLUSTERS.map(([id, name, n]) => {
    const mine = outlets.filter(o => o.clusters.includes(name));
    return { cluster_id: id, cluster: name, outlets: n + 1, outlets_seen: mine.length, photos: mine.reduce((a, o) => a + o.photos, 0), compliance: mean(mine.flatMap(o => o.trend)) };
  });
  const problems = SKUS.map((sku, i) => ({ sku, slots: Math.round(48 - i * 4 + r() * 3), photos: Math.round(26 - i * 2 + r() * 2) })).sort((a, b) => b.slots - a.slots);
  const assigned = CLUSTERS.reduce((a, [, , n]) => a + n + 1, 0);
  return {
    days: 5,
    summary: { photos: all.length, outlets: outlets.length, compliance: mean(all), osa: 0.91, assigned_outlets: assigned, coverage: round(outlets.length / assigned) },
    by_day: days.map((d, i) => ({ day: iso(d), photos: photosByDay[i].length, compliance: mean(photosByDay[i]) })),
    by_outlet: outlets,
    by_cluster: byCluster,
    by_planogram: PLANS.map(([name, title, version], ci) => ({ name, title, version, photos: byCluster[ci].photos, compliance: byCluster[ci].compliance })),
    problems,
    activity: { users: users.filter(u => u.last_seen).sort((a, b) => b.last_seen.localeCompare(a.last_seen)), by_day: actDays, active_users: users.filter(u => u.last_seen).length },
  };
}
