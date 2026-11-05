// Property management (F-13): add, rename, reorder, hide, delete, and edit options with colors.
import { useState } from 'react';
import { optionColors, propertyTypes, statusGroups, type Property, type PropertyType, type SelectOption, type StatusGroup } from '@nonstop/shared';
import { addProperty, deleteProperty, movePropertyTo, newId, renameProperty, setOptions, setPropertyHidden } from '../../data/databases.ts';
import { useData, useStore } from '../../data/workspace.tsx';
import { COLOR_LABELS, databaseTitle, moveKey, TYPE_LABELS } from '../../model/database.ts';
import { Popover } from './Popover.tsx';

const GROUP_LABELS: Record<StatusGroup, string> = { todo: 'Belum', doing: 'Berjalan', done: 'Selesai' };

export function PropertyMenu({ prop, anchor, onClose }: { prop: Property; anchor: HTMLElement | null; onClose: () => void }) {
  const store = useStore();
  const { pages, databases } = useData();
  const [name, setName] = useState(prop.name);
  // Steps count only the columns the user sees, so a hidden column in between never eats a click.
  const list = databases.propertiesOf(prop.databaseId).filter((p) => p.hidden === prop.hidden);
  const left = moveKey(list, prop.id, -1);
  const right = moveKey(list, prop.id, 1);
  const target = prop.config.databaseId ? databases.byId.get(prop.config.databaseId) : undefined;

  const rename = () => {
    const next = name.trim();
    if (next && next !== prop.name) void renameProperty(store, prop.id, next);
  };
  const remove = async () => {
    const pair = prop.type === 'relation' ? ' Properti pasangannya di database tujuan ikut terhapus.' : '';
    if (!window.confirm(`Hapus properti "${prop.name}"?${pair}`)) return;
    await deleteProperty(store, prop);
    onClose();
  };

  return (
    <Popover anchor={anchor} label={`Properti ${prop.name}`} onClose={() => (rename(), onClose())} wide={prop.type === 'select' || prop.type === 'multiSelect' || prop.type === 'status'}>
      <div className="pop-form">
        <label>
          Nama properti
          <input
            value={name}
            maxLength={100}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onBlur={rename}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), rename())}
          />
        </label>
        <p className="muted">
          Tipe: {TYPE_LABELS[prop.type]}
          {prop.type === 'relation' && target && ` ke ${databaseTitle(target, pages)}`}
          {prop.type === 'relation' && prop.config.reverse && ' (sisi balik)'}
        </p>
        {(prop.type === 'select' || prop.type === 'multiSelect' || prop.type === 'status') && <OptionsEditor prop={prop} />}
        <div className="row menu-actions">
          <button type="button" className="ghost" disabled={!left} onClick={() => left && void movePropertyTo(store, prop.id, left)}>
            ← Geser kiri
          </button>
          <button type="button" className="ghost" disabled={!right} onClick={() => right && void movePropertyTo(store, prop.id, right)}>
            Geser kanan →
          </button>
          <button type="button" className="ghost" onClick={() => (void setPropertyHidden(store, prop.id, !prop.hidden), onClose())}>
            {prop.hidden ? 'Tampilkan' : 'Sembunyikan'}
          </button>
          <button type="button" className="ghost danger" onClick={() => void remove()}>
            Hapus properti
          </button>
        </div>
      </div>
    </Popover>
  );
}

function OptionsEditor({ prop }: { prop: Property }) {
  const store = useStore();
  const options = prop.config.options ?? [];
  const save = (next: SelectOption[]) => void setOptions(store, prop, next);
  const update = (id: string, patch: Partial<SelectOption>) => save(options.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const add = () =>
    save([
      ...options,
      { id: newId(), name: `Opsi ${options.length + 1}`, color: optionColors[options.length % optionColors.length]!, ...(prop.type === 'status' ? { group: 'todo' as const } : {}) },
    ]);

  return (
    <fieldset className="options">
      <legend>Opsi</legend>
      <ul>
        {options.map((o) => (
          <li key={o.id}>
            <OptionName option={o} onSave={(name) => update(o.id, { name })} />
            <select aria-label={`Warna ${o.name}`} value={o.color} onChange={(e) => update(o.id, { color: e.target.value as SelectOption['color'] })} className={`c-${o.color}`}>
              {optionColors.map((c) => (
                <option key={c} value={c}>
                  {COLOR_LABELS[c]}
                </option>
              ))}
            </select>
            {prop.type === 'status' && (
              <select aria-label={`Grup ${o.name}`} value={o.group ?? 'todo'} onChange={(e) => update(o.id, { group: e.target.value as StatusGroup })}>
                {statusGroups.map((g) => (
                  <option key={g} value={g}>
                    {GROUP_LABELS[g]}
                  </option>
                ))}
              </select>
            )}
            <button type="button" className="icon" aria-label={`Hapus opsi ${o.name}`} onClick={() => save(options.filter((x) => x.id !== o.id))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="ghost" onClick={add}>
        + Opsi
      </button>
    </fieldset>
  );
}

function OptionName({ option, onSave }: { option: SelectOption; onSave: (name: string) => void }) {
  const [value, setValue] = useState(option.name);
  const commit = () => value.trim() && value !== option.name && onSave(value.trim());
  return (
    <input
      aria-label={`Nama opsi ${option.name}`}
      value={value}
      maxLength={100}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), commit())}
    />
  );
}

/** Adds a property: pick a type, a name, and for relations the target database. */
export function AddPropertyMenu({ databaseId, anchor, onClose }: { databaseId: string; anchor: HTMLElement | null; onClose: () => void }) {
  const store = useStore();
  const { pages, databases } = useData();
  const [type, setType] = useState<PropertyType | null>(null);
  const [name, setName] = useState('');
  const [targetId, setTargetId] = useState(databaseId);
  const self = databases.byId.get(databaseId);
  const targets = [...databases.byId.values()].sort((a, b) => databaseTitle(a, pages).localeCompare(databaseTitle(b, pages), 'id'));

  const submit = async () => {
    if (!type) return;
    const finalName = name.trim() || TYPE_LABELS[type];
    const target = type === 'relation' ? { databaseId: targetId, reverseName: self ? databaseTitle(self, pages) : 'Relation' } : undefined;
    await addProperty(store, databases, databaseId, type, finalName, target);
    onClose();
  };

  return (
    <Popover anchor={anchor} label="Properti baru" onClose={onClose}>
      {!type ? (
        <div className="pop-list">
          <p className="muted pop-head">Tipe properti</p>
          <ul>
            {propertyTypes.map((t) => (
              <li key={t}>
                <button type="button" className="ghost pop-item" onClick={() => setType(t)}>
                  {TYPE_LABELS[t]}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <form className="pop-form" onSubmit={(e) => (e.preventDefault(), void submit())}>
          <label>
            Nama properti ({TYPE_LABELS[type]})
            <input value={name} placeholder={TYPE_LABELS[type]} maxLength={100} autoFocus onChange={(e) => setName(e.target.value)} />
          </label>
          {type === 'relation' && (
            <label>
              Database tujuan
              <select value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {targets.map((d) => (
                  <option key={d.id} value={d.id}>
                    {databaseTitle(d, pages)}
                    {d.id === databaseId ? ' (database ini)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="row">
            <button type="submit">Tambah</button>
            <button type="button" className="ghost" onClick={() => setType(null)}>
              Kembali
            </button>
          </div>
        </form>
      )}
    </Popover>
  );
}
