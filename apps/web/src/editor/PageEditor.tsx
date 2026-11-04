// Block editor of a page (F-03, F-04), connected to the synced block rows.
//
// The editor owns what the user sees. A snapshot holds the last state written to or accepted from
// the store, so local edits are found by diffing the editor against it, and remote changes by
// finding rows with a timestamp this editor has not seen yet.
import { useEffect, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { filterSuggestionItems } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import { SuggestionMenuController, useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/ariakit';
import '@blocknote/ariakit/style.css';
import { compareHlc, type Block } from '@nonstop/shared';
import type { Stored } from '../data/db.ts';
import { useStore } from '../data/workspace.tsx';
import { buildDocument, diffDocument, liveBlocks, toSnapshot, type DocBlock, type FlatBlock, type Snapshot } from '../model/blocks.ts';
import { schema } from './schema.tsx';
import { slashMenuItems } from './slash-menu.tsx';

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

const newest = (hlc: Record<string, string>) => Object.values(hlc).reduce<string | null>((m, h) => (compareHlc(h, m) > 0 ? h : m), null);

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

  const editor = useCreateBlockNote({ schema, dictionary, initialContent: initial.length ? (initial as never) : undefined }, []);

  const save = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const { writes, next } = diffDocument(pageId, snapshot.current, editor.document as unknown as DocBlock[]);
    snapshot.current = next;
    if (!writes.length) return;
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
        hlcs.forEach((h, i) => seen.current.set(ids[i]!, { ...seen.current.get(ids[i]!), ...h }));
      })
      .finally(() => ids.forEach((id) => writing.current.delete(id)));
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
    const changed = rows.filter((r) => {
      if (writing.current.has(r.id)) return false;
      const known = seen.current.get(r.id);
      return !known || compareHlc(newest(r._hlc), newest(known)) > 0;
    });
    if (!changed.length) return;
    if (timer.current) save(); // local edits first, so they are not lost when the document is rebuilt

    const merged = new Map(snapshot.current);
    for (const r of changed) {
      seen.current.set(r.id, { ...r._hlc });
      const [live] = liveBlocks([r]);
      if (live) merged.set(r.id, live);
      else merged.delete(r.id);
    }
    const before = snapshot.current;
    snapshot.current = merged;
    applyRemote(editor, before, merged);
    // save and applyRemote read refs only, so rows and editor are the real dependencies.
  }, [rows, editor]);

  function applyRemote(ed: typeof editor, before: Snapshot, after: Snapshot) {
    applyingRemote.current = true;
    try {
      const structural =
        before.size !== after.size ||
        [...after.values()].some((b) => {
          const old = before.get(b.id);
          return !old || old.parentId !== b.parentId || old.sortKey !== b.sortKey;
        });
      if (!structural) {
        for (const b of after.values()) updateIfChanged(ed, before.get(b.id), b);
        return;
      }
      const cursor = safeCursorBlock(ed);
      const doc = buildDocument([...after.values()]);
      ed.replaceBlocks(ed.document, (doc.length ? doc : [{ type: 'paragraph' }]) as never);
      if (cursor && after.has(cursor)) ed.setTextCursorPosition(cursor, 'end');
    } finally {
      applyingRemote.current = false;
    }
  }

  return (
    <BlockNoteView
      editor={editor}
      editable={!readOnly}
      theme={window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'}
      slashMenu={false}
      emojiPicker={false}
      onChange={() => {
        if (applyingRemote.current || readOnly) return;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(save, SAVE_MS);
      }}
      onBlur={() => timer.current && save()}
    >
      <SuggestionMenuController triggerCharacter="/" getItems={async (query) => filterSuggestionItems(slashMenuItems(editor), query)} />
    </BlockNoteView>
  );
}

function updateIfChanged(ed: { updateBlock: (id: string, b: never) => unknown }, old: FlatBlock | undefined, b: FlatBlock) {
  if (old && old.type === b.type && JSON.stringify(old.props) === JSON.stringify(b.props) && JSON.stringify(old.content) === JSON.stringify(b.content)) return;
  ed.updateBlock(b.id, { type: b.type, props: b.props, content: b.type === 'divider' ? undefined : b.content } as never);
}

function safeCursorBlock(ed: { getTextCursorPosition: () => { block: { id: string } } }): string | null {
  try {
    return ed.getTextCursorPosition().block.id;
  } catch {
    return null;
  }
}
