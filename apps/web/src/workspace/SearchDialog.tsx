// Search (F-51): titles and page text, from local data, so it works offline. Ctrl/Cmd+K opens it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useStore } from '../data/workspace.tsx';
import type { PageIndex } from '../model/pages.ts';
import { buildSearchIndex, search, searchDocs } from '../model/search.ts';
import { navigate, pagePath } from '../router.ts';

export function SearchDialog({ index, onClose }: { index: PageIndex; onClose: () => void }) {
  const store = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const blocks = useLiveQuery(() => store.db.block.toArray(), [store]);
  const ms = useMemo(() => buildSearchIndex(searchDocs(index, blocks ?? [])), [index, blocks]);
  const hits = useMemo(() => search(ms, query), [ms, query]);

  useEffect(() => {
    ref.current?.showModal();
  }, []);
  useEffect(() => setActive(0), [query]);

  const open = (id: string) => {
    navigate(pagePath(id));
    onClose();
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label="Cari">
      <input
        className="search-input"
        type="search"
        placeholder="Cari judul atau isi halaman…"
        aria-label="Cari"
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
          else if (e.key === 'Enter' && hits[active]) open(hits[active].id);
          else return;
          e.preventDefault();
        }}
      />
      {query.trim() !== '' && hits.length === 0 && <p className="muted">Tidak ada hasil.</p>}
      <ul className="search-results" role="listbox" aria-label="Hasil pencarian">
        {hits.map((hit, i) => (
          <li key={hit.id}>
            <button className="ghost" role="option" aria-selected={i === active} onClick={() => open(hit.id)}>
              <strong>{highlight(hit.title, hit.terms)}</strong>
              {hit.snippet && <span className="snippet">{highlight(hit.snippet, hit.terms)}</span>}
            </button>
          </li>
        ))}
      </ul>
    </dialog>
  );
}

function highlight(text: string, terms: string[]) {
  if (!terms.length) return text;
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const parts = text.split(new RegExp(`(${escaped.join('|')})`, 'gi'));
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}
