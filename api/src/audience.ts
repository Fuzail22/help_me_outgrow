import type { Ctx } from './context.js';
import type { TopicAudience } from './store/schema.js';

/**
 * G11: topic audiences. A curated topic is shown to everyone (no audience document, or mode `public`), or only to the
 * members of the listed groups and the listed people (`restricted`). This app decides; the platform's `visibility`
 * keeps its meaning (private = not ready, shown to nobody) and is never changed here.
 */
export async function audienceCheck(ctx: Ctx, userId: string): Promise<(topicId: string) => boolean> {
  const [audiences, memberships] = await Promise.all([
    ctx.store.topicAudiences.find({ mode: 'restricted' }),
    ctx.store.groupMembers.find({ userId }),
  ]);
  const restricted = new Map(audiences.map((a) => [a._id, a]));
  const groups = new Set(memberships.map((m) => m.groupId));
  return (topicId) => {
    const a = restricted.get(topicId);
    return !a || allows(a, userId, groups);
  };
}

export const allows = (a: Pick<TopicAudience, 'mode' | 'groupIds' | 'userIds'>, userId: string, groups: Set<string>) =>
  a.mode === 'public' || a.userIds.includes(userId) || a.groupIds.some((g) => groups.has(g));
