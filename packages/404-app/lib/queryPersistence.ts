export const QUERY_STORAGE_KEY = 'port-404-query'

export interface QueryStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function readPersistedQuery(storage: QueryStorageLike | null | undefined): string {
  if (!storage) return ''

  try {
    return storage.getItem(QUERY_STORAGE_KEY) ?? ''
  } catch {
    return ''
  }
}

export function writePersistedQuery(
  storage: QueryStorageLike | null | undefined,
  query: string
): void {
  if (!storage) return

  try {
    if (query) {
      storage.setItem(QUERY_STORAGE_KEY, query)
    } else {
      storage.removeItem(QUERY_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures in browsers that disable sessionStorage.
  }
}

export function clearPersistedQuery(storage: QueryStorageLike | null | undefined): void {
  if (!storage) return

  try {
    storage.removeItem(QUERY_STORAGE_KEY)
  } catch {
    // Ignore storage failures in browsers that disable sessionStorage.
  }
}
