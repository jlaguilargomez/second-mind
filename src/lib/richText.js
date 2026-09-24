export function tokenizeRichText(text = '') {
  const pattern = /(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>]+|www\.[^\s<>]+|\[\[[^\]]+\]\]|@[\p{L}\p{N}_/-]+|#[\p{L}\p{N}_/-]+)/giu
  const tokens = []
  let cursor = 0

  for (const match of text.matchAll(pattern)) {
    const start = match.index
    if (start > cursor) tokens.push({ type: 'text', value: text.slice(cursor, start), raw: text.slice(cursor, start) })

    const raw = match[0]
    const markdownLink = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/i)
    if (markdownLink) {
      tokens.push({ type: 'link', value: markdownLink[1], href: markdownLink[2], raw })
    } else if (/^(https?:\/\/|www\.)/i.test(raw)) {
      const trailing = raw.match(/[.,!?;:]+$/)?.[0] || ''
      const url = trailing ? raw.slice(0, -trailing.length) : raw
      const href = /^www\./i.test(url) ? `https://${url}` : url
      if (url) tokens.push({ type: 'link', value: url, href, raw: url })
      if (trailing) tokens.push({ type: 'text', value: trailing, raw: trailing })
    } else if (raw.startsWith('[[')) {
      tokens.push({ type: 'context', value: raw.slice(2, -2), raw })
    } else if (raw.startsWith('@')) {
      tokens.push({ type: 'context', value: raw.slice(1), raw })
    } else if (raw.startsWith('#')) {
      tokens.push({ type: 'tag', value: raw.slice(1), raw })
    }
    cursor = start + raw.length
  }

  if (cursor < text.length) tokens.push({ type: 'text', value: text.slice(cursor), raw: text.slice(cursor) })
  return tokens
}
