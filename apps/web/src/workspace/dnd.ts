// Shared drag-and-drop helpers for the page tree and the board.
import type { DragEndEvent, DragMoveEvent } from '@dnd-kit/core';

/** The pointer's current y position during a drag, from the start event plus the drag delta. */
export function pointerY(e: DragMoveEvent | DragEndEvent): number | null {
  const start = e.activatorEvent;
  let y: number | null = null;
  if (start instanceof MouseEvent) y = start.clientY;
  else if (typeof TouchEvent !== 'undefined' && start instanceof TouchEvent) y = start.touches[0]?.clientY ?? null;
  return y === null ? null : y + e.delta.y;
}
