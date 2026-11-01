// Дерево кластеров точек: «Алматы» → «Супермаркет Южный». Точки подкластера — и точки родителя,
// так же считает сервер. Петли и пропавшие родители не ломают дерево: такой кластер — верхний.

import type { Cluster } from './types';

export interface ClusterNode { c: Cluster; depth: number; path: string; outlets: string[]; children: string[] }

export function clusterTree(clusters: Cluster[]): ClusterNode[] {
  const byId = new Map(clusters.map(c => [c.id, c]));
  const chain = (c: Cluster) => {
    const out: Cluster[] = [];
    for (let cur: Cluster | undefined = c; cur && !out.includes(cur); cur = cur.parentId ? byId.get(cur.parentId) : undefined) out.push(cur);
    return out;
  };
  const parentOf = (c: Cluster) => { const ch = chain(c); return ch.length > 1 && ch[ch.length - 1] !== c ? ch[1] : undefined; };
  const kids = new Map<string, Cluster[]>();
  clusters.forEach(c => { const p = parentOf(c); if (p) kids.set(p.id, [...(kids.get(p.id) ?? []), c]); });
  const all = (c: Cluster, seen = new Set<string>()): string[] => {
    if (seen.has(c.id)) return [];
    seen.add(c.id);
    return [...c.outlets, ...(kids.get(c.id) ?? []).flatMap(k => all(k, seen))];
  };
  const out: ClusterNode[] = [];
  const walk = (c: Cluster, depth: number) => {
    const ch = chain(c).reverse();
    out.push({ c, depth, path: ch.map(x => x.name).join(' › '), outlets: [...new Set(all(c))], children: (kids.get(c.id) ?? []).map(k => k.id) });
    (kids.get(c.id) ?? []).forEach(k => walk(k, depth + 1));
  };
  // порядок создания, а не по алфавиту: иначе карточка прыгает, пока пишешь её название
  clusters.filter(c => !parentOf(c)).forEach(c => walk(c, 0));
  return out;
}

// Кандидаты в родители: все, кроме самого кластера и его потомков (иначе петля)
export function parentOptions(tree: ClusterNode[], id: string): ClusterNode[] {
  const banned = new Set<string>([id]);
  let grew = true;
  while (grew) { grew = false; tree.forEach(n => { if (n.c.parentId && banned.has(n.c.parentId) && !banned.has(n.c.id)) { banned.add(n.c.id); grew = true; } }); }
  return tree.filter(n => !banned.has(n.c.id));
}
