// "Jadikan ticket" (F-41): the dialog that picks the ticket database, and the links between a
// ticket and the page it came from.
import { useEffect, useRef, useState } from 'react';
import type { Page } from '@nonstop/shared';
import { convertToTicket, createProject, type TicketSource } from '../data/tickets.ts';
import { useData, useStore } from '../data/workspace.tsx';
import { databaseTitle } from '../model/database.ts';
import { UNTITLED } from '../model/pages.ts';
import { ticketDatabases, ticketsFrom } from '../model/tickets.ts';
import { navigate, pagePath } from '../router.ts';

export function TicketDialog({ source, onClose }: { source: TicketSource; onClose: () => void }) {
  const store = useStore();
  const { pages, databases } = useData();
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  const targets = ticketDatabases(databases, pages);
  /** Tickets this page or checklist item already has, so a second one is a conscious choice. */
  const existing = ticketsFrom(pages, source.pageId, source.blockId ?? null).filter((t) => t.id !== made);
  /** "Proyek / Ticket": the page above the database tells projects apart. */
  const label = (pageId: string, title: string) => {
    const parent = pages.parentOf(pageId);
    const above = parent ? pages.byId.get(parent)?.title || UNTITLED : null;
    return above ? `${above} / ${title}` : title;
  };

  const pick = async (databaseId: string) => {
    setBusy(true);
    setFailed(false);
    try {
      setMade(await convertToTicket(store, pages, databases, databaseId, source));
    } catch (err) {
      console.error(err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog ref={ref} className="dialog" aria-label="Jadikan ticket" onClose={onClose}>
      <h2>Jadikan ticket</h2>
      {made ? (
        <p role="status">
          Ticket dibuat.{' '}
          <a href={pagePath(made)} onClick={(e) => (e.preventDefault(), onClose(), navigate(pagePath(made)))}>
            Buka ticket
          </a>
        </p>
      ) : targets.length ? (
        <>
          {existing.length > 0 && (
            <p className="muted" role="note">
              Sudah ada ticket dari {source.blockId ? 'tugas' : 'halaman'} ini: {existing.map((t) => t.title || UNTITLED).join(', ')}. Pilih database di bawah untuk membuat satu lagi.
            </p>
          )}
          {failed && (
            <p className="error" role="alert">
              Ticket gagal dibuat. Tugas atau database ini mungkin sudah dihapus di perangkat lain.
            </p>
          )}
          <p className="muted">Masuk ke database ticket mana?</p>
          <ul className="template-list">
            {targets.map((d) => (
              <li key={d.id}>
                <button type="button" className="ghost template-choice" disabled={busy} onClick={() => void pick(d.id)}>
                  🎯 <strong>{label(d.pageId, databaseTitle(d, pages))}</strong>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <p className="muted">Belum ada database ticket. Buat Proyek dulu: database Ticket dan Epic dengan view Backlog dan Board.</p>
          <button type="button" disabled={busy} onClick={() => (setBusy(true), void createProject(store, pages, null).finally(() => setBusy(false)))}>
            Buat Proyek
          </button>
        </>
      )}
      <div className="row">
        <button type="button" className="ghost" onClick={onClose}>
          {made ? 'Tutup' : 'Batal'}
        </button>
      </div>
    </dialog>
  );
}

/** "Dari: <sumber>" on a ticket, and the tickets made from this page. */
export function TicketLinks({ page }: { page: Page }) {
  const { pages } = useData();
  const source = page.sourceId ? pages.byId.get(page.sourceId) : undefined;
  const tickets = ticketsFrom(pages, page.id);
  if (!source && !tickets.length) return null;
  const link = (p: Page) => (
    <a key={p.id} className="chip-link" href={pagePath(p.id)} onClick={(e) => (e.preventDefault(), navigate(pagePath(p.id)))}>
      {p.title || UNTITLED}
    </a>
  );
  return (
    <div className="ticket-links row" aria-label="Link ticket">
      {source && (
        <span>
          <span className="muted">Dari: </span>
          {link(source)}
        </span>
      )}
      {tickets.length > 0 && (
        <span>
          <span className="muted">Ticket: </span>
          {tickets.map(link)}
        </span>
      )}
    </div>
  );
}
