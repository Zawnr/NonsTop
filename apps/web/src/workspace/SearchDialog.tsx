// Search (F-51): titles and page text, from local data, so it works offline. Ctrl/Cmd+K opens it.
import { useEffect, useMemo, useRef, useState } from 'react';
import type MiniSearch from 'minisearch';
import { useData, useStore } from '../data/workspace.tsx';
import type { PageIndex } from '../model/pages.ts';
import { buildSearchIndex, matchRanges, search, searchDocs, type SearchDoc } from '../model/search.ts';
import { navigate, pagePath } from '../router.ts';

export function SearchDialog({ index, onClose }: { index: PageIndex; onClose: () => void }) {
  const store = useStore();
  const { databases } = useData();
  const ref = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [ms, setMs] = useState<MiniSearch<SearchDoc> | null>(null);
  // Built once when the dialog opens: rebuilding on every save while typing elsewhere is wasted work.
  useEffect(() => {
    let cancelled = false;
    void store.db.block.toArray().then((blocks) => !cancelled && setMs(buildSearchIndex(searchDocs(index, blocks, databases.isOrphanRow))));
    return () => {
      cancelled = true;
    };
    // index is read once, at open.
  }, [store]);
  const hits = useMemo(() => (ms ? search(ms, query) : []), [ms, query]);

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
  const ranges = matchRanges(text, terms);
  if (!ranges.length) return text;
  const out: (string | React.JSX.Element)[] = [];
  let pos = 0;
  ranges.forEach(([start, end], i) => {
    if (start > pos) out.push(text.slice(pos, start));
    out.push(<mark key={i}>{text.slice(start, end)}</mark>);
    pos = end;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}
