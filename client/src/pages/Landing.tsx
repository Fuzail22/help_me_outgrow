import { useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ns } from '../lib/ns';
import { IosGuide } from '../components/IosGuide';

let counted = false;

export function Landing() {
  const [params] = useSearchParams();
  useEffect(() => { if (!counted) { counted = true; void ns.track('visit', { path: location.pathname }); } }, []);
  return (
    <section className="landing">
      {params.get('welcome') && <p className="callout" role="status">A friend shared this with you. Welcome.</p>}
      <h1>A steady word, when you need one.</h1>
      <ul className="hooks">
        <li>Wish there had been some reassurance the day you slipped back?</li>
        <li>Wish something answered the doubts and the second-guessing?</li>
        <li>Wish someone walked beside you through a break-up or a loss?</li>
      </ul>
      <p className="lede">
        Pick what you are going through and when you want to hear from us. A short, supportive note arrives in your
        browser's notifications at those times. No app to install.
      </p>
      <IosGuide compact />
      <Link className="btn primary big" to="/start">Choose what you need</Link>
      <p className="muted small">Free. Up to three months. Stop any time.</p>
    </section>
  );
}
