import { useEffect, useRef, useState } from 'react';
import SearchPage from './pages/SearchPage.jsx';
import LibraryPage from './pages/LibraryPage.jsx';
import UploadPage from './pages/UploadPage.jsx';
import PaperPage from './pages/PaperPage.jsx';

// Top-level pages shown in the navigation.
const NAV = {
  search: { label: 'Search Papers', title: 'Search' },
  library: { label: 'My Library', title: 'My Library' },
  upload: { label: 'Upload PDF', title: 'Upload PDF' },
};

// The current page lives in the URL hash (#/search, #/library, #/upload,
// #/paper/12), so refresh and the browser's back/forward buttons work without
// a router library.
function routeFromHash() {
  const [page, id] = window.location.hash.replace(/^#\/?/, '').split('/');
  if (page === 'paper' && /^\d+$/.test(id ?? '')) return { page: 'paper', id: Number(id) };
  return { page: page in NAV ? page : 'search' };
}

const initialSearch = { query: '', status: 'idle', submitted: '', total: 0, results: [], error: null };

export default function App() {
  const [route, setRoute] = useState(routeFromHash);
  const [search, setSearch] = useState(initialSearch);
  const firstRender = useRef(true);

  useEffect(() => {
    const onHashChange = () => setRoute(routeFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    document.title = `${route.page === 'paper' ? 'Paper' : NAV[route.page].title} · AI Research Assistant`;
    // After navigating, move focus to the new content (screen readers and
    // keyboard users would otherwise stay on the link they activated).
    if (firstRender.current) firstRender.current = false;
    else document.getElementById('main')?.focus();
  }, [route.page, route.id]);

  // The paper view belongs to the library section of the navigation.
  const section = route.page === 'paper' ? 'library' : route.page;

  return (
    <>
      {/* Focus <main> directly: following "#main" would change the hash, which selects the page. */}
      <a
        href="#main"
        className="skip-link"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <div className="container header-inner">
          <a href="#/search" className="brand">
            <span className="brand-mark" aria-hidden="true">◆</span> AI Research Assistant
          </a>
          <nav aria-label="Main">
            <ul className="nav-list">
              {Object.entries(NAV).map(([key, { label }]) => (
                <li key={key}>
                  <a
                    href={`#/${key}`}
                    className={`nav-link${section === key ? ' active' : ''}`}
                    aria-current={route.page === key ? 'page' : section === key ? 'true' : undefined}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main id="main" className="container" tabIndex={-1}>
        {route.page === 'search' && <SearchPage search={search} setSearch={setSearch} />}
        {route.page === 'library' && <LibraryPage />}
        {route.page === 'upload' && <UploadPage />}
        {route.page === 'paper' && <PaperPage key={route.id} id={route.id} />}
      </main>
    </>
  );
}
