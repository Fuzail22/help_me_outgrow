import request from 'supertest';
import { createApp } from '../src/app.js';
import type { Config, Ctx, Identity } from '../src/context.js';
import { createMemoryStore } from '../src/store/memory.js';
import { PlatformError, type EnrolmentInput, type Platform, type PlatformEnrolment, type PlatformLine, type PlatformTopic, type Summary } from '../src/platform.js';
import { noPayments } from '../src/payments/index.js';

export const ORIGIN = 'https://app.example.test';

/** An in-memory stand-in for the notification platform's secret-key API (just the behaviour this app relies on). */
export class FakePlatform implements Platform {
  topicsList: PlatformTopic[] = [];
  linesBy = new Map<string, PlatformLine[]>();
  enrol = new Map<string, (PlatformEnrolment & { externalId: string })>();
  summaries = new Map<string, Summary>();
  deliveries = new Map<string, { externalId: string; body: string; attribution: string | null; topic: string }>();
  policyValue = { maxPerDay: 24, minGapMinutes: 15, maxDurationDays: 366, browserEnrolments: false };
  tokens: string[] = [];
  calls: { method: string; args: unknown[] }[] = [];
  private n = 0;
  constructor(public now: () => Date) {}
  addTopic(t: Partial<PlatformTopic> & { slug: string }, lines = 92) {
    const topic: PlatformTopic = { _id: `t_${t.slug}`, title: t.slug, description: '', visibility: 'public', repeat: false, itemCount: lines, status: 'active', sensitive: false, retiredAt: null, ...t };
    this.topicsList.push(topic);
    this.linesBy.set(topic._id, Array.from({ length: lines }, (_, i) => ({ id: `${topic._id}_l${i}`, seq: i, number: i + 1, body: `${topic.slug} line ${i + 1}`, attribution: null, imageUrl: null, state: 'live', actions: null })));
    return topic;
  }
  async token(externalId: string) { this.tokens.push(externalId); return { token: 'platform.jwt.token', expiresIn: 3600 }; }
  async policy() { return { policy: this.policyValue, titleTemplate: '{topic}' }; }
  async topics() { return this.topicsList.map((t) => ({ ...t })); }
  async enrolments(x: string) { return [...this.enrol.values()].filter((e) => e.externalId === x).map(({ externalId: _x, ...e }) => e); }
  async createEnrolment(x: string, b: EnrolmentInput) {
    this.calls.push({ method: 'createEnrolment', args: [x, b] });
    const topic = this.topicsList.find((t) => t._id === b.topicId);
    if (!topic) throw new PlatformError(404, 'not_found', 'Topic not found');
    if ([...this.enrol.values()].some((e) => e.externalId === x && e.topicId === b.topicId && ['active', 'paused'].includes(e.status))) throw new PlatformError(409, 'already_enrolled', 'Already enrolled');
    const e = { externalId: x, id: `e${++this.n}`, topicId: b.topicId, topicTitle: topic.title, slots: b.slots, timezone: b.timezone, startDate: b.startDate ?? this.now().toISOString().slice(0, 10), endDate: b.endDate,
      position: 0, nextSendAt: null, status: 'active' as const, maxItems: b.maxItems ?? null, sentCount: 0, loop: b.loop ?? null, actions: b.actions ?? null, endingNotice: b.endingNotice ?? null, externalRef: b.externalRef ?? null, itemsAvailable: topic.itemCount };
    this.enrol.set(e.id, e);
    const { externalId: _x, ...view } = e; return view;
  }
  async patchEnrolment(x: string, id: string, b: any) {
    this.calls.push({ method: 'patchEnrolment', args: [x, id, b] });
    const e = this.enrol.get(id);
    if (!e || e.externalId !== x) throw new PlatformError(404, 'not_found', 'Enrolment not found');
    const { action, reason: _r, ...rest } = b;
    Object.assign(e, rest);
    if (action) e.status = ({ pause: 'paused', resume: 'active', cancel: 'cancelled' } as const)[action as 'pause'];
    const { externalId: _x, ...view } = e; return view;
  }
  async summary(x: string) { return this.summaries.get(x) ?? { delivered: 0, opened: 0, rated: 0, ratedUp: 0, ratedDown: 0, lastRatedAt: null, byTopic: {} }; }
  async delivery(x: string, id: string) {
    const d = this.deliveries.get(id);
    if (!d || d.externalId !== x) throw new PlatformError(404, 'not_found', 'Delivery not found');
    return { id, scheduledFor: this.now().toISOString(), topic: { title: d.topic, slug: d.topic, sensitive: false }, body: d.body, attribution: d.attribution };
  }
  async createTopic(b: any) {
    this.calls.push({ method: 'createTopic', args: [b] });
    if (this.topicsList.some((t) => t.slug === b.slug)) throw new PlatformError(409, 'topic_exists', 'exists');
    return this.addTopic({ ...b, visibility: b.visibility ?? 'public' }, 0);
  }
  async patchTopic(id: string, b: any) {
    this.calls.push({ method: 'patchTopic', args: [id, b] });
    const t = this.topicsList.find((x) => x._id === id);
    if (!t) throw new PlatformError(404, 'not_found', 'Topic not found');
    const { retired, ...rest } = b; Object.assign(t, rest);
    if (retired !== undefined) t.retiredAt = retired ? this.now().toISOString() : null;
    return { ...t };
  }
  async lines(topicId: string) { const l = this.linesBy.get(topicId); if (!l) throw new PlatformError(404, 'not_found', 'Topic not found'); return l.map((x) => ({ ...x })); }
  async appendLines(topicId: string, lines: { body: string; attribution?: string | null; imageUrl?: string | null; clickUrl?: string | null }[]) {
    this.calls.push({ method: 'appendLines', args: [topicId, lines] });
    const l = this.linesBy.get(topicId)!; const t = this.topicsList.find((x) => x._id === topicId)!;
    const created = lines.map((x) => { const seq = l.length; const line = { id: `${topicId}_l${seq}`, seq, number: seq + 1, body: x.body, attribution: x.attribution ?? null, imageUrl: x.imageUrl ?? null, clickUrl: x.clickUrl ?? null, state: 'live' as const, actions: null }; l.push(line); return line; });
    t.itemCount = l.length;
    return { created, skip: [] };
  }
  async editLine(topicId: string, lineId: string, b: any) {
    const line = this.linesBy.get(topicId)?.find((x) => x.id === lineId);
    if (!line) throw new PlatformError(404, 'not_found', 'Line not found');
    Object.assign(line, b); return { ...line };
  }
}

