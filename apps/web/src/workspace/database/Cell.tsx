// One property value of one row: shown and edited in place (F-11, F-20). Used by the table and by
// the property panel of a row page (F-14).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatCountdown, optionColors, propField, reminderStatus, type Property, type SelectOption } from '@nonstop/shared';
import { addRow, newId, setOptions, setRelation, setValue } from '../../data/databases.ts';
import { useNow } from '../../hooks/now.ts';
import { useData, useStore } from '../../data/workspace.tsx';
import {
  cellText,
  cellValue,
  databaseTitle,
  dateRange,
  editableNumber,
  formatNumber,
  isEmpty,
  storedIds,
  parseNumber,
  safeUrl,
  type CellValue,
  type Row,
} from '../../model/database.ts';
import { UNTITLED } from '../../model/pages.ts';
import { navigate, pagePath } from '../../router.ts';
import { Popover } from './Popover.tsx';

/** `placeholder` is shown for empty values, so an empty property still looks clickable (row page). */
export function Cell({ prop, row, readOnly, placeholder }: { prop: Property; row: Row; readOnly?: boolean; placeholder?: string }) {
  const { databases } = useData();
  const store = useStore();
  const cell = cellValue(databases, prop, row);
  const save = (value: unknown) => void setValue(store, row.id, prop.id, value);
  const label = `${prop.name || 'Properti'}: ${row.title || UNTITLED}`;

  switch (cell.type) {
    case 'text':
      return <TextInput label={label} value={cell.value} readOnly={readOnly} placeholder={placeholder} onSave={(v) => save(v || null)} />;
    case 'url':
      return <UrlInput label={label} value={cell.value} readOnly={readOnly} placeholder={placeholder} onSave={(v) => save(v || null)} />;
    case 'number':
      return (
        <TextInput
          label={label}
          value={cell.value === null ? '' : formatNumber(cell.value)}
          editValue={cell.value === null ? '' : editableNumber(cell.value)}
          readOnly={readOnly}
          inputMode="decimal"
          placeholder={placeholder}
          className="num"
          onSave={(v) => {
            const n = parseNumber(v);
            if (n !== null || !v.trim()) save(n);
          }}
        />
      );
    case 'checkbox':
      return <CheckboxCell label={label} value={cell.value} readOnly={readOnly} onSave={save} />;
    default:
      return <PopoverCell prop={prop} row={row} cell={cell} label={label} readOnly={readOnly} placeholder={placeholder} />;
  }
}

/** Shows the new state at once; the stored value arrives a moment later through the live query. */
function CheckboxCell({ label, value, readOnly, onSave }: { label: string; value: boolean; readOnly?: boolean; onSave: (v: boolean) => void }) {
  const [pending, setPending] = useState<boolean | null>(null);
  if (pending !== null && pending === value) setPending(null);
  return (
    <label className="cell-check">
      <input
        type="checkbox"
        aria-label={label}
        checked={pending ?? value}
        disabled={readOnly}
        onChange={(e) => {
          setPending(e.target.checked);
          onSave(e.target.checked);
        }}
      />
    </label>
  );
}

