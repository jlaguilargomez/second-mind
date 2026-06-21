const PROPERTY_PATTERN = /^\s{2}([\w-]+)::\s*(.*)$/
const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?/

export function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

export function isoDate(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 10)
}

export function parseFrontmatter(markdown = '') {
  const match = markdown.match(FRONTMATTER_PATTERN)
  if (!match) return { attributes: {}, body: markdown }

  const attributes = {}
  for (const line of match[1].split('\n')) {
    const separator = line.indexOf(':')
    if (separator < 0) continue
    attributes[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }

  return { attributes, body: markdown.slice(match[0].length) }
}

export function serializeFrontmatter(attributes = {}) {
  const entries = Object.entries(attributes).filter(([, value]) => value !== undefined && value !== '')
  if (!entries.length) return ''
  return `---\n${entries.map(([key, value]) => `${key}: ${value}`).join('\n')}\n---\n\n`
}

export function titleFromMarkdown(markdown, fallback = 'Sin título') {
  const heading = markdown.match(/^#\s+(.+)$/m)
  return heading?.[1]?.trim() || fallback
}

export function extractContexts(markdown = '') {
  const mentions = [...markdown.matchAll(/(?:^|[\s(])@([\p{L}\p{N}_/-]+)/gu)].map(
    (match) => match[1].trim(),
  )
  const wikiLinks = [...markdown.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) => match[1].trim())
  return [...new Set([...mentions, ...wikiLinks].filter(Boolean))]
}

export function extractTags(markdown = '') {
  return [
    ...new Set(
      [...markdown.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_/-]+)/gu)]
        .map((match) => match[1].trim())
        .filter(Boolean),
    ),
  ]
}

export function excerpt(markdown = '', max = 120) {
  const clean = markdown
    .replace(FRONTMATTER_PATTERN, '')
    .replace(/^\s{2}[\w-]+::.*$/gm, '')
    .replace(/^#+\s+/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '@$1')
    .replace(/[*_>`-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return clean.length > max ? `${clean.slice(0, max).trim()}…` : clean
}

export function contextSlug(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function createBlock(type = 'log', content = '') {
  return {
    id: createId(),
    type,
    content,
    checked: false,
    reminder: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function blockFromLine(line) {
  if (/^#{1,3}\s+/.test(line)) {
    const level = line.match(/^#+/)[0].length
    return { ...createBlock('heading', line.replace(/^#{1,3}\s+/, '')), level }
  }
  const task = line.match(/^\s*-\s+\[([ xX])\]\s*(.*)$/)
  if (task) return { ...createBlock('task', task[2]), checked: task[1].toLowerCase() === 'x' }
  const log = line.match(/^\s*-\s+(.*)$/)
  if (log) return createBlock('log', log[1])
  return createBlock('text', line)
}

export function parseMarkdown(markdown = '', options = {}) {
  const { attributes, body } = parseFrontmatter(markdown)
  const lines = body.replace(/\r/g, '').split('\n')
  const blocks = []
  let current = null

  for (const line of lines) {
    const property = line.match(PROPERTY_PATTERN)
    if (property && current) {
      const [, key, value] = property
      if (key === 'id') current.id = value
      else if (key === 'reminder') current.reminder = value
      else if (key === 'created-at') current.createdAt = value
      else if (key === 'updated-at') current.updatedAt = value
      else {
        current.properties ||= {}
        current.properties[key] = value
      }
      continue
    }

    if (!line.trim()) {
      current = null
      continue
    }

    current = blockFromLine(line)
    blocks.push(current)
  }

  const fallbackTitle = options.fallbackTitle || 'Sin título'
  const titleBlock = blocks.find((block) => block.type === 'heading' && block.level === 1)
  return {
    attributes,
    title: titleBlock?.content || fallbackTitle,
    blocks,
  }
}

export function serializeBlock(block) {
  let line = block.content
  if (block.type === 'heading') line = `${'#'.repeat(block.level || 2)} ${block.content}`
  if (block.type === 'log') line = `- ${block.content}`
  if (block.type === 'task') line = `- [${block.checked ? 'x' : ' '}] ${block.content}`

  const properties = [
    `  id:: ${block.id || createId()}`,
    block.reminder ? `  reminder:: ${block.reminder}` : null,
    block.createdAt ? `  created-at:: ${block.createdAt}` : null,
    block.updatedAt ? `  updated-at:: ${block.updatedAt}` : null,
    ...Object.entries(block.properties || {}).map(([key, value]) => `  ${key}:: ${value}`),
  ].filter(Boolean)

  return `${line}\n${properties.join('\n')}`
}

export function serializeNote(note) {
  const attributes = {
    id: note.id,
    type: note.kind === 'journal' ? 'journal' : 'context',
    ...(note.date ? { date: note.date } : {}),
    ...(note.kind === 'context'
      ? { name: note.title, emoji: note.emoji || '◈', color: note.color || 'sage' }
      : {}),
    version: note.version || 1,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  }
  return `${serializeFrontmatter(attributes)}${note.blocks.map(serializeBlock).join('\n\n')}\n`
}

export function normalizeNote(note) {
  const parsed = parseMarkdown(note.markdown || '', {
    fallbackTitle: note.title || note.filename?.replace(/\.md$/i, '') || 'Sin título',
  })
  const dateMatch = note.date || note.filename?.match(/\d{4}-\d{2}-\d{2}/)?.[0]
  const now = new Date().toISOString()
  const normalized = {
    id: note.id || parsed.attributes.id || createId(),
    kind: note.kind || (parsed.attributes.type === 'context' ? 'context' : 'journal'),
    filename: note.filename,
    date: dateMatch || parsed.attributes.date || null,
    title: parsed.title,
    emoji: note.emoji || parsed.attributes.emoji || '◈',
    color: note.color || parsed.attributes.color || 'sage',
    blocks: (note.blocks || parsed.blocks).map((block) => ({
      ...block,
      id: block.id || createId(),
      createdAt: block.createdAt || now,
      updatedAt: block.updatedAt || now,
    })),
    version: Number(note.version || parsed.attributes.version || 1),
    createdAt: note.createdAt || parsed.attributes.createdAt || now,
    updatedAt: note.updatedAt || parsed.attributes.updatedAt || now,
    deletedAt: note.deletedAt || null,
  }
  normalized.markdown = serializeNote(normalized)
  normalized.contexts = extractContexts(normalized.markdown)
  normalized.tags = extractTags(normalized.markdown)
  normalized.excerpt = excerpt(normalized.markdown)
  return normalized
}

export function dailyTemplate(date, id = createId()) {
  const note = normalizeNote({
    id,
    kind: 'journal',
    date,
    filename: `${date}.md`,
    title: date,
    blocks: [
      { ...createBlock('heading', date), level: 1 },
      createBlock('log', ''),
    ],
  })
  return note.markdown
}

export function contextTemplate(name, options = {}) {
  const note = normalizeNote({
    id: options.id || createId(),
    kind: 'context',
    filename: `${contextSlug(name) || 'contexto'}.md`,
    title: name,
    emoji: options.emoji || '◈',
    color: options.color || 'sage',
    blocks: [{ ...createBlock('heading', name), level: 1 }],
  })
  return note.markdown
}

export function reminderState(reminder, now = new Date()) {
  if (!reminder) return null
  const target = new Date(reminder)
  const today = isoDate(now)
  const targetDay = isoDate(target)
  if (target < now && targetDay !== today) return 'overdue'
  if (targetDay === today) return 'today'
  return 'upcoming'
}
