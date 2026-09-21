/** Utilitaires de date, tous calés sur le fuseau de l'établissement. */

export const TZ = 'Europe/Paris';

const DAY_MS = 86_400_000;

/** `Date` → `AAAA-MM-JJ` en heure de Paris. */
export function isoDay(date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(date);
}

/** Lundi de la semaine contenant `iso` (`AAAA-MM-JJ`). */
export function mondayOf(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(d);
  const shift = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(weekday);
  return isoDay(new Date(d.getTime() - (shift < 0 ? 0 : shift) * DAY_MS));
}

export function addDays(iso, count) {
  return isoDay(new Date(new Date(`${iso}T12:00:00Z`).getTime() + count * DAY_MS));
}

export function today() {
  return isoDay(new Date());
}

/** Numéro de semaine ISO 8601. */
export function weekNumber(iso) {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  return 1 + Math.round((d - firstThursday) / (7 * DAY_MS));
}

const timeFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const dayLongFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' });
const dayShortFmt = new Intl.DateTimeFormat('fr-FR', { timeZone: TZ, weekday: 'short' });

export const formatTime = (iso) => timeFmt.format(new Date(iso));
export const formatDayLong = (iso) => dayLongFmt.format(new Date(`${iso}T12:00:00Z`));
export const formatDayShort = (iso) => dayShortFmt.format(new Date(`${iso}T12:00:00Z`)).replace('.', '');
export const dayNumber = (iso) => Number(iso.slice(8, 10));

/** Durée en minutes entre deux instants ISO. */
export function durationMinutes(start, end) {
  return Math.round((new Date(end) - new Date(start)) / 60_000);
}

export function formatDuration(start, end) {
  const total = durationMinutes(start, end);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return `${h} h ${String(m).padStart(2, '0')}`;
  if (h) return `${h} h`;
  return `${m} min`;
}

const hourMinuteFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

/** Minutes écoulées depuis minuit (heure de Paris) pour un instant ISO. */
export function minutesOfDay(iso) {
  const [h, m] = hourMinuteFmt.format(new Date(iso)).split(':');
  return Number(h) * 60 + Number(m);
}

/** `510` → `08:30`. */
export function formatMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
