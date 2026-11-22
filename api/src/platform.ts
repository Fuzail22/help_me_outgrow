/**
 * The notification platform, as this app's backend sees it: every call uses the secret key and names the person by
 * our own opaque user id. The platform decides nothing about who may follow what; this app does (limits.ts).
 */
export interface Slot { day: number; time: string }
export interface PlatformAction { id: string; title: string; kind: 'feedback' | 'open' | 'snooze'; value?: 'up' | 'down'; url?: string; minutes?: number }
export interface EndingNotice { withinDays: number; text: string; action?: PlatformAction | null }
export interface PlatformEnrolment {
  id: string; topicId: string; topicTitle?: string; slots: Slot[]; timezone: string; startDate: string; endDate: string;
  position: number; nextSendAt: string | null; status: 'active' | 'paused' | 'completed' | 'cancelled';
  maxItems: number | null; sentCount: number; loop: boolean | null; actions: PlatformAction[] | null; endingNotice: EndingNotice | null;
  externalRef: string | null; itemsAvailable: number;
}
export interface PlatformTopic {
  _id: string; slug: string; title: string; description: string; visibility: 'public' | 'private'; repeat: boolean;
  itemCount: number; status: 'active' | 'archived'; sensitive: boolean; retiredAt?: string | null; actions?: PlatformAction[] | null;
}
export interface PlatformLine { id: string; seq: number; number: number; body: string; attribution: string | null; imageUrl: string | null; state: 'live' | 'draft'; actions: PlatformAction[] | null }
export interface PlatformPolicy { maxPerDay: number; minGapMinutes: number; maxDurationDays: number; browserEnrolments: boolean }
export interface Summary { delivered: number; opened: number; rated: number; ratedUp: number; ratedDown: number; lastRatedAt: string | null; byTopic: Record<string, { delivered: number; opened: number; rated: number }> }
export interface DeliveryView { id: string; scheduledFor: string; topic: { title: string; slug: string; sensitive: boolean }; body: string; attribution: string | null }

export interface EnrolmentInput { topicId: string; slots: Slot[]; timezone: string; startDate?: string; endDate: string; maxItems?: number | null; loop?: boolean | null; actions?: PlatformAction[] | null; endingNotice?: EndingNotice | null; externalRef?: string | null }
export type EnrolmentPatch = Partial<Omit<EnrolmentInput, 'topicId' | 'timezone' | 'startDate'>> & { action?: 'pause' | 'resume' | 'cancel'; reason?: string };

export interface Platform {
  token(externalId: string): Promise<{ token: string; expiresIn: number }>;
  policy(): Promise<{ policy: PlatformPolicy; titleTemplate: string }>;
  topics(): Promise<PlatformTopic[]>;
  enrolments(externalId: string): Promise<PlatformEnrolment[]>;
  createEnrolment(externalId: string, body: EnrolmentInput): Promise<PlatformEnrolment>;
  patchEnrolment(externalId: string, id: string, body: EnrolmentPatch): Promise<PlatformEnrolment>;
  summary(externalId: string): Promise<Summary>;
  delivery(externalId: string, deliveryId: string): Promise<DeliveryView>;
  createTopic(body: { slug: string; title: string; description?: string; sensitive?: boolean; repeat?: boolean; visibility?: 'public' | 'private'; actions?: PlatformAction[] | null }): Promise<PlatformTopic>;
  patchTopic(id: string, body: Record<string, unknown>): Promise<PlatformTopic>;
  lines(topicId: string): Promise<PlatformLine[]>;
  appendLines(topicId: string, lines: { body: string; attribution?: string | null; imageUrl?: string | null }[]): Promise<{ created: PlatformLine[]; skip: { row: number; body: string; reason: string }[] }>;
  editLine(topicId: string, lineId: string, body: { body?: string; attribution?: string | null; imageUrl?: string | null }): Promise<PlatformLine>;
}

/** An error the platform answered with; status and code pass through to our own API. */
export class PlatformError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

export function createPlatform(opts: { url: string; secretKey: string; fetch?: typeof fetch }): Platform {
  const base = opts.url.replace(/\/$/, '');
  const f = opts.fetch ?? fetch;
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await f(base + path, {
      method, headers: { authorization: `Bearer ${opts.secretKey}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await r.json().catch(() => ({}))) as any;
    if (!r.ok) throw new PlatformError(r.status, data?.error?.code ?? 'platform_error', data?.error?.message ?? `Platform answered ${r.status}`, data?.error?.details);
    return data as T;
  };
  const acct = (x: string) => `/v1/accounts/${encodeURIComponent(x)}`;
  return {
    token: (externalId) => call('POST', '/v1/subscriber-tokens', { externalId }),
    policy: () => call('GET', '/v1/policy'),
    topics: async () => (await call<{ topics: PlatformTopic[] }>('GET', '/v1/topics')).topics,
    enrolments: async (x) => (await call<{ enrolments: PlatformEnrolment[] }>('GET', `${acct(x)}/enrolments`)).enrolments,
    createEnrolment: (x, body) => call('POST', `${acct(x)}/enrolments`, body),
    patchEnrolment: (x, id, body) => call('PATCH', `${acct(x)}/enrolments/${encodeURIComponent(id)}`, body),
    summary: (x) => call('GET', `${acct(x)}/summary`),
    async delivery(x, deliveryId) {
      // Read with the person's own (short-lived) subscriber token: the platform checks the delivery is theirs.
      const { token } = await call<{ token: string }>('POST', '/v1/subscriber-tokens', { externalId: x });
      const r = await f(`${base}/v1/deliveries/${encodeURIComponent(deliveryId)}`, { headers: { authorization: `Bearer ${token}` } });
      const data = (await r.json().catch(() => ({}))) as any;
      if (!r.ok) throw new PlatformError(r.status, data?.error?.code ?? 'platform_error', data?.error?.message ?? 'Delivery not found');
      return data;
    },
    createTopic: (body) => call('POST', '/v1/topics', body),
    patchTopic: (id, body) => call('PATCH', `/v1/topics/${encodeURIComponent(id)}`, body),
    lines: async (topicId) => (await call<{ items: PlatformLine[] }>('GET', `/v1/topics/${encodeURIComponent(topicId)}/items`)).items,
    appendLines: (topicId, lines) => call('POST', `/v1/topics/${encodeURIComponent(topicId)}/items`, { lines }),
    editLine: (topicId, lineId, body) => call('PATCH', `/v1/topics/${encodeURIComponent(topicId)}/items/${encodeURIComponent(lineId)}`, body),
  };
}
