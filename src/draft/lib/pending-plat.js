// Round 15, D2: a plat picked before signing in is kept in this browser while the homeowner signs in, so the
// sign-in (here, or by the emailed link opened on this device) never loses it. The file never leaves the browser
// until the homeowner is signed in; it is dropped once it has been sent or after a day. Every step is best effort:
// a private window or blocked storage just means the file is picked again.
const DB = 'drafthouse'
const STORE = 'pending'
const KEY = 'plat'
const DAY = 24 * 3600 * 1000

function open() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no storage'))
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx(mode, fn) {
  const db = await open()
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = fn(t.objectStore(STORE))
      t.oncomplete = () => resolve(req?.result)
      t.onerror = () => reject(t.error)
    })
  } finally {
    db.close()
  }
}

/** Keep the picked file (a File or Blob with a name) until sign-in. */
export async function keepPlat(file) {
  try {
    if (!file) return
    await tx('readwrite', (s) => s.put({ blob: file, name: file.name || 'plat', type: file.type || '', at: Date.now() }, KEY))
  } catch {}
}

/** The file kept before sign-in, as a File, or null. */
export async function pendingPlat() {
  try {
    const rec = await tx('readonly', (s) => s.get(KEY))
    if (!rec?.blob || Date.now() - (rec.at || 0) > DAY) return null
    return typeof File === 'function' ? new File([rec.blob], rec.name, { type: rec.type }) : rec.blob
  } catch {
    return null
  }
}

export async function dropPlat() {
  try {
    await tx('readwrite', (s) => s.delete(KEY))
  } catch {}
}

/** What the homeowner sees for their file: the kind, never the file's own name (round 15, P4). */
export const platKind = (file) => (/pdf$/i.test(file?.type || '') || /\.pdf$/i.test(file?.name || '') ? 'Plat (PDF)' : 'Plat (photo)')
