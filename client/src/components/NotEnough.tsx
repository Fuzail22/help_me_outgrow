import { formatDate } from '../lib/time';

export interface NotEnoughInfo { needed: number; available: number; endDate: string | null; timesPerDay: number | null }

/** The topic has fewer quotes than the schedule needs: offer an earlier end, fewer times a day, or looping. */
export function NotEnough({ info, onEndDate, onTimes, onLoop }: { info: NotEnoughInfo; onEndDate: (d: string) => void; onTimes: (n: number) => void; onLoop: () => void }) {
  return (
    <div className="callout warn" role="alert">
      <strong>This topic has {info.available} notes; your schedule needs {info.needed}.</strong>
      <p>Choose one way to make it fit:</p>
      <div className="actions left wrap">
        {info.endDate && <button className="btn secondary" onClick={() => onEndDate(info.endDate!)}>End on {formatDate(info.endDate)}</button>}
        {info.timesPerDay && <button className="btn secondary" onClick={() => onTimes(info.timesPerDay!)}>{info.timesPerDay} {info.timesPerDay === 1 ? 'time' : 'times'} a day</button>}
        <button className="btn secondary" onClick={onLoop}>Start again from the first note when it runs out</button>
      </div>
    </div>
  );
}
