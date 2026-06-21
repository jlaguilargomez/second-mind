const DB_NAME = 'second-mind-handles'
const STORE_NAME = 'workspace'
const HANDLE_KEY = 'directory'

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function saveDirectoryHandle(handle) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, 'readwrite')
    transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY)
    transaction.oncomplete = resolve
    transaction.onerror = () => reject(transaction.error)
  })
}

export async function getDirectoryHandle() {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(HANDLE_KEY)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function verifyPermission(handle, write = false) {
  if (!handle) return false
  const options = { mode: write ? 'readwrite' : 'read' }
  if ((await handle.queryPermission(options)) === 'granted') return true
  return (await handle.requestPermission(options)) === 'granted'
}

async function readMarkdownDirectory(directory, kind) {
  const notes = []
  for await (const [name, handle] of directory.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue
    const file = await handle.getFile()
    notes.push({
      id: `${kind}/${name}`,
      kind,
      filename: name,
      markdown: await file.text(),
      updatedAt: file.lastModified,
    })
  }
  return notes
}

export async function readWorkspace(root) {
  const notes = []
  for (const kind of ['journals', 'contexts']) {
    try {
      const directory = await root.getDirectoryHandle(kind)
      notes.push(...(await readMarkdownDirectory(directory, kind)))
    } catch (error) {
      if (error.name !== 'NotFoundError') throw error
    }
  }

  for await (const [name, handle] of root.entries()) {
    if (handle.kind !== 'file' || !name.toLowerCase().endsWith('.md')) continue
    const file = await handle.getFile()
    notes.push({
      id: `imports/${name}`,
      kind: 'journal',
      filename: name,
      markdown: await file.text(),
      updatedAt: file.lastModified,
    })
  }
  return notes
}

export async function writeNote(root, note) {
  const directory = await root.getDirectoryHandle(note.kind === 'context' ? 'contexts' : 'journals', {
    create: true,
  })
  const handle = await directory.getFileHandle(note.filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write(note.markdown)
  await writable.close()
}
