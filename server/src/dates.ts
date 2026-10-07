/** Lundi de la semaine contenant `date`, en heure de Paris. */
export function mondayOf(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const shift = days.indexOf(map.weekday as string);
  const local = new Date(`${map.year}-${map.month}-${map.day}T00:00:00Z`);
  local.setUTCDate(local.getUTCDate() - (shift < 0 ? 0 : shift));
  return local.toISOString().slice(0, 10);
}
