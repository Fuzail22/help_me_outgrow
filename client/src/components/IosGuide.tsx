import { useEffect } from 'react';
import { ns } from '../lib/ns';
import { iosInfo, MIN_IOS } from '../lib/ios';

/** The Share icon as Safari draws it, so the step can point at the right button. */
const ShareIcon = () => (
  <svg className="share-icon" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v12" /><path d="M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
  </svg>
);

/**
 * Shown to iPhone and iPad visitors in a browser tab, before sign-in (R5). iOS only delivers web push to a
 * site added to the Home Screen (iOS 16.4 or later); older versions are told to update.
 */
export function IosGuide({ where }: { where: 'landing' | 'start' | 'manage' }) {
  const info = iosInfo();
  // Counted once, where the flow would otherwise start, with the platform's existing `unsupported` event.
  useEffect(() => {
    if (where === 'start') void ns.track('unsupported', { reason: info.tooOld ? 'ios_too_old' : 'ios_needs_home_screen', iosVersion: info.version?.join('.') ?? 'unknown' });
  }, [where, info.tooOld]); // eslint-disable-line react-hooks/exhaustive-deps

  if (info.tooOld) {
    return (
      <div className="callout warn ios-guide" role="note" aria-label="Update iOS">
        <strong>Update your iPhone to use help me outgrow.</strong>
        <p>Notes from websites need iOS {MIN_IOS.join('.')} or later{info.version ? ` (this one has iOS ${info.version.join('.')})` : ''}.
          Open <em>Settings</em> › <em>General</em> › <em>Software Update</em>, then come back to this page.</p>
      </div>
    );
  }
  return (
    <div className="callout ios-guide" role="note" aria-label="Add to Home Screen">
      <strong>On iPhone, add help me outgrow to your Home Screen first.</strong>
      <p>iPhones only deliver notes to sites opened from the Home Screen. It takes three taps:</p>
      <ol className="steps">
        <li>Tap the <strong>Share</strong> button <ShareIcon /> in the browser bar.</li>
        <li>Scroll down and choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        <li>Open <strong>outgrow</strong> from your Home Screen and continue there.</li>
      </ol>
      <p className="muted small">Nothing is saved until you do. You will sign in and choose your times inside the app.</p>
    </div>
  );
}
