/**
 * Relative timestamps for the activity feed and comment threads — "2h ago", "Yesterday",
 * "12 Mar" (checklists/phase-08-activity-comments.md §4).
 *
 * Two constraints shape everything below.
 *
 * **No ICU.** `toLocaleDateString` and `Intl.RelativeTimeFormat` are the obvious tools and both
 * are ICU-backed, so a trimmed Hermes build can return a different string — or throw — for input
 * the web app handles fine (docs/04-split-engine.md §1). The month names are therefore spelled
 * out here. That makes this module English-only, which matches an app that has no i18n layer
 * yet; when one arrives, this is the single function that needs a translation table.
 *
 * **The clock is an argument.** `now` is a parameter with a default rather than a `Date.now()`
 * buried in the middle, so every boundary below — the minute, the hour, midnight, New Year — is
 * testable without faking timers.
 *
 * "Yesterday" is a *calendar* judgement, not "24 hours ago": an expense added at 23:00 is
 * "Yesterday" at 00:30, not "1h ago". Calendar days are read in the host's local timezone,
 * which is the only reading a user would recognise as their own yesterday.
 */

/** English month abbreviations. A tuple, so `MONTH_NAMES[0]` is known to exist. */
const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;

/**
 * How far ahead of `now` a timestamp may sit before it stops being treated as "just now".
 *
 * Firestore server timestamps are minted on Google's clock and read against the device's, so a
 * comment can legitimately arrive a few seconds in the future. Rendering that as `-1m ago` — or
 * as a duration that counts *down* — looks like a bug to the user and is one to debug.
 */
const CLOCK_SKEW_TOLERANCE_MS = 60_000;

/** Epoch milliseconds from either accepted spelling. */
function toMillis(value: number | Date): number {
  return value instanceof Date ? value.getTime() : value;
}

/** Local midnight at the start of `date`'s calendar day, in epoch ms. */
function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** `"12 Mar"`, or `"12 Mar 2024"` when the year differs from the year of `reference`. */
function absoluteDate(date: Date, reference: Date): string {
  // Unreachable fallback: `getMonth()` is specified to return 0-11. It is here because
  // `noUncheckedIndexedAccess` cannot know that, and a `??` reads better than a cast.
  const month = MONTH_NAMES[date.getMonth()] ?? MONTH_NAMES[0];
  const stem = `${String(date.getDate())} ${month}`;
  return date.getFullYear() === reference.getFullYear()
    ? stem
    : `${stem} ${String(date.getFullYear())}`;
}

/**
 * A short, human relative timestamp.
 *
 * ```ts
 * formatRelativeTime(now - 30_000, now)      // 'Just now'
 * formatRelativeTime(now - 5 * 60_000, now)  // '5m ago'
 * formatRelativeTime(now - 2 * 3_600_000, now) // '2h ago'   (same calendar day)
 * formatRelativeTime(yesterdayEvening, now)  // 'Yesterday'
 * formatRelativeTime(lastMarch, now)         // '12 Mar'
 * formatRelativeTime(twoYearsAgo, now)       // '12 Mar 2024'
 * ```
 *
 * The ladder, in order:
 *
 * | Condition                                   | Output        |
 * | ------------------------------------------- | ------------- |
 * | under a minute old (or up to a minute ahead)| `Just now`    |
 * | under an hour old                           | `42m ago`     |
 * | earlier today                               | `5h ago`      |
 * | the previous calendar day                   | `Yesterday`   |
 * | earlier this year                           | `12 Mar`      |
 * | any other year                              | `12 Mar 2024` |
 * | further ahead than a minute                 | the date      |
 *
 * @param when The moment to describe — epoch milliseconds, or a `Date`. A Firestore
 *   `Timestamp` is not accepted directly; call `.toMillis()`, so that this module keeps no
 *   dependency on the Firebase SDK.
 * @param now The moment to describe it relative to. Defaults to the current time; pass it
 *   explicitly in tests and anywhere a whole list must be rendered against one consistent
 *   instant.
 * @throws {RangeError} if either argument is not a finite instant (an `Invalid Date`, or the
 *   `NaN` that `undefined` arithmetic produces upstream).
 */
