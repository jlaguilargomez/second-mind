const captureShortcuts = {
  '+': { type: 'task', content: '', patch: {} },
  '-': { type: 'log', content: '', patch: {} },
}

export const blockActionShortcutLabels = {
  menu: 'Ctrl/Cmd + .',
  reminder: 'Ctrl/Cmd + ;',
  priority: 'Ctrl/Cmd + Shift + P',
  remove: 'Ctrl/Cmd + Shift + Retroceso',
}

export function getCaptureShortcut({ key, value, selectionStart, selectionEnd, hasSuggestion }) {
  if (hasSuggestion || key !== ' ') return null
  if (selectionStart !== selectionEnd || selectionStart !== 1) return null
  const shortcut = captureShortcuts[value]
  return shortcut ? { marker: value, ...shortcut } : null
}

export function getBlockActionShortcut({
  key,
  code,
  ctrlKey = false,
  metaKey = false,
  shiftKey = false,
  altKey = false,
  blockType,
}) {
  if ((!ctrlKey && !metaKey) || altKey) return null

  if (!shiftKey && (key === '.' || code === 'Period')) return 'toggle-menu'
  if (blockType === 'task' && (key === ';' || code === 'Semicolon')) return 'edit-reminder'
  if (
    blockType === 'task'
    && shiftKey
    && (key.toLocaleLowerCase() === 'p' || code === 'KeyP')
  ) return 'cycle-priority'
  if (shiftKey && ['Backspace', 'Delete'].includes(key)) return 'remove-block'

  return null
}
