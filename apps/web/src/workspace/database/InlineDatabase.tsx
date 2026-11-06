// An inline database inside the block editor (F-10). Rendered by the editor's `database` block.
import { duplicateInlineDatabase } from '../../data/copy.ts';
import { useData, useStore } from '../../data/workspace.tsx';
import { DatabaseView } from './DatabaseView.tsx';

/** `insertAfter` adds a database block for a copy right below this one (F-32). */
export function InlineDatabase({ databaseId, readOnly, insertAfter }: { databaseId: string; readOnly: boolean; insertAfter?: (databaseId: string) => void }) {
  const store = useStore();
  const { pages, databases } = useData();
  if (!databaseId) return null;
  // The block can arrive from another device before its database record does.
  if (!databases.byId.has(databaseId)) return <p className="muted db-missing">Memuat database…</p>;
  const duplicate = insertAfter
    ? async (withRows: boolean) => insertAfter(await duplicateInlineDatabase(store, pages, databases, databaseId, withRows))
    : undefined;
  return <DatabaseView databaseId={databaseId} readOnly={readOnly} onDuplicate={duplicate ? (w) => void duplicate(w) : undefined} />;
}
