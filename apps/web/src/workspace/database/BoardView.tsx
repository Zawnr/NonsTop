// Board view (F-21): one column per option of a status or select property. Cards move between
// columns by dragging (long press on touch screens) or through their "Pindah ke" menu.
import { useRef, useState } from 'react';
import { DndContext, MouseSensor, pointerWithin, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent, type DragMoveEvent } from '@dnd-kit/core';
import { propField, type Property, type View } from '@nonstop/shared';
import { renamePage } from '../../data/pages.ts';
import { useData, useStore } from '../../data/workspace.tsx';
import { cellValue, isEmpty, type Row } from '../../model/database.ts';
import { UNTITLED } from '../../model/pages.ts';
import { cardKey, groupable, groupRows, groupValue, type RowGroup } from '../../model/views.ts';
import { navigate, pagePath } from '../../router.ts';
import { CellDisplay, Chip, TextInput } from './Cell.tsx';
import { Popover } from './Popover.tsx';

interface Drop {
  column: string | null;
  /** The card the moving card goes before; null = end of the column. */
  beforeId: string | null;
}

const COLUMN = 'col:';
const colId = (key: string | null) => COLUMN + (key ?? '');
const colKey = (id: string): string | null => id.slice(COLUMN.length) || null;

function pointerY(e: DragMoveEvent | DragEndEvent): number | null {
  const start = e.activatorEvent;
  let y: number | null = null;
  if (start instanceof MouseEvent) y = start.clientY;
  else if (typeof TouchEvent !== 'undefined' && start instanceof TouchEvent) y = start.touches[0]?.clientY ?? null;
  return y === null ? null : y + e.delta.y;
}

export function BoardView({
  view,
  properties,
  visible,
  rows,
  readOnly,
  newRowId,
  onAdd,
}: {
  view: View;
  properties: Property[];
  visible: Property[];
  rows: Row[];
  readOnly?: boolean;
  newRowId?: string | null;
  onAdd: (groupKey: string | null) => void;
}) {
  const store = useStore();
  const { databases } = useData();
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );
  const prop = view.groupBy ? properties.find((p) => p.id === view.groupBy) : undefined;
  if (!prop || !groupable(prop, true)) {
    return <p className="muted db-empty">Pilih properti Status atau Select untuk kolom board lewat tombol “Kolom”.</p>;
  }
  const columns = groupRows(databases, prop, rows);
  const columnOf = (rowId: string) => columns.find((c) => c.rows.some((r) => r.id === rowId));

  /** Moves a card to a column, before a card or at the end. The order changes only without sorts. */
  const move = (rowId: string, target: Drop) => {
    // The "no value" column only exists while it has cards; moving there from the menu still works.
    const column = columns.find((c) => c.key === target.column) ?? (target.column === null ? { key: null, rows: [] } : undefined);
    const from = columnOf(rowId);
    if (!column || !from) return;
    const fields: Record<string, unknown> = {};
    if (from.key !== column.key) fields[propField(prop.id)] = groupValue(prop, column.key);
    if (!view.sorts.length && target.beforeId !== rowId) fields.sortKey = cardKey(column.rows, rowId, target.beforeId);
    if (Object.keys(fields).length) void store.write('page', rowId, fields);
  };

  /** Where the dragged card would land, from the pointer position of a drag event. */
  const dropAt = (e: DragMoveEvent | DragEndEvent): Drop | null => {
    const over = e.over ? String(e.over.id) : null;
    if (!over) return null;
    if (over.startsWith(COLUMN)) return { column: colKey(over), beforeId: null };
    const column = columnOf(over);
    if (!column) return null;
    const y = pointerY(e);
    const { top, height } = e.over!.rect;
    if (y !== null && y > top + height / 2) {
      const i = column.rows.findIndex((r) => r.id === over);
      return { column: column.key, beforeId: column.rows[i + 1]?.id ?? null };
    }
    return { column: column.key, beforeId: over };
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragging(String(e.active.id))}
      onDragMove={(e) => setDrop(dropAt(e))}
      onDragEnd={(e) => {
        // Computed from the end event itself: a quick release can come before the last move re-renders.
        const target = dropAt(e);
        if (target) move(String(e.active.id), target);
        setDrop(null);
        setDragging(null);
      }}
      onDragCancel={() => (setDrop(null), setDragging(null))}
    >
      <div className="board" role="list" aria-label={`Board menurut ${prop.name}`}>
        {columns.map((c) => (
          <Column
            key={c.key ?? ''}
            column={c}
            columns={columns}
            prop={prop}
            visible={visible.filter((p) => p.id !== prop.id)}
            readOnly={readOnly}
            newRowId={newRowId}
            dragging={dragging}
            drop={drop?.column === c.key ? drop : null}
            onAdd={() => onAdd(c.key)}
            onMove={(rowId, key) => move(rowId, { column: key, beforeId: null })}
            onRename={(rowId, title) => void renamePage(store, rowId, title)}
          />
        ))}
      </div>
    </DndContext>
  );
}

