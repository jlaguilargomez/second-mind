export function titleFromMarkdown(markdown, fallback = 'Sin título') {
  const heading = markdown.match(/^#\s+(.+)$/m)
  return heading?.[1]?.trim() || fallback
}

export function extractContexts(markdown = '') {
  const wikiLinks = [...markdown.matchAll(/\[\[([^\]\n]+)\]\]/g)].map((match) => match[1].trim())
  const tags = [...markdown.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)].map((match) => match[1].trim())
  return [...new Set([...wikiLinks, ...tags].filter(Boolean))]
}

export function excerpt(markdown = '', max = 120) {
  const clean = markdown
    .replace(/^---[\s\S]*?---/m, '')
    .replace(/^#+\s+/gm, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/[*_>`#-]/g, '')
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

export function dailyTemplate(date) {
  return `---
date: ${date}
type: journal
---

# ${date}

- `
}

export function contextTemplate(name) {
  return `---
type: context
name: ${name}
---

# ${name}

`
}
