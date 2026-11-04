// "Pindahkan ke…": moving without drag, for touch screens and keyboard users.
import { useEffect, useRef } from 'react';
import type { Page } from '@nonstop/shared';
import { movePage } from '../data/pages.ts';
import { useStore } from '../data/workspace.tsx';
import { placeAtEnd, UNTITLED, visibleChildren, type PageIndex } from '../model/pages.ts';

export function MoveDialog({ index, page, onClose }: { index: PageIndex; page: Page; onClose: () => void }) {
  const store = useStore();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const targets: { id: string | null; label: string; depth: number }[] = [{ id: null, label: 'Tingkat atas', depth: 0 }];
  const walk = (parentId: string | null, depth: number) => {
    for (const p of visibleChildren(index, parentId)) {
      if (p.id === page.id) continue; // a page cannot move into itself or below itself
      targets.push({ id: p.id, label: p.title || UNTITLED, depth });
      walk(p.id, depth + 1);
    }
  };
  walk(null, 1);

  const choose = async (parentId: string | null) => {
    const place = placeAtEnd(index, page.id, parentId);
    if (place) await movePage(store, page.id, place);
    onClose();
  };

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} aria-label="Pindahkan halaman">
      <h2>Pindahkan “{page.title || UNTITLED}” ke…</h2>
      <ul className="move-list">
        {targets.map((t) => (
          <li key={t.id ?? 'root'}>
            <button
              className="ghost"
              style={{ paddingLeft: `${t.depth * 14 + 12}px` }}
              disabled={t.id === index.parentOf(page.id)}
              onClick={() => void choose(t.id)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
      <button className="ghost" onClick={onClose}>
        Batal
      </button>
    </dialog>
  );
}
