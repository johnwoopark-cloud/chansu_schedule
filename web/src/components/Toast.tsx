import { useEffect, useState } from 'preact/hooks';

interface ToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

let current: ToastState | null = null;
let nextId = 1;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function hideToast(): void {
  current = null;
  clearTimeout(timer);
  emit();
}

/** Shows a short message, optionally with an action such as "되돌리기". Replaces any visible toast. */
export function showToast(message: string, action?: ToastState['action'], durationMs = 6000): void {
  current = { id: nextId++, message, action };
  clearTimeout(timer);
  timer = setTimeout(hideToast, durationMs);
  emit();
}

export function ToastHost() {
  const [toast, setToast] = useState<ToastState | null>(current);
  useEffect(() => {
    const update = () => setToast(current);
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, []);
  if (!toast) return null;
  return (
    <div class="toast" role="status" key={toast.id}>
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            const run = toast.action!.run;
            hideToast();
            run();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
