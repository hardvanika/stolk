// Time zone helpers without dependencies. Stölk stores local wall-clock dates and times
// (YYYY-MM-DD, HH:MM) in the user's zone; the APIs speak UTC instants.

export const DEFAULT_TZ = process.env.STOLK_TZ || 'Europe/Madrid';

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  });
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(d)) o[p.type] = p.value;
  return o;
}

/** UTC instant → local {date, time} in tz. */
export function toLocal(instant: string | Date, tz = DEFAULT_TZ): { date: string; time: string } {
  const p = parts(new Date(instant), tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Local date + time in tz → UTC Date. Handles DST by correcting with the zone's offset at that moment. */
export function toUtc(date: string, time: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t: number) => {
    const p = parts(new Date(t), tz);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t); // second pass fixes guesses that straddle a DST change
  return new Date(t);
}

/** Minutes between two local HH:MM on the same day (end before start counts as next day). */
export function minutesBetween(start: string, end: string): number {
  const [a, b] = start.split(':').map(Number);
  const [c, e] = end.split(':').map(Number);
  let m = c * 60 + e - (a * 60 + b);
  if (m <= 0) m += 24 * 60;
  return m;
}
