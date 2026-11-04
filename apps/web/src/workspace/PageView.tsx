// One page: title, actions, sub-pages, and the "other version" marker for conflicts (F-63).
import { useEffect, useRef, useState } from 'react';
import type { Conflict, Page } from '@nonstop/shared';
import { createPage, deletePermanently, renamePage, resolveConflict, restorePage, setFavorite, trashPage } from '../data/pages.ts';
import { usePageConflicts, useStore } from '../data/workspace.tsx';
import { UNTITLED, visibleChildren, type PageIndex } from '../model/pages.ts';
import { navigate, pagePath } from '../router.ts';
import { MoveDialog } from './MoveDialog.tsx';

const TITLE_SAVE_MS = 400;

export function PageView({ index, page }: { index: PageIndex; page: Page }) {
  const store = useStore();
  const [moving, setMoving] = useState(false);
  const trashed = index.isTrashed(page.id);
  const children = visibleChildren(index, page.id);
  const crumbs = index.ancestors(page.id);

  const addChild = async () => navigate(pagePath(await createPage(store, index, page.id)));

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

      {!trashed && (
        <div className="row actions">
          <button className="ghost" aria-pressed={page.isFavorite} onClick={() => void setFavorite(store, page.id, !page.isFavorite)}>
            {page.isFavorite ? '★ Favorit' : '☆ Favoritkan'}
          </button>
          <button className="ghost" onClick={() => void addChild()}>
            + Sub-halaman
          </button>
          <button className="ghost" onClick={() => setMoving(true)}>
            Pindahkan
          </button>
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

      <p className="muted placeholder">Editor blok hadir di sprint 2.</p>

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
    </article>
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
  const conflicts = usePageConflicts(pageId);
  if (!conflicts.length) return null;
  const use = async (c: Conflict) => {
    await renamePage(store, pageId, String(c.value ?? ''));
    await resolveConflict(store, c.id);
  };
  return (
    <div className="banner conflict" role="status" aria-label="Ada versi lain">
      <strong>Ada versi lain</strong>
      <p className="muted">Judul ini diedit di dua perangkat saat offline. Yang terakhir dipakai: “{current || UNTITLED}”.</p>
      <ul>
        {conflicts.map((c) => (
          <li key={c.id}>
            <span>
              “{String(c.value ?? '') || UNTITLED}” <span className="muted">dari perangkat {c.deviceId}, {formatTime(c.hlc)}</span>
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
