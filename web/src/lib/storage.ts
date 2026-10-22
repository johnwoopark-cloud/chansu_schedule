export interface StorageStatus {
  persisted: boolean | null;
  usageBytes: number | null;
  quotaBytes: number | null;
}

export async function getStorageStatus(): Promise<StorageStatus> {
  const storage = navigator.storage;
  if (!storage) return { persisted: null, usageBytes: null, quotaBytes: null };
  const [persisted, estimate] = await Promise.all([
    storage.persisted ? storage.persisted() : Promise.resolve(null),
    storage.estimate ? storage.estimate() : Promise.resolve(undefined),
  ]);
  return { persisted, usageBytes: estimate?.usage ?? null, quotaBytes: estimate?.quota ?? null };
}

/** Asks the browser not to evict our data. Chrome on Android grants this for installed apps. */
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
