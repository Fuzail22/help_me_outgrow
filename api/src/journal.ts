import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Ctx } from './context.js';
import { HttpError } from './http.js';
import { newId } from './ids.js';
import { JOURNAL_TOPIC_SLUG, addDays, todayIn } from './limits.js';
import type { JournalEntry, User } from './store/schema.js';
import type { PlatformAction, PlatformTopic } from './platform.js';

/**
 * Journal entries are encrypted at rest with AES-256-GCM under a key derived per person (HKDF of JOURNAL_KEY and the
 * user id). Only the timestamps and two flags (has a quote, has a mood) are stored in the clear: that is all the admin
 * statistics use. Plain text exists only in the person's own requests.
 */
export interface EntryContent { text: string; mood: number | null; quote: { body: string; attribution: string | null; topic: string; deliveryId: string } | null; prompt: string | null }

const keyFor = (ctx: Ctx, userId: string) => Buffer.from(hkdfSync('sha256', Buffer.from(ctx.config.journalKey, 'hex'), Buffer.from('hmo-journal-v1'), Buffer.from(userId), 32));

export function seal(ctx: Ctx, userId: string, c: EntryContent) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(ctx, userId), iv);
  cipher.setAAD(Buffer.from(userId));
  const ct = Buffer.concat([cipher.update(JSON.stringify(c), 'utf8'), cipher.final()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export function open(ctx: Ctx, e: JournalEntry): EntryContent {
  const d = createDecipheriv('aes-256-gcm', keyFor(ctx, e.userId), Buffer.from(e.iv, 'base64'));
  d.setAAD(Buffer.from(e.userId));
  d.setAuthTag(Buffer.from(e.tag, 'base64'));
  return JSON.parse(Buffer.concat([d.update(Buffer.from(e.ct, 'base64')), d.final()]).toString('utf8'));
}

export const view = (ctx: Ctx, e: JournalEntry) => ({ id: e._id, ts: e.ts, updatedAt: e.updatedAt, ...open(ctx, e) });

export async function addEntry(ctx: Ctx, user: User, input: { text: string; mood?: number | null; deliveryId?: string | null; prompt?: string | null }) {
  let quote: EntryContent['quote'] = null; let prompt = input.prompt ?? null;
  if (input.deliveryId) {
    // The platform checks the delivery is this person's; we keep a copy of the words inside the encrypted entry.
    const d = await ctx.platform.delivery(user._id, input.deliveryId).catch(() => { throw new HttpError(404, 'not_found', 'That note was not found'); });
    // A journal reminder's text is a prompt; anything else is a quote the person is writing about.
    if (d.topic.slug === JOURNAL_TOPIC_SLUG) prompt = d.body;
    else quote = { body: d.body, attribution: d.attribution, topic: d.topic.title, deliveryId: d.id };
  }
  const content: EntryContent = { text: input.text, mood: input.mood ?? null, quote, prompt };
  const now = ctx.now();
  const e: JournalEntry = { _id: newId('j_'), userId: user._id, ts: now, updatedAt: now, ...seal(ctx, user._id, content), hasQuote: !!quote, hasMood: content.mood !== null };
  await ctx.store.journal.insertOne(e);
  return view(ctx, e);
}

export function toMarkdown(entries: ReturnType<typeof view>[]) {
  const MOODS = ['', 'very low', 'low', 'okay', 'good', 'very good'];
  return ['# My journal — help me outgrow', '', ...entries.flatMap((e) => [
    `## ${new Date(e.ts).toISOString().slice(0, 16).replace('T', ' ')} UTC${e.mood ? ` · feeling ${MOODS[e.mood]}` : ''}`, '',
    ...(e.quote ? [`> ${e.quote.body}${e.quote.attribution ? ` — ${e.quote.attribution}` : ''}`, `> (${e.quote.topic})`, ''] : []),
    ...(e.prompt ? [`*${e.prompt}*`, ''] : []), e.text, '',
  ])].join('\n');
}

// ---- reminders through the platform

export const PROMPTS = [
  'What is one thing that felt a little lighter today?', 'What is taking most of your energy right now?', 'Name one small thing you did for yourself today.',
  'What would you tell a friend in your place?', 'What are you carrying that is not yours to carry?', 'What helped, even a little, this week?',
  'Where did you notice your breath today?', 'What are you looking forward to, however small?', 'What did you learn about yourself recently?',
  'What is one worry you can set down for tonight?', 'Who made today a bit easier?', 'What does rest look like for you right now?',
  'What would make tomorrow five percent kinder?', 'What feeling visited most today?', 'What are you proud of that nobody saw?',
  'What do you need more of, and less of?', 'What is one thing you can forgive yourself for?', 'Describe a moment today you would like to remember.',
  'What is a boundary you kept, or want to keep?', 'How have you grown since the hardest day?',
];
export const writeAction = (ctx: Ctx): PlatformAction => ({ id: 'write', title: 'Write now', kind: 'open', url: `${ctx.config.appOrigin}/journal/new?d={deliveryId}` });

/** The shared, private reminder topic (one for the whole app; each person who wants reminders gets an enrolment on it). */
export async function journalTopic(ctx: Ctx): Promise<PlatformTopic> {
  const found = (await ctx.platform.topics()).find((t) => t.slug === JOURNAL_TOPIC_SLUG);
  if (found) return found;
  const t = await ctx.platform.createTopic({
    slug: JOURNAL_TOPIC_SLUG, title: 'Journal', description: 'Gentle prompts to write a few lines.', visibility: 'private', repeat: true, sensitive: false,
    actions: [writeAction(ctx), { id: 'later', title: 'Later', kind: 'snooze', minutes: 30 }],
  });
  await ctx.platform.appendLines(t._id, PROMPTS.map((body) => ({ body })));
  return (await ctx.platform.topics()).find((x) => x._id === t._id) ?? t;
}

export const REMINDER_DAYS = 365;
export function reminderWindow(tz: string, now: Date) { const start = todayIn(tz, now); return { startDate: start, endDate: addDays(start, REMINDER_DAYS - 1) }; }
