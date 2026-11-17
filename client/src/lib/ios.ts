/**
 * iPhone and iPad facts the app needs (R5). iOS delivers web push only to a site added to the Home Screen,
 * from iOS 16.4, and shows no notification action buttons or images.
 */
export interface IosInfo { isIOS: boolean; version: { major: number; minor: number } | null; standalone: boolean; tooOld: boolean }

export const MIN_IOS = { major: 16, minor: 4 };

export function iosInfo(ua: string = navigator.userAgent, nav: Navigator = navigator, win: Window = window): IosInfo {
  // iPadOS reports a Mac user-agent; a touch screen gives it away.
  const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints ?? 0) > 1);
  const m = /OS (\d+)_(\d+)/.exec(ua) ?? (isIOS ? /Version\/(\d+)\.(\d+)/.exec(ua) : null);
  const version = isIOS && m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
  const standalone = !!(win.matchMedia?.('(display-mode: standalone)').matches || (nav as any).standalone === true);
  const tooOld = !!version && (version.major < MIN_IOS.major || (version.major === MIN_IOS.major && version.minor < MIN_IOS.minor));
  return { isIOS, version, standalone, tooOld };
}

/** True in Safari (or another iOS browser) where notifications cannot work until the site is on the Home Screen. */
export const needsHomeScreen = (i: IosInfo = iosInfo()) => i.isIOS && !i.standalone;
