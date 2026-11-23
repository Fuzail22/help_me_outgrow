import { describe, expect, it } from 'vitest';
import { ALL_DAYS, setup } from './helpers.js';

const W = { 'x-admin': '1' };
const body = (topicId: string, extra: object = {}) => ({ topicId, slots: ALL_DAYS('08:00'), timezone: 'Asia/Kolkata', endDate: '2026-12-19', ...extra });

async function world() {
  const s = await setup({ adminOwnerEmail: 'owner@dev.invalid' });
  const owner = s.as((await s.signIn('Owner')).cookie);
  const invite = async (name: string, role: string) => { await owner.post('/api/admin/admins', { email: `${name.toLowerCase()}@dev.invalid`, role }).set(W).expect(201); return s.as((await s.signIn(name)).cookie); };
  const editor = await invite('Ed', 'editor');
  const grief = s.platform.addTopic({ slug: 'grief' }); const loss = s.platform.addTopic({ slug: 'loss' });
  const asha = await s.signIn('Asha'); const ravi = await s.signIn('Ravi'); const mira = await s.signIn('Mira');
  const slugs = async (cookie: string) => (await s.as(cookie).get('/api/me/limits').expect(200)).body.topics.map((t: any) => t.slug);
  return { s, owner, invite, editor, grief, loss, asha, ravi, mira, slugs };
}

