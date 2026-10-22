import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { Icon } from './Icon';

/** Bottom sheet built on <dialog>, so focus trapping and the back gesture/Escape come from the browser. */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-label={title}
      onClose={onClose}
      onClick={(e) => {
        // Tap on the backdrop (the dialog element itself, outside the panel) closes.
        if (e.target === ref.current) onClose();
      }}
    >
      {open && (
        <div class="sheet-panel">
          <div class="sheet-head">
            <h2>{title}</h2>
            <button type="button" class="icon-button" aria-label="닫기" onClick={onClose}>
              <Icon name="skip" size={20} />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
