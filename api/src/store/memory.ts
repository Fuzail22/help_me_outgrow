import { Query } from 'mingo';
import { update as applyUpdate } from 'mingo/updater';
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { DuplicateKeyError, type Collection, type Filter, type FindOptions, type IndexSpec, type Update } from './types.js';
import { INDEXES, type Collections, type Store } from './schema.js';

const clone = <T>(v: T): T => structuredClone(v);
const keyPart = (v: unknown) => (v instanceof Date ? `d:${v.getTime()}` : JSON.stringify(v));

class MemoryCollection<T extends { _id: string }> implements Collection<T> {
  docs = new Map<string, T>();
  constructor(private name: string, private indexes: IndexSpec[], private onWrite: () => void) {}

  private checkUnique(doc: T, ignoreId?: string) {
    const all = [{ keys: ['_id'], unique: true }, ...this.indexes];
    for (const ix of all) {
      if (!ix.unique) continue;
      if ((ix as IndexSpec).uniqueWhenString && typeof (doc as any)[ix.keys[0]] !== 'string') continue;
      const k = ix.keys.map((f) => keyPart((doc as any)[f])).join('|');
      for (const other of this.docs.values()) {
        if (other._id === ignoreId) continue;
        if (ix.keys.map((f) => keyPart((other as any)[f])).join('|') === k) {
          throw new DuplicateKeyError(this.name, ix.keys.join(','));
        }
      }
    }
  }
  private match(filter: Filter, opts: FindOptions = {}): T[] {
    const q = new Query(filter as any);
    let out = [...this.docs.values()].filter((d) => q.test(d as any));
    if (opts.sort) {
      const entries = Object.entries(opts.sort);
      out.sort((a: any, b: any) => {
        for (const [f, dir] of entries) {
          const x = a[f] instanceof Date ? a[f].getTime() : a[f];
          const y = b[f] instanceof Date ? b[f].getTime() : b[f];
          if (x < y) return -dir;
          if (x > y) return dir;
        }
        return 0;
      });
    }
    if (opts.skip) out = out.slice(opts.skip);
    if (opts.limit) out = out.slice(0, opts.limit);
    return out;
  }
  private mutate(doc: T, update: Update): T {
    const next = clone(doc);
    applyUpdate(next as any, update as any);
    this.checkUnique(next, doc._id);
    this.docs.set(doc._id, next);
    return next;
  }

  async insertOne(doc: T) { this.checkUnique(doc); this.docs.set(doc._id, clone(doc)); this.onWrite(); return doc; }
  async insertMany(docs: T[]) { for (const d of docs) { this.checkUnique(d); this.docs.set(d._id, clone(d)); } this.onWrite(); }
  async findOne(filter: Filter, opts?: FindOptions) { const [d] = this.match(filter, { ...opts, limit: 1 }); return d ? clone(d) : null; }
  async find(filter: Filter, opts?: FindOptions) { return this.match(filter, opts).map(clone); }
  async findOneAndUpdate(filter: Filter, update: Update, opts?: { sort?: FindOptions['sort'] }) {
    // No await between match and write: atomic within the single-threaded event loop.
    const [d] = this.match(filter, { sort: opts?.sort, limit: 1 });
    if (!d) return null;
    const next = this.mutate(d, update); this.onWrite();
    return clone(next);
  }
  async updateOne(filter: Filter, update: Update, opts?: { upsert?: boolean }) {
    const [d] = this.match(filter, { limit: 1 });
    if (!d) {
      if (!opts?.upsert) return 0;
      throw new Error('upsert is not supported by the memory store; insert explicitly');
    }
    this.mutate(d, update); this.onWrite(); return 1;
  }
  async updateMany(filter: Filter, update: Update) {
    const ds = this.match(filter); for (const d of ds) this.mutate(d, update);
    if (ds.length) this.onWrite(); return ds.length;
  }
  async deleteMany(filter: Filter) {
    const ds = this.match(filter); for (const d of ds) this.docs.delete(d._id);
    if (ds.length) this.onWrite(); return ds.length;
  }
  async count(filter: Filter) { return this.match(filter).length; }
}

const reviveDates = (_k: string, v: unknown) =>
  v && typeof v === 'object' && '$date' in (v as any) ? new Date((v as any).$date) : v;
function serialise(v: unknown): unknown {
  if (v instanceof Date) return { $date: v.toISOString() };
  if (Array.isArray(v)) return v.map(serialise);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, serialise(x)]));
  return v;
}

/**
 * In-memory store for tests and local development. With `file`, state is
 * snapshotted to disk after writes and reloaded on start, which is what the
 * restart tests and the local demo use. It is not meant for production.
 */
export function createMemoryStore(opts: { file?: string } = {}): Store {
  const cols: Record<string, MemoryCollection<any>> = {};
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    timer = null;
    if (!opts.file) return;
    const dump = Object.fromEntries(Object.entries(cols).map(([n, c]) => [n, [...c.docs.values()].map(serialise)]));
    writeFileSync(opts.file + '.tmp', JSON.stringify(dump));
    renameSync(opts.file + '.tmp', opts.file);
  };
  const onWrite = () => { if (opts.file && !timer) timer = setTimeout(flush, 50); };
  for (const name of Object.keys(INDEXES)) cols[name] = new MemoryCollection(name, INDEXES[name as keyof Collections], onWrite);
  if (opts.file && existsSync(opts.file)) {
    const dump = JSON.parse(readFileSync(opts.file, 'utf8'), reviveDates);
    for (const [n, docs] of Object.entries(dump)) for (const d of docs as any[]) cols[n]?.docs.set(d._id, d);
  }
  return { ...(cols as unknown as Collections), close: async () => { if (timer) { clearTimeout(timer); flush(); } } };
}
