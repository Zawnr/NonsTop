// Block editor of a page (F-03, F-04), connected to the synced block rows.
//
// The editor owns what the user sees. A snapshot holds the last state written to or accepted from
// the store, so local edits are found by diffing the editor against it, and remote changes by
// finding rows with a timestamp this editor has not seen yet.
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { filterSuggestionItems } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  useBlockNoteEditor,
  useComponentsContext,
  useCreateBlockNote,
  useExtensionState,
  type SideMenuProps,
} from '@blocknote/react';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { BlockNoteView } from '@blocknote/ariakit';
import '@blocknote/ariakit/style.css';
import { compareHlc, sameValue, type Block } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { createInlineDatabase, newId, syncInlineDatabases } from '../data/databases.ts';
import { useStore } from '../data/workspace.tsx';
import { buildDocument, diffDocument, hasNoContent, liveBlocks, toSnapshot, type DocBlock, type FlatBlock, type Snapshot } from '../model/blocks.ts';
import { schema } from './schema.tsx';
import { slashMenuItems } from './slash-menu.tsx';
import { navigate } from '../router.ts';
import { TicketDialog } from '../workspace/Tickets.tsx';

const SAVE_MS = 300;

const dictionary = {
  ...en,
  placeholders: {
    ...en.placeholders,
    default: "Ketik '/' untuk perintah",
    heading: 'Heading',
    toggleListItem: 'Toggle',
    bulletListItem: 'List',
    numberedListItem: 'List',
    checkListItem: 'Tugas',
  },
};

export default function PageEditor({ pageId, readOnly }: { pageId: string; readOnly: boolean }) {
  const store = useStore();
  const rows = useLiveQuery(() => store.db.block.where('pageId').equals(pageId).toArray(), [store, pageId]);
  if (!rows) return null;
  return <EditorInner key={pageId} pageId={pageId} rows={rows} readOnly={readOnly} />;
}

type SeenHlc = Map<string, Record<string, string>>;

/** A field of this row carries a timestamp newer than the one the editor has seen for that field. */
const hasUnseen = (row: Stored<Block>, known: Record<string, string> | undefined) =>
  Object.entries(row._hlc).some(([field, hlc]) => compareHlc(hlc, known?.[field]) > 0);

function mergeSeen(known: Record<string, string> | undefined, incoming: Record<string, string>): Record<string, string> {
  const out = { ...known };
  for (const [field, hlc] of Object.entries(incoming)) if (compareHlc(hlc, out[field]) > 0) out[field] = hlc;
  return out;
}

