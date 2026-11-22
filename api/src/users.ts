import type { Ctx } from './context.js';
import type { Provider, User } from './store/schema.js';
import { newId, referralCode } from './ids.js';
import { DuplicateKeyError } from './store/types.js';

export const publicUser = (u: User) => ({ id: u._id, name: u.name, email: u.email, referralCode: u.referralCode });

/**
 * 0.5 users were `{ _id, id, googleId, email, name, createdAt: string }`. They are brought to the current shape the
 * first time they are read (no migration job): provider ids, device ids, a referral code and a real date.
 */
export async function normaliseUser(ctx: Ctx, u: User & { googleId?: string; id?: string }): Promise<User> {
  if (u.referralCode && u.providers && Array.isArray(u.deviceIds) && u.createdAt instanceof Date) return u;
  const set: Partial<User> = {
    providers: u.providers ?? (u.googleId ? { [u.googleId.startsWith('dev:') ? 'dev' : 'google']: u.googleId } : {}),
    deviceIds: Array.isArray(u.deviceIds) ? u.deviceIds : [],
    createdAt: u.createdAt instanceof Date ? u.createdAt : new Date(u.createdAt as unknown as string),
  };
  for (let i = 0; ; i++) {
    try {
      return (await ctx.store.users.findOneAndUpdate({ _id: u._id }, { $set: { ...set, referralCode: u.referralCode ?? referralCode() } }))!;
    } catch (e) { if (!(e instanceof DuplicateKeyError) || i > 3) throw e; }
  }
}

export interface SignInInput { provider: Provider; sub: string; email: string; name: string; deviceId?: string | null; ref?: string | null }

/**
 * Finds the person by provider id; otherwise by verified email (so Google and Zoho with the same address are one
 * account); otherwise creates them. A new account that arrived through someone's referral link records it.
 */
export async function signInUser(ctx: Ctx, input: SignInInput): Promise<{ user: User; created: boolean }> {
  const email = input.email.toLowerCase();
  const legacy = input.provider === 'google' || input.provider === 'dev' ? [{ googleId: input.sub }] : [];
  let user = await ctx.store.users.findOne({ $or: [{ [`providers.${input.provider}`]: input.sub }, ...legacy] });
  let created = false;
  if (!user) user = await ctx.store.users.findOne({ email });
  if (user) {
    user = await normaliseUser(ctx, user);
    user = (await ctx.store.users.findOneAndUpdate({ _id: user._id }, { $set: { [`providers.${input.provider}`]: input.sub, email, name: input.name } }))!;
  } else {
    const found = input.ref ? await ctx.store.users.findOne({ referralCode: input.ref }) : null;
    // Signing up again on a device the referrer uses is not a referral.
    const owner = found && !(input.deviceId && (found.deviceIds ?? []).includes(input.deviceId)) ? found : null;
    for (let i = 0; !user; i++) {
      const doc: User = {
        _id: newId('u_'), email, name: input.name, createdAt: ctx.now(), providers: { [input.provider]: input.sub }, deviceIds: [],
        referralCode: referralCode(),
        referredBy: owner ? { code: owner.referralCode, userId: owner._id, deviceId: input.deviceId ?? null, at: ctx.now() } : null,
      };
      try { user = await ctx.store.users.insertOne(doc); created = true; } catch (e) {
        if (!(e instanceof DuplicateKeyError) || i > 3) throw e;
        // Two first sign-ins at once: the other one created the account.
        user = await ctx.store.users.findOne({ [`providers.${input.provider}`]: input.sub });
      }
    }
  }
  if (input.deviceId && !user.deviceIds.includes(input.deviceId)) {
    user = (await ctx.store.users.findOneAndUpdate({ _id: user._id }, { $addToSet: { deviceIds: input.deviceId } }))!;
    // A visit to their own link from this device (before they signed in on it) was not someone else's.
    await ctx.store.refVisits.deleteMany({ ownerId: user._id, deviceId: input.deviceId });
  }
  return { user, created };
}

/** Deletes everything this app keeps about the person (the browser erases the platform side first). */
export async function deleteUser(ctx: Ctx, userId: string) {
  const s = ctx.store;
  await Promise.all([
    s.journal.deleteMany({ userId }), s.journalReminders.deleteMany({ _id: userId }), s.levelUnlocks.deleteMany({ userId }),
    s.refProofs.deleteMany({ userId }), s.refVisits.deleteMany({ ownerId: userId }), s.entitlements.deleteMany({ userId }),
  ]);
  // Orders are kept (accounting), with the person removed.
  await s.orders.updateMany({ userId }, { $set: { userId: 'deleted' } });
  await s.users.deleteMany({ _id: userId });
}
