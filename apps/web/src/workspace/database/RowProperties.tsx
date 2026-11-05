// Property panel at the top of a row page (F-14): every property of the row, editable in place.
import { useState } from 'react';
import type { Page } from '@nonstop/shared';
import { useData } from '../../data/workspace.tsx';
import { databaseTitle } from '../../model/database.ts';
import { navigate, pagePath } from '../../router.ts';
import { Cell } from './Cell.tsx';

export function RowProperties({ page, readOnly }: { page: Page; readOnly: boolean }) {
  const { pages, databases } = useData();
  const [showHidden, setShowHidden] = useState(false);
  const db = page.databaseId ? databases.byId.get(page.databaseId) : undefined;
  // Trashed rows are not in the index, but the page still opens from the trash.
  const row = databases.row(page.id) ?? (db ? { ...page, values: {} } : undefined);
  if (!db || !row) return null;
  const all = databases.propertiesOf(db.id);
  const hidden = all.filter((p) => p.hidden);
  const shown = showHidden ? all : all.filter((p) => !p.hidden);
  const owner = db.pageId;

  return (
    <section className="row-props" aria-label="Properti">
      <p className="muted row-db">
        Baris di{' '}
        <a href={pagePath(owner)} onClick={(e) => (e.preventDefault(), navigate(pagePath(owner)))}>
          {databaseTitle(db, pages)}
        </a>
      </p>
      <dl>
        {shown.map((p) => (
          <div key={p.id} className="row-prop">
            <dt>{p.name || 'Tanpa nama'}</dt>
            <dd>
              <Cell prop={p} row={row} readOnly={readOnly} placeholder={readOnly ? undefined : 'Kosong'} />
            </dd>
          </div>
        ))}
      </dl>
      {hidden.length > 0 && (
        <button type="button" className="ghost small" onClick={() => setShowHidden(!showHidden)}>
          {showHidden ? 'Sembunyikan properti tersembunyi' : `${hidden.length} properti tersembunyi`}
        </button>
      )}
    </section>
  );
}
