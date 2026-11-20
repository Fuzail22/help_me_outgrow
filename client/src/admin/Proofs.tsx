import { useEffect, useState } from 'react';
import { admin, when } from './api';

interface P { _id: string; userId: string; email: string; name: string; referralCode: string; note: string; status: string; createdAt: string; decidedBy: string | null }
/** Social-post proofs. The screenshot arrives by email at support; match it by the sender's email or referral code. */
export function Proofs({ supportEmail = 'support@htsta.com' }: { supportEmail?: string }) {
  const [status, setStatus] = useState('pending');
  const [list, setList] = useState<P[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = () => admin<{ proofs: P[] }>('GET', `/proofs?status=${status}`).then((r) => setList(r.proofs));
  useEffect(() => { void load(); }, [status]);
  const act = async (id: string, what: 'approve' | 'reject') => { setError(null); try { await admin('POST', `/proofs/${id}/${what}`); await load(); } catch (e: any) { setError(e.message); } };
  return (
    <>
      <h1>Social posts</h1>
      <p className="muted">People email a screenshot of their post to {supportEmail} and press “I have sent the screenshot”. Find the email from the address below (the subject carries their referral code), check the post, then approve: one approved post counts as one referral.</p>
      <div className="chips">{['pending', 'approved', 'rejected'].map((s) => <button key={s} className={'chip' + (s === status ? ' on' : '')} onClick={() => setStatus(s)}>{s}</button>)}</div>
      <table className="table"><thead><tr><th>Person</th><th>Code</th><th>Sent</th><th>Note</th><th /></tr></thead><tbody>
        {list.map((p) => (
          <tr key={p._id}><td>{p.name}<br /><span className="small muted">{p.email}</span></td><td><code>{p.referralCode}</code></td><td className="small">{when(p.createdAt)}</td><td className="small">{p.note || '—'}</td>
            <td>{p.status === 'pending' ? <><button className="btn primary" onClick={() => act(p._id, 'approve')}>Approve</button> <button className="link" onClick={() => act(p._id, 'reject')}>Reject</button></> : <span className="small muted">{p.status} by {p.decidedBy}</span>}</td></tr>
        ))}
        {!list.length && <tr><td colSpan={5} className="muted">Nothing here.</td></tr>}
      </tbody></table>
      {error && <p className="error" role="alert">{error}</p>}
    </>
  );
}
