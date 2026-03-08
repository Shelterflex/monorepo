export interface LinkedAddressStore {
  setLinkedAddress(userId: string, address: string): Promise<void>
  getLinkedAddress(userId: string): Promise<string | null>
  clear(): Promise<void>
}

export class InMemoryLinkedAddressStore implements LinkedAddressStore {
  private linked = new Map<string, string>()

  async setLinkedAddress(userId: string, address: string): Promise<void> {
    this.linked.set(userId, address)
  }

  async getLinkedAddress(userId: string): Promise<string | null> {
    return this.linked.get(userId) ?? null
  }

  async clear(): Promise<void> {
    this.linked.clear()
  }
}
