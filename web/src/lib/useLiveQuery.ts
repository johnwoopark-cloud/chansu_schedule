import { liveQuery } from 'dexie';
import { useEffect, useState } from 'preact/hooks';

/** Re-runs `query` whenever the IndexedDB tables it reads change. Returns undefined until the first result. */
export function useLiveQuery<T>(query: () => Promise<T> | T, deps: unknown[] = []): T | undefined {
  const [value, setValue] = useState<T | undefined>(undefined);
  useEffect(() => {
    const subscription = liveQuery(query).subscribe({
      next: setValue,
      error: (err) => console.error('liveQuery failed', err),
    });
    return () => subscription.unsubscribe();
  }, deps);
  return value;
}