function Column({
  column,
  columns,
  prop,
  visible,
  readOnly,
  newRowId,
  dragging,
  drop,
  onAdd,
  onMove,
  onRename,
}: {
  column: RowGroup;
  columns: RowGroup[];
  prop: Property;
  visible: Property[];
  readOnly?: boolean;
  newRowId?: string | null;
  dragging: string | null;
  drop: Drop | null;
  onAdd: () => void;
  onMove: (rowId: string, key: string | null) => void;
  onRename: (rowId: string, title: string) => void;
}) {
  const zone = useDroppable({ id: colId(column.key), disabled: readOnly });
  const name = column.label;
  return (
    <section ref={zone.setNodeRef} className={drop ? 'board-col drop' : 'board-col'} role="listitem" aria-label={`Kolom ${name}`}>
      <header className="board-col-head">
        {column.option ? <Chip option={column.option} /> : <span className="muted">{name}</span>}
        <span className="muted board-count">{column.rows.length}</span>
        {!readOnly && (
          <button type="button" className="icon" aria-label={`Kartu baru di ${name}`} onClick={onAdd}>
            +
          </button>
        )}
      </header>
      <ul className="board-cards">
        {column.rows.map((row) => (
          <Card
            key={row.id}
            row={row}
            columns={columns}
            current={column.key}
            prop={prop}
            visible={visible}
            readOnly={readOnly}
            autoEdit={row.id === newRowId}
            dragging={dragging === row.id}
            dropBefore={drop?.beforeId === row.id}
            onMove={(key) => onMove(row.id, key)}
            onRename={(t) => onRename(row.id, t)}
          />
        ))}
        {drop && drop.beforeId === null && <li className="drop-line" aria-hidden="true" />}
      </ul>
    </section>
  );
}

function Card({
  row,
  columns,
  current,
  prop,
  visible,
  readOnly,
  autoEdit,
  dragging,
  dropBefore,
  onMove,
  onRename,
}: {
  row: Row;
  columns: RowGroup[];
  current: string | null;
  prop: Property;
  visible: Property[];
  readOnly?: boolean;
  autoEdit: boolean;
  dragging: boolean;
  dropBefore: boolean;
  onMove: (key: string | null) => void;
  onRename: (title: string) => void;
}) {
  const { databases } = useData();
  const drag = useDraggable({ id: row.id, disabled: readOnly });
  const dropZone = useDroppable({ id: row.id, disabled: readOnly });
  const [menu, setMenu] = useState(false);
  const menuBtn = useRef<HTMLButtonElement>(null);
  const title = row.title || UNTITLED;
  const shown = visible.filter((p) => !isEmpty(cellValue(databases, p, row)));
  return (
    <>
      {dropBefore && <li className="drop-line" aria-hidden="true" />}
      <li
        ref={(el) => (drag.setNodeRef(el), dropZone.setNodeRef(el))}
        className={dragging ? 'board-card dragging' : 'board-card'}
        aria-label={`Kartu ${title}`}
        {...drag.listeners}
        {...drag.attributes}
        role="group"
        tabIndex={-1}
      >
        <div className="board-card-title">
          <TextInput label={`Judul kartu ${title}`} value={row.title} placeholder={UNTITLED} readOnly={readOnly} autoEdit={autoEdit} onSave={onRename} />
          <button type="button" className="icon" aria-label={`Buka ${title}`} onClick={() => navigate(pagePath(row.id))}>
            ↗
          </button>
          {!readOnly && (
            <button ref={menuBtn} type="button" className="icon" aria-label={`Pindah ${title}`} onClick={() => setMenu(true)}>
              ⋯
            </button>
          )}
        </div>
        {shown.length > 0 && (
          <div className="board-card-props">
            {shown.map((p) => (
              <span key={p.id} className="db-list-prop" title={p.name}>
                <CellDisplay prop={p} row={row} />
              </span>
            ))}
          </div>
        )}
      </li>
      {menu && (
        <Popover anchor={menuBtn.current} label={`Pindah ${title}`} onClose={() => setMenu(false)}>
          <div className="pop-list">
            <p className="muted pop-head">Pindah ke kolom {prop.name}</p>
            {columns
              .filter((c) => c.key !== current)
              .map((c) => (
                <button key={c.key ?? ''} type="button" className="ghost pop-item" onClick={() => (onMove(c.key), setMenu(false))}>
                  {c.option ? <Chip option={c.option} /> : c.label}
                </button>
              ))}
            {current !== null && (
              <button type="button" className="ghost pop-item" onClick={() => (onMove(null), setMenu(false))}>
                Tanpa {prop.name}
              </button>
            )}
          </div>
        </Popover>
      )}
    </>
  );
}
