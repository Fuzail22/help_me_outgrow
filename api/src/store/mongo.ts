import { MongoClient, MongoServerError, type Db } from 'mongodb';
import { DuplicateKeyError, type Collection, type Filter, type FindOptions, type Update } from './types.js';
import { INDEXES, type Collections, type Store } from './schema.js';

function wrap<T extends { _id: string }>(db: Db, name: string): Collection<T> {
  const c = db.collection<any>(name);
  const dup = (e: unknown): never => {
    if (e instanceof MongoServerError && e.code === 11000) throw new DuplicateKeyError(name, JSON.stringify(e.keyPattern ?? {}));
    throw e;
  };
  return {
    insertOne: async (doc) => { await c.insertOne(doc).catch(dup); return doc; },
    insertMany: async (docs) => { if (docs.length) await c.insertMany(docs).catch(dup); },
    findOne: (filter: Filter, opts?: FindOptions) => c.findOne(filter, { sort: opts?.sort }) as Promise<T | null>,
    find: (filter: Filter, opts: FindOptions = {}) => {
      let cur = c.find(filter);
      if (opts.sort) cur = cur.sort(opts.sort);
      if (opts.skip) cur = cur.skip(opts.skip);
      if (opts.limit) cur = cur.limit(opts.limit);
      return cur.toArray() as Promise<T[]>;
    },
    findOneAndUpdate: (filter: Filter, update: Update, opts) =>
      c.findOneAndUpdate(filter, update, { returnDocument: 'after', sort: opts?.sort }).catch(dup) as Promise<T | null>,
    updateOne: async (filter, update, opts) => (await c.updateOne(filter, update, { upsert: opts?.upsert }).catch(dup)).matchedCount,
    updateMany: async (filter, update) => (await c.updateMany(filter, update).catch(dup)).matchedCount,
    deleteMany: async (filter) => (await c.deleteMany(filter)).deletedCount,
    count: (filter) => c.countDocuments(filter),
  };
}

export async function createMongoStore(uri: string): Promise<Store> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  const cols: Record<string, Collection<any>> = {};
  for (const [name, specs] of Object.entries(INDEXES)) {
    cols[name] = wrap(db, name);
    for (const s of specs) {
      await db.collection(name).createIndex(
        Object.fromEntries(s.keys.map((k) => [k, 1])),
        // Only pass options that are set: the driver would send `unique: undefined` as null and the server rejects it.
        { ...(s.unique ? { unique: true } : {}), ...(s.ttlSeconds ? { expireAfterSeconds: s.ttlSeconds } : {}) },
      );
    }
  }
  return { ...(cols as unknown as Collections), close: () => client.close() };
}
