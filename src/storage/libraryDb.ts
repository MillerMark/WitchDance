const DB_NAME = 'witchdance'
const DB_VERSION = 1
const STORE = 'library'

interface StoredTrack {
  id: string
  name: string
  size: number
  lastModified: number
  type: string
  buffer: ArrayBuffer
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

// Read all ArrayBuffers BEFORE opening the transaction to avoid async-in-transaction race
export async function saveLibrary(
  tracks: { id: string; name: string; file: File }[],
): Promise<void> {
  const records: StoredTrack[] = await Promise.all(
    tracks.map(async (t) => ({
      id: t.id,
      name: t.name,
      size: t.file.size,
      lastModified: t.file.lastModified,
      type: t.file.type || 'audio/mpeg',
      buffer: await t.file.arrayBuffer(),
    })),
  )

  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.clear()
    for (const record of records) {
      store.put(record)
    }
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

export async function loadLibrary(): Promise<
  { id: string; name: string; file: File }[]
> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const req = store.getAll()
    req.onsuccess = () => {
      const records: StoredTrack[] = req.result
      const tracks = records.map((r) => {
        const file = new File([r.buffer], r.name, {
          type: r.type,
          lastModified: r.lastModified,
        })
        return { id: r.id, name: r.name, file }
      })
      resolve(tracks)
    }
    req.onerror = () => reject(req.error)
  })
}
