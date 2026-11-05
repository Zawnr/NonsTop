// A database with its views (F-10, F-20 to F-23): view tabs and settings, then a table, a list or a
// board of the rows that pass the view's filters, in its order and groups.
import { Fragment, useRef, useState } from 'react';
import type { Property, View, ViewType } from '@nonstop/shared';
import { addRowFrom, addRowTemplate, setDefaultTemplate } from '../../data/copy.ts';
import { addView, deleteView, renameDatabase, renameView, updateView, VIEW_NAMES } from '../../data/databases.ts';
import { renamePage, trashPage } from '../../data/pages.ts';
import { useData, useStore } from '../../data/workspace.tsx';
import { cellValue, isEmpty, UNTITLED_DATABASE, type Row } from '../../model/database.ts';
import { UNTITLED } from '../../model/pages.ts';
import { groupable, groupRows, groupValue, hiddenAfter, hiddenProperties, prefillValues, viewRows, visibleProperties, type RowGroup } from '../../model/views.ts';
import { navigate, pagePath } from '../../router.ts';
import { BoardView } from './BoardView.tsx';
import { Cell, CellDisplay, Chip, TextInput } from './Cell.tsx';
import { Popover } from './Popover.tsx';
import { AddPropertyMenu, PropertyMenu } from './PropertyMenu.tsx';
import { ViewToolbar } from './ViewSettings.tsx';

const VIEW_ICONS: Record<ViewType, string> = { table: '▦', list: '☰', board: '▥' };

const VIEW_KEY = 'nonstop:view:';

/** `onDuplicate`: an inline database offers "Duplikat" through its block (the editor inserts the copy). */
export function DatabaseView({ databaseId, readOnly, onDuplicate }: { databaseId: string; readOnly?: boolean; onDuplicate?: (withRows: boolean) => void }) {
  const store = useStore();
  const { pages, databases } = useData();
  const db = databases.byId.get(databaseId);
  const views = databases.viewsOf(databaseId);
  const [chosen, setChosen] = useState(() => localStorage.getItem(VIEW_KEY + databaseId));
  // The row just added from this view: its title opens for typing in place.
  const [newRowId, setNewRowId] = useState<string | null>(null);
  if (!db) return <p className="muted db-missing">Database ini sudah dihapus atau belum tersinkron.</p>;

  const view = views.find((v) => v.id === chosen) ?? views[0];
  const choose = (id: string) => {
    setChosen(id);
    localStorage.setItem(VIEW_KEY + databaseId, id);
  };
  const properties = databases.propertiesOf(databaseId);
  const visible = visibleProperties(view, properties);
  // In the trash (read-only), still show the rows so the user can check them before restoring.
  const all = databases.rowsOf(databaseId, readOnly);
  const rows = viewRows(databases, view, properties, all);
  const groupProp = view?.groupBy ? properties.find((p) => p.id === view.groupBy && groupable(p, view.type === 'board')) : undefined;
  const templates = databases.templatesOf(databaseId);
  const defaultTemplate = templates.find((t) => t.id === db.defaultTemplateId)?.id ?? null;

  /** Adds a row that fits the view (its filters, and the group it was added in). */
  const newRow = async (templateId: string | null = defaultTemplate, groupKey?: string | null) => {
    const values = prefillValues(view, properties);
    if (groupProp && groupKey !== undefined) values[groupProp.id] = groupValue(groupProp, groupKey);
    const id = await addRowFrom(store, pages, databases, databaseId, templateId, values);
    // A list has no editable cells, so a new entry gets its title on the row page (F-14).
    if (view?.type === 'list') navigate(pagePath(id));
    else setNewRowId(id);
  };

  return (
    <section className={db.inline ? 'database inline' : 'database'} aria-label={db.inline ? db.title || UNTITLED_DATABASE : 'Database'}>
      {db.inline && (
        <div className="db-title row">
          <TextInput label="Judul database" value={db.title} placeholder={UNTITLED_DATABASE} readOnly={readOnly} onSave={(t) => void renameDatabase(store, db.id, t)} />
          {!readOnly && onDuplicate && <DuplicateButton label={db.title || UNTITLED_DATABASE} onDuplicate={onDuplicate} />}
        </div>
      )}
      <ViewTabs databaseId={databaseId} views={views} current={view} onChoose={choose} readOnly={readOnly} />
      {view && !readOnly && <ViewToolbar view={view} properties={properties} />}
      {!view || view.type === 'table' ? (
        <TableView databaseId={databaseId} view={view} properties={visible} rows={rows} groupProp={groupProp} readOnly={readOnly} newRowId={newRowId} />
      ) : view.type === 'list' ? (
        <ListView properties={visible} rows={rows} groupProp={groupProp} />
      ) : (
        <BoardView view={view} properties={properties} visible={visible} rows={rows} readOnly={readOnly} newRowId={newRowId} onAdd={(key) => void newRow(defaultTemplate, key)} />
      )}
      <div className="row db-foot">
        {!readOnly && (
          <span className="split">
            <button type="button" className="ghost" onClick={() => void newRow()}>
              + Baris baru
            </button>
            <TemplateMenu databaseId={databaseId} templates={templates} defaultId={defaultTemplate} onUse={(id) => void newRow(id)} />
          </span>
        )}
        {view && <HiddenProperties view={view} properties={properties} readOnly={readOnly} />}
        <span className="muted db-count">
          {rows.length === all.length ? `${rows.length} baris` : `${rows.length} dari ${all.length} baris`}
        </span>
      </div>
    </section>
  );
}

