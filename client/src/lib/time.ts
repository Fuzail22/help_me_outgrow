import type { Slot } from '@notification-service/sdk';

export const DAYS = [
  { day: 1, short: 'Mon' }, { day: 2, short: 'Tue' }, { day: 3, short: 'Wed' }, { day: 4, short: 'Thu' },
  { day: 5, short: 'Fri' }, { day: 6, short: 'Sat' }, { day: 7, short: 'Sun' },
];
export const DURATIONS = [
  { days: 7, label: '1 week' }, { days: 14, label: 'A fortnight' }, { days: 30, label: '1 month' }, { days: 92, label: '3 months' },
];

// Browsers still report a few renamed zones under their old names; show and store the current one.
const RENAMED: Record<string, string> = { 'Asia/Calcutta': 'Asia/Kolkata', 'Asia/Katmandu': 'Asia/Kathmandu', 'Asia/Saigon': 'Asia/Ho_Chi_Minh', 'Asia/Rangoon': 'Asia/Yangon' };
export const browserTimezone = () => { const z = Intl.DateTimeFormat().resolvedOptions().timeZone; return RENAMED[z] ?? z; };
export const timezones = (): string[] => { try { return [...new Set(Intl.supportedValuesOf('timeZone').map((z) => RENAMED[z] ?? z))].sort(); } catch { return [browserTimezone()]; } };

/** Today's calendar date in a timezone, YYYY-MM-DD. */
export const todayIn = (tz: string, now = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
export function addDays(isoDate: string, n: number) {
  const d = new Date(isoDate + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
/** Last day of an enrolment that starts today and runs for `days` days, counting today. */
export const endDateFor = (tz: string, days: number) => addDays(todayIn(tz), days - 1);

export const toSlots = (days: number[], times: string[]): Slot[] => days.flatMap((day) => times.map((time) => ({ day, time })));
export function fromSlots(slots: Slot[]) {
  return { days: [...new Set(slots.map((s) => s.day))].sort(), times: [...new Set(slots.map((s) => s.time))].sort() };
}

export const formatTime = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
};
export function describeSchedule(slots: Slot[]) {
  const { days, times } = fromSlots(slots);
  const d = days.length === 7 ? 'Every day' : days.length === 5 && !days.includes(6) && !days.includes(7) ? 'Weekdays' : days.map((x) => DAYS[x - 1].short).join(', ');
  return `${d} at ${times.map(formatTime).join(', ')}`;
}
export const formatWhen = (iso: string, tz: string) =>
  new Intl.DateTimeFormat([], { timeZone: tz, weekday: 'long', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const formatDate = (isoDate: string) =>
  new Intl.DateTimeFormat([], { timeZone: 'UTC', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(isoDate + 'T00:00:00Z'));
