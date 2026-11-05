// An inline database inside the block editor (F-10). Rendered by the editor's `database` block.
import { useData } from '../../data/workspace.tsx';
import { DatabaseView } from './DatabaseView.tsx';

export function InlineDatabase({ databaseId, readOnly }: { databaseId: string; readOnly: boolean }) {
  const { databases } = useData();
  if (!databaseId) return null;
  // The block can arrive from another device before its database record does.
  if (!databases.byId.has(databaseId)) return <p className="muted db-missing">Memuat database…</p>;
  return <DatabaseView databaseId={databaseId} readOnly={readOnly} />;
}
