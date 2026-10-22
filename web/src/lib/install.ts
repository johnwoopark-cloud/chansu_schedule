// Captures Chrome's install prompt so the app can offer "홈 화면에 설치" from its own UI.

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  notify();
});

window.addEventListener('appinstalled', () => {
  deferred = null;
  notify();
});

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches;
}

export function canPromptInstall(): boolean {
  return deferred !== null;
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  notify();
  return outcome === 'accepted';
}

export function onInstallStateChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
