export class NotesRepository {
  async initialize() {}
  async listNotes() {
    throw new Error('listNotes() no implementado')
  }
  async getNote() {
    throw new Error('getNote() no implementado')
  }
  async saveNote() {
    throw new Error('saveNote() no implementado')
  }
  async deleteNote() {
    throw new Error('deleteNote() no implementado')
  }
  async listOperations() {
    return []
  }
  async acknowledgeOperations() {}
}
