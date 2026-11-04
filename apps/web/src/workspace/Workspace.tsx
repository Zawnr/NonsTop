// App layout: sidebar (fixed on wide screens, drawer on phones) and the current view.
import { useState } from 'react';
import { createPage } from '../data/pages.ts';
import { usePageIndex, useStore } from '../data/workspace.tsx';
import { favorites, trashRoots, UNTITLED, type PageIndex } from '../model/pages.ts';
import { navigate, pagePath, useRoute } from '../router.ts';
import { PageTree } from './PageTree.tsx';
import { PageView } from './PageView.tsx';
import { SettingsView } from './SettingsView.tsx';
import { SyncBadge } from './SyncBadge.tsx';
import { TrashView } from './TrashView.tsx';

export function Workspace({ onLogout }: { onLogout: () => void }) {
  const index = usePageIndex();
  const route = useRoute();
  const [navOpen, setNavOpen] = useState(false);
  const store = useStore();

  if (!index) return null;
  const trashCount = trashRoots(index).length;
  const currentId = route.name === 'page' ? route.id : null;
  const closeNav = () => setNavOpen(false);

  const newPage = async () => {
    navigate(pagePath(await createPage(store, index, null)));
    closeNav();
  };

  return (
    <div className={navOpen ? 'shell nav-open' : 'shell'}>
      <aside className="sidebar" aria-label="Navigasi">
        <div className="sidebar-head">
          <a href="/" className="brand" onClick={(e) => (e.preventDefault(), navigate('/'), closeNav())}>
            NonsTop
          </a>
          <SyncBadge />
        </div>
        <button className="new-page" onClick={() => void newPage()}>
          + Halaman baru
        </button>
        <Favorites index={index} currentId={currentId} onNavigate={closeNav} />
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
          <SyncBadge />
        </header>
        <View index={index} onLogout={onLogout} onNewPage={() => void newPage()} />
      </main>
    </div>
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
