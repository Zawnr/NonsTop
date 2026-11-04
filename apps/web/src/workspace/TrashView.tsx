// Trash (F-09): restore, or delete permanently. Permanent delete exists only here.
import { restorePage } from '../data/pages.ts';
import { useStore } from '../data/workspace.tsx';
import { trashRoots, UNTITLED, type PageIndex } from '../model/pages.ts';
import { navigate, pagePath } from '../router.ts';
import { confirmDelete } from './PageView.tsx';

export function TrashView({ index }: { index: PageIndex }) {
  const store = useStore();
  const pages = trashRoots(index);
  return (
    <article className="page-view">
      <h1>Trash</h1>
      {pages.length === 0 && <p className="muted">Trash kosong.</p>}
      <ul className="trash-list">
        {pages.map((p) => {
          const count = index.descendants(p.id).length;
          return (
            <li key={p.id}>
              <a href={pagePath(p.id)} onClick={(e) => (e.preventDefault(), navigate(pagePath(p.id)))}>
                {p.title || UNTITLED}
              </a>
              {count > 0 && <span className="muted"> · {count} sub-halaman</span>}
              <span className="row">
                <button className="ghost" onClick={() => void restorePage(store, index, p.id)}>
                  Pulihkan
                </button>
                <button className="ghost danger" onClick={() => void confirmDelete(store, index, p)}>
                  Hapus permanen
                </button>
              </span>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
