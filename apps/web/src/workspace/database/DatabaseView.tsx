// A database with its views (F-10, F-20, F-22): view tabs, then a table or a list of rows.
import { useRef, useState } from 'react';
import type { Property, View, ViewType } from '@nonstop/shared';
import { addRow, addView, deleteView, renameDatabase, renameView, setPropertyHidden } from '../../data/databases.ts';
import { renamePage, trashPage } from '../../data/pages.ts';
import { useData, useStore } from '../../data/workspace.tsx';
import { cellValue, isEmpty, UNTITLED_DATABASE, type Row } from '../../model/database.ts';
import { UNTITLED } from '../../model/pages.ts';
import { navigate, pagePath } from '../../router.ts';
import { Cell, CellDisplay, TextInput } from './Cell.tsx';
import { Popover } from './Popover.tsx';
import { AddPropertyMenu, PropertyMenu } from './PropertyMenu.tsx';

const VIEW_KEY = 'nonstop:view:';

export function DatabaseView({ databaseId, readOnly }: { databaseId: string; readOnly?: boolean }) {
  const store = useStore();
  const { databases } = useData();
  const db = databases.byId.get(databaseId);
  const views = databases.viewsOf(databaseId);
  const [chosen, setChosen] = useState(() => localStorage.getItem(VIEW_KEY + databaseId));
  if (!db) return <p className="muted db-missing">Database ini sudah dihapus atau belum tersinkron.</p>;

  const view = views.find((v) => v.id === chosen) ?? views[0];
  const choose = (id: string) => {
    setChosen(id);
    localStorage.setItem(VIEW_KEY + databaseId, id);
  };
  const properties = databases.propertiesOf(databaseId);
  const visible = properties.filter((p) => !p.hidden);
  // In the trash (read-only), still show the rows so the user can check them before restoring.
  const rows = databases.rowsOf(databaseId, readOnly);
  const newRow = async () => {
    const id = await addRow(store, databases, databaseId);
    // The full row page is where a new entry gets its content (F-14).
    navigate(pagePath(id));
  };

  return (
    <section className={db.inline ? 'database inline' : 'database'} aria-label={db.inline ? db.title || UNTITLED_DATABASE : 'Database'}>
      {db.inline && (
        <div className="db-title">
          <TextInput label="Judul database" value={db.title} placeholder={UNTITLED_DATABASE} readOnly={readOnly} onSave={(t) => void renameDatabase(store, db.id, t)} />
        </div>
      )}
      <ViewTabs databaseId={databaseId} views={views} current={view} onChoose={choose} readOnly={readOnly} />
      {!view || view.type === 'table' ? (
        <TableView databaseId={databaseId} properties={visible} rows={rows} readOnly={readOnly} />
      ) : (
        <ListView properties={visible} rows={rows} />
      )}
      <div className="row db-foot">
        {!readOnly && (
          <button type="button" className="ghost" onClick={() => void newRow()}>
            + Baris baru
          </button>
        )}
        <HiddenProperties properties={properties.filter((p) => p.hidden)} readOnly={readOnly} />
        <span className="muted db-count">{rows.length} baris</span>
      </div>
    </section>
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
          {v.type === 'table' ? '▦' : '☰'} {v.name || 'View'}
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
            <button type="button" className="ghost pop-item" onClick={() => void add('table')}>
              ▦ Tabel
            </button>
            <button type="button" className="ghost pop-item" onClick={() => void add('list')}>
              ☰ List
            </button>
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

function TableView({ databaseId, properties, rows, readOnly }: { databaseId: string; properties: Property[]; rows: Row[]; readOnly?: boolean }) {
  const store = useStore();
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
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="col-title">
                <span className="title-cell">
                  <TextInput label={`Judul baris ${row.title || UNTITLED}`} value={row.title} placeholder={UNTITLED} readOnly={readOnly} onSave={(t) => void renamePage(store, row.id, t)} />
                  <button type="button" className="icon open-row" aria-label={`Buka ${row.title || UNTITLED}`} onClick={() => navigate(pagePath(row.id))}>
                    ↗
                  </button>
                  {!readOnly && (
                    <button type="button" className="icon open-row" aria-label={`Hapus baris ${row.title || UNTITLED}`} onClick={() => void trashPage(store, row.id)}>
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
        </tbody>
      </table>
      {!rows.length && <p className="muted db-empty">Belum ada baris.</p>}
      {editing && menu && <PropertyMenu prop={editing} anchor={menu.anchor} onClose={() => setMenu(null)} />}
      {menu?.id === 'add' && <AddPropertyMenu databaseId={databaseId} anchor={menu.anchor} onClose={() => setMenu(null)} />}
    </div>
  );
}

function ListView({ properties, rows }: { properties: Property[]; rows: Row[] }) {
  const { databases } = useData();
  if (!rows.length) return <p className="muted db-empty">Belum ada baris.</p>;
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

function HiddenProperties({ properties, readOnly }: { properties: Property[]; readOnly?: boolean }) {
  const store = useStore();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  if (!properties.length) return null;
  return (
    <>
      <button ref={btn} type="button" className="ghost" onClick={() => setOpen(true)}>
        {properties.length} properti tersembunyi
      </button>
      {open && (
        <Popover anchor={btn.current} label="Properti tersembunyi" onClose={() => setOpen(false)}>
          <ul className="pop-list">
            {properties.map((p) => (
              <li key={p.id} className="row hidden-prop">
                <span>{p.name || 'Tanpa nama'}</span>
                <button type="button" className="ghost" disabled={readOnly} onClick={() => void setPropertyHidden(store, p.id, false)}>
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
