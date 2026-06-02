import { describe, expect, test } from 'vitest'
import {
  QUERY_STORAGE_KEY,
  clearPersistedQuery,
  readPersistedQuery,
  writePersistedQuery,
} from './queryPersistence'

function createStorage() {
  const values = new Map<string, string>()

  return {
    getItem(key: string) {
      return values.has(key) ? values.get(key)! : null
    },
    setItem(key: string, value: string) {
      values.set(key, value)
    },
    removeItem(key: string) {
      values.delete(key)
    },
    has(key: string) {
      return values.has(key)
    },
  }
}

describe('query persistence', () => {
  test('reads an empty query when nothing is stored', () => {
    const storage = createStorage()

    expect(readPersistedQuery(storage)).toBe('')
  })

  test('writes and reads the stored query', () => {
    const storage = createStorage()

    writePersistedQuery(storage, 'auth')

    expect(storage.getItem(QUERY_STORAGE_KEY)).toBe('auth')
    expect(readPersistedQuery(storage)).toBe('auth')
  })

  test('clears the stored query when asked', () => {
    const storage = createStorage()

    writePersistedQuery(storage, 'auth')
    clearPersistedQuery(storage)

    expect(storage.has(QUERY_STORAGE_KEY)).toBe(false)
    expect(readPersistedQuery(storage)).toBe('')
  })
})
