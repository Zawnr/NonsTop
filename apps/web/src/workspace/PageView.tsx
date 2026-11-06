// One page: title, actions, sub-pages, and the "other version" marker for conflicts (F-63).
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { PROP_PREFIX, type Conflict, type Page } from '@nonstop/shared';
import { duplicatePage, setDefaultTemplate, setTemplate } from '../data/copy.ts';
import { createDatabasePage, renameDatabase } from '../data/databases.ts';
import { createPage, deletePermanently, renamePage, resolveConflict, restorePage, setFavorite, trashPage } from '../data/pages.ts';
import { useData, usePageConflicts, useStore } from '../data/workspace.tsx';
import { contentText } from '../model/blocks.ts';
import { cellText, cellValue, databaseTitle, type DatabaseIndex, type Row } from '../model/database.ts';
import { UNTITLED, visibleChildren, type PageIndex } from '../model/pages.ts';
import { navigate, pagePath } from '../router.ts';
import { DatabaseView } from './database/DatabaseView.tsx';
import { RowProperties } from './database/RowProperties.tsx';
import { Popover } from './database/Popover.tsx';
import { MoveDialog } from './MoveDialog.tsx';
import { EmptyPageTemplates, useIsEmptyPage } from './Templates.tsx';
import { TicketDialog, TicketLinks } from './Tickets.tsx';

const TITLE_SAVE_MS = 400;

// The editor is the largest part of the app. Loading it separately keeps the first screen fast.
const PageEditor = lazy(() => import('../editor/PageEditor.tsx'));

