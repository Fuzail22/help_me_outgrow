// Same storage port as the notification platform (copied, not shared: the two repositories share no code).
/**
 * Storage port. Repositories and jobs are written against MongoDB query and
 * update syntax; in production the calls pass straight through to the MongoDB
 * driver, in tests and local dev they are evaluated in memory by mingo.
 */
export type Filter = Record<string, unknown>;
export type Update = Record<string, unknown>;
export type Sort = Record<string, 1 | -1>;

export interface FindOptions { sort?: Sort; limit?: number; skip?: number }

export interface Collection<T extends { _id: string }> {
  insertOne(doc: T): Promise<T>;
  insertMany(docs: T[]): Promise<void>;
  findOne(filter: Filter, opts?: FindOptions): Promise<T | null>;
  find(filter: Filter, opts?: FindOptions): Promise<T[]>;
  /** Atomic. Returns the document after the update, or null when nothing matched. */
  findOneAndUpdate(filter: Filter, update: Update, opts?: { sort?: Sort }): Promise<T | null>;
  updateOne(filter: Filter, update: Update, opts?: { upsert?: boolean }): Promise<number>;
  updateMany(filter: Filter, update: Update): Promise<number>;
  deleteMany(filter: Filter): Promise<number>;
  count(filter: Filter): Promise<number>;
}

export class DuplicateKeyError extends Error {
  constructor(public collection: string, public index: string) {
    super(`duplicate key in ${collection} on ${index}`);
  }
}

export interface IndexSpec {
  keys: string[]; unique?: boolean; ttlSeconds?: number;
  /** Unique only among documents where the (single) key is a string: older documents without it never collide. */
  uniqueWhenString?: boolean;
}
