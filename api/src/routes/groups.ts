import type { RequestHandler, Router } from 'express';
import { z } from 'zod';
import type { Ctx } from '../context.js';
import { h, HttpError, parse } from '../http.js';
import { newId } from '../ids.js';
import { audit, type AdminRequest } from '../admin/auth.js';
import { JOURNAL_TOPIC_SLUG } from '../limits.js';
import { DuplicateKeyError } from '../store/types.js';
import type { AdminRole, Group, TopicAudience } from '../store/schema.js';

const groupName = z.string().trim().min(1).max(60); const groupDesc = z.string().trim().max(300);
const groupBody = z.object({ name: groupName, description: groupDesc.default('') });
const groupPatch = z.object({ name: groupName.optional(), description: groupDesc.optional() });
const ids = z.array(z.string().min(1).max(64)).max(500);
const audienceBody = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('public') }),
  z.object({ mode: z.literal('restricted'), groupIds: ids.default([]), userIds: ids.default([]) }),
]);
const uniq = <T>(xs: T[]) => [...new Set(xs)];

/** How an admin sees a topic's audience: names, not bare ids. */
export async function audienceViews(ctx: Ctx, topicIds: string[]) {
  const docs = await ctx.store.topicAudiences.find({ _id: { $in: topicIds } });
  const [groups, users] = await Promise.all([
    ctx.store.groups.find({ _id: { $in: uniq(docs.flatMap((d) => d.groupIds)) } }),
    ctx.store.users.find({ _id: { $in: uniq(docs.flatMap((d) => d.userIds)) } }),
  ]);
  const g = new Map(groups.map((x) => [x._id, x])); const u = new Map(users.map((x) => [x._id, x]));
  const byTopic = new Map(docs.map((d) => [d._id, d]));
  return (topicId: string) => {
    const d = byTopic.get(topicId);
    if (!d || d.mode === 'public') return { mode: 'public' as const, groups: [], users: [] };
    return {
      mode: 'restricted' as const,
      groups: d.groupIds.filter((id) => g.has(id)).map((id) => ({ id, name: g.get(id)!.name })),
      users: d.userIds.filter((id) => u.has(id)).map((id) => ({ id, email: u.get(id)!.email, name: u.get(id)!.name })),
    };
  };
}

