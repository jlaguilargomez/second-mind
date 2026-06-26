import { createBlock, createId, normalizeNote } from './markdown.js'

export const WORKSPACE_SETTINGS_KEY = 'workspace-settings'

function normalizeTemplateName(name, fallback = 'Plantilla diaria') {
  return String(name || '').trim().slice(0, 60) || fallback
}

export function createDefaultWorkspaceSettings() {
  return {
    dailyTemplates: [],
    activeDailyTemplateId: null,
    theme: 'dark',
  }
}

export function hasMeaningfulTemplateBlocks(blocks = []) {
  return blocks.some((block) => {
    if ((block.content || '').trim()) return true
    if (block.type === 'task') return true
    if (block.reminder) return true
    return block.type === 'heading' && Number(block.level) > 1
  })
}

function normalizeTemplateBlocks(blocks = []) {
  const templateNote = normalizeNote({
    id: createId(),
    kind: 'journal',
    filename: 'plantilla.md',
    title: 'Plantilla diaria',
    blocks: [
      { ...createBlock('heading', 'Plantilla diaria'), level: 1 },
      ...(Array.isArray(blocks) && blocks.length ? blocks : [createBlock('log', '')]),
    ],
  })
  const normalizedBlocks = templateNote.blocks.slice(1)
  return hasMeaningfulTemplateBlocks(normalizedBlocks) ? normalizedBlocks : []
}

export function normalizeDailyTemplate(template = {}, index = 0) {
  return {
    id: template.id || createId(),
    name: normalizeTemplateName(template.name),
    blocks: normalizeTemplateBlocks(template.blocks),
    isDefault: Boolean(template.isDefault ?? index === 0),
    order: Number.isFinite(template.order) ? Number(template.order) : index,
  }
}

export function normalizeWorkspaceSettings(settings = {}) {
  const rawTemplates = Array.isArray(settings.dailyTemplates) ? settings.dailyTemplates : []
  const dailyTemplates = rawTemplates.map((template, index) => normalizeDailyTemplate(template, index))
  const activeDailyTemplateId = dailyTemplates.find((template) => template.id === settings.activeDailyTemplateId)?.id
    || dailyTemplates.find((template) => template.isDefault)?.id
    || dailyTemplates[0]?.id
    || null
  const theme = settings.theme === 'light' ? 'light' : 'dark'

  return {
    dailyTemplates: dailyTemplates.map((template) => ({
      ...template,
      isDefault: template.id === activeDailyTemplateId,
    })),
    activeDailyTemplateId,
    theme,
  }
}

export function resolveActiveDailyTemplate(settings = {}) {
  const normalized = normalizeWorkspaceSettings(settings)
  return normalized.dailyTemplates.find((template) => template.id === normalized.activeDailyTemplateId) || null
}

export function createJournalNote(date) {
  return normalizeNote({
    id: createId(),
    kind: 'journal',
    filename: `${date}.md`,
    date,
    title: date,
    blocks: [
      { ...createBlock('heading', date), level: 1 },
      createBlock('log', ''),
    ],
  })
}

export function isBaseJournal(note) {
  if (!note || note.kind !== 'journal') return false
  if (note.blocks.length !== 2) return false
  const [title, body] = note.blocks
  return title.type === 'heading'
    && title.level === 1
    && body.type === 'log'
    && !body.content.trim()
}

export function createTemplateEditorNote(template = null) {
  const baseTemplate = normalizeDailyTemplate(template || {
    name: 'Plantilla diaria',
    blocks: [],
  })
  return normalizeNote({
    id: baseTemplate.id,
    kind: 'journal',
    filename: 'plantilla-diaria.md',
    title: baseTemplate.name,
    blocks: [
      { ...createBlock('heading', 'Plantilla diaria'), level: 1 },
      ...(baseTemplate.blocks.length ? baseTemplate.blocks : [createBlock('log', '')]),
    ],
  })
}

export function extractTemplateBlocksFromNote(note) {
  const templateBlocks = (note?.blocks || []).slice(1)
  return hasMeaningfulTemplateBlocks(templateBlocks) ? templateBlocks : []
}

export function cloneTemplateBlocks(blocks = []) {
  const idMap = new Map(blocks.map((block) => [block.id, createId()]))
  const now = new Date().toISOString()
  return blocks.map((block) => ({
    ...block,
    id: idMap.get(block.id) || createId(),
    parentId: block.parentId ? idMap.get(block.parentId) || null : null,
    ancestorIds: (block.ancestorIds || []).map((id) => idMap.get(id)).filter(Boolean),
    createdAt: now,
    updatedAt: now,
  }))
}
