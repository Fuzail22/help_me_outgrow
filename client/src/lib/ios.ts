/**
 * iPhone and iPad specifics (R5).
 *
 * iOS delivers web push only to a web app opened from the Home Screen, from iOS 16.4. In a Safari (or
 * Chrome, Firefox …) tab it never can, so iPhone visitors are guided to Add to Home Screen first.
 */
export const MIN_IOS: [number, number] = [16, 4];

export interface IosInfo {
  isIOS: boolean;
  /** Inside the Home Screen app (standalone display mode). */
  standalone: boolean;
  /** [major, minor] when the user-agent says it; null when it does not. */
  version: [number, number] | null;
  /** Known to be older than 16.4, so web push is impossible until the person updates. */
  tooOld: boolean;
  /** In a browser tab on iOS: show the Add to Home Screen guide instead of the normal flow. */
  needsHomeScreen: boolean;
}

export function iosInfo(nav: Navigator = navigator, win: Window = window): IosInfo {
  const ua = nav.userAgent || '';
  // iPadOS 13+ reports a desktop Mac user-agent; touch support gives it away.
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1);
  const standalone = (nav as any).standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches;
  let version: [number, number] | null = null;
  const os = ua.match(/OS (\d+)[_.](\d+)/); // "CPU iPhone OS 17_2 like Mac OS X"
  const safari = ua.match(/Version\/(\d+)\.(\d+)/); // iPadOS desktop mode: Safari's version tracks the OS
  if (isIOS && os && /like Mac OS X/.test(ua)) version = [Number(os[1]), Number(os[2])];
  else if (isIOS && safari) version = [Number(safari[1]), Number(safari[2])];
  const tooOld = !!version && (version[0] < MIN_IOS[0] || (version[0] === MIN_IOS[0] && version[1] < MIN_IOS[1]));
  return { isIOS, standalone, version, tooOld, needsHomeScreen: isIOS && !standalone };
}
