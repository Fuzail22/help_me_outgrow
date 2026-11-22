import { describe, expect, it } from 'vitest';
import { MongoClient } from 'mongodb';
import { createMongoStore } from '../src/store/mongo.js';
import { makeCtx } from './helpers.js';
import { normaliseUser, signInUser } from '../src/users.js';

/**
 * Upgrading a real 0.5 database (set MONGO_TEST_URI to run): users without referral codes and the old unique googleId
 * index. The first 0.6 deploy crashed here (E11000 on referralCode_1, dup key null).
 */
const uri = process.env.MONGO_TEST_URI;
describe.skipIf(!uri)('MongoDB: upgrade from 0.5 data', () => {
  it('starts on 0.5 users, keeps them signing in, and lets any number of new accounts be created', async () => {
    const dbName = `hmo_upgrade_${Date.now()}`;
    const client = new MongoClient(`${uri!.replace(/\/$/, '')}/${dbName}`); await client.connect();
    const users = client.db().collection<any>('users');
    await users.createIndex({ googleId: 1 }, { unique: true });
    await users.insertMany([
      { _id: 'u_a', id: 'u_a', googleId: 'g-a', email: 'a@example.test', name: 'A', createdAt: '2026-10-01T00:00:00.000Z' },
      { _id: 'u_b', id: 'u_b', googleId: 'g-b', email: 'b@example.test', name: 'B', createdAt: '2026-10-02T00:00:00.000Z' },
    ]);
    const store = await createMongoStore(`${uri!.replace(/\/$/, '')}/${dbName}`);   // crashed before the fix
    const store2 = await createMongoStore(`${uri!.replace(/\/$/, '')}/${dbName}`);  // and starts again cleanly
    await store2.close();
    const { ctx } = makeCtx();
    ctx.store = store;
    const a = await normaliseUser(ctx, (await store.users.findOne({ _id: 'u_a' }))!);
    expect(a.referralCode).toMatch(/^[a-z2-9]{8}$/);
    const again = await signInUser(ctx, { provider: 'google', sub: 'g-b', email: 'b@example.test', name: 'B' });
    expect(again).toMatchObject({ created: false, user: { _id: 'u_b', providers: { google: 'g-b' } } });
    for (const n of [1, 2, 3]) expect((await signInUser(ctx, { provider: 'zoho', sub: `z-${n}`, email: `z${n}@example.test`, name: `Z${n}` })).created).toBe(true);
    const idx = await users.indexes();
    expect(idx.map((i) => i.name)).not.toContain('googleId_1');
    expect(idx.find((i) => i.name === 'referralCode_1')).toMatchObject({ unique: true, partialFilterExpression: { referralCode: { $type: 'string' } } });
    // Two users can never share a code.
    await expect(users.updateOne({ _id: 'u_b' }, { $set: { referralCode: a.referralCode } })).rejects.toThrow(/E11000/);
    await client.db().dropDatabase(); await client.close(); await store.close();
  }, 60_000);
});