export function formatRelativeTime(when: number | Date, now: number | Date = Date.now()): string {
  const whenMs = toMillis(when);
  const nowMs = toMillis(now);

  if (!Number.isFinite(whenMs) || !Number.isFinite(nowMs)) {
    throw new RangeError(
      `[splitsutra] formatRelativeTime received a non-finite instant: ` +
        `when=${String(whenMs)}, now=${String(nowMs)}.`,
    );
  }

  const whenDate = new Date(whenMs);
  const nowDate = new Date(nowMs);
  const elapsed = nowMs - whenMs;

  // Ahead of the clock. A little is server skew; a lot is a genuinely future-dated item, and
  // "in -3 days" is not a phrase, so those fall through to an absolute date.
  if (elapsed < 0) {
    return -elapsed <= CLOCK_SKEW_TOLERANCE_MS ? 'Just now' : absoluteDate(whenDate, nowDate);
  }

  if (elapsed < MS_PER_MINUTE) return 'Just now';

  if (elapsed < MS_PER_HOUR) {
    return `${String(Math.floor(elapsed / MS_PER_MINUTE))}m ago`;
  }

  // Calendar difference, not `elapsed / MS_PER_DAY`: a DST transition makes a local day 23 or
  // 25 hours long, and dividing would call an evening event "Yesterday" on the wrong morning.
  // Rounding absorbs that hour; the operands are both local midnights, so the quotient is
  // otherwise a whole number.
  const dayDelta = Math.round((startOfLocalDay(nowDate) - startOfLocalDay(whenDate)) / MS_PER_DAY);

  if (dayDelta === 0) return `${String(Math.floor(elapsed / MS_PER_HOUR))}h ago`;
  if (dayDelta === 1) return 'Yesterday';

  return absoluteDate(whenDate, nowDate);
}

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Month headings — the expense ledger's section labels
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Full month names, for section headings.
 *
 * A second table rather than a suffix on {@link MONTH_NAMES}, because "Sep" abbreviates and
 * "September" does not, and both spellings are wanted in different places: a row's date is
 * squeezed next to a payer's name, a section heading has the width to be read as a word. The
 * same no-ICU reasoning that spelled out the abbreviations applies here — `toLocaleDateString`
 * with `{ month: 'long' }` is the obvious tool and is exactly the ICU dependency this module
 * exists to avoid.
 */
const MONTH_NAMES_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

/**
 * A sortable, comparable identity for the calendar month `when` falls in — `"2026-08"`.
 *
 * The month is read in the **host's local timezone**, matching {@link formatRelativeTime}'s
 * "Yesterday": an expense added at 23:00 on the 31st belongs to the month the person who
 * entered it was living in, not to UTC's.
 *
 * Zero-padded so lexical order is chronological order, which is what lets a grouping pass sort
 * by key without converting back to a date.
 */
export function monthKey(when: number | Date): string {
  const date = when instanceof Date ? when : new Date(when);
  const month = date.getMonth() + 1;
  return `${String(date.getFullYear())}-${month < 10 ? '0' : ''}${String(month)}`;
}

/**
 * `"August"`, or `"August 2025"` when the year differs from the year of `now`.
 *
 * The year is dropped for the current one on the same reasoning as {@link formatRelativeTime}'s
 * absolute dates: it is the year the reader is already in, so printing it is noise that makes
 * the headings that *do* carry a year harder to notice.
 */
export function formatMonthLabel(when: number | Date, now: number | Date = Date.now()): string {
  const date = when instanceof Date ? when : new Date(when);
  const reference = now instanceof Date ? now : new Date(now);

  // `getMonth()` is specified to return 0-11; the fallback is here because
  // `noUncheckedIndexedAccess` cannot know that.
  const month = MONTH_NAMES_LONG[date.getMonth()] ?? MONTH_NAMES_LONG[0];

  return date.getFullYear() === reference.getFullYear()
    ? month
    : `${month} ${String(date.getFullYear())}`;
}