function EditorInner({ pageId, rows, readOnly }: { pageId: string; rows: Stored<Block>[]; readOnly: boolean }) {
  const store = useStore();
  const first = useRef(rows);
  const initial = useMemo(() => buildDocument(liveBlocks(first.current)), []);
  const snapshot = useRef<Snapshot>(toSnapshot(liveBlocks(first.current)));
  /** Field timestamps this editor has seen per block: loaded, accepted from remote, or written itself. */
  const seen = useRef<SeenHlc>(new Map(first.current.map((r) => [r.id, { ...r._hlc }])));
  /** Blocks with a local write still in flight. A remote value for them loses to it anyway. */
  const writing = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const applyingRemote = useRef(false);
  /** Bumped when a local write finishes, so remote changes skipped during it are checked again. */
  const [writesDone, setWritesDone] = useState(0);
  /** Checklist item being turned into a ticket (F-41). */
  const [ticketFor, setTicketFor] = useState<string | null>(null);

  const editor = useCreateBlockNote({ schema, dictionary, initialContent: initial.length ? (initial as never) : undefined }, []);

  const save = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const before = snapshot.current;
    const { writes, next } = diffDocument(pageId, before, editor.document as unknown as DocBlock[]);
    snapshot.current = next;
    if (!writes.length) return;
    void syncInlineDatabases(store, pageId, databaseIds(before), databaseIds(next));
    const ids = writes.map((w) => w.id);
    ids.forEach((id) => writing.current.add(id));
    void store
      .writeMany(
        writes.map((w) => ({
          entity: 'block',
          id: w.id,
          fields: w.fields,
          // The version the user saw, so an edit over an unseen remote change is kept as a conflict.
          prevHlc: Object.fromEntries(Object.keys(w.fields).map((f) => [f, seen.current.get(w.id)?.[f] ?? null])),
        })),
      )
      .then((hlcs) => {
        hlcs.forEach((h, i) => seen.current.set(ids[i]!, mergeSeen(seen.current.get(ids[i]!), h)));
      })
      .finally(() => {
        ids.forEach((id) => writing.current.delete(id));
        setWritesDone((n) => n + 1);
      });
  };

  // Save what is still waiting when the page closes.
  useEffect(
    () => () => {
      if (timer.current) save();
    },
    // Unmount only: save reads refs, so it needs no dependencies.
    [],
  );

  // Remote changes: rows carrying a timestamp this editor has not seen.
  useEffect(() => {
    // Per field: a remote edit of one field can be older than another field this editor wrote.
    const changed = rows.filter((r) => !writing.current.has(r.id) && hasUnseen(r, seen.current.get(r.id)));
    if (!changed.length) return;
    if (timer.current) save(); // local edits first, so they are not lost when the document is rebuilt

    const merged = new Map(snapshot.current);
    for (const r of changed) {
      seen.current.set(r.id, mergeSeen(seen.current.get(r.id), r._hlc));
      const [live] = liveBlocks([r]);
      if (live) merged.set(r.id, live);
      else merged.delete(r.id);
    }
    const before = snapshot.current;
    snapshot.current = merged;
    applyRemote(editor, before, merged);
    // save and applyRemote read refs only. writesDone re-checks rows skipped while a write was in flight.
  }, [rows, editor, writesDone]);

  /**
   * Shows remote changes in the editor. Removals, inserts and edits are applied block by block, so
   * the caret and undo history stay intact. Only moves of existing blocks rebuild the document.
   */
  function applyRemote(ed: typeof editor, before: Snapshot, after: Snapshot) {
    applyingRemote.current = true;
    try {
      const moved = [...after.values()].some((b) => {
        const old = before.get(b.id);
        return old && (old.parentId !== b.parentId || old.sortKey !== b.sortKey);
      });
      if (moved) return rebuild(ed, after);

      // One transaction for all edits. Its mapping carries the user's selection over the inserted and
      // removed blocks; BlockNote's insert would otherwise move the caret.
      const selection = ed.prosemirrorState.selection;
      ed.transact((tr) => {
        const removed = [...before.keys()].filter((id) => !after.has(id) && ed.getBlock(id));
        if (removed.length) ed.removeBlocks(removed);

        const tree = buildDocument([...after.values()]);
        const walk = (siblings: DocBlock[], parent: DocBlock | null) => {
          siblings.forEach((block, i) => {
            if (!before.has(block.id) && !ed.getBlock(block.id)) {
              const single = { ...block, children: [] } as never;
              const prev = siblings.slice(0, i).reverse().find((s) => ed.getBlock(s.id));
              const next = siblings.slice(i + 1).find((s) => ed.getBlock(s.id));
              if (prev) ed.insertBlocks([single], prev.id, 'after');
              else if (next) ed.insertBlocks([single], next.id, 'before');
              else if (parent) ed.updateBlock(parent.id, { children: [single] } as never);
              else if (ed.document[0]) ed.insertBlocks([single], ed.document[0].id, 'before');
            } else if (before.has(block.id)) {
              updateIfChanged(ed, before.get(block.id), after.get(block.id)!);
            }
            walk(block.children, block);
          });
        };
        walk(tree, null);
        tr.setSelection(selection.map(tr.doc, tr.mapping));
      });
    } finally {
      applyingRemote.current = false;
    }
  }

  /** Replaces the whole document, keeping the caret at the same position in the text. */
  function rebuild(ed: typeof editor, after: Snapshot) {
    const pos = ed.prosemirrorState.selection.from;
    const doc = buildDocument([...after.values()]);
    ed.replaceBlocks(ed.document, (doc.length ? doc : [{ type: 'paragraph' }]) as never);
    const max = ed.prosemirrorState.doc.content.size - 1;
    try {
      ed._tiptapEditor.commands.setTextSelection(Math.max(1, Math.min(pos, max)));
    } catch {
      // the old position no longer exists; leave the caret where the editor put it
    }
  }

  const createDatabase = () => {
    const id = newId();
    void createInlineDatabase(store, id, pageId);
    return id;
  };

  const startTicket = (blockId: string) => {
    if (timer.current) save(); // the item's latest text goes into the ticket title
    setTicketFor(blockId);
  };

  return (
    // Links to pages of this workspace open inside the app instead of reloading it.
    <div className="editor-host" onClickCapture={openInternalLink}>
      <BlockNoteView
        editor={editor}
        editable={!readOnly}
        theme={window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'}
        slashMenu={false}
        sideMenu={false}
        emojiPicker={false}
        onChange={() => {
          if (applyingRemote.current || readOnly) return;
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(save, SAVE_MS);
        }}
        onBlur={() => timer.current && save()}
      >
        <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems(slashMenuItems(editor, createDatabase, readOnly ? undefined : startTicket), query)} />
        <TicketContext.Provider value={readOnly ? null : startTicket}>
          <SideMenuController sideMenu={NonstopSideMenu} />
        </TicketContext.Provider>
      </BlockNoteView>
      {ticketFor && <TicketDialog source={{ pageId, blockId: ticketFor }} onClose={() => setTicketFor(null)} />}
    </div>
  );
}