/** Text shown as plain text until clicked, then edited in an input. Enter or leaving saves, Escape cancels. */
export function TextInput({
  label,
  value,
  editValue,
  onSave,
  readOnly,
  inputMode,
  className,
  placeholder,
  autoEdit,
}: {
  label: string;
  value: string;
  /** Text the input starts with, when it differs from the display (numbers without separators). */
  editValue?: string;
  onSave: (v: string) => void;
  readOnly?: boolean;
  inputMode?: 'decimal';
  className?: string;
  placeholder?: string;
  /** Opens the input as soon as this becomes true (a row just added from the table). */
  autoEdit?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!autoEdit || readOnly) return;
    cancelled.current = false;
    setDraft(editValue ?? value);
    // Only the switch to true opens the input; later value changes must not reopen it.
  }, [autoEdit]);
  if (draft === null) {
    return (
      <button type="button" className={`cell-btn ${className ?? ''}`} aria-label={label} disabled={readOnly} onClick={() => ((cancelled.current = false), setDraft(editValue ?? value))}>
        {value || <span className="muted">{placeholder ?? ''}</span>}
      </button>
    );
  }
  const finish = () => {
    if (!cancelled.current && draft !== (editValue ?? value)) onSave(draft.trim() === '' ? '' : draft);
    setDraft(null);
  };
  return (
    <input
      className={`cell-input ${className ?? ''}`}
      aria-label={label}
      autoFocus
      value={draft}
      inputMode={inputMode}
      enterKeyHint="done"
      maxLength={10_000}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={finish}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function UrlInput({ label, value, onSave, readOnly, placeholder }: { label: string; value: string; onSave: (v: string) => void; readOnly?: boolean; placeholder?: string }) {
  const href = safeUrl(value);
  return (
    <span className="cell-url">
      <TextInput label={label} value={value} onSave={onSave} readOnly={readOnly} placeholder={placeholder} />
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Buka tautan ${value}`} className="cell-link">
          ↗
        </a>
      )}
    </span>
  );
}

export function Chip({ option }: { option: SelectOption }) {
  return <span className={`chip c-${option.color}`}>{option.name || 'Tanpa nama'}</span>;
}

function display(cell: CellValue): ReactNode {
  switch (cell.type) {
    case 'select':
    case 'status':
      return cell.value ? <Chip option={cell.value} /> : null;
    case 'multiSelect':
      return cell.value.map((o) => <Chip key={o.id} option={o} />);
    case 'relation':
      return cell.value.map((r) => (
        <span key={r.id} className="chip rel">
          {r.title || UNTITLED}
        </span>
      ));
    case 'date':
      return cell.value?.remindAt ? (
        <>
          {cellText(cell)}
          <ReminderCountdown start={cell.value.start} remindAt={cell.value.remindAt} />
        </>
      ) : (
        cellText(cell)
      );
    default:
      return cellText(cell);
  }
}

/** "· 5 menit lagi" next to a date with a reminder that has not gone out yet (F-52). */
function ReminderCountdown({ start, remindAt }: { start: string; remindAt: string }) {
  const now = useNow();
  const status = reminderStatus(start, remindAt, now);
  if (status.kind !== 'upcoming') return null;
  return <span className="muted reminder-countdown"> · {formatCountdown(status.ms)} lagi</span>;
}

/** What happens to the reminder being edited, so the user knows when the notification comes. */
function ReminderHint({ start, remindAt }: { start: string; remindAt: string }) {
  // Every second while the editor is open: a reminder a minute away is worth watching closely.
  const now = useNow(1000);
  const status = reminderStatus(start, remindAt, now);
  if (status.kind === 'upcoming') return <span className="muted" role="status">Notifikasi muncul dalam {formatCountdown(status.ms)}, ke semua perangkat.</span>;
  if (status.kind === 'due') return <span className="muted" role="status">Jam ini sudah lewat: notifikasi dikirim dalam 1 menit setelah disimpan.</span>;
  if (status.kind === 'missed') return <span className="error" role="status">Lewat lebih dari 6 jam: notifikasi tidak dikirim. Pilih jam yang akan datang.</span>;
  return null;
}

/** A value as plain display, for places that are links themselves (list view). */
export function CellDisplay({ prop, row }: { prop: Property; row: Row }) {
  const { databases } = useData();
  return <span className="chips">{display(cellValue(databases, prop, row))}</span>;
}

function PopoverCell({ prop, row, cell, label, readOnly, placeholder }: { prop: Property; row: Row; cell: CellValue; label: string; readOnly?: boolean; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btn} type="button" className="cell-btn chips" aria-label={label} disabled={readOnly} onClick={() => setOpen(true)}>
        {isEmpty(cell) && placeholder ? <span className="muted">{placeholder}</span> : display(cell)}
      </button>
      {open && (
        <Popover anchor={btn.current} label={label} onClose={() => setOpen(false)}>
          {cell.type === 'date' && <DateEditor prop={prop} row={row} cell={cell} onDone={() => setOpen(false)} />}
          {(cell.type === 'select' || cell.type === 'status' || cell.type === 'multiSelect') && <OptionPicker prop={prop} row={row} cell={cell} />}
          {cell.type === 'relation' && <RelationPicker prop={prop} row={row} cell={cell} />}
        </Popover>
      )}
    </>
  );
}

function DateEditor({ prop, row, cell, onDone }: { prop: Property; row: Row; cell: Extract<CellValue, { type: 'date' }>; onDone: () => void }) {
  const store = useStore();
  const today = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD in local time
  const [start, setStart] = useState(cell.value?.start ?? today);
  const [end, setEnd] = useState<string | null>(cell.value?.end ?? null);
  const [remindAt, setRemindAt] = useState<string | null>(cell.value?.remindAt ?? null);
  const save = () => {
    void setValue(store, row.id, prop.id, start ? dateRange(start, end || null, remindAt ? remindAt.slice(0, 5) : null) : null);
    onDone();
  };
  return (
    <form className="pop-form" onSubmit={(e) => (e.preventDefault(), save())}>
      <label>
        Tanggal
        <input type="date" value={start} required onChange={(e) => setStart(e.target.value)} aria-label="Tanggal mulai" />
      </label>
      {end === null ? (
        <button type="button" className="ghost" onClick={() => setEnd(start)}>
          + Tanggal akhir
        </button>
      ) : (
        <label>
          Tanggal akhir
          <span className="row">
            <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="Tanggal akhir" />
            <button type="button" className="ghost" onClick={() => setEnd(null)} aria-label="Hapus tanggal akhir">
              ✕
            </button>
          </span>
        </label>
      )}
      {remindAt === null ? (
        <button type="button" className="ghost" onClick={() => setRemindAt('09:00')}>
          + Pengingat
        </button>
      ) : (
        <label>
          Pengingat jam
          <span className="row">
            <input type="time" value={remindAt} required onChange={(e) => setRemindAt(e.target.value)} aria-label="Jam pengingat" />
            <button type="button" className="ghost" onClick={() => setRemindAt(null)} aria-label="Hapus pengingat">
              ✕
            </button>
          </span>
          <ReminderHint start={start} remindAt={remindAt.slice(0, 5)} />
        </label>
      )}
      <div className="row">
        <button type="submit">Simpan</button>
        <button
          type="button"
          className="ghost"
          onClick={() => {
            void setValue(store, row.id, prop.id, null);
            onDone();
          }}
        >
          Kosongkan
        </button>
      </div>
    </form>
  );
}

/** Pick options of a select, status or multi-select. Typing a new name creates an option. */
function OptionPicker({ prop, row, cell }: { prop: Property; row: Row; cell: Extract<CellValue, { type: 'select' | 'status' | 'multiSelect' }> }) {
  const store = useStore();
  const [query, setQuery] = useState('');
  const options = prop.config.options ?? [];
  const multi = cell.type === 'multiSelect';
  const selected = new Set(multi ? cell.value.map((o) => o.id) : cell.value ? [cell.value.id] : []);
  const q = query.trim().toLocaleLowerCase('id');
  const shown = options.filter((o) => o.name.toLocaleLowerCase('id').includes(q));
  const exact = options.some((o) => o.name.toLocaleLowerCase('id') === q);

  const choose = (id: string) => {
    if (multi) {
      const next = selected.has(id) ? [...selected].filter((x) => x !== id) : [...selected, id];
      void setValue(store, row.id, prop.id, next);
    } else {
      void setValue(store, row.id, prop.id, selected.has(id) ? null : id);
    }
  };

  const create = async () => {
    const name = query.trim();
    if (!name) return;
    const option: SelectOption = {
      id: newId(),
      name,
      color: optionColors[options.length % optionColors.length]!,
      ...(prop.type === 'status' ? { group: 'todo' as const } : {}),
    };
    await setOptions(store, prop, [...options, option]);
    setQuery('');
    choose(option.id);
  };

  return (
    <div className="pop-list">
      <input
        className="pop-search"
        placeholder={prop.type === 'status' ? 'Cari status…' : 'Cari atau buat opsi…'}
        aria-label="Cari opsi"
        value={query}
        maxLength={100}
        enterKeyHint="done"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          e.preventDefault();
          if (shown.length === 1 && q) choose(shown[0]!.id);
          else if (!exact) void create();
        }}
      />
      <ul role="listbox" aria-label="Opsi" aria-multiselectable={multi}>
        {shown.map((o) => (
          <li key={o.id}>
            <button type="button" role="option" aria-selected={selected.has(o.id)} className="ghost pop-item" onClick={() => choose(o.id)}>
              <span className="tick" aria-hidden="true">{selected.has(o.id) ? '✓' : ''}</span>
              <Chip option={o} />
            </button>
          </li>
        ))}
      </ul>
      {q && !exact && (
        <button type="button" className="ghost pop-item" onClick={() => void create()}>
          + Buat “{query.trim()}”
        </button>
      )}
      {!options.length && !q && <p className="muted">Belum ada opsi. Ketik nama untuk membuat.</p>}
    </div>
  );
}

/** Link rows of the related database. Works from either side of the relation (F-15). */
function RelationPicker({ prop, row, cell }: { prop: Property; row: Row; cell: Extract<CellValue, { type: 'relation' }> }) {
  const store = useStore();
  const { pages, databases } = useData();
  const [query, setQuery] = useState('');
  const target = prop.config.databaseId ? databases.byId.get(prop.config.databaseId) : undefined;
  if (!target) return <p className="muted">Database tujuan sudah dihapus.</p>;
  const linked = new Set(cell.value.map((r) => r.id));
  const q = query.trim().toLocaleLowerCase('id');
  const rows = databases.rowsOf(target.id).filter((r) => r.id !== row.id && (r.title || UNTITLED).toLocaleLowerCase('id').includes(q));

  const createAndLink = async () => {
    const id = await addRow(store, databases, target.id, query.trim());
    setQuery('');
    // The new row is not in this render's index yet, so link it on the side that needs no lookup.
    if (prop.config.reverse && prop.config.pairId) await setValue(store, id, prop.config.pairId, [row.id]);
    // Keep every stored id, including links to rows that are trashed or not synced yet.
    else await setValue(store, row.id, prop.id, [...storedIds(row.values[propField(prop.id)]), id]);
  };

  return (
    <div className="pop-list">
      <p className="muted pop-head">Tautkan ke {databaseTitle(target, pages)}</p>
      <input className="pop-search" placeholder="Cari baris…" aria-label="Cari baris" value={query} enterKeyHint="search" onChange={(e) => setQuery(e.target.value)} />
      <ul role="listbox" aria-label="Baris" aria-multiselectable>
        {rows.map((r) => (
          <li key={r.id} className="pop-rel">
            <button
              type="button"
              role="option"
              aria-selected={linked.has(r.id)}
              className="ghost pop-item"
              onClick={() => void setRelation(store, databases, prop, row, r.id, !linked.has(r.id))}
            >
              <span className="tick" aria-hidden="true">{linked.has(r.id) ? '✓' : ''}</span>
              {r.title || UNTITLED}
            </button>
            <button type="button" className="icon" aria-label={`Buka ${r.title || UNTITLED}`} onClick={() => navigate(pagePath(r.id))}>
              ↗
            </button>
          </li>
        ))}
      </ul>
      {q && (
        <button type="button" className="ghost pop-item" onClick={() => void createAndLink()}>
          + Baris baru “{query.trim()}”
        </button>
      )}
      {!rows.length && !q && <p className="muted">Database tujuan belum punya baris.</p>}
    </div>
  );
}