/** G11 admin: groups of people, and who each curated topic is shown to. Editors and up, every change audited. */
export function groupAdminRoutes(ctx: Ctx) {
  return (api: Router, need: (r: AdminRole) => RequestHandler) => {
    const A = '/api/admin';
    const who = (req: unknown) => (req as AdminRequest).admin.email;
    const group = async (id: string) => {
      const g = await ctx.store.groups.findOne({ _id: id });
      if (!g) throw new HttpError(404, 'not_found', 'No such group');
      return g;
    };
    const sameName = (e: unknown) => { if (e instanceof DuplicateKeyError) throw new HttpError(409, 'group_exists', 'A group with this name already exists'); throw e; };

    api.get(`${A}/groups`, need('editor'), h(async (_req, res) => {
      const [groups, members] = await Promise.all([ctx.store.groups.find({}, { sort: { nameKey: 1 } }), ctx.store.groupMembers.find({})]);
      const count = new Map<string, number>(); for (const m of members) count.set(m.groupId, (count.get(m.groupId) ?? 0) + 1);
      res.json({ groups: groups.map((g) => ({ ...g, memberCount: count.get(g._id) ?? 0 })) });
    }));
    api.post(`${A}/groups`, need('editor'), h(async (req, res) => {
      const b = parse(groupBody, req.body); const now = ctx.now();
      const g: Group = { _id: newId('grp_'), name: b.name, nameKey: b.name.toLowerCase(), description: b.description, createdAt: now, createdBy: who(req), updatedAt: now };
      await ctx.store.groups.insertOne(g).catch(sameName);
      await audit(ctx, who(req), 'group.create', g._id, null, { name: g.name, description: g.description });
      res.status(201).json({ ...g, memberCount: 0 });
    }));
    api.get(`${A}/groups/:id`, need('editor'), h(async (req, res) => {
      const g = await group(req.params.id);
      const members = await ctx.store.groupMembers.find({ groupId: g._id }, { sort: { addedAt: -1 } });
      const users = new Map((await ctx.store.users.find({ _id: { $in: members.map((m) => m.userId) } })).map((u) => [u._id, u]));
      const topics = await ctx.store.topicAudiences.find({ mode: 'restricted', groupIds: g._id });
      const titles = new Map((await ctx.platform.topics()).map((t) => [t._id, t.title]));
      res.json({
        group: g,
        members: members.filter((m) => users.has(m.userId)).map((m) => ({ id: m.userId, email: users.get(m.userId)!.email, name: users.get(m.userId)!.name, addedAt: m.addedAt, addedBy: m.addedBy })),
        topics: topics.map((t) => ({ id: t._id, title: titles.get(t._id) ?? t._id })),
      });
    }));
    api.patch(`${A}/groups/:id`, need('editor'), h(async (req, res) => {
      const b = parse(groupPatch, req.body);
      const g = await group(req.params.id);
      const set = { ...(b.name !== undefined ? { name: b.name, nameKey: b.name.toLowerCase() } : {}), ...(b.description !== undefined ? { description: b.description } : {}), updatedAt: ctx.now() };
      const next = await ctx.store.groups.findOneAndUpdate({ _id: g._id }, { $set: set }).catch(sameName);
      await audit(ctx, who(req), 'group.update', g._id, { name: g.name, description: g.description }, { name: next!.name, description: next!.description });
      res.json(next);
    }));
    /** Deleting a group removes its memberships and takes it out of every topic's audience (those topics stay restricted). */
    api.delete(`${A}/groups/:id`, need('editor'), h(async (req, res) => {
      const g = await group(req.params.id);
      const members = await ctx.store.groupMembers.count({ groupId: g._id });
      const topics = (await ctx.store.topicAudiences.find({ groupIds: g._id })).map((t) => t._id);
      await ctx.store.topicAudiences.updateMany({ groupIds: g._id }, { $pull: { groupIds: g._id } });
      await ctx.store.groupMembers.deleteMany({ groupId: g._id });
      await ctx.store.groups.deleteMany({ _id: g._id });
      await audit(ctx, who(req), 'group.delete', g._id, { name: g.name, members, topics }, null);
      res.status(204).end();
    }));
    api.post(`${A}/groups/:id/members`, need('editor'), h(async (req, res) => {
      const g = await group(req.params.id);
      const { userIds } = parse(z.object({ userIds: ids.min(1) }), req.body);
      const found = new Set((await ctx.store.users.find({ _id: { $in: uniq(userIds) } })).map((u) => u._id));
      const missing = uniq(userIds).filter((id) => !found.has(id));
      if (missing.length) throw new HttpError(404, 'not_found', 'Some of these people do not exist', { missing });
      const have = new Set((await ctx.store.groupMembers.find({ groupId: g._id, userId: { $in: [...found] } })).map((m) => m.userId));
      const add = [...found].filter((id) => !have.has(id));
      if (add.length) {
        await ctx.store.groupMembers.insertMany(add.map((userId) => ({ _id: `${g._id}:${userId}`, groupId: g._id, userId, addedAt: ctx.now(), addedBy: who(req) })));
        await audit(ctx, who(req), 'group.members.add', g._id, null, { userIds: add });
      }
      res.status(201).json({ added: add, already: [...have] });
    }));
    /** The person keeps any course already running on a topic they now cannot see; they just cannot start a new one. */
    api.delete(`${A}/groups/:id/members/:userId`, need('editor'), h(async (req, res) => {
      const g = await group(req.params.id);
      if (!(await ctx.store.groupMembers.deleteMany({ groupId: g._id, userId: req.params.userId }))) throw new HttpError(404, 'not_found', 'This person is not in the group');
      await audit(ctx, who(req), 'group.members.remove', g._id, { userIds: [req.params.userId] }, null);
      res.status(204).end();
    }));

    /** `curated: false` for the journal and people's own topics, which have no audience of their own. */
    api.get(`${A}/topics/:id/audience`, need('editor'), h(async (req, res) => {
      const topic = (await ctx.platform.topics()).find((t) => t._id === req.params.id);
      if (!topic) throw new HttpError(404, 'not_found', 'Topic not found');
      const curated = topic.slug !== JOURNAL_TOPIC_SLUG && !(await ctx.store.ownTopics.count({ platformTopicId: topic._id }));
      res.json({ ...(await audienceViews(ctx, [topic._id]))(topic._id), curated });
    }));
    /** Public (everyone) or restricted to groups and/or people. Only curated topics: not the journal, not people's own. */
    api.put(`${A}/topics/:id/audience`, need('editor'), h(async (req, res) => {
      const b = parse(audienceBody, req.body);
      const topic = (await ctx.platform.topics()).find((t) => t._id === req.params.id);
      if (!topic) throw new HttpError(404, 'not_found', 'Topic not found');
      if (topic.slug === JOURNAL_TOPIC_SLUG || (await ctx.store.ownTopics.count({ platformTopicId: topic._id }))) throw new HttpError(409, 'not_curated', 'Only curated topics have an audience');
      const groupIds = b.mode === 'restricted' ? uniq(b.groupIds) : []; const userIds = b.mode === 'restricted' ? uniq(b.userIds) : [];
      const [gs, us] = await Promise.all([ctx.store.groups.find({ _id: { $in: groupIds } }), ctx.store.users.find({ _id: { $in: userIds } })]);
      const missing = [...groupIds.filter((id) => !gs.some((g) => g._id === id)), ...userIds.filter((id) => !us.some((u) => u._id === id))];
      if (missing.length) throw new HttpError(404, 'not_found', 'Some of these groups or people do not exist', { missing });
      const before = (await audienceViews(ctx, [topic._id]))(topic._id);
      const doc: TopicAudience = { _id: topic._id, mode: b.mode, groupIds, userIds, updatedAt: ctx.now(), updatedBy: who(req) };
      if (b.mode === 'public') await ctx.store.topicAudiences.deleteMany({ _id: topic._id });
      else {
        const { _id, ...fields } = doc;
        const save = () => ctx.store.topicAudiences.updateOne({ _id }, { $set: fields });
        // Two saves at once: the second insert collides and becomes an update.
        if (!(await save())) await ctx.store.topicAudiences.insertOne(doc).catch(async (e) => { if (e instanceof DuplicateKeyError) await save(); else throw e; });
      }
      const after = (await audienceViews(ctx, [topic._id]))(topic._id);
      const brief = (v: typeof after) => ({ mode: v.mode, groups: v.groups.map((g) => g.name), users: v.users.map((u) => u.email) });
      await audit(ctx, who(req), 'topic.audience', topic.slug, brief(before), brief(after));
      res.json(after);
    }));
  };
}
