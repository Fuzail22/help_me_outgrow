import type { Collection, IndexSpec } from './types.js';

export type Id = string;
export type Provider = 'google' | 'zoho' | 'dev';

/** Someone who signed in. The platform only ever sees `_id` (as the external id). */
export interface User {
  _id: Id; email: string; name: string; createdAt: Date;
  providers: Partial<Record<Provider, string>>;
  /** Random per-browser ids seen while signed in (referral checks: your own device never counts). */
  deviceIds: string[];
  referralCode: string;
  referredBy?: { code: string; userId: Id; deviceId: string | null; at: Date } | null;
}
export type AdminRole = 'owner' | 'editor' | 'support' | 'viewer';
export interface AdminUser { _id: Id; email: string; role: AdminRole; invitedBy: string | null; createdAt: Date; lastSignInAt: Date | null }
export interface AuditEntry { _id: Id; actor: string; action: string; target: string | null; before: unknown; after: unknown; ts: Date }
/** Admin-editable configuration documents: 'growth', 'pricing', 'limits'. */
export interface SettingsDoc { _id: 'growth' | 'pricing' | 'limits'; data: Record<string, unknown>; updatedAt: Date; updatedBy: string }
export interface RefVisit { _id: Id; code: string; ownerId: Id; deviceId: string; ipHash: string; at: Date }
export interface RefProof { _id: Id; userId: Id; note: string; status: 'pending' | 'approved' | 'rejected'; decidedBy: string | null; decidedAt: Date | null; createdAt: Date }
export type VavpId = 'vavp1' | 'vavp2' | 'vavp3';
export interface LevelUnlock { _id: Id; userId: Id; level: number; at: Date; celebrated: boolean; pick: { vavp: VavpId; topicId: string | null; amount: number; at: Date } | null }
export type EntitlementKind = 'slots' | 'items' | 'own_topic';
export interface Entitlement {
  _id: Id; userId: Id; kind: EntitlementKind; topicId: string | null; amount: number;
  source: 'level' | 'purchase' | 'admin'; sourceRef: string; startsAt: Date; expiresAt: Date | null; revokedAt: Date | null;
  meta?: Record<string, unknown>;
}
export interface Order {
  _id: Id; userId: Id; product: string; topicId: string | null; units: number; amountMinor: number; currency: 'INR' | 'USD';
  provider: 'razorpay' | 'stripe' | 'mock'; providerOrderId: string | null; providerPaymentId: string | null;
  status: 'created' | 'paid' | 'failed'; rank: number | null; termMonths: number | null; createdAt: Date; paidAt: Date | null;
  meta?: Record<string, unknown>;
}
export interface Counter { _id: string; count: number }
export interface OwnTopic { _id: Id; userId: Id; platformTopicId: string; title: string; visibility: 'private' | 'public'; status: 'live' | 'review' | 'rejected'; lineCap: number; entitlementId: Id; createdAt: Date }
export interface JournalEntry { _id: Id; userId: Id; ts: Date; updatedAt: Date; iv: string; ct: string; tag: string; hasQuote: boolean; hasMood: boolean }
export interface JournalReminder { _id: Id /* userId */; enrolmentId: string | null; tiedTopicId: string | null; slots: { day: number; time: string }[]; timezone: string; updatedAt: Date }
export interface Waitlist { _id: Id; email: string; country: string; at: Date }
/** G11: a named set of people an admin can show topics to. `nameKey` is the lower-cased name (unique). */
export interface Group { _id: Id; name: string; nameKey: string; description: string; createdAt: Date; createdBy: string; updatedAt: Date }
/** One person in one group. `_id` is `<groupId>:<userId>`, so adding twice is a no-op. */
export interface GroupMember { _id: string; groupId: Id; userId: Id; addedAt: Date; addedBy: string }
/**
 * G11: who may see a curated topic, kept in this app (the platform's `visibility` is not changed). No document means
 * public (everyone). `restricted` means only the listed groups' members and the listed people.
 */
export interface TopicAudience { _id: string /* platform topic id */; mode: 'public' | 'restricted'; groupIds: Id[]; userIds: Id[]; updatedAt: Date; updatedBy: string }

export interface Collections {
  users: Collection<User>; admins: Collection<AdminUser>; audit: Collection<AuditEntry>; settings: Collection<SettingsDoc>;
  refVisits: Collection<RefVisit>; refProofs: Collection<RefProof>; levelUnlocks: Collection<LevelUnlock>;
  entitlements: Collection<Entitlement>; orders: Collection<Order>; counters: Collection<Counter>; ownTopics: Collection<OwnTopic>;
  journal: Collection<JournalEntry>; journalReminders: Collection<JournalReminder>; waitlist: Collection<Waitlist>;
  groups: Collection<Group>; groupMembers: Collection<GroupMember>; topicAudiences: Collection<TopicAudience>;
}
export interface Store extends Collections { close(): Promise<void> }

export const INDEXES: Record<keyof Collections, IndexSpec[]> = {
  // 0.5 users have no referral code until they are next read (users.ts normaliseUser): unique among those that do.
  users: [{ keys: ['email'] }, { keys: ['referralCode'], unique: true, uniqueWhenString: true }, { keys: ['providers.google'] }, { keys: ['providers.zoho'] }, { keys: ['referredBy.userId'] }],
  admins: [{ keys: ['email'], unique: true }],
  audit: [{ keys: ['ts'] }],
  settings: [],
  refVisits: [{ keys: ['code', 'deviceId'], unique: true }, { keys: ['ownerId'] }],
  refProofs: [{ keys: ['status', 'createdAt'] }, { keys: ['userId'] }],
  levelUnlocks: [{ keys: ['userId', 'level'], unique: true }],
  entitlements: [{ keys: ['userId', 'kind'] }],
  orders: [{ keys: ['userId'] }, { keys: ['providerOrderId'] }],
  counters: [],
  ownTopics: [{ keys: ['userId'] }, { keys: ['platformTopicId'], unique: true }],
  journal: [{ keys: ['userId', 'ts'] }],
  journalReminders: [],
  waitlist: [{ keys: ['email'], unique: true }],
  groups: [{ keys: ['nameKey'], unique: true }],
  groupMembers: [{ keys: ['groupId'] }, { keys: ['userId'] }],
  topicAudiences: [{ keys: ['groupIds'] }, { keys: ['userIds'] }],
};

/** [collection, index name] from older versions, dropped at start-up. */
export const LEGACY_INDEXES: [keyof Collections, string][] = [['users', 'googleId_1']];
