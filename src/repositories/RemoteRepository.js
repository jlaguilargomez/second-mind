import { NotesRepository } from './NotesRepository'

export class RemoteRepository extends NotesRepository {
  constructor({ baseUrl, fetcher = fetch, tokenProvider = () => null }) {
    super()
    this.baseUrl = baseUrl
    this.fetcher = fetcher
    this.tokenProvider = tokenProvider
  }

  async request(path, options = {}) {
    const token = await this.tokenProvider()
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    })
    if (!response.ok) throw new Error(`RemoteRepository: ${response.status}`)
    return response.status === 204 ? null : response.json()
  }

  listNotes(cursor = '') {
    return this.request(`/v1/notes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
  }

  getNote(id) {
    return this.request(`/v1/notes/${id}`)
  }

  saveNote(note, options = {}) {
    return this.request(`/v1/notes/${note.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...note, expectedVersion: options.expectedVersion }),
    })
  }

  deleteNote(id) {
    return this.request(`/v1/notes/${id}`, { method: 'DELETE' })
  }

  sync(operations) {
    return this.request('/v1/sync', {
      method: 'POST',
      body: JSON.stringify({ operations }),
    })
  }

  listReminders() {
    return this.request('/v1/reminders')
  }

  registerDevice(subscription) {
    return this.request('/v1/devices', {
      method: 'POST',
      body: JSON.stringify(subscription),
    })
  }
}
