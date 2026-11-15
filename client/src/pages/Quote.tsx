import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { DeliveryView } from '@notification-service/sdk';
import { ns } from '../lib/ns';

const CLICKS_KEY = 'hmo_opens';

/** Where a tapped notification lands: the line, a one-tap rating, an optional comment. Needs no sign-in. */
export function Quote() {
  const { deliveryId } = useParams();
  const [params] = useSearchParams();
  const token = params.get('t') ?? undefined;
  const [d, setD] = useState<DeliveryView | null>(null);
  const [missing, setMissing] = useState(false);
  const [rating, setRating] = useState<'up' | 'down' | null>(null);
  const [comment, setComment] = useState('');
  const [saved, setSaved] = useState(false);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    if (!deliveryId) return;
    ns.getDelivery(deliveryId, token).then((v) => { setD(v); setRating(v.rating); setComment(v.comment ?? ''); setSaved(!!v.comment); }).catch(() => setMissing(true));
  }, [deliveryId, token]);

  // Offer install after the third opened note: installed web apps keep their notification permission.
  useEffect(() => {
    let opens = 0;
    try { opens = Number(localStorage.getItem(CLICKS_KEY) ?? 0) + 1; localStorage.setItem(CLICKS_KEY, String(opens)); } catch { /* ignore */ }
    const check = () => setCanInstall(opens >= 3 && !!(window as any).__hmoInstall && localStorage.getItem('hmo_install_dismissed') !== '1');
    check(); window.addEventListener('hmo-installable', check);
    return () => window.removeEventListener('hmo-installable', check);
  }, []);

  if (missing) return <section><h1>This note is no longer available</h1><p>It may have been erased, or the link is incomplete. <Link to="/manage">See my notes</Link>.</p></section>;
  if (!d) return <p className="muted" aria-busy="true">Loading…</p>;

  const rate = async (r: 'up' | 'down') => { setRating(r); await ns.sendFeedback({ deliveryId: d.id, rating: r }, token).catch(() => setRating(null)); };
  const install = async () => { const p = (window as any).__hmoInstall; setCanInstall(false); if (p) { p.prompt(); await p.userChoice.catch(() => undefined); (window as any).__hmoInstall = null; } };

  return (
    <section className="quote">
      <p className="eyebrow">{d.topic.title}</p>
      <blockquote>{d.body}</blockquote>
      {d.attribution && <p className="muted">{d.attribution}</p>}
      <div className="rate" role="group" aria-label="Was this helpful?">
        <button className={'btn ' + (rating === 'up' ? 'primary' : 'secondary')} aria-pressed={rating === 'up'} onClick={() => rate('up')}>Helpful</button>
        <button className={'btn ' + (rating === 'down' ? 'primary' : 'secondary')} aria-pressed={rating === 'down'} onClick={() => rate('down')}>Not for me</button>
      </div>
      {rating && (
        <form className="comment" onSubmit={async (e) => { e.preventDefault(); if (!comment.trim()) return; await ns.sendFeedback({ deliveryId: d.id, text: comment.trim() }, token); setSaved(true); }}>
          <label className="field">{rating === 'up' ? 'What made it land? (optional)' : 'What would have been better? (optional)'}
            <textarea value={comment} maxLength={500} rows={3} onChange={(e) => { setComment(e.target.value); setSaved(false); }} />
          </label>
          {saved ? <p className="muted" role="status">Thank you. Saved.</p> : <button className="btn secondary" disabled={!comment.trim()}>Send</button>}
        </form>
      )}
      {canInstall && (
        <div className="callout">
          <strong>Keep these notes coming</strong>
          <p>Browsers sometimes switch off notifications for sites you rarely open. Installing help me outgrow prevents that.</p>
          <div className="actions left">
            <button className="btn primary" onClick={install}>Install</button>
            <button className="btn secondary" onClick={() => { localStorage.setItem('hmo_install_dismissed', '1'); setCanInstall(false); }}>Not now</button>
          </div>
        </div>
      )}
      <p className="muted small"><Link to="/manage">Change or stop my notes</Link></p>
    </section>
  );
}
