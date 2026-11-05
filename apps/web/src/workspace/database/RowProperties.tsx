// Property panel at the top of a row page (F-14): every property of the row, editable in place.
// Hiding a property belongs to each view (F-23), so the row page always shows all of them.
import type { Page } from '@nonstop/shared';
import { useData } from '../../data/workspace.tsx';
import { databaseTitle } from '../../model/database.ts';
import { navigate, pagePath } from '../../router.ts';
import { Cell } from './Cell.tsx';

export function RowProperties({ page, readOnly }: { page: Page; readOnly: boolean }) {
  const { pages, databases } = useData();
  const db = page.databaseId ? databases.byId.get(page.databaseId) : undefined;
  const row = databases.row(page.id);
  if (!db || !row) return null;
  const all = databases.propertiesOf(db.id);
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
        {all.map((p) => (
          <div key={p.id} className="row-prop">
            <dt>{p.name || 'Tanpa nama'}</dt>
            <dd>
              <Cell prop={p} row={row} readOnly={readOnly} placeholder={readOnly ? undefined : 'Kosong'} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