function DuplicateButton({ label, onDuplicate }: { label: string; onDuplicate: (withRows: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className="icon" aria-label={`Menu database ${label}`} onClick={() => setOpen(true)}>
        ⋯
      </button>
      {open && (
        <Popover anchor={btn.current} label={`Menu database ${label}`} onClose={() => setOpen(false)}>
          <div className="pop-list">
            <button type="button" className="ghost pop-item" onClick={() => (onDuplicate(true), setOpen(false))}>
              Duplikat dengan isi
            </button>
            <button type="button" className="ghost pop-item" onClick={() => (onDuplicate(false), setOpen(false))}>
              Duplikat struktur saja
            </button>
          </div>
        </Popover>
      )}
    </>
  );
}

/** Row templates (F-31): add a row from one, edit them, choose the default, or make a new one. */
function TemplateMenu({ databaseId, templates, defaultId, onUse }: { databaseId: string; templates: Row[]; defaultId: string | null; onUse: (id: string | null) => void }) {
  const store = useStore();
  const { databases } = useData();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const use = (id: string | null) => (onUse(id), setOpen(false));
  return (
    <>
      <button ref={btn} type="button" className="ghost split-more" aria-label="Template baris" onClick={() => setOpen(true)}>
        ▾
      </button>
      {open && (
        <Popover anchor={btn.current} label="Template baris" onClose={() => setOpen(false)}>
          <div className="pop-list">
            <p className="muted pop-head">Baris baru dari</p>
            <button type="button" className="ghost pop-item" onClick={() => use(null)}>
              <span className="tick" aria-hidden="true">{defaultId === null ? '★' : ''}</span>Baris kosong
            </button>
            {templates.map((t) => (
              <div key={t.id} className="pop-rel">
                <button type="button" className="ghost pop-item" onClick={() => use(t.id)}>
                  <span className="tick" aria-hidden="true">{defaultId === t.id ? '★' : ''}</span>
                  {t.title || UNTITLED}
                </button>
                <button type="button" className="icon" aria-label={`Edit template ${t.title || UNTITLED}`} onClick={() => navigate(pagePath(t.id))}>
                  ✎
                </button>
              </div>
            ))}
            <div className="row menu-actions">
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  const id = await addRowTemplate(store, databases, databaseId);
                  navigate(pagePath(id));
                }}
              >
                + Template baru
              </button>
              {templates.length > 0 && (
                <label className="pop-default">
                  Default
                  <select aria-label="Template default" value={defaultId ?? ''} onChange={(e) => void setDefaultTemplate(store, databaseId, e.target.value || null)}>
                    <option value="">Baris kosong</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title || UNTITLED}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        </Popover>
      )}
    </>
  );
}

