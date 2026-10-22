import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

/**
 * Re-runs `query` whenever the IndexedDB tables it reads change. Returns
 * undefined until the first result, and again after `deps` change until the
 * new result arrives, so a screen never shows data for the previous inputs
 * (e.g. yesterday's doses under today's date).
 */
export function useLiveQuery<T>(query: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const key = JSON.stringify(deps);
  const [state, setState] = useState<{ key: string; value: T } | undefined>(undefined);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: (value) => setState({ key, value }),
      error: (err) => console.error('liveQuery failed', err),
    });
    return () => subscription.unsubscribe();
  }, [key]);
  return state?.key === key ? state.value : undefined;
}