export function makeCtx(over: Partial<Config> = {}, start = '2026-11-20T06:00:00Z') {
  let current = new Date(start);
  const clock = { now: () => new Date(current), set: (iso: string) => { current = new Date(iso); }, advanceDays: (d: number) => { current = new Date(current.getTime() + d * 86400000); } };
  const platform = new FakePlatform(clock.now);
  const identities = new Map<string, Identity>([['valid-google-credential-token', { sub: 'g-123', email: 'asha@example.test', name: 'Asha', emailVerified: true }]]);
  const logs: Record<string, unknown>[] = [];
  const ctx: Ctx = {
    store: createMemoryStore(), platform, payments: noPayments, now: clock.now, log: (l) => logs.push(l),
    config: {
      sessionSecret: 's'.repeat(40), appOrigin: ORIGIN, devLogin: true, secureCookies: true, adminOwnerEmail: 'owner@example.test',
      journalKey: 'ab'.repeat(32), publicUrl: 'https://api.example.test', supportEmail: 'support@htsta.com',
      zoho: { clientId: 'zoho-client', clientSecret: 'zoho-secret', accountsUrl: 'https://accounts.zoho.in' }, googleClientId: 'google-client', ...over,
    },
    async verifyGoogle(c) { const id = identities.get(c); if (!id) throw new Error('bad'); return id; },
    async zohoSignIn() { throw new Error('not stubbed'); },
  };
  return { ctx, platform, clock, identities, logs };
}

export async function setup(over: Partial<Config> = {}, start?: string) {
  const m = makeCtx(over, start);
  const app = createApp(m.ctx);
  /** Signs a person in with the dev login; returns their cookie and id. */
  const signIn = async (name = 'Asha', extra: object = {}) => {
    const r = await request(app).post('/auth/dev').set('origin', ORIGIN).send({ name, ...extra }).expect(200);
    const cookie = String(r.headers['set-cookie']).split(';')[0];
    return { cookie, id: r.body.user.id as string, user: r.body.user, created: r.body.created as boolean };
  };
  const as = (cookie: string) => ({
    get: (p: string) => request(app).get(p).set('cookie', cookie),
    post: (p: string, b: object = {}) => request(app).post(p).set('cookie', cookie).set('origin', ORIGIN).send(b),
    patch: (p: string, b: object) => request(app).patch(p).set('cookie', cookie).set('origin', ORIGIN).send(b),
    put: (p: string, b: object) => request(app).put(p).set('cookie', cookie).set('origin', ORIGIN).send(b),
    del: (p: string) => request(app).delete(p).set('cookie', cookie).set('origin', ORIGIN),
  });
  return { ...m, app, signIn, as };
}
export const ALL_DAYS = (time: string) => [1, 2, 3, 4, 5, 6, 7].map((day) => ({ day, time }));