/** Opens the ticket dialog for a block. null = read-only page. */
const TicketContext = createContext<((blockId: string) => void) | null>(null);

// Defined once at module level: a component created during render would remount on every editor
// update and close the menu right after it opens.
function NonstopDragMenu() {
  return (
    <DragHandleMenu>
      <RemoveBlockItem>Hapus</RemoveBlockItem>
      <BlockColorsItem>Warna</BlockColorsItem>
      <MoveItems />
      <TicketItem />
    </DragHandleMenu>
  );
}

function NonstopSideMenu(props: SideMenuProps) {
  return <SideMenu {...props} dragHandleMenu={NonstopDragMenu} />;
}

/**
 * Move and indent from the block menu. On touch screens a drag is unreliable, so these four items
 * are the way to reorder blocks there; on the laptop they sit next to drag and Tab.
 */
function MoveItems() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (!block || !editor.isEditable) return null;
  const atBlock = (fn: () => void) => () => {
    editor.setTextCursorPosition(block.id, 'end');
    fn();
  };
  const items: [string, () => void][] = [
    ['Naikkan', () => editor.moveBlocksUp(block.id)],
    ['Turunkan', () => editor.moveBlocksDown(block.id)],
    ['Masuk (indent)', atBlock(() => editor.canNestBlock() && editor.nestBlock())],
    ['Keluar (outdent)', atBlock(() => editor.canUnnestBlock() && editor.unnestBlock())],
  ];
  return (
    <>
      {items.map(([label, run]) => (
        <Components.Generic.Menu.Item key={label} className="bn-menu-item" onClick={run}>
          {label}
        </Components.Generic.Menu.Item>
      ))}
    </>
  );
}

/** "Jadikan ticket" in the block menu, for checklist items only (F-41). */
function TicketItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor();
  const onPick = useContext(TicketContext);
  const block = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  if (!onPick || !block || block.type !== 'checkListItem') return null;
  return (
    <Components.Generic.Menu.Item className="bn-menu-item" onClick={() => onPick(block.id)}>
      Jadikan ticket
    </Components.Generic.Menu.Item>
  );
}

/** Opens `/p/<id>` links with the app router. Other links keep their default behaviour. */
function openInternalLink(e: React.MouseEvent) {
  const a = (e.target as HTMLElement).closest('a');
  const href = a?.getAttribute('href');
  if (!href || !/^\/p\/[A-Za-z0-9_-]+$/.test(href) || e.ctrlKey || e.metaKey) return;
  e.preventDefault();
  e.stopPropagation();
  navigate(href);
}

/** Database ids referenced by the inline database blocks of a snapshot. */
function databaseIds(snapshot: Snapshot): Set<string> {
  const ids = new Set<string>();
  for (const b of snapshot.values()) if (b.type === 'database' && typeof b.props.databaseId === 'string' && b.props.databaseId) ids.add(b.props.databaseId);
  return ids;
}

function updateIfChanged(ed: { updateBlock: (id: string, b: never) => unknown }, old: FlatBlock | undefined, b: FlatBlock) {
  if (old && old.type === b.type && sameValue(old.props, b.props) && sameValue(old.content, b.content)) return;
  ed.updateBlock(b.id, { type: b.type, props: b.props, content: hasNoContent(b.type) ? undefined : b.content } as never);
}
