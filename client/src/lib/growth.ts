import { api } from './ns';

export type Vavp = 'vavp1' | 'vavp2' | 'vavp3';
export type TaskType = 'ratings' | 'referral_visits' | 'referral_signups' | 'approved_posts';
export interface GrowthLevel { level: number; mode: 'any' | 'all'; tasks: { type: TaskType; count: number; have: number }[]; reached: boolean; at: string | null; pick: { vavp: Vavp; topicId: string | null; amount: number } | null; options: { vavp: Vavp; amount: number }[] }
export interface Growth {
  level: number; levels: GrowthLevel[]; celebrate: number[]; counts: Record<TaskType, number>;
  referral: { code: string; url: string }; proofs: { id: string; status: string; createdAt: string }[]; supportEmail: string;
}
export const growth = {
  get: () => api<Growth>('GET', '/api/growth'),
  celebrated: (levels: number[]) => api<null>('POST', '/api/growth/celebrated', { levels }),
  pick: (level: number, vavp: Vavp, topicId?: string | null) => api<Growth>('POST', '/api/growth/pick', { level, vavp, topicId: topicId ?? null }),
  proof: (note: string) => api<{ id: string }>('POST', '/api/growth/proofs', { note }),
  visit: (code: string, deviceId: string) => api<{ counted: boolean }>('POST', '/api/ref/visit', { code, deviceId }),
};
export const TASK_TEXT: Record<TaskType, (n: number) => string> = {
  ratings: (n) => `Rate ${n} notes (helpful or not, both count)`,
  referral_visits: (n) => (n === 1 ? 'Someone opens your link on their device' : `${n} people open your link on their devices`),
  referral_signups: (n) => (n === 1 ? 'Someone joins through your link' : `${n} people join through your link`),
  approved_posts: (n) => (n === 1 ? 'A post about us is approved' : `${n} posts about us are approved`),
};
export const VAVP_TEXT: Record<Vavp, { title: string; text: (amount: number) => string }> = {
  vavp1: { title: 'More notes a day', text: (n) => `+${n} ${n === 1 ? 'time' : 'times'} a day on one topic you choose` },
  vavp2: { title: 'Longer course', text: (n) => `+${n} more notes on one topic you choose` },
  vavp3: { title: 'Your own topic', text: () => 'Write a topic of your own, up to 150 notes' },
};
