const trackingTags = new Set(['delegado', 'esperando'])

export function isTrackingTask(task) {
  return (task.tags || []).some((tag) => trackingTags.has(tag.toLocaleLowerCase()))
}
