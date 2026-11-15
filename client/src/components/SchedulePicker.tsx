import { DAYS } from '../lib/time';

interface Props { days: number[]; times: string[]; maxTimes: number; onChange: (v: { days: number[]; times: string[] }) => void }

/** Which days, and up to `maxTimes` times of day. */
export function SchedulePicker({ days, times, maxTimes, onChange }: Props) {
  const toggle = (d: number) => onChange({ days: days.includes(d) ? days.filter((x) => x !== d) : [...days, d].sort(), times });
  const setTime = (i: number, v: string) => onChange({ days, times: times.map((t, j) => (j === i ? v : t)) });
  const duplicate = new Set(times).size !== times.length;
  return (
    <div className="schedule">
      <fieldset>
        <legend>Days</legend>
        <div className="chips">
          {DAYS.map((d) => (
            <button type="button" key={d.day} className={'chip' + (days.includes(d.day) ? ' on' : '')} aria-pressed={days.includes(d.day)} onClick={() => toggle(d.day)}>{d.short}</button>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Times <span className="muted">(up to {maxTimes} a day)</span></legend>
        <div className="times">
          {times.map((t, i) => (
            <div className="time-row" key={i}>
              <input type="time" aria-label={`Time ${i + 1}`} value={t} onChange={(e) => setTime(i, e.target.value)} />
              {times.length > 1 && <button type="button" className="link" aria-label={`Remove time ${i + 1}`} onClick={() => onChange({ days, times: times.filter((_, j) => j !== i) })}>Remove</button>}
            </div>
          ))}
          {times.length < maxTimes && (
            <button type="button" className="link" onClick={() => onChange({ days, times: [...times, ['13:00', '21:00', '18:00'].find((t) => !times.includes(t)) ?? '12:00'] })}>+ Add another time</button>
          )}
        </div>
        {duplicate && <p className="error" role="alert">Two times are the same. Change one of them.</p>}
        {!days.length && <p className="error" role="alert">Pick at least one day.</p>}
      </fieldset>
    </div>
  );
}
export const scheduleValid = (days: number[], times: string[]) => days.length > 0 && times.length > 0 && times.every(Boolean) && new Set(times).size === times.length;
