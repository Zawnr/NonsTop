// Per-view settings (F-23): filters, sorts, grouping and which properties show. Every change is
// saved on the view, so each view keeps its own setup on every device.
import { useRef, useState } from 'react';
import { TITLE_PROPERTY, type FilterOp, type Property, type View, type ViewFilter, type ViewSort } from '@nonstop/shared';
import { updateView } from '../../data/databases.ts';
import { useData, useStore } from '../../data/workspace.tsx';
import { UNTITLED } from '../../model/pages.ts';
import { fieldOf, groupable, hiddenAfter, needsValue, OP_LABELS, opsFor, visibleProperties, type FieldKind } from '../../model/views.ts';
import { Popover } from './Popover.tsx';

type Menu = 'filter' | 'sort' | 'group' | 'props' | null;

export function ViewToolbar({ view, properties }: { view: View; properties: Property[] }) {
  const [menu, setMenu] = useState<Menu>(null);
  const refs = { filter: useRef<HTMLButtonElement>(null), sort: useRef<HTMLButtonElement>(null), group: useRef<HTMLButtonElement>(null), props: useRef<HTMLButtonElement>(null) };
  const board = view.type === 'board';
  const groupProp = view.groupBy ? properties.find((p) => p.id === view.groupBy) : undefined;
  const hiddenCount = properties.length - visibleProperties(view, properties).length;
  const count = (n: number) => (n ? ` (${n})` : '');
  return (
    <div className="view-toolbar row" role="toolbar" aria-label={`Pengaturan view ${view.name}`}>
      <button ref={refs.filter} type="button" className={view.filters.length ? 'chip-btn on' : 'chip-btn'} onClick={() => setMenu('filter')}>
        Filter{count(view.filters.length)}
      </button>
      <button ref={refs.sort} type="button" className={view.sorts.length ? 'chip-btn on' : 'chip-btn'} onClick={() => setMenu('sort')}>
        Urutkan{count(view.sorts.length)}
      </button>
      <button ref={refs.group} type="button" className={groupProp ? 'chip-btn on' : 'chip-btn'} onClick={() => setMenu('group')}>
        {board ? 'Kolom' : 'Grup'}
        {groupProp ? `: ${groupProp.name || 'Tanpa nama'}` : ''}
      </button>
      <button ref={refs.props} type="button" className={hiddenCount ? 'chip-btn on' : 'chip-btn'} onClick={() => setMenu('props')}>
        Properti{hiddenCount ? ` (${hiddenCount} disembunyikan)` : ''}
      </button>
      {menu === 'filter' && <FilterMenu view={view} properties={properties} anchor={refs.filter.current} onClose={() => setMenu(null)} />}
      {menu === 'sort' && <SortMenu view={view} properties={properties} anchor={refs.sort.current} onClose={() => setMenu(null)} />}
      {menu === 'group' && <GroupMenu view={view} properties={properties} anchor={refs.group.current} onClose={() => setMenu(null)} />}
      {menu === 'props' && <PropertiesMenu view={view} properties={properties} anchor={refs.props.current} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** Title first, then the properties: the fields a filter or sort can use. */
function FieldSelect({ value, properties, label, onChange }: { value: string; properties: Property[]; label: string; onChange: (id: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value={TITLE_PROPERTY}>Judul</option>
      {properties.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name || 'Tanpa nama'}
        </option>
      ))}
      {fieldOf(value, properties) === undefined && <option value={value}>(properti terhapus)</option>}
    </select>
  );
}

const kindOf = (id: string, properties: Property[]): FieldKind => {
  const f = fieldOf(id, properties);
  return f === 'title' || f === undefined ? 'title' : f.type;
};

function FilterMenu({ view, properties, anchor, onClose }: { view: View; properties: Property[]; anchor: HTMLElement | null; onClose: () => void }) {
  const store = useStore();
  const save = (filters: ViewFilter[]) => void updateView(store, view.id, { filters });
  const change = (i: number, patch: Partial<ViewFilter>) => save(view.filters.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  const setField = (i: number, propertyId: string) => change(i, { propertyId, op: opsFor(kindOf(propertyId, properties))[0]!, value: null });
  return (
    <Popover anchor={anchor} label="Filter" onClose={onClose} wide>
      <div className="pop-form">
        <p className="muted pop-head">Baris tampil kalau semua filter cocok.</p>
        {view.filters.length === 0 && <p className="muted">Belum ada filter.</p>}
        <ul className="settings-list">
          {view.filters.map((f, i) => {
            const kind = kindOf(f.propertyId, properties);
            return (
              <li key={i} className="settings-item">
                <FieldSelect label={`Properti filter ${i + 1}`} value={f.propertyId} properties={properties} onChange={(id) => setField(i, id)} />
                <select aria-label={`Operator filter ${i + 1}`} value={f.op} onChange={(e) => change(i, { op: e.target.value as FilterOp, value: needsValue(e.target.value as FilterOp) ? f.value : null })}>
                  {opsFor(kind).map((op) => (
                    <option key={op} value={op}>
                      {OP_LABELS[op]}
                    </option>
                  ))}
                </select>
                {needsValue(f.op) && <FilterValue index={i} filter={f} properties={properties} onChange={(value) => change(i, { value })} />}
                <button type="button" className="icon" aria-label={`Hapus filter ${i + 1}`} onClick={() => save(view.filters.filter((_, j) => j !== i))}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="ghost" onClick={() => save([...view.filters, { propertyId: TITLE_PROPERTY, op: 'contains', value: null }])}>
          + Tambah filter
        </button>
      </div>
    </Popover>
  );
}

function FilterValue({ index, filter, properties, onChange }: { index: number; filter: ViewFilter; properties: Property[]; onChange: (v: string | number | null) => void }) {
  const { databases } = useData();
  const field = fieldOf(filter.propertyId, properties);
  const label = `Nilai filter ${index + 1}`;
  if (field && field !== 'title') {
    if (field.type === 'select' || field.type === 'status' || field.type === 'multiSelect') {
      return (
        <select aria-label={label} value={String(filter.value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Pilih…</option>
          {(field.config.options ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              {o.name || 'Tanpa nama'}
            </option>
          ))}
        </select>
      );
    }
    if (field.type === 'relation') {
      const rows = field.config.databaseId ? databases.rowsOf(field.config.databaseId) : [];
      return (
        <select aria-label={label} value={String(filter.value ?? '')} onChange={(e) => onChange(e.target.value || null)}>
          <option value="">Pilih…</option>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title || UNTITLED}
            </option>
          ))}
        </select>
      );
    }
    if (field.type === 'date') {
      return <input type="date" aria-label={label} value={String(filter.value ?? '')} onChange={(e) => onChange(e.target.value || null)} />;
    }
  }
  const number = field !== undefined && field !== 'title' && field.type === 'number';
  return <DraftInput key={filter.propertyId} label={label} value={filter.value === null ? '' : String(filter.value)} inputMode={number ? 'decimal' : undefined} onCommit={(t) => onChange(t === '' ? null : number ? Number(t.replace(',', '.')) : t)} />;
}

/** A text field that saves on Enter or when it loses focus, not on every key. */
function DraftInput({ label, value, inputMode, onCommit }: { label: string; value: string; inputMode?: 'decimal'; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  const commit = () => draft.trim() !== value && onCommit(draft.trim());
  return (
    <input
      aria-label={label}
      value={draft}
      inputMode={inputMode}
      enterKeyHint="done"
      maxLength={500}
      placeholder="Nilai"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
    />
  );
}

function SortMenu({ view, properties, anchor, onClose }: { view: View; properties: Property[]; anchor: HTMLElement | null; onClose: () => void }) {
  const store = useStore();
  const save = (sorts: ViewSort[]) => void updateView(store, view.id, { sorts });
  const change = (i: number, patch: Partial<ViewSort>) => save(view.sorts.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <Popover anchor={anchor} label="Urutkan" onClose={onClose} wide>
      <div className="pop-form">
        {view.sorts.length === 0 && <p className="muted">Urutan manual. Tambah urutan untuk mengurutkan menurut properti.</p>}
        <ul className="settings-list">
          {view.sorts.map((s, i) => (
            <li key={i} className="settings-item">
              <FieldSelect label={`Properti urutan ${i + 1}`} value={s.propertyId} properties={properties} onChange={(propertyId) => change(i, { propertyId })} />
              <select aria-label={`Arah urutan ${i + 1}`} value={s.dir} onChange={(e) => change(i, { dir: e.target.value as ViewSort['dir'] })}>
                <option value="asc">Naik (A→Z, 1→9)</option>
                <option value="desc">Turun (Z→A, 9→1)</option>
              </select>
              <button type="button" className="icon" aria-label={`Hapus urutan ${i + 1}`} onClick={() => save(view.sorts.filter((_, j) => j !== i))}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        <button type="button" className="ghost" onClick={() => save([...view.sorts, { propertyId: TITLE_PROPERTY, dir: 'asc' }])}>
          + Tambah urutan
        </button>
      </div>
    </Popover>
  );
}

function GroupMenu({ view, properties, anchor, onClose }: { view: View; properties: Property[]; anchor: HTMLElement | null; onClose: () => void }) {
  const store = useStore();
  const board = view.type === 'board';
  const options = properties.filter((p) => groupable(p, board));
  return (
    <Popover anchor={anchor} label={board ? 'Kolom board' : 'Grup'} onClose={onClose}>
      <div className="pop-form">
        <label>
          {board ? 'Kolom menurut' : 'Kelompokkan menurut'}
          <select value={view.groupBy ?? ''} onChange={(e) => void updateView(store, view.id, { groupBy: e.target.value || null })}>
            <option value="">{board ? 'Pilih properti…' : 'Tanpa grup'}</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name || 'Tanpa nama'}
              </option>
            ))}
          </select>
        </label>
        {!options.length && <p className="muted">{board ? 'Tambah properti Status atau Select dulu.' : 'Tambah properti Status, Select, atau Checkbox dulu.'}</p>}
      </div>
    </Popover>
  );
}

function PropertiesMenu({ view, properties, anchor, onClose }: { view: View; properties: Property[]; anchor: HTMLElement | null; onClose: () => void }) {
  const store = useStore();
  const shown = new Set(visibleProperties(view, properties).map((p) => p.id));
  return (
    <Popover anchor={anchor} label="Properti tampil" onClose={onClose}>
      <div className="pop-list">
        <p className="muted pop-head">Tampil di view ini</p>
        {properties.map((p) => (
          <label key={p.id} className="check-row">
            <input
              type="checkbox"
              checked={shown.has(p.id)}
              onChange={(e) => void updateView(store, view.id, { hiddenProps: hiddenAfter(view, properties, p.id, !e.target.checked) })}
            />
            {p.name || 'Tanpa nama'}
          </label>
        ))}
      </div>
    </Popover>
  );
}
