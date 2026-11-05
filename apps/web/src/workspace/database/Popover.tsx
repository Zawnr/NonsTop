// A small menu or editor next to the element that opened it. Built on a modal <dialog>, so it sits
// above tables and the editor, traps focus and closes with Escape. On phones it is a bottom sheet.
// Rendered into <body>, so its DOM events never reach the block editor around an inline database.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function Popover({ anchor, label, onClose, children, wide }: { anchor: HTMLElement | null; label: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    if (!anchor || window.matchMedia('(max-width: 767px)').matches) return;
    const r = anchor.getBoundingClientRect();
    const width = dialog.offsetWidth;
    const height = dialog.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const below = r.bottom + 4;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, r.top - height - 4) : below;
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
  });

  // Return focus to the opener so keyboard users keep their place in the table.
  useEffect(() => () => anchor?.focus({ preventScroll: true }), [anchor]);

  return createPortal(
    <dialog
      ref={ref}
      className={wide ? 'popover wide' : 'popover'}
      aria-label={label}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // A click on the backdrop lands on the dialog element itself.
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      {children}
    </dialog>,
    document.body,
  );
}
