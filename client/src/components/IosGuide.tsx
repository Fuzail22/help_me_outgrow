import { useState } from 'react';
import { iosInfo, MIN_IOS } from '../lib/ios';
import { ns } from '../lib/ns';

/**
 * Shown to iPhone and iPad visitors in the browser, before sign-in (R5): notifications only work from the Home
 * Screen app, from iOS 16.4. Renders nothing elsewhere (Android, desktop, or inside the Home Screen app).
 */
export function IosGuide({ compact = false }: { compact?: boolean }) {
  const info = iosInfo();
  const [noted, setNoted] = useState(false);
  if (!info.isIOS || info.standalone) return null;
  if (info.tooOld) {
    return (
      <div className="callout warn ios-guide" role="note" aria-label="Update your iPhone">
        <strong>Update your iPhone to use help me outgrow</strong>
        <p>This iPhone runs iOS {info.version!.major}.{info.version!.minor}. Notes arrive as notifications, which iPhones support for web apps from
          iOS {MIN_IOS.major}.{MIN_IOS.minor}. Update in Settings → General → Software Update, then come back.</p>
      </div>
    );
  }
  return (
    <div className="callout ios-guide" role="note" aria-label="Add to Home Screen">
      <strong>On iPhone, add help me outgrow to your Home Screen first</strong>
      {!compact && <p>iPhones deliver notes only to web apps on the Home Screen. It takes a few seconds:</p>}
      <ol>
        <li>Tap the <strong>Share</strong> button <span aria-hidden="true">(the square with an arrow)</span> in Safari’s toolbar.</li>
        <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        <li>Open <strong>help me outgrow</strong> from the new icon, and sign in and choose your notes there.</li>
      </ol>
      {!compact && <p className="muted small">Choices made here in Safari are not carried over to the Home Screen app, so you will pick them again there.</p>}
      {!compact && (noted ? <p className="small">Thanks, noted.</p>
        : <button className="btn secondary" onClick={() => { setNoted(true); void ns.track('ios_interest', { step: 'guide' }); }}>I will add it now</button>)}
    </div>
  );
}
