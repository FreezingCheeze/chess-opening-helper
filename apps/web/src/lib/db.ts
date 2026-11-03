import type { BranchPrefs } from '@opening/engine'

export type OpeningRecord = {
  id: string
  userId: string
  name: string
  myColor: 'white' | 'black'
  createdAt: string
  updatedAt: string
  dirty?: boolean
}

export type LineRecord = {
  id: string
  userId: string
  openingId: string
  groupName: string
  name: string
  pgn: string
  included: boolean
  sortOrder: number
  createdAt: string
  updatedAt: string
  dirty?: boolean
}

export type ProgressRecord = {
  id: string
  userId: string
  openingId: string
  positionKey: string
  expectedSan: string
  introduced: boolean
  needsReview: boolean
  updatedAt: string
  dirty?: boolean
}

export type BranchPrefsRecord = {
  id: string
  userId: string
  openingId: string
  prefs: BranchPrefs
  updatedAt: string
  dirty?: boolean
}

export type LocalUser = {
  id: string
  email: string
  salt: string
  hash: string
  origin: 'local'
}

export type Tombstone = {
  id: string
  table: 'openings' | 'lines' | 'progress'
  rowId: string
  userId: string
}

const DB_NAME = 'opening-trainer'
const DB_VERSION = 2

let opened: Promise<IDBDatabase> | null = null

function database(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('This browser cannot store lines.'))
  if (!opened) {
    opened = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = (event) => {
        const db = request.result
        for (const name of ['openings', 'lines', 'progress', 'branchPrefs', 'users', 'tombstones']) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' })

        if (event.oldVersion < 2) {
          const transaction = request.transaction
          if (!transaction) return
          const meta = transaction.objectStore('meta')
          const preferences = transaction.objectStore('branchPrefs')
          const cursorRequest = meta.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (!cursor) return
            const row = cursor.value as { key?: string; value?: BranchPrefs }
            const match = row.key?.match(/^branchPrefs:([^:]+):([^:]+)$/)
            if (match) {
              const [, userId, openingId] = match
              preferences.put({
                id: `${userId}:${openingId}`,
                userId,
                openingId,
                prefs: row.value ?? {},
                updatedAt: new Date().toISOString(),
                dirty: true,
              } satisfies BranchPrefsRecord)
              cursor.delete()
            }
            cursor.continue()
          }
        }
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        opened = null
        reject(request.error)
      }
    })
  }
  return opened
}

export async function putRow<T>(store: string, value: T): Promise<void> {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(store).put(value)
  })
}

export async function getRow<T>(store: string, id: string): Promise<T | undefined> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const request = tx.objectStore(store).get(id)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  })
}

export async function allRows<T>(store: string): Promise<T[]> {
  const db = await database()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly')
    const request = tx.objectStore(store).getAll()
    request.onsuccess = () => resolve((request.result as T[]) ?? [])
    request.onerror = () => reject(request.error)
  })
}

export async function deleteRow(store: string, id: string): Promise<void> {
  const db = await database()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(store).delete(id)
  })
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await getRow<{ key: string; value: T }>('meta', key)
  return row?.value
}

export async function setMeta<T>(key: string, value: T): Promise<void> {
  await putRow('meta', { key, value })
}

export async function clearMeta(key: string): Promise<void> {
  await deleteRow('meta', key)
}
