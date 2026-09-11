import { extractContexts, extractTags, reminderDate } from './markdown.js'
import { isTrackingTask } from './taskClassification.js'

export const ASSISTANT_PERIODS = [7, 14, 30]
export const DEFAULT_ASSISTANT_BUDGET = 18_000

function dateDaysAgo(today, days) {
  const value = new Date(`${today}T12:00:00`)
  value.setDate(value.getDate() - (days - 1))
  return value.toISOString().slice(0, 10)
}

function sourceFrom(note, block, category) {
  return {
    category,
    noteId: note.id,
    blockId: block.id,
    date: note.date || null,
    title: note.title,
    type: block.type,
    content: String(block.content || '').trim(),
    checked: block.type === 'task' ? Boolean(block.checked) : undefined,
    priority: block.type === 'task' ? block.priority || 'base' : undefined,
    reminder: block.type === 'task' ? reminderDate(block.reminder) || null : undefined,
    contexts: block.contexts || extractContexts(block.content),
    tags: block.tags || extractTags(block.content),
    updatedAt: block.updatedAt || note.updatedAt || null,
  }
}

function taskRank(source) {
  const priority = { high: 0, medium: 1, base: 2 }[source.priority] ?? 2
  return [
    priority,
    source.reminder || '9999-12-31',
    source.date ? `-${source.date}` : '',
    source.blockId,
  ]
}

function compareRank(a, b) {
  const left = taskRank(a)
  const right = taskRank(b)
  for (let index = 0; index < left.length; index += 1) {
    const comparison = String(left[index]).localeCompare(String(right[index]))
    if (comparison) return comparison
  }
  return 0
}

function sourceLine(sourceId, source) {
  const metadata = [
    source.date || source.title,
    source.type === 'task' ? (source.checked ? 'completada' : 'abierta') : source.type,
    source.priority && source.priority !== 'base' ? `prioridad:${source.priority}` : null,
    source.reminder ? `fecha:${source.reminder}` : null,
    ...source.contexts.map((name) => `@${name}`),
    ...source.tags.map((name) => `#${name}`),
  ].filter(Boolean)
  return `[${sourceId}] ${metadata.join(' | ')} :: ${source.content}`
}

export function buildAssistantContext(notes = [], options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10)
  const periodDays = ASSISTANT_PERIODS.includes(Number(options.periodDays))
    ? Number(options.periodDays)
    : 14
  const since = dateDaysAgo(today, periodDays)
  const budget = Math.max(1_000, Number(options.characterBudget) || DEFAULT_ASSISTANT_BUDGET)
  const openTasks = []
  const tracking = []
  const completedTasks = []
  const logs = []

  for (const note of notes) {
    const inPeriod = note.kind === 'journal' && note.date >= since && note.date <= today
    for (const block of note.blocks || []) {
      if (!block.content?.trim() || (block.type === 'heading' && block.level === 1)) continue
      if (block.type === 'task' && !block.checked) {
        const source = sourceFrom(note, block, isTrackingTask(block) ? 'tracking' : 'openTasks')
        if (source.category === 'tracking') tracking.push(source)
        else openTasks.push(source)
      } else if (block.type === 'task' && block.checked && inPeriod) {
        completedTasks.push(sourceFrom(note, block, 'completedTasks'))
      } else if (inPeriod) {
        logs.push(sourceFrom(note, block, 'logs'))
      }
    }
  }

  openTasks.sort(compareRank)
  tracking.sort(compareRank)
  completedTasks.sort((a, b) => (b.date || '').localeCompare(a.date || '') || compareRank(a, b))
  logs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.blockId.localeCompare(b.blockId))

  const ordered = [...openTasks, ...tracking, ...completedTasks, ...logs]
  const included = []
  const sourceMap = {}
  const lines = []
  let usedCharacters = 0
  for (const source of ordered) {
    const sourceId = `S${included.length + 1}`
    const line = sourceLine(sourceId, source)
    if (usedCharacters + line.length + 1 > budget) continue
    const normalized = { ...source, sourceId }
    included.push(normalized)
    sourceMap[sourceId] = normalized
    lines.push(line)
    usedCharacters += line.length + 1
  }

  return {
    periodDays,
    since,
    until: today,
    counts: {
      openTasks: openTasks.length,
      tracking: tracking.length,
      completedTasks: completedTasks.length,
      logs: logs.length,
      included: included.length,
      omitted: ordered.length - included.length,
    },
    sources: included,
    sourceMap,
    prompt: [
      `Periodo de diarios: ${since} a ${today}.`,
      'Las tareas abiertas se incluyen aunque sean anteriores al periodo.',
      `Fuentes incluidas: ${included.length}; omitidas por límite: ${ordered.length - included.length}.`,
      ...lines,
    ].join('\n'),
  }
}