function ViewTabs({ databaseId, views, current, onChoose, readOnly }: { databaseId: string; views: View[]; current?: View; onChoose: (id: string) => void; readOnly?: boolean }) {
  const store = useStore();
  const { databases } = useData();
  const [menu, setMenu] = useState<'add' | 'edit' | null>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const editBtn = useRef<HTMLButtonElement>(null);
  const add = async (type: ViewType) => {
    onChoose(await addView(store, databases, databaseId, type));
    setMenu(null);
  };
  return (
    <div className="view-tabs" role="tablist" aria-label="View">
      {views.map((v) => (
        <button key={v.id} type="button" role="tab" aria-selected={v.id === current?.id} className="view-tab" onClick={() => onChoose(v.id)}>
          {VIEW_ICONS[v.type]} {v.name || 'View'}
        </button>
      ))}
      {!readOnly && current && (
        <button ref={editBtn} type="button" className="icon" aria-label={`Atur view ${current.name}`} onClick={() => setMenu('edit')}>
          ⋯
        </button>
      )}
      {!readOnly && (
        <button ref={addBtn} type="button" className="icon" aria-label="View baru" onClick={() => setMenu('add')}>
          +
        </button>
      )}
      {menu === 'add' && (
        <Popover anchor={addBtn.current} label="View baru" onClose={() => setMenu(null)}>
          <div className="pop-list">
            {(['table', 'board', 'list'] as const).map((t) => (
              <button key={t} type="button" className="ghost pop-item" onClick={() => void add(t)}>
                {VIEW_ICONS[t]} {VIEW_NAMES[t]}
              </button>
            ))}
          </div>
        </Popover>
      )}
      {menu === 'edit' && current && (
        <Popover anchor={editBtn.current} label={`Atur view ${current.name}`} onClose={() => setMenu(null)}>
          <div className="pop-form">
            <label>
              Nama view
              <input
                defaultValue={current.name}
                maxLength={100}
                autoFocus
                onBlur={(e) => e.target.value.trim() && e.target.value !== current.name && void renameView(store, current.id, e.target.value.trim())}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </label>
            <button
              type="button"
              className="ghost danger"
              disabled={views.length < 2}
              title={views.length < 2 ? 'Database butuh minimal satu view' : undefined}
              onClick={() => (void deleteView(store, current.id), setMenu(null))}
            >
              Hapus view
            </button>
          </div>
        </Popover>
      )}
    </div>
  );
}

