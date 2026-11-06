// App layout: sidebar (fixed on wide screens, drawer on phones) and the current view.
import { useEffect, useRef, useState } from 'react';
import { createDatabasePage } from '../data/databases.ts';
import { createPage, createQuickNote } from '../data/pages.ts';
import { DataContext, useLiveWorkspaceData, useStore } from '../data/workspace.tsx';
import { favorites, trashRoots, UNTITLED, type PageIndex } from '../model/pages.ts';
import { navigate, pagePath, useRoute } from '../router.ts';
import { PageTree } from './PageTree.tsx';
import { PageView } from './PageView.tsx';
import { SearchDialog } from './SearchDialog.tsx';
import { SettingsView } from './SettingsView.tsx';
import { SyncBadge } from './SyncBadge.tsx';
import { SidebarTemplates, TemplateDialog } from './Templates.tsx';
import { TrashView } from './TrashView.tsx';

export function Workspace({ onLogout }: { onLogout: () => void }) {
  const data = useLiveWorkspaceData();
  const index = data?.pages;
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const [templating, setTemplating] = useState(false);
  const store = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Inside the editor, Ctrl/Cmd+K creates a link, so search only takes it elsewhere.
      const inEditor = e.target instanceof HTMLElement && e.target.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && !inEditor) {
        e.preventDefault();
        setSearching(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Quick note (F-50): create the note once the data is loaded, then replace /quick with its page,
  // so Back does not create another one.
  const quickDone = useRef(false);
  useEffect(() => {
    if (route.name !== 'quick') {
      quickDone.current = false;
      return;
    }
    if (!index || quickDone.current) return;
    quickDone.current = true;
    void createQuickNote(store, index).then((id) => navigate(pagePath(id), { replace: true }));
  }, [route.name, index, store]);

  if (!data || !index) return null;
  const trashCount = trashRoots(index).length;
  const currentId = route.name === 'page' ? route.id : null;
  const closeNav = () => setNavOpen(false);

  const newPage = async () => {
    navigate(pagePath(await createPage(store, index, null)));
    closeNav();
  };

  const newDatabase = async () => {
    navigate(pagePath(await createDatabasePage(store, index, null)));
    closeNav();
  };

  return (
    <DataContext.Provider value={data}>
    <div className={navOpen ? 'shell nav-open' : 'shell'}>
      <aside className="sidebar" aria-label="Navigasi">
        <div className="sidebar-head">
          <a href="/" className="brand" onClick={(e) => (e.preventDefault(), navigate('/'), closeNav())}>
            NonsTop
          </a>
          <SyncBadge />
        </div>
        <button className="ghost search-open" onClick={() => (setSearching(true), closeNav())}>
          Cari…
        </button>
        <button className="new-page" onClick={() => void newPage()}>
          + Halaman baru
        </button>
        <button className="ghost new-page" onClick={() => void newDatabase()}>
          + Database baru
        </button>
        <button className="ghost new-page" onClick={() => (setTemplating(true), closeNav())}>
          Dari template…
        </button>
        <Favorites index={index} currentId={currentId} onNavigate={closeNav} />
        <SidebarTemplates index={index} currentId={currentId} onNavigate={closeNav} />
        <h2 className="section-title">Halaman</h2>
        <PageTree index={index} currentId={currentId} onNavigate={closeNav} />
        <div className="sidebar-foot">
          <SideLink path="/trash" label={`Trash${trashCount ? ` (${trashCount})` : ''}`} onNavigate={closeNav} />
          <SideLink path="/settings" label="Pengaturan" onNavigate={closeNav} />
        </div>
      </aside>
      <div className="scrim" onClick={closeNav} aria-hidden="true" />
      <main className="main">
        <header className="mobile-bar">
          <button className="icon" onClick={() => setNavOpen(true)} aria-label="Buka menu">
            ☰
          </button>
          <span className="row mobile-bar-end">
            {/* Quick note from anywhere in the app, like the launcher shortcut (F-50, N-02). */}
            <button className="ghost quick-note" onClick={() => navigate('/quick')}>
              + Catatan
            </button>
            <SyncBadge />
          </span>
        </header>
        <View index={index} onLogout={onLogout} onNewPage={() => void newPage()} />
      </main>
      {searching && <SearchDialog index={index} onClose={() => setSearching(false)} />}
      {templating && <TemplateDialog index={index} onClose={() => setTemplating(false)} />}
    </div>
    </DataContext.Provider>
  );
}

function View({ index, onLogout, onNewPage }: { index: PageIndex; onLogout: () => void; onNewPage: () => void }) {
  const route = useRoute();
  if (route.name === 'trash') return <TrashView index={index} />;
  if (route.name === 'settings') return <SettingsView onLogout={onLogout} />;
  if (route.name === 'page') {
    const page = index.byId.get(route.id);
    if (!page) {
      return (
        <article className="page-view">
          <h1>Halaman tidak ditemukan</h1>
          <p className="muted">Halaman ini sudah dihapus permanen, atau belum tersinkron ke perangkat ini.</p>
        </article>
      );
    }
    return <PageView index={index} page={page} />;
  }
  return (
    <article className="page-view">
      <h1>NonsTop</h1>
      <p className="muted">Pilih halaman di sidebar, atau mulai yang baru.</p>
      <div className="row">
        <button onClick={onNewPage}>+ Halaman baru</button>
      </div>
    </article>
  );
}

function Favorites({ index, currentId, onNavigate }: { index: PageIndex; currentId: string | null; onNavigate: () => void }) {
  const list = favorites(index);
  if (!list.length) return null;
  return (
    <>
      <h2 className="section-title">Favorit</h2>
      <ul className="side-list" aria-label="Favorit">
        {list.map((p) => (
          <li key={p.id}>
            <a
              href={pagePath(p.id)}
              className={p.id === currentId ? 'active' : undefined}
              onClick={(e) => (e.preventDefault(), navigate(pagePath(p.id)), onNavigate())}
            >
              ★ {p.title || UNTITLED}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

function SideLink({ path, label, onNavigate }: { path: string; label: string; onNavigate: () => void }) {
  return (
    <a
      href={path}
      className={location.pathname === path ? 'side-link active' : 'side-link'}
      onClick={(e) => (e.preventDefault(), navigate(path), onNavigate())}
    >
      {label}
    </a>
  );
}
