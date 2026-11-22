import { useEffect, useState, type ReactNode } from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import { admin, can, dollars, rupees } from './api';
import type { AdminMe } from './Admin';

/* Settings the owner asked to be configurable. Each field says what it does in plain words; the api validates again. */

interface Loaded<T> { data: T; updatedAt: string | null; updatedBy: string | null; isDefault: boolean; platform: { maxPerDay: number; minGapMinutes: number; maxDurationDays: number } }
function useSettings<T>(id: string) {
  const [s, setS] = useState<Loaded<T> | null>(null);
  const [draft, setDraft] = useState<T | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = () => admin<Loaded<T>>('GET', `/settings/${id}`).then((r) => { setS(r); setDraft(structuredClone(r.data)); });
  useEffect(() => { void load(); }, [id]);
  const save = async () => {
    setMsg(null);
    try { await admin('PUT', `/settings/${id}`, draft); await load(); setMsg({ ok: true, text: 'Saved. It applies from the next change anyone makes.' }); }
    catch (e: any) { setMsg({ ok: false, text: e.details?.[0] ? `${e.message} (${e.details[0].path})` : e.message }); }
  };
  return { s, draft, setDraft, save, msg };
}
const Num = ({ label, help, value, onChange, min = 0, max, step = 1 }: { label: string; help?: ReactNode; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number }) => (
  <label className="field">{label}<input type="number" value={value} min={min} max={max} step={step} onChange={(e) => onChange(Number(e.target.value))} />{help && <span className="muted small help">{help}</span>}</label>
);
const Saved = ({ s }: { s: { updatedAt: string | null; updatedBy: string | null; isDefault: boolean } }) => <p className="muted small">{s.isDefault ? 'Using the defaults.' : `Last saved ${new Date(s.updatedAt!).toLocaleString()} by ${s.updatedBy}.`}</p>;
const SaveBar = ({ canEdit, save, msg }: { canEdit: boolean; save: () => void; msg: { ok: boolean; text: string } | null }) => (
  <div className="savebar">{canEdit ? <button className="btn primary" onClick={save}>Save</button> : <span className="muted small">Read only for your role.</span>}{msg && <span className={msg.ok ? 'small' : 'error'} role={msg.ok ? 'status' : 'alert'}>{msg.text}</span>}</div>
);

export function Settings({ me }: { me: AdminMe }) {
  return (
    <>
      <h1>Settings</h1>
      <nav className="subnav"><NavLink to="/admin/settings" end>Limits</NavLink><NavLink to="/admin/settings/growth">Levels and VAVP</NavLink><NavLink to="/admin/settings/pricing">Paid privileges</NavLink></nav>
      <Routes>
        <Route path="/" element={<LimitsForm canEdit={can(me, 'editor')} />} />
        <Route path="growth" element={<GrowthForm canEdit={can(me, 'editor')} />} />
        <Route path="pricing" element={<PricingForm canEdit={can(me, 'owner')} />} />
      </Routes>
    </>
  );
}

