export function tokenizeRichText(text = '') {
  const parts = text.split(/(\[\[[^\]]+\]\]|@[\p{L}\p{N}_/-]+|#[\p{L}\p{N}_/-]+)/gu)
  return parts.filter(Boolean).map((part) => {
    if (part.startsWith('[[')) return { type: 'context', value: part.slice(2, -2), raw: part }
    if (part.startsWith('@')) return { type: 'context', value: part.slice(1), raw: part }
    if (part.startsWith('#')) return { type: 'tag', value: part.slice(1), raw: part }
    return { type: 'text', value: part, raw: part }
  })
}
