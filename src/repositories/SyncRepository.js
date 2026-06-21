export class SyncRepository {
  constructor({ local, remote }) {
    this.local = local
    this.remote = remote
  }

  async sync() {
    const operations = await this.local.listOperations()
    if (!operations.length) return { synced: 0, conflicts: [] }
    const result = await this.remote.sync(operations)
    const conflicts = result.conflicts || []
    const accepted = operations
      .filter((operation) => !conflicts.some((conflict) => conflict.operationId === operation.operationId))
      .map((operation) => operation.operationId)
    await this.local.acknowledgeOperations(accepted)
    return { synced: accepted.length, conflicts }
  }
}