export function PageView({ index, page }: { index: PageIndex; page: Page }) {
  const store = useStore();
  const { databases } = useData();
  const [moving, setMoving] = useState(false);
  const [ticketing, setTicketing] = useState(false);
  const trashed = index.isTrashed(page.id);
  const children = visibleChildren(index, page.id);
  const crumbs = index.ancestors(page.id);
  const fullDatabase = databases.fullPageOf(page.id);
  const isRow = page.databaseId !== null;
  const rowDb = page.databaseId ? databases.byId.get(page.databaseId) : undefined;
  const empty = useIsEmptyPage(page);
  /** Ideas become tickets: any page but templates, databases and tickets themselves. */
  const canTicket = !page.isTemplate && !fullDatabase && rowDb?.kind !== 'ticket';

  const addChild = async () => navigate(pagePath(await createPage(store, index, page.id)));
  const addDatabase = async () => navigate(pagePath(await createDatabasePage(store, index, page.id)));

  return (
    <article className="page-view">
      <nav className="crumbs" aria-label="Lokasi halaman">
        {crumbs.map((c) => (
          <a key={c.id} href={pagePath(c.id)} onClick={(e) => (e.preventDefault(), navigate(pagePath(c.id)))}>
            {c.title || UNTITLED}
          </a>
        ))}
      </nav>

      {trashed && (
        <div className="banner" role="status">
          <span>Halaman ini ada di trash.</span>
          <button onClick={() => void restorePage(store, index, trashedRoot(index, page))}>
            Pulihkan
          </button>
        </div>
      )}

      <ConflictBanner pageId={page.id} current={page.title} />

      <TitleInput key={page.id} page={page} readOnly={trashed} />

      <TicketLinks page={page} />

      {isRow && page.isTemplate && rowDb && (
        <div className="banner" role="status">
          <span>
            Template baris untuk {databaseTitle(rowDb, index)}
            {rowDb.defaultTemplateId === page.id ? ' (default)' : ''}. Baris baru dari template ini menyalin judul, properti, dan isinya.
          </span>
          {!trashed && (
            <button className="ghost" onClick={() => void setDefaultTemplate(store, rowDb.id, rowDb.defaultTemplateId === page.id ? null : page.id)}>
              {rowDb.defaultTemplateId === page.id ? 'Bukan default' : 'Jadikan default'}
            </button>
          )}
        </div>
      )}
      {!isRow && page.isTemplate && (
        <div className="banner" role="status">
          <span>Halaman ini template. Pakai lewat “Dari template…” di sidebar atau di halaman kosong.</span>
        </div>
      )}

      {isRow && <RowProperties page={page} readOnly={trashed} />}

      {!trashed && (
        <div className="row actions">
          <button className="ghost" aria-pressed={page.isFavorite} onClick={() => void setFavorite(store, page.id, !page.isFavorite)}>
            {page.isFavorite ? '★ Favorit' : '☆ Favoritkan'}
          </button>
          <button className="ghost" onClick={() => void addChild()}>
            + Sub-halaman
          </button>
          <button className="ghost" onClick={() => void addDatabase()}>
            + Database
          </button>
          {!isRow && (
            <button className="ghost" onClick={() => setMoving(true)}>
              Pindahkan
            </button>
          )}
          <DuplicateButton index={index} databases={databases} page={page} />
          {canTicket && (
            <button className="ghost" onClick={() => setTicketing(true)}>
              Jadikan ticket
            </button>
          )}
          {!isRow && (
            <button className="ghost" aria-pressed={page.isTemplate} onClick={() => void setTemplate(store, page.id, !page.isTemplate)}>
              {page.isTemplate ? 'Bukan template' : 'Jadikan template'}
            </button>
          )}
          <button
            className="ghost danger"
            onClick={async () => {
              await trashPage(store, page.id);
              navigate('/');
            }}
          >
            Hapus
          </button>
        </div>
      )}
      {trashed && page.trashedAt !== null && (
        <div className="row actions">
          <button className="ghost danger" onClick={() => void confirmDelete(store, index, page)}>
            Hapus permanen
          </button>
        </div>
      )}

      {empty && !trashed && !isRow && !page.isTemplate && <EmptyPageTemplates page={page} />}

      {fullDatabase ? (
        <DatabaseView key={fullDatabase.id} databaseId={fullDatabase.id} readOnly={trashed} />
      ) : (
        <div className="editor" data-testid="editor">
          <Suspense fallback={<p className="muted">Memuat editor…</p>}>
            <PageEditor pageId={page.id} readOnly={trashed} />
          </Suspense>
        </div>
      )}

      {children.length > 0 && (
        <section aria-label="Sub-halaman">
          <h2 className="section-title">Sub-halaman</h2>
          <ul className="child-list">
            {children.map((c) => (
              <li key={c.id}>
                <a href={pagePath(c.id)} onClick={(e) => (e.preventDefault(), navigate(pagePath(c.id)))}>
                  {c.title || UNTITLED}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {moving && <MoveDialog index={index} page={page} onClose={() => setMoving(false)} />}
      {ticketing && <TicketDialog source={{ pageId: page.id }} onClose={() => setTicketing(false)} />}
    </article>
  );
}

/** Duplicates the page (F-32). A page with databases asks whether their rows come along. */
function DuplicateButton({ index, databases, page }: { index: PageIndex; databases: DatabaseIndex; page: Page }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const ids = new Set([page.id, ...index.descendants(page.id).map((p) => p.id)]);
  const hasDatabase = [...databases.byId.values()].some((d) => ids.has(d.pageId));
  const run = async (withRows: boolean) => {
    setOpen(false);
    navigate(pagePath(await duplicatePage(store, index, databases, page.id, withRows)));
  };
  return (
    <>
      <button ref={btn} className="ghost" onClick={() => (hasDatabase ? setOpen(true) : void run(true))}>
        Duplikat
      </button>
      {open && (
        <Popover anchor={btn.current} label="Duplikat" onClose={() => setOpen(false)}>
          <div className="pop-list">
            <button type="button" className="ghost pop-item" onClick={() => void run(true)}>
              Duplikat dengan isi
            </button>
            <button type="button" className="ghost pop-item" onClick={() => void run(false)}>
              Duplikat struktur saja
            </button>
            <p className="muted pop-head">Struktur saja: database tanpa baris, template baris tetap ikut.</p>
          </div>
        </Popover>
      )}
    </>
  );
}

/** The page to restore: this page if it was trashed itself, otherwise the trashed ancestor it sits under. */
function trashedRoot(index: PageIndex, page: Page): string {
  if (page.trashedAt !== null) return page.id;
  return index.ancestors(page.id).find((a) => a.trashedAt !== null)?.id ?? page.id;
}

export async function confirmDelete(store: ReturnType<typeof useStore>, index: PageIndex, page: Page) {
  const count = index.descendants(page.id).length;
  const extra = count ? ` beserta ${count} sub-halaman` : '';
  if (!window.confirm(`Hapus permanen "${page.title || UNTITLED}"${extra}? Ini tidak bisa dibatalkan.`)) return;
  await deletePermanently(store, index, page.id);
  if (location.pathname === pagePath(page.id)) navigate('/trash');
}

function TitleInput({ page, readOnly }: { page: Page; readOnly: boolean }) {
  const store = useStore();
  const [value, setValue] = useState(page.title);
  const focused = useRef(false);
  /** The user typed since focusing. Until then, remote changes may replace the text. */
  const dirty = useRef(false);
  /**
   * HLC of the title the user started editing from. Sent as prevHlc so concurrent edits are detected.
   * undefined until loaded: the store then uses the stored HLC.
   */
  const base = useRef<string | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(page.title);
  const pending = useRef<string | null>(null);

  const loadBase = () =>
    void store.db.page.get(page.id).then((rec) => {
      base.current = rec?._hlc.title ?? null;
    });

  // Show changes from other devices unless the user is typing here.
  useEffect(() => {
    latest.current = page.title;
    if (!dirty.current) {
      setValue(page.title);
      loadBase();
    }
    // loadBase only reads refs and props, so page.title is the only dependency.
  }, [page.title]);

  const save = (next: string) => {
    pending.current = null;
    if (next === latest.current) {
      dirty.current = false;
      return;
    }
    void renamePage(store, page.id, next, base.current).then((hlc) => {
      base.current = hlc; // the next edit continues from our own write
      if (!focused.current) dirty.current = false;
    });
  };

  const flush = (next: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (dirty.current) save(next);
  };

  // Leaving the page while a save is waiting: save now, so no typed text is lost.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current !== null) save(pending.current);
    },
    // Runs on unmount only. The component remounts per page (key = page id).
    [],
  );

  return (
    <input
      className="title-input"
      aria-label="Judul halaman"
      placeholder={UNTITLED}
      value={value}
      readOnly={readOnly}
      maxLength={500}
      autoFocus={page.title === '' && !readOnly}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        flush(value);
        if (!pending.current && value === latest.current) dirty.current = false;
      }}
      onChange={(e) => {
        const next = e.target.value;
        dirty.current = true;
        setValue(next);
        pending.current = next;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => flush(next), TITLE_SAVE_MS);
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  );
}

function ConflictBanner({ pageId, current }: { pageId: string; current: string }) {
  const store = useStore();
  const { databases } = useData();
  const conflicts = usePageConflicts(pageId);
  if (!conflicts.length) return null;
  const isTitle = (c: Conflict) => c.entity === 'page' && c.field === 'title';
  const isProp = (c: Conflict) => c.entity === 'page' && c.field.startsWith(PROP_PREFIX);
  const label = (c: Conflict) => {
    if (isTitle(c)) return 'Judul';
    if (c.entity === 'database') return 'Judul database';
    if (isProp(c)) return `Properti ${databases.property(c.field.slice(PROP_PREFIX.length))?.name ?? '(terhapus)'}`;
    return 'Isi blok';
  };
  const preview = (c: Conflict) => {
    if (isTitle(c) || c.entity === 'database') return String(c.value ?? '') || UNTITLED;
    if (isProp(c)) {
      const prop = databases.property(c.field.slice(PROP_PREFIX.length));
      // Only the values matter for reading a stored value; the row's other fields are not used.
      const text = prop ? cellText(cellValue(databases, prop, { id: c.entityId, values: { [c.field]: c.value } } as Row)) : '';
      return text || '(kosong)';
    }
    return contentText(c.value) || UNTITLED;
  };
  const use = async (c: Conflict) => {
    if (isTitle(c)) await renamePage(store, pageId, String(c.value ?? ''));
    else if (c.entity === 'database') await renameDatabase(store, c.entityId, String(c.value ?? ''));
    else if (isProp(c)) await store.write('page', c.entityId, { [c.field]: c.value });
    else await store.write('block', c.entityId, { content: c.value, deleted: false });
    await resolveConflict(store, c.id);
  };
  return (
    <div className="banner conflict" role="status" aria-label="Ada versi lain">
      <strong>Ada versi lain</strong>
      <p className="muted">
        Bagian ini diedit di dua perangkat tanpa saling melihat. Yang terakhir dipakai{conflicts.some(isTitle) ? ` (judul sekarang: “${current || UNTITLED}”)` : ''}. Versi lain:
      </p>
      <ul>
        {conflicts.map((c) => (
          <li key={c.id}>
            <span>
              <span className="muted">{label(c)}: </span>“{preview(c)}”{' '}
              <span className="muted">
                dari perangkat {c.deviceId.split('-')[0]}, {formatTime(c.hlc)}
              </span>
            </span>
            <span className="row">
              <button className="ghost" onClick={() => void use(c)}>
                Pakai versi ini
              </button>
              <button className="ghost" onClick={() => void resolveConflict(store, c.id)}>
                Abaikan
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function formatTime(hlc: string): string {
  const ms = Number(hlc.slice(0, 13));
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '';
}
