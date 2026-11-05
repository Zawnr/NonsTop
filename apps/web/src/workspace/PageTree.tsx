// Sidebar page tree (F-02): open and close branches, drag to reorder or move.
// Mouse drag starts after 6 px; touch drag starts after a long press, so taps and scrolling still work.
import { useEffect, useState } from 'react';
import {
  DndContext,
  MouseSensor,
  pointerWithin,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
} from '@dnd-kit/core';
import { createPage, movePage } from '../data/pages.ts';
import { useStore } from '../data/workspace.tsx';
import { placeRelative, UNTITLED, visibleChildren, type DropPosition, type PageIndex } from '../model/pages.ts';
import { navigate, pagePath } from '../router.ts';
import { pointerY } from './dnd.ts';

const EXPANDED_KEY = 'nonstop:expanded';

function loadExpanded(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

interface Row {
  id: string;
  title: string;
  depth: number;
  hasChildren: boolean;
}

function flatten(index: PageIndex, expanded: Set<string>): Row[] {
  const rows: Row[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const p of visibleChildren(index, parentId)) {
      const kids = visibleChildren(index, p.id);
      rows.push({ id: p.id, title: p.title || UNTITLED, depth, hasChildren: kids.length > 0 });
      if (kids.length && expanded.has(p.id)) walk(p.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

interface Drop {
  targetId: string;
  position: DropPosition;
}

export function PageTree({ index, currentId, onNavigate }: { index: PageIndex; currentId: string | null; onNavigate: () => void }) {
  const store = useStore();
  const [expanded, setExpanded] = useState(loadExpanded);
  const [drop, setDrop] = useState<Drop | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
  );

  const save = (next: Set<string>) => {
    setExpanded(next);
    localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next]));
  };

  // Keep the open page visible: expand its ancestors.
  useEffect(() => {
    if (!currentId) return;
    const missing = index.ancestors(currentId).filter((a) => !expanded.has(a.id));
    if (missing.length) save(new Set([...expanded, ...missing.map((a) => a.id)]));
  }, [currentId, index]);

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    save(next);
  };

  const addChild = async (parentId: string) => {
    const id = await createPage(store, index, parentId);
    save(new Set([...expanded, parentId]));
    navigate(pagePath(id));
    onNavigate();
  };

  /** Where the dragged page would land, from the pointer position of a drag event. */
  const dropAt = (e: DragMoveEvent | DragEndEvent): Drop | null => {
    const y = pointerY(e);
    if (!e.over || y === null) return null;
    const { top, height } = e.over.rect;
    const position: DropPosition = y < top + height * 0.25 ? 'before' : y > top + height * 0.75 ? 'after' : 'inside';
    const targetId = String(e.over.id);
    return placeRelative(index, String(e.active.id), targetId, position) !== null ? { targetId, position } : null;
  };

  const onDragMove = (e: DragMoveEvent) => setDrop(dropAt(e));

  const onDragEnd = (e: DragEndEvent) => {
    const movingId = String(e.active.id);
    // Computed from the end event itself: a quick release can come before the last move re-renders.
    const target = dropAt(e);
    if (target) {
      const place = placeRelative(index, movingId, target.targetId, target.position);
      if (place) {
        void movePage(store, movingId, place);
        if (target.position === 'inside') save(new Set([...expanded, target.targetId]));
      }
    }
    setDrop(null);
    setDragging(null);
  };

  const rows = flatten(index, expanded);
  if (!rows.length) return <p className="muted tree-empty">Belum ada halaman.</p>;

  return (
    <DndContext
      sensors={sensors}
      // The row under the pointer or finger is the target, matching how the drop position is computed.
      collisionDetection={pointerWithin}
      onDragStart={(e) => setDragging(String(e.active.id))}
      onDragMove={onDragMove}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDrop(null);
        setDragging(null);
      }}
    >
      <ul className="tree" role="tree" aria-label="Halaman">
        {rows.map((row) => (
          <TreeRow
            key={row.id}
            row={row}
            active={row.id === currentId}
            expanded={expanded.has(row.id)}
            dragging={dragging === row.id}
            drop={drop?.targetId === row.id ? drop.position : null}
            onToggle={() => toggle(row.id)}
            onAdd={() => void addChild(row.id)}
            onOpen={() => {
              navigate(pagePath(row.id));
              onNavigate();
            }}
          />
        ))}
      </ul>
    </DndContext>
  );
}

interface TreeRowProps {
  row: Row;
  active: boolean;
  expanded: boolean;
  dragging: boolean;
  drop: DropPosition | null;
  onToggle: () => void;
  onAdd: () => void;
  onOpen: () => void;
}

function TreeRow({ row, active, expanded, dragging, drop, onToggle, onAdd, onOpen }: TreeRowProps) {
  const drag = useDraggable({ id: row.id });
  const dropZone = useDroppable({ id: row.id });
  return (
    <li
      ref={dropZone.setNodeRef}
      role="treeitem"
      aria-expanded={row.hasChildren ? expanded : undefined}
      aria-selected={active}
      className={['tree-row', active && 'active', dragging && 'dragging', drop && `drop-${drop}`].filter(Boolean).join(' ')}
      style={{ paddingLeft: `${row.depth * 14 + 4}px` }}
    >
      {row.hasChildren ? (
        <button className="icon twisty" onClick={onToggle} aria-label={expanded ? `Tutup ${row.title}` : `Buka ${row.title}`}>
          <span className={expanded ? 'chev open' : 'chev'} aria-hidden="true">›</span>
        </button>
      ) : (
        <span className="twisty-spacer" />
      )}
      <a
        ref={drag.setNodeRef}
        href={pagePath(row.id)}
        className="tree-link"
        onClick={(e) => {
          e.preventDefault();
          onOpen();
        }}
        {...drag.listeners}
        {...drag.attributes}
        role="link"
        tabIndex={0}
      >
        {row.title}
      </a>
      <button className="icon add" onClick={onAdd} aria-label={`Sub-halaman baru di ${row.title}`}>
        +
      </button>
    </li>
  );
}
