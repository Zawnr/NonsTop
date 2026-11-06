// Page templates (F-30): the choices on an empty page, the sidebar section, and the dialog that
// creates a page from a template.
import { useEffect, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Page } from '@nonstop/shared';
import { applyTemplate, createFromTemplate, type TemplateRef } from '../data/copy.ts';
import { useData, useStore } from '../data/workspace.tsx';
import { contentText } from '../model/blocks.ts';
import { pageTemplates, UNTITLED, type PageIndex } from '../model/pages.ts';
import { BUILTIN_TEMPLATES } from '../model/templates.ts';
import { navigate, pagePath } from '../router.ts';

/** Built-in templates first, then the user's own. */
function TemplateList({ index, onPick, exclude }: { index: PageIndex; onPick: (ref: TemplateRef) => void; exclude?: string }) {
  const own = pageTemplates(index).filter((p) => p.id !== exclude);
  return (
    <ul className="template-list">
      {BUILTIN_TEMPLATES.map((t) => (
        <li key={t.id}>
          <button type="button" className="ghost template-choice" onClick={() => onPick({ builtin: t })}>
            <span aria-hidden="true">{t.icon}</span>
            <span>
              <strong>{t.name}</strong>
              <span className="muted"> {t.description}</span>
            </span>
          </button>
        </li>
      ))}
      {own.map((p) => (
        <li key={p.id}>
          <button type="button" className="ghost template-choice" onClick={() => onPick({ pageId: p.id })}>
            <span aria-hidden="true">📄</span>
            <strong>{p.title || UNTITLED}</strong>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** True while the page has no content of its own: no blocks with text, no sub-pages, no database. */
export function useIsEmptyPage(page: Page): boolean {
  const store = useStore();
  const { pages, databases } = useData();
  const blocks = useLiveQuery(() => store.db.block.where('pageId').equals(page.id).toArray(), [store, page.id]);
  if (!blocks) return false;
  const content = blocks.some((b) => !b.deleted && (b.type !== 'paragraph' || contentText(b.content).trim() !== ''));
  return !content && pages.childrenOf(page.id).every((c) => c.deleted || c.trashedAt !== null) && !databases.fullPageOf(page.id);
}

/** Template choices on an empty page. Picking one fills this page (its title stays). */
export function EmptyPageTemplates({ page }: { page: Page }) {
  const store = useStore();
  const { pages } = useData();
  return (
    <section className="empty-templates" aria-label="Mulai dari template">
      {/* Folded on phones, so a quick note starts typing near the top (N-02). */}
      <details open={!window.matchMedia('(max-width: 767px)').matches}>
        <summary className="muted">Mulai dari template, atau langsung ketik di bawah.</summary>
        <TemplateList index={pages} exclude={page.id} onPick={(ref) => void applyTemplate(store, pages, page.id, ref)} />
      </details>
    </section>
  );
}

export function SidebarTemplates({ index, currentId, onNavigate }: { index: PageIndex; currentId: string | null; onNavigate: () => void }) {
  const list = pageTemplates(index);
  if (!list.length) return null;
  return (
    <>
      <h2 className="section-title">Template</h2>
      <ul className="side-list" aria-label="Template">
        {list.map((p) => (
          <li key={p.id}>
            <a
              href={pagePath(p.id)}
              className={p.id === currentId ? 'active' : undefined}
              onClick={(e) => (e.preventDefault(), navigate(pagePath(p.id)), onNavigate())}
            >
              📄 {p.title || UNTITLED}
            </a>
          </li>
        ))}
      </ul>
    </>
  );
}

/** "Dari template": creates a new top-level page from the chosen template and opens it. */
export function TemplateDialog({ index, onClose }: { index: PageIndex; onClose: () => void }) {
  const store = useStore();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const pick = async (template: TemplateRef) => {
    const id = await createFromTemplate(store, index, null, template);
    onClose();
    navigate(pagePath(id));
  };
  return (
    <dialog ref={ref} className="dialog" aria-label="Halaman dari template" onClose={onClose}>
      <h2>Halaman baru dari template</h2>
      <TemplateList index={index} onPick={(t) => void pick(t)} />
      <div className="row">
        <button type="button" className="ghost" onClick={onClose}>
          Batal
        </button>
      </div>
    </dialog>
  );
}
