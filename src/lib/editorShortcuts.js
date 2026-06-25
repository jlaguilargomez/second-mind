const captureShortcuts = {
  '+': { type: 'task', content: '', patch: {} },
  '>': { type: 'heading', content: '', patch: { level: 2 } },
}

export function getCaptureShortcut({ key, value, selectionStart, selectionEnd, hasSuggestion }) {
  if (hasSuggestion || key !== ' ') return null
  if (selectionStart !== selectionEnd || selectionStart !== 1) return null
  const shortcut = captureShortcuts[value]
  return shortcut ? { marker: value, ...shortcut } : null
}
