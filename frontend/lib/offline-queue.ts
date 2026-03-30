export type OfflineQueueMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface OfflineQueueEntry {
  id: string
  path: string
  method: OfflineQueueMethod
  body: string | null
  headers: Record<string, string>
  createdAt: string
}

const STORAGE_KEY = 'sheltaflex-offline-queue'

function getStorage() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.localStorage
}

function readQueue(): OfflineQueueEntry[] {
  const storage = getStorage()
  if (!storage) {
    return []
  }

  const raw = storage.getItem(STORAGE_KEY)
  if (!raw) {
    return []
  }

  try {
    return JSON.parse(raw) as OfflineQueueEntry[]
  } catch {
    storage.removeItem(STORAGE_KEY)
    return []
  }
}

function writeQueue(entries: OfflineQueueEntry[]) {
  const storage = getStorage()
  if (!storage) {
    return
  }

  storage.setItem(STORAGE_KEY, JSON.stringify(entries))
  window.dispatchEvent(
    new CustomEvent('offline-queue-updated', {
      detail: entries.length,
    }),
  )
}

export function getOfflineQueueCount() {
  return readQueue().length
}

export function enqueueOfflineRequest(
  entry: Omit<OfflineQueueEntry, 'id' | 'createdAt'>,
) {
  const entries = readQueue()
  entries.push({
    ...entry,
    id: `offline_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  })
  writeQueue(entries)
}

export function clearOfflineQueue() {
  writeQueue([])
}

export async function flushOfflineQueue(baseUrl: string) {
  const entries = readQueue()
  if (!entries.length) {
    return 0
  }

  const remaining: OfflineQueueEntry[] = []
  let processed = 0

  for (const entry of entries) {
    try {
      const response = await fetch(`${baseUrl}${entry.path}`, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
      })

      if (!response.ok) {
        remaining.push(entry)
        continue
      }

      processed += 1
    } catch {
      remaining.push(entry)
    }
  }

  writeQueue(remaining)
  return processed
}
