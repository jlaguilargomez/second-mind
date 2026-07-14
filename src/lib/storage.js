const DB_NAME = 'second-mind-handles'
const STORE_NAME = 'workspace'
const HANDLE_KEY = 'directory'
const WORKSPACE_MANIFEST = 'second-mind.json'
const DIRECTORY_NOTE_KIND = {
  journals: 'journal',
  contexts: 'context',
  tags: 'tag',
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

function isCloneFailure(error) {
  return error?.name === 'DataCloneError'
    || /serializable|clone|clon/i.test(String(error?.message || ''))
}

export async function saveDirectoryHandle(handle) {
  try {
    const db = await openDb()
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(handle, HANDLE_KEY)
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
    })
    return true
  } catch (error) {
    if (isCloneFailure(error)) return false
    throw error
  }
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
  notes.workspaceManifest = await readWorkspaceManifest(root)
  for (const directoryName of ['journals', 'contexts', 'tags']) {
    try {
      const directory = await root.getDirectoryHandle(directoryName)
      notes.push(...(await readMarkdownDirectory(directory, DIRECTORY_NOTE_KIND[directoryName])))
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

export async function readMarkdownTree(root, prefix = '') {
  const notes = []
  for await (const [name, handle] of root.entries()) {
    const path = prefix ? `${prefix}/${name}` : name
    if (handle.kind === 'directory') {
      notes.push(...(await readMarkdownTree(handle, path)))
      continue
    }
    if (!prefix && name === WORKSPACE_MANIFEST) {
      notes.workspaceManifest = await readWorkspaceManifest(root)
      continue
    }
    if (!name.toLowerCase().endsWith('.md')) continue
    const file = await handle.getFile()
    notes.push({
      path,
      filename: name,
      markdown: await file.text(),
      updatedAt: file.lastModified,
    })
  }
  return notes
}

export async function writeNote(root, note) {
  const directoryName = note.kind === 'context'
    ? 'contexts'
    : note.kind === 'tag'
      ? 'tags'
      : 'journals'
  const directory = await root.getDirectoryHandle(directoryName, { create: true })
  const handle = await directory.getFileHandle(note.filename, { create: true })
  const writable = await handle.createWritable()
  await writable.write(note.markdown)
  await writable.close()
}

export async function readWorkspaceManifest(root) {
  try {
    const handle = await root.getFileHandle(WORKSPACE_MANIFEST)
    const file = await handle.getFile()
    return JSON.parse(await file.text())
  } catch (error) {
    if (error.name === 'NotFoundError') return null
    if (error instanceof SyntaxError) {
      throw new Error('El archivo second-mind.json no es un JSON válido.')
    }
    throw error
  }
}

export async function writeWorkspaceManifest(root, manifest) {
  const handle = await root.getFileHandle(WORKSPACE_MANIFEST, { create: true })
  const writable = await handle.createWritable()
  await writable.write(JSON.stringify(manifest, null, 2))
  await writable.close()
}

export async function removeNote(root, note) {
  const directoryName = note.kind === 'context'
    ? 'contexts'
    : note.kind === 'tag'
      ? 'tags'
      : 'journals'
  const directory = await root.getDirectoryHandle(directoryName)
  await directory.removeEntry(note.filename)
}
