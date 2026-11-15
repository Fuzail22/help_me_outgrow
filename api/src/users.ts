import { MongoClient } from 'mongodb';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** The only personal data this app keeps: who signed in. The notification platform never sees it. */
export interface User { id: string; googleId: string; email: string; name: string; createdAt: string }
export interface UserStore {
  upsertByGoogleId(p: { googleId: string; email: string; name: string }): Promise<User>;
  get(id: string): Promise<User | null>;
  delete(id: string): Promise<void>;
}
const newId = () => 'u_' + randomBytes(12).toString('hex');

/** In memory, optionally mirrored to a JSON file. For local development and tests. */
export function createFileUserStore(file?: string): UserStore {
  const users = new Map<string, User>(file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).map((u: User) => [u.id, u]) : []);
  const save = () => { if (file) writeFileSync(file, JSON.stringify([...users.values()])); };
  return {
    async upsertByGoogleId(p) {
      let u = [...users.values()].find((x) => x.googleId === p.googleId);
      if (u) { u.email = p.email; u.name = p.name; } else { u = { id: newId(), ...p, createdAt: new Date().toISOString() }; users.set(u.id, u); }
      save(); return { ...u };
    },
    async get(id) { const u = users.get(id); return u ? { ...u } : null; },
    async delete(id) { users.delete(id); save(); },
  };
}

export async function createMongoUserStore(uri: string): Promise<UserStore> {
  const client = new MongoClient(uri); await client.connect();
  const col = client.db().collection<User & { _id: string }>('users');
  await col.createIndex({ googleId: 1 }, { unique: true });
  const strip = (d: any): User | null => { if (!d) return null; const { _id, ...u } = d; return u; };
  return {
    async upsertByGoogleId(p) {
      const id = newId();
      const run = () => col.findOneAndUpdate({ googleId: p.googleId },
        { $set: { email: p.email, name: p.name }, $setOnInsert: { _id: id, id, googleId: p.googleId, createdAt: new Date().toISOString() } },
        { upsert: true, returnDocument: 'after' });
      // Two first sign-ins at once can both try to insert; the loser retries and finds the winner's row.
      const d = await run().catch((e) => { if (e?.code === 11000) return run(); throw e; });
      return strip(d)!;
    },
    get: async (id) => strip(await col.findOne({ _id: id })),
    delete: async (id) => { await col.deleteOne({ _id: id }); },
  };
}