function TableView({
  databaseId,
  view,
  properties,
  rows,
  groupProp,
  readOnly,
  newRowId,
}: {
  databaseId: string;
  view?: View;
  properties: Property[];
  rows: Row[];
  groupProp?: Property;
  readOnly?: boolean;
  newRowId?: string | null;
}) {
  const store = useStore();
  const { databases } = useData();
  const groups: RowGroup[] = groupProp ? groupRows(databases, groupProp, rows) : [{ key: null, label: '', rows }];
  const span = properties.length + 1 + (readOnly ? 0 : 1);
  const [menu, setMenu] = useState<{ id: string | 'add'; anchor: HTMLElement } | null>(null);
  const editing = menu && menu.id !== 'add' ? properties.find((p) => p.id === menu.id) : undefined;
  return (
    <div className="db-table-wrap">
      <table className="db-table">
        <thead>
          <tr>
            <th scope="col" className="col-title">
              Judul
            </th>
            {properties.map((p) => (
              <th key={p.id} scope="col">
                <button type="button" className="th-btn" disabled={readOnly} onClick={(e) => setMenu({ id: p.id, anchor: e.currentTarget })}>
                  {p.name || 'Tanpa nama'}
                </button>
              </th>
            ))}
            {!readOnly && (
              <th scope="col" className="col-add">
                <button type="button" className="icon" aria-label="Properti baru" onClick={(e) => setMenu({ id: 'add', anchor: e.currentTarget })}>
                  +
                </button>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g.key ?? ''}>
              {groupProp && (
                <tr className="group-row">
                  <th scope="rowgroup" colSpan={span}>
                    <GroupLabel group={g} />
                  </th>
                </tr>
              )}
              {g.rows.map((row) => (
                <tr key={row.id}>
                  <th scope="row" className="col-title">
                    <span className="title-cell">
                      <TextInput label={`Judul baris ${row.title || UNTITLED}`} value={row.title} placeholder={UNTITLED} readOnly={readOnly} autoEdit={row.id === newRowId} onSave={(t) => void renamePage(store, row.id, t)} />
                      <button type="button" className="icon open-row" aria-label={`Buka ${row.title || UNTITLED}`} onClick={() => navigate(pagePath(row.id))}>
                        ↗
                      </button>
                      {!readOnly && (
                        <button type="button" className="icon open-row del-row" aria-label={`Hapus baris ${row.title || UNTITLED}`} onClick={() => void trashPage(store, row.id)}>
                          🗑
                        </button>
                      )}
                    </span>
                  </th>
                  {properties.map((p) => (
                    <td key={p.id}>
                      <Cell prop={p} row={row} readOnly={readOnly} />
                    </td>
                  ))}
                  {!readOnly && <td />}
                </tr>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="muted db-empty">Belum ada baris.</p>}
      {editing && menu && <PropertyMenu prop={editing} view={view} anchor={menu.anchor} onClose={() => setMenu(null)} />}
      {menu?.id === 'add' && <AddPropertyMenu databaseId={databaseId} anchor={menu.anchor} onClose={() => setMenu(null)} />}
    </div>
  );
}

function GroupLabel({ group }: { group: RowGroup }) {
  return (
    <span className="group-label">
      {group.option ? <Chip option={group.option} /> : <span>{group.label}</span>}
      <span className="muted">{group.rows.length}</span>
    </span>
  );
}

function ListView({ properties, rows, groupProp }: { properties: Property[]; rows: Row[]; groupProp?: Property }) {
  const { databases } = useData();
  if (!rows.length) return <p className="muted db-empty">Belum ada baris.</p>;
  if (groupProp) {
    return (
      <div className="db-groups">
        {groupRows(databases, groupProp, rows).map((g) => (
          <section key={g.key ?? ''} aria-label={g.label}>
            <h3 className="group-head">
              <GroupLabel group={g} />
            </h3>
            {g.rows.length ? <ListRows properties={properties} rows={g.rows} /> : <p className="muted db-empty">Kosong.</p>}
          </section>
        ))}
      </div>
    );
  }
  return <ListRows properties={properties} rows={rows} />;
}

function ListRows({ properties, rows }: { properties: Property[]; rows: Row[] }) {
  const { databases } = useData();
  return (
    <ul className="db-list">
      {rows.map((row) => (
        <li key={row.id}>
          <a href={pagePath(row.id)} onClick={(e) => (e.preventDefault(), navigate(pagePath(row.id)))}>
            <span className="db-list-title">{row.title || UNTITLED}</span>
            <span className="db-list-props">
              {properties
                .filter((p) => !isEmpty(cellValue(databases, p, row)))
                .map((p) => (
                  <span key={p.id} className="db-list-prop" title={p.name}>
                    <CellDisplay prop={p} row={row} />
                  </span>
                ))}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

function HiddenProperties({ view, properties, readOnly }: { view: View; properties: Property[]; readOnly?: boolean }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const hidden = hiddenProperties(view, properties);
  if (!hidden.length) return null;
  return (
    <>
      <button ref={btn} type="button" className="ghost" onClick={() => setOpen(true)}>
        {hidden.length} properti tersembunyi
      </button>
      {open && (
        <Popover anchor={btn.current} label="Properti tersembunyi" onClose={() => setOpen(false)}>
          <ul className="pop-list">
            {hidden.map((p) => (
              <li key={p.id} className="row hidden-prop">
                <span>{p.name || 'Tanpa nama'}</span>
                <button
                  type="button"
                  className="ghost"
                  disabled={readOnly}
                  onClick={() => void updateView(store, view.id, { hiddenProps: hiddenAfter(view, properties, p.id, false) })}
                >
                  Tampilkan
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      )}
    </>
  );
}
