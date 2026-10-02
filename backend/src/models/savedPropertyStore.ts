/**
 * Tenant saved property store — in-memory implementation for dev/tests.
 */

export interface SavedPropertyRecord {
  userId: string;
  listingId: string;
  createdAt: string;
}

export interface ListSavedPropertiesOptions {
  limit?: number;
  offset?: number;
}

export interface SavedPropertyStore {
  save(userId: string, listingId: string): Promise<SavedPropertyRecord>;
  remove(userId: string, listingId: string): Promise<boolean>;
  isSaved(userId: string, listingId: string): Promise<boolean>;
  listListingIds(
    userId: string,
    options?: ListSavedPropertiesOptions,
  ): Promise<string[]>;
  count(userId: string): Promise<number>;
  clear(): Promise<void>;
}

export class InMemorySavedPropertyStore implements SavedPropertyStore {
  private records: SavedPropertyRecord[] = [];

  async save(userId: string, listingId: string): Promise<SavedPropertyRecord> {
    const existing = this.records.find(
      (r) => r.userId === userId && r.listingId === listingId,
    );
    if (existing) {
      return existing;
    }

    const record: SavedPropertyRecord = {
      userId,
      listingId,
      createdAt: new Date().toISOString(),
    };
    this.records.push(record);
    return record;
  }

  async remove(userId: string, listingId: string): Promise<boolean> {
    const before = this.records.length;
    this.records = this.records.filter(
      (r) => !(r.userId === userId && r.listingId === listingId),
    );
    return this.records.length < before;
  }

  async isSaved(userId: string, listingId: string): Promise<boolean> {
    return this.records.some(
      (r) => r.userId === userId && r.listingId === listingId,
    );
  }

  async listListingIds(
    userId: string,
    options?: ListSavedPropertiesOptions,
  ): Promise<string[]> {
    const userRecords = this.records.filter((r) => r.userId === userId);
    const offset = Math.max(0, options?.offset ?? 0);
    if (options?.limit !== undefined) {
      const limit = Math.max(1, options.limit);
      return userRecords.slice(offset, offset + limit).map((r) => r.listingId);
    }
    return userRecords.slice(offset).map((r) => r.listingId);
  }

  async count(userId: string): Promise<number> {
    return this.records.filter((r) => r.userId === userId).length;
  }

  async clear(): Promise<void> {
    this.records = [];
  }
}

let savedPropertyStore: SavedPropertyStore = new InMemorySavedPropertyStore();

export function initSavedPropertyStore(store: SavedPropertyStore): void {
  savedPropertyStore = store;
}

export { savedPropertyStore };