// ---- limits
interface Limits { baseLadder: { minDays: number; maxSlots: number }[]; baseItems: number; maxDurationDays: number; durations: { days: number; label: string }[]; endingNotice: { withinDays: number; text: string }; ownTopicLineCap: number }
function LimitsForm({ canEdit }: { canEdit: boolean }) {
  const { s, draft: d, setDraft, save, msg } = useSettings<Limits>('limits');
  if (!s || !d) return <p className="muted" aria-busy="true">Loading…</p>;
  const set = (p: Partial<Limits>) => setDraft({ ...d, ...p });
  return (
    <div className="settings">
      <Saved s={s} />
      <p className="muted">What everyone gets before any level or purchase. Levels (VAVP) and paid privileges add on top of these. The platform caps every person at <strong>{s.platform.maxPerDay}</strong> notifications a day, <strong>{s.platform.minGapMinutes}</strong> minutes apart, and <strong>{s.platform.maxDurationDays}</strong> days per course.</p>
      <h3>Notifications a day per topic, by account age</h3>
      <table className="table"><thead><tr><th>From day</th><th>Times a day</th><th /></tr></thead><tbody>
        {d.baseLadder.map((t, i) => (
          <tr key={i}>
            <td><input aria-label={`Tier ${i + 1} from day`} type="number" min={0} value={t.minDays} disabled={i === 0} onChange={(e) => set({ baseLadder: d.baseLadder.map((x, j) => (j === i ? { ...x, minDays: Number(e.target.value) } : x)) })} /></td>
            <td><input aria-label={`Tier ${i + 1} times a day`} type="number" min={1} max={s.platform.maxPerDay} value={t.maxSlots} onChange={(e) => set({ baseLadder: d.baseLadder.map((x, j) => (j === i ? { ...x, maxSlots: Number(e.target.value) } : x)) })} /></td>
            <td>{i > 0 && <button className="link" onClick={() => set({ baseLadder: d.baseLadder.filter((_, j) => j !== i) })}>Remove</button>}</td>
          </tr>
        ))}
      </tbody></table>
      <button className="link" onClick={() => set({ baseLadder: [...d.baseLadder, { minDays: (d.baseLadder.at(-1)?.minDays ?? 0) + 30, maxSlots: (d.baseLadder.at(-1)?.maxSlots ?? 3) + 1 }] })}>+ Add a tier</button>
      <Num label="Quotes per course" help="How many notes one course (one topic, start to end) sends at most. VAVP2 picks and purchases add to it, up to the lines the topic has." value={d.baseItems} min={1} onChange={(n) => set({ baseItems: n })} />
      <Num label="Longest course (days)" help={`What people can choose when they start. At most ${s.platform.maxDurationDays} (the platform's ceiling).`} value={d.maxDurationDays} min={1} max={s.platform.maxDurationDays} onChange={(n) => set({ maxDurationDays: n })} />
      <h3>Length choices shown to people</h3>
      {d.durations.map((x, i) => (
        <div className="inline-form" key={i}>
          <Num label="Days" value={x.days} min={1} onChange={(n) => set({ durations: d.durations.map((y, j) => (j === i ? { ...y, days: n } : y)) })} />
          <label className="field">Label<input value={x.label} onChange={(e) => set({ durations: d.durations.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} /></label>
          <button className="link" onClick={() => set({ durations: d.durations.filter((_, j) => j !== i) })}>Remove</button>
        </div>
      ))}
      <button className="link" onClick={() => set({ durations: [...d.durations, { days: 60, label: '2 months' }] })}>+ Add a choice</button>
      <h3>“About to end” notice</h3>
      <Num label="Show it in the last … days" value={d.endingNotice.withinDays} min={1} max={30} onChange={(n) => set({ endingNotice: { ...d.endingNotice, withinDays: n } })} />
      <label className="field">Text added to each note<input value={d.endingNotice.text} maxLength={140} onChange={(e) => set({ endingNotice: { ...d.endingNotice, text: e.target.value } })} /><span className="muted small help">{'{daysLeft}'} becomes the number of days left. Each note also gets a “Choose what's next” button. Applies to courses started after saving.</span></label>
      <Num label="Lines in a person's own topic (VAVP3)" help="More than this is requested by email to support." value={d.ownTopicLineCap} min={1} onChange={(n) => set({ ownTopicLineCap: n })} />
      <SaveBar canEdit={canEdit} save={save} msg={msg} />
    </div>
  );
}

// ---- levels and VAVP
type TaskType = 'ratings' | 'referral_visits' | 'referral_signups' | 'approved_posts';
interface Growth { levels: { level: number; mode: 'any' | 'all'; tasks: { type: TaskType; count: number }[] }[]; vavp: { vavp1: { levels: Record<string, number>; stack: 'max' | 'sum' }; vavp2: { levels: Record<string, number>; stack: 'max' | 'sum' }; vavp3: { levels: Record<string, number> } } }
const TASKS: Record<TaskType, string> = {
  ratings: 'Rate notes (helpful or not, either counts)', referral_visits: 'Referral link opened on someone else’s device',
  referral_signups: 'Someone signs up through the referral link', approved_posts: 'Social posts approved by support',
};
function GrowthForm({ canEdit }: { canEdit: boolean }) {
  const { s, draft: d, setDraft, save, msg } = useSettings<Growth>('growth');
  if (!s || !d) return <p className="muted" aria-busy="true">Loading…</p>;
  const set = (p: Partial<Growth>) => setDraft({ ...d, ...p });
  const setLevel = (i: number, l: Growth['levels'][number]) => set({ levels: d.levels.map((x, j) => (j === i ? l : x)) });
  const setVavp = (k: 'vavp1' | 'vavp2' | 'vavp3', level: number, n: number) => set({ vavp: { ...d.vavp, [k]: { ...d.vavp[k], levels: { ...d.vavp[k].levels, [level]: n } } } });
  return (
    <div className="settings">
      <Saved s={s} />
      <p className="muted">People earn levels by adding value to the app. Every task is checked automatically from the numbers (ratings from the platform, referral visits and sign-ups here), except social posts, which support approves. A level, once reached, is never taken back. Each new level lets the person pick <strong>one</strong> VAVP open at that level.</p>
      {d.levels.map((l, i) => (
        <fieldset key={l.level} className="level-box">
          <legend>Level {l.level}</legend>
          <label className="field">Unlocks when<select value={l.mode} onChange={(e) => setLevel(i, { ...l, mode: e.target.value as 'any' | 'all' })}><option value="any">any one of these is done</option><option value="all">all of these are done</option></select></label>
          {l.tasks.map((t, k) => (
            <div className="inline-form" key={k}>
              <label className="field">Task<select value={t.type} onChange={(e) => setLevel(i, { ...l, tasks: l.tasks.map((x, j) => (j === k ? { ...x, type: e.target.value as TaskType } : x)) })}>{Object.entries(TASKS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
              <Num label="How many" value={t.count} min={1} onChange={(n) => setLevel(i, { ...l, tasks: l.tasks.map((x, j) => (j === k ? { ...x, count: n } : x)) })} />
              {l.tasks.length > 1 && <button className="link" onClick={() => setLevel(i, { ...l, tasks: l.tasks.filter((_, j) => j !== k) })}>Remove</button>}
            </div>
          ))}
          <button className="link" onClick={() => setLevel(i, { ...l, tasks: [...l.tasks, { type: 'ratings', count: 10 }] })}>+ Add a task</button>
          {i === d.levels.length - 1 && i > 0 && <button className="link danger" onClick={() => set({ levels: d.levels.slice(0, -1) })}>Remove this level</button>}
        </fieldset>
      ))}
      <button className="btn secondary" onClick={() => set({ levels: [...d.levels, { level: d.levels.length + 1, mode: 'any', tasks: [{ type: 'referral_signups', count: d.levels.length + 1 }] }] })}>+ Add level {d.levels.length + 1}</button>

      <h3>What each VAVP gives at each level</h3>
      <p className="muted small">VAVP1: extra notifications a day on one topic the person chooses. VAVP2: extra quotes on one topic (only as far as the topic has lines). VAVP3: a topic of their own (open at a level when ticked; until then it is only for sale). 0 means not offered at that level.</p>
      <table className="table"><thead><tr><th>Level</th><th>VAVP1 +notifications a day</th><th>VAVP2 +quotes</th><th>VAVP3 own topic</th></tr></thead><tbody>
        {d.levels.map((l) => (
          <tr key={l.level}><td>{l.level}</td>
            <td><input aria-label={`VAVP1 at level ${l.level}`} type="number" min={0} value={d.vavp.vavp1.levels[l.level] ?? 0} onChange={(e) => setVavp('vavp1', l.level, Number(e.target.value))} /></td>
            <td><input aria-label={`VAVP2 at level ${l.level}`} type="number" min={0} value={d.vavp.vavp2.levels[l.level] ?? 0} onChange={(e) => setVavp('vavp2', l.level, Number(e.target.value))} /></td>
            <td><input aria-label={`VAVP3 at level ${l.level}`} type="checkbox" checked={!!d.vavp.vavp3.levels[l.level]} onChange={(e) => setVavp('vavp3', l.level, e.target.checked ? 1 : 0)} /></td></tr>
        ))}
      </tbody></table>
      {(['vavp1', 'vavp2'] as const).map((k) => (
        <label className="field" key={k}>{k === 'vavp1' ? 'VAVP1' : 'VAVP2'}: picks on the same topic at different levels
          <select value={d.vavp[k].stack} onChange={(e) => set({ vavp: { ...d.vavp, [k]: { ...d.vavp[k], stack: e.target.value } } })}><option value="max">the largest counts (L2's +2 replaces L1's +1)</option><option value="sum">they add up (+1 and +2 make +3)</option></select>
        </label>
      ))}
      <SaveBar canEdit={canEdit} save={save} msg={msg} />
    </div>
  );
}

// ---- paid privileges
interface Ladder { start: number; step: number; band: number; maxBuyers: number }
interface Pricing { international: boolean; vavp1Units: number[]; vavp1Bundle3: number; vavp2: { items: number; price: number }[]; vavp3: { private: Ladder; public: Ladder }; terms: { upTo: number | null; months: number }[]; usd: { vavp1Unit: number; vavp1Bundle3: number; vavp2: number[]; vavp3Private: number; vavp3Public: number } }
const ladderPrice = (l: Ladder, rank: number) => l.start + l.step * Math.floor((Math.min(rank, l.maxBuyers) - 1) / l.band);
const termFor = (terms: Pricing['terms'], rank: number) => (terms.find((t) => t.upTo === null || rank <= t.upTo) ?? terms.at(-1)!).months;
const Money = ({ label, value, onChange, help, usd }: { label: string; value: number; onChange: (n: number) => void; help?: ReactNode; usd?: boolean }) => (
  <label className="field">{label}<span className="money"><span>{usd ? '$' : '₹'}</span><input type="number" min={0} step={usd ? 0.01 : 1} value={value / 100} onChange={(e) => onChange(Math.round(Number(e.target.value) * 100))} /></span>{help && <span className="muted small help">{help}</span>}</label>
);
function PricingForm({ canEdit }: { canEdit: boolean }) {
  const { s, draft: d, setDraft, save, msg } = useSettings<Pricing>('pricing');
  if (!s || !d) return <p className="muted" aria-busy="true">Loading…</p>;
  const set = (p: Partial<Pricing>) => setDraft({ ...d, ...p });
  const ranks = [1, 10, 11, 20, 21, 70, 71, 200, 201];
  return (
    <div className="settings">
      <Saved s={s} />
      <p className="muted">Paid privileges are sold on their own page, separate from what people earn by levels. Prices are in rupees for India (Razorpay: UPI, cards, netbanking, wallets) and in US dollars elsewhere (Razorpay international cards, or Stripe if configured). How long a purchase lasts depends on how early the person bought that product.</p>
      <h3>How long a purchase lasts (by buyer number, per product)</h3>
      {d.terms.map((t, i) => (
        <div className="inline-form" key={i}>
          {t.upTo === null ? <span className="field">Everyone after</span> : <Num label="Up to buyer number" value={t.upTo} min={1} onChange={(n) => set({ terms: d.terms.map((x, j) => (j === i ? { ...x, upTo: n } : x)) })} />}
          <Num label="Months" value={t.months} min={1} onChange={(n) => set({ terms: d.terms.map((x, j) => (j === i ? { ...x, months: n } : x)) })} />
        </div>
      ))}
      <h3>VAVP1: extra notifications a day on one topic</h3>
      {d.vavp1Units.map((p, i) => <Money key={i} label={`${['1st', '2nd', '3rd', '4th', '5th', '6th'][i] ?? `${i + 1}th`} extra notification`} value={p} onChange={(n) => set({ vavp1Units: d.vavp1Units.map((x, j) => (j === i ? n : x)) })} />)}
      <p className="small"><button className="link" onClick={() => set({ vavp1Units: [...d.vavp1Units, (d.vavp1Units.at(-1) ?? 1000) * 2] })}>+ Allow one more</button>{d.vavp1Units.length > 1 && <> · <button className="link" onClick={() => set({ vavp1Units: d.vavp1Units.slice(0, -1) })}>Remove the last</button></>}</p>
      <Money label="Bundle of 3 bought together" value={d.vavp1Bundle3} onChange={(n) => set({ vavp1Bundle3: n })} help={`Instead of ${rupees(d.vavp1Units.slice(0, 3).reduce((a, b) => a + b, 0))} one by one.`} />
      <h3>VAVP2: extra quotes on one topic</h3>
      {d.vavp2.map((p, i) => (
        <div className="inline-form" key={i}>
          <Num label="Quotes" value={p.items} min={1} onChange={(n) => set({ vavp2: d.vavp2.map((x, j) => (j === i ? { ...x, items: n } : x)) })} />
          <Money label="Price" value={p.price} onChange={(n) => set({ vavp2: d.vavp2.map((x, j) => (j === i ? { ...x, price: n } : x)) })} />
        </div>
      ))}
      <h3>VAVP3: a topic of one's own (up to the line limit in Limits)</h3>
      {(['private', 'public'] as const).map((k) => (
        <fieldset key={k} className="level-box">
          <legend>{k === 'private' ? 'Private (only they get its notes)' : 'Public (anyone may follow it, after review)'}</legend>
          <Money label="First buyers pay" value={d.vavp3[k].start} onChange={(n) => set({ vavp3: { ...d.vavp3, [k]: { ...d.vavp3[k], start: n } } })} />
          <Money label="Then add" value={d.vavp3[k].step} onChange={(n) => set({ vavp3: { ...d.vavp3, [k]: { ...d.vavp3[k], step: n } } })} />
          <Num label="…for every this many buyers" value={d.vavp3[k].band} min={1} onChange={(n) => set({ vavp3: { ...d.vavp3, [k]: { ...d.vavp3[k], band: n } } })} />
          <Num label="Price stops rising after buyer" value={d.vavp3[k].maxBuyers} min={1} onChange={(n) => set({ vavp3: { ...d.vavp3, [k]: { ...d.vavp3[k], maxBuyers: n } } })} />
        </fieldset>
      ))}
      <h3>Preview</h3>
      <table className="table"><thead><tr><th>Buyer number</th><th>Lasts</th><th>VAVP3 private</th><th>VAVP3 public</th></tr></thead><tbody>
        {ranks.map((r) => <tr key={r}><td>{r}</td><td>{termFor(d.terms, r)} months</td><td>{rupees(ladderPrice(d.vavp3.private, r))}</td><td>{rupees(ladderPrice(d.vavp3.public, r))}</td></tr>)}
      </tbody></table>
      <h3>Outside India</h3>
      <label className="check"><input type="checkbox" checked={d.international} onChange={(e) => set({ international: e.target.checked })} /><span>Sell outside India (US dollars, through Razorpay's international payments). When off, visitors from other countries can join a waitlist.</span></label>
      <Money usd label="VAVP1, one extra notification" value={d.usd.vavp1Unit} onChange={(n) => set({ usd: { ...d.usd, vavp1Unit: n } })} />
      <Money usd label="VAVP1, bundle of 3" value={d.usd.vavp1Bundle3} onChange={(n) => set({ usd: { ...d.usd, vavp1Bundle3: n } })} />
      {d.vavp2.map((p, i) => <Money usd key={i} label={`VAVP2, ${p.items} quotes`} value={d.usd.vavp2[i] ?? 0} onChange={(n) => { const v = [...d.usd.vavp2]; v[i] = n; set({ usd: { ...d.usd, vavp2: v } }); }} />)}
      <Money usd label="VAVP3 private" value={d.usd.vavp3Private} onChange={(n) => set({ usd: { ...d.usd, vavp3Private: n } })} />
      <Money usd label="VAVP3 public" value={d.usd.vavp3Public} onChange={(n) => set({ usd: { ...d.usd, vavp3Public: n } })} help={`Card fees take a larger share of small payments abroad; ${dollars(100)} is the smallest price Razorpay accepts.`} />
      <SaveBar canEdit={canEdit} save={save} msg={msg} />
    </div>
  );
}