describe('G11: groups and topic audiences', () => {
  it('every topic is public until an editor narrows it; then only the chosen groups and people see it', async () => {
    const { editor, grief, asha, ravi, mira, slugs } = await world();
    expect(await slugs(asha.cookie)).toEqual(['grief', 'loss']);
    expect((await editor.get('/api/admin/topics').expect(200)).body.topics.find((t: any) => t._id === grief._id).audience).toEqual({ mode: 'public', groups: [], users: [] });

    const g = (await editor.post('/api/admin/groups', { name: 'Hospice volunteers' }).set(W).expect(201)).body;
    await editor.post(`/api/admin/groups/${g._id}/members`, { userIds: [asha.id] }).set(W).expect(201);
    const a = (await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'restricted', groupIds: [g._id], userIds: [mira.id] }).set(W).expect(200)).body;
    expect(a).toMatchObject({ mode: 'restricted', groups: [{ id: g._id, name: 'Hospice volunteers' }], users: [{ id: mira.id, name: 'Mira' }] });

    expect(await slugs(asha.cookie)).toEqual(['grief', 'loss']); // in the group
    expect(await slugs(mira.cookie)).toEqual(['grief', 'loss']); // chosen by name
    expect(await slugs(ravi.cookie)).toEqual(['loss']); // neither: the topic is hidden entirely

    // Back to public: everyone again.
    await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'public' }).set(W).expect(200);
    expect(await slugs(ravi.cookie)).toEqual(['grief', 'loss']);
  });

  it('someone outside the audience cannot start, pick or buy for the topic: it answers as if it did not exist', async () => {
    const { s, editor, grief, ravi } = await world();
    await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'restricted', groupIds: [], userIds: [] }).set(W).expect(200);
    const c = s.as(ravi.cookie);
    expect((await c.post('/api/enrolments', body(grief._id)).expect(404)).body.error.code).toBe('not_found');
    expect((await c.get('/api/me/limits').expect(200)).body.perTopic).not.toHaveProperty(grief._id);
    expect((await c.get('/api/upgrade/catalog').expect(200)).body.topics.map((t: any) => t.id)).not.toContain(grief._id);
    expect(s.platform.calls.filter((x) => x.method === 'createEnrolment')).toEqual([]);
  });

  it('removing someone stops new courses only: a running course goes on, can be paused and edited, but not restarted', async () => {
    const { s, editor, grief, asha, slugs } = await world();
    const g = (await editor.post('/api/admin/groups', { name: 'Circle' }).set(W).expect(201)).body;
    await editor.post(`/api/admin/groups/${g._id}/members`, { userIds: [asha.id] }).set(W).expect(201);
    await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'restricted', groupIds: [g._id] }).set(W).expect(200);
    const c = s.as(asha.cookie);
    const e = (await c.post('/api/enrolments', body(grief._id)).expect(201)).body;

    await editor.del(`/api/admin/groups/${g._id}/members/${asha.id}`).set(W).expect(204);
    expect(await slugs(asha.cookie)).toEqual(['loss']);
    // The running course is untouched on the platform and still listed.
    expect(s.platform.calls.filter((x) => x.method === 'patchEnrolment' && (x.args[2] as any).action)).toEqual([]);
    expect((await c.get('/api/enrolments').expect(200)).body.enrolments).toMatchObject([{ id: e.id, status: 'active' }]);
    await c.patch(`/api/enrolments/${e.id}`, { action: 'pause' }).expect(200);
    await c.patch(`/api/enrolments/${e.id}`, { action: 'resume', endDate: '2026-12-10' }).expect(200);
    // A new course on it (loop again, or after cancelling) is refused, and the refusal leaves the old one running.
    await c.post(`/api/enrolments/${e.id}/next`, { choice: 'loop' }).expect(404);
    expect(s.platform.enrol.get(e.id)!.status).toBe('active');
    await c.patch(`/api/enrolments/${e.id}`, { action: 'cancel' }).expect(200);
    await c.post('/api/enrolments', body(grief._id)).expect(404);
  });

  it('deleting a group takes it out of every audience and drops its memberships; the topic stays restricted', async () => {
    const { s, owner, editor, grief, asha, slugs } = await world();
    const g = (await editor.post('/api/admin/groups', { name: 'Circle' }).set(W).expect(201)).body;
    await editor.post(`/api/admin/groups/${g._id}/members`, { userIds: [asha.id] }).set(W).expect(201);
    await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'restricted', groupIds: [g._id] }).set(W).expect(200);
    expect((await editor.get(`/api/admin/groups/${g._id}`).expect(200)).body).toMatchObject({ members: [{ id: asha.id, name: 'Asha' }], topics: [{ id: grief._id, title: 'grief' }] });
    expect((await owner.get(`/api/admin/users/${asha.id}`).expect(200)).body.groups).toEqual([{ id: g._id, name: 'Circle' }]);

    await editor.del(`/api/admin/groups/${g._id}`).set(W).expect(204);
    expect(await s.ctx.store.groupMembers.count({})).toBe(0);
    expect((await editor.get(`/api/admin/topics/${grief._id}/audience`).expect(200)).body).toEqual({ mode: 'restricted', groups: [], users: [], curated: true });
    expect(await slugs(asha.cookie)).toEqual(['loss']);
    await editor.get(`/api/admin/groups/${g._id}`).expect(404);
  });

  it('manages groups: unique names, rename, adding twice is harmless, unknown people and groups are refused', async () => {
    const { editor, grief, asha } = await world();
    const g = (await editor.post('/api/admin/groups', { name: 'Circle', description: 'Weekly' }).set(W).expect(201)).body;
    expect((await editor.post('/api/admin/groups', { name: 'circle' }).set(W).expect(409)).body.error.code).toBe('group_exists');
    await editor.patch(`/api/admin/groups/${g._id}`, { name: 'Inner circle' }).set(W).expect(200);
    await editor.post(`/api/admin/groups/${g._id}/members`, { userIds: [asha.id] }).set(W).expect(201);
    expect((await editor.post(`/api/admin/groups/${g._id}/members`, { userIds: [asha.id] }).set(W).expect(201)).body).toEqual({ added: [], already: [asha.id] });
    expect((await editor.post(`/api/admin/groups/${g._id}/members`, { userIds: ['u_nobody'] }).set(W).expect(404)).body.error.details).toEqual({ missing: ['u_nobody'] });
    expect((await editor.get('/api/admin/groups').expect(200)).body.groups).toMatchObject([{ name: 'Inner circle', description: 'Weekly', memberCount: 1 }]);
    await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'restricted', groupIds: ['grp_nope'] }).set(W).expect(404);
    await editor.put('/api/admin/topics/t_nope/audience', { mode: 'public' }).set(W).expect(404);
    await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'everyone' }).set(W).expect(422);
  });

  it('is for editors and owners only, and every change is audited', async () => {
    const { s, owner, invite, editor, grief, asha } = await world();
    const support = await invite('Sup', 'support'); const viewer = await invite('View', 'viewer');
    for (const c of [support, viewer]) {
      await c.get('/api/admin/groups').expect(403);
      await c.post('/api/admin/groups', { name: 'X' }).set(W).expect(403);
      await c.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'public' }).set(W).expect(403);
    }
    await s.as(asha.cookie).get('/api/admin/groups').expect(403);
    const g = (await owner.post('/api/admin/groups', { name: 'Circle' }).set(W).expect(201)).body;
    await editor.post(`/api/admin/groups/${g._id}/members`, { userIds: [asha.id] }).set(W).expect(201);
    await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'restricted', groupIds: [g._id] }).set(W).expect(200);
    await editor.del(`/api/admin/groups/${g._id}/members/${asha.id}`).set(W).expect(204);
    const log = (await owner.get('/api/admin/audit').expect(200)).body.entries.filter((e: any) => /^(group|topic\.audience)/.test(e.action));
    expect(log.map((e: any) => e.action)).toEqual(['group.members.remove', 'topic.audience', 'group.members.add', 'group.create']);
    expect(log[1]).toMatchObject({ actor: 'ed@dev.invalid', target: 'grief', before: { mode: 'public' }, after: { mode: 'restricted', groups: ['Circle'], users: [] } });
  });

  it('own topics and the journal keep their rules and cannot be given an audience; private topics stay hidden until public', async () => {
    const { s, owner, editor, asha, slugs } = await world();
    const journal = s.platform.addTopic({ slug: 'journal-prompts', visibility: 'private' });
    await editor.put(`/api/admin/topics/${journal._id}/audience`, { mode: 'public' }).set(W).expect(409);
    // A private (not yet ready) topic set for Asha is still hidden until an editor makes it public.
    const draft = s.platform.addTopic({ slug: 'draft', visibility: 'private' });
    await editor.put(`/api/admin/topics/${draft._id}/audience`, { mode: 'restricted', userIds: [asha.id] }).set(W).expect(200);
    expect(await slugs(asha.cookie)).toEqual(['grief', 'loss']);
    await editor.patch(`/api/admin/topics/${draft._id}`, { visibility: 'public' }).set(W).expect(200);
    expect(await slugs(asha.cookie)).toEqual(['grief', 'loss', 'draft']);
    // An own topic (VAVP3) is refused an audience.
    await owner.post(`/api/admin/users/${asha.id}/entitlements`, { kind: 'own_topic', topicId: null, amount: 1, months: null, note: 'gift' }).set(W).expect(201);
    const own = (await s.as(asha.cookie).post('/api/own-topics', { title: 'Mine', visibility: 'private' }).expect(201)).body;
    expect((await editor.get(`/api/admin/topics/${own.platformTopicId}/audience`).expect(200)).body.curated).toBe(false);
    expect((await editor.put(`/api/admin/topics/${own.platformTopicId}/audience`, { mode: 'restricted' }).set(W).expect(409)).body.error.code).toBe('not_curated');
    expect(await slugs(asha.cookie)).toContain(own.platformTopicId.replace(/^t_/, ''));
  });

  it('deleting an account removes the person from groups and audiences', async () => {
    const { s, editor, grief, asha } = await world();
    const g = (await editor.post('/api/admin/groups', { name: 'Circle' }).set(W).expect(201)).body;
    await editor.post(`/api/admin/groups/${g._id}/members`, { userIds: [asha.id] }).set(W).expect(201);
    await editor.put(`/api/admin/topics/${grief._id}/audience`, { mode: 'restricted', userIds: [asha.id] }).set(W).expect(200);
    const { deleteUser } = await import('../src/users.js');
    await deleteUser(s.ctx, asha.id);
    expect(await s.ctx.store.groupMembers.count({})).toBe(0);
    expect((await s.ctx.store.topicAudiences.findOne({ _id: grief._id }))!.userIds).toEqual([]);
  });
});
