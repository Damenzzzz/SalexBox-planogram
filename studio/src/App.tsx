import { Suspense, lazy } from 'react';
import { Toast, Icon } from './ui/common';
import { useRoute } from './store';
import { Planograms } from './ui/Planograms';
import { Editor } from './ui/Editor';
import { ServerButton } from './ui/Server';
import { useStore } from './store';

// Остальные экраны грузятся, когда их открывают: первый экран — список планограмм и редактор
const Fixtures = lazy(() => import('./ui/Fixtures').then(m => ({ default: m.Fixtures })));
const Constructor = lazy(() => import('./ui/Constructor').then(m => ({ default: m.Constructor })));
const Catalog = lazy(() => import('./ui/Catalog').then(m => ({ default: m.Catalog })));
const Compare = lazy(() => import('./ui/Compare').then(m => ({ default: m.Compare })));
const Outlets = lazy(() => import('./ui/Outlets').then(m => ({ default: m.Outlets })));
const Help = lazy(() => import('./ui/Help').then(m => ({ default: m.Help })));
const Monitor = lazy(() => import('./ui/Monitor').then(m => ({ default: m.Monitor })));
const PrintView = lazy(() => import('./ui/Print').then(m => ({ default: m.PrintView })));
const PriceListView = lazy(() => import('./ui/Print').then(m => ({ default: m.PriceListView })));

const Loading = () => <div className="page"><p className="hint" role="status">Загружаю…</p></div>;

const TABS: [string, string, string, string[]][] = [
  ['planograms', 'Планограммы', 'grid', ['planograms', 'planogram']],
  ['fixtures', 'Шкафы', 'cabinet', ['fixtures', 'fixture']],
  ['catalog', 'Каталог SKU', 'box', ['catalog']],
  ['compare', 'Сверка IR', 'scan', ['compare']],
  ['outlets', 'Точки', 'pin', ['outlets']],
  ['monitor', 'Мониторинг', 'chart', ['monitor']],
];

export default function App() {
  const [section = 'planograms', id] = useRoute();
  useStore(s => s.texRev);   // догрузились фото эталонов — перерисовать миниатюры
  if (section === 'print' && id) return <Suspense fallback={<Loading />}><PrintView id={id} /><Toast /></Suspense>;
  if (section === 'pricelist' && id) return <Suspense fallback={<Loading />}><PriceListView id={id} /><Toast /></Suspense>;
  let view;
  if (section === 'planogram' && id) view = <Editor id={id} />;
  else if (section === 'fixtures') view = <Fixtures />;
  else if (section === 'fixture' && id) view = <Constructor id={id} />;
  else if (section === 'catalog') view = <Catalog />;
  else if (section === 'compare') view = <Compare planogramId={id ?? null} />;
  else if (section === 'outlets') view = <Outlets />;
  else if (section === 'help') view = <Help />;
  else if (section === 'monitor') view = <Monitor />;
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
        <a className={`btn btn-sm btn-ghost help-link${section === 'help' ? ' is-on' : ''}`} href="#/help" aria-current={section === 'help' ? 'page' : undefined}><Icon name="help" size={16} /><span>Помощь</span></a>
        <ServerButton />
      </header>
      <main className="main"><Suspense fallback={<Loading />}>{view}</Suspense></main>
      <Toast />
    </div>
  );
}
