import { Toast, Icon } from './ui/common';
import { useRoute } from './store';
import { Planograms } from './ui/Planograms';
import { Fixtures } from './ui/Fixtures';
import { Constructor } from './ui/Constructor';
import { Editor } from './ui/Editor';
import { Catalog } from './ui/Catalog';
import { Compare } from './ui/Compare';
import { Outlets } from './ui/Outlets';
import { PriceListView, PrintView } from './ui/Print';
import { ServerButton } from './ui/Server';
import { useStore } from './store';

const TABS: [string, string, string, string[]][] = [
  ['planograms', 'Планограммы', 'grid', ['planograms', 'planogram']],
  ['fixtures', 'Шкафы', 'cabinet', ['fixtures', 'fixture']],
  ['catalog', 'Каталог SKU', 'box', ['catalog']],
  ['compare', 'Сверка IR', 'scan', ['compare']],
  ['outlets', 'Точки', 'pin', ['outlets']],
];

export default function App() {
  const [section = 'planograms', id] = useRoute();
  useStore(s => s.texRev);   // догрузились фото эталонов — перерисовать миниатюры
  if (section === 'print' && id) return <><PrintView id={id} /><Toast /></>;
  if (section === 'pricelist' && id) return <><PriceListView id={id} /><Toast /></>;
  let view;
  if (section === 'planogram' && id) view = <Editor id={id} />;
  else if (section === 'fixtures') view = <Fixtures />;
  else if (section === 'fixture' && id) view = <Constructor id={id} />;
  else if (section === 'catalog') view = <Catalog />;
  else if (section === 'compare') view = <Compare planogramId={id ?? null} />;
  else if (section === 'outlets') view = <Outlets />;
  else view = <Planograms />;

  return (
    <div className="app">
      <header className="topnav">
        <a className="brand" href="#/planograms">
          <svg width="24" height="24" viewBox="0 0 26 26" fill="none" aria-hidden="true"><rect x="2.5" y="2.5" width="21" height="21" rx="3" stroke="currentColor" strokeWidth="2" /><path d="M3 9.5h20M3 16.5h20" stroke="currentColor" strokeWidth="2" /><rect x="6" y="4.5" width="3" height="4" rx=".6" fill="currentColor" /><rect x="10.5" y="4.5" width="3" height="4" rx=".6" fill="currentColor" /><rect x="6" y="11.5" width="3" height="4" rx=".6" fill="currentColor" /><rect x="15" y="11.5" width="3" height="4" rx=".6" fill="currentColor" /><rect x="10.5" y="18.5" width="3" height="4" rx=".6" fill="currentColor" /></svg>
          Planogram Studio <span className="pill">Табак</span>
        </a>
        <nav className="tabs" aria-label="Разделы">
          {TABS.map(([path, name, icon, match]) => (
            <a key={path} href={`#/${path}`} aria-current={match.includes(section) ? 'page' : undefined}>
              <Icon name={icon} size={16} />{name}
            </a>
          ))}
        </nav>
        <ServerButton />
      </header>
      <main className="main">{view}</main>
      <Toast />
    </div>
  );
}
