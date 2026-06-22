import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('la aplicación no carga recursos de Google Fonts', async () => {
  const [styles, vite] = await Promise.all([
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../vite.config.js', import.meta.url), 'utf8'),
  ])

  assert.doesNotMatch(styles, /fonts\.googleapis|fonts\.gstatic/)
  assert.doesNotMatch(vite, /fonts\.googleapis|fonts\.gstatic/)
})

test('el documento aplica una política de seguridad y no envía referrer', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8')

  assert.match(html, /Content-Security-Policy/)
  assert.match(html, /default-src 'self'/)
  assert.match(html, /object-src 'none'/)
  assert.match(html, /name="referrer" content="no-referrer"/)
})

test('las GitHub Actions están fijadas por SHA', async () => {
  const workflow = await readFile(
    new URL('../.github/workflows/deploy-pages.yml', import.meta.url),
    'utf8',
  )
  const uses = [...workflow.matchAll(/uses:\s+([^\s#]+)/g)].map((match) => match[1])

  assert.ok(uses.length >= 5)
  for (const action of uses) {
    assert.match(action, /@[a-f0-9]{40}$/)
  }
})
