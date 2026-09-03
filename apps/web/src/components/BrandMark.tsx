/**
 * The SplitSutra mark.
 *
 * A component rather than an `<img>` written into a screen, because "no raw DOM in a screen
 * file" is a real rule here: screens compose `<Screen>`, `<Stack>`, `<Row>` and `<Card>`, which
 * map 1:1 onto React Native primitives, and anything that genuinely needs a DOM node lives in a
 * non-screen module so the port has exactly one file to swap.
 *
 * 🔴 Decorative by default, and that is deliberate rather than lazy. Everywhere this is used the
 * wordmark "SplitSutra" is already on screen as text beside it, so a real `alt` makes a screen
 * reader announce the name twice in a row (NFR-5). Pass `label` only where the mark appears
 * WITHOUT the wordmark next to it — then it is the only thing carrying the name and has to say
 * so.
 *
 * Serves `/favicon.svg`: the same 430-byte mark the browser tab uses, self-contained with its
 * own background, and crisp at any size — the PNGs in `public/` exist for the manifest, where a
 * raster is required, and would be soft scaled up here.
 */

import styles from './brandMark.module.css';

export interface BrandMarkProps {
  /** Accessible name. Omit when the wordmark is already beside it — see above. */
  readonly label?: string | undefined;
}

export function BrandMark({ label }: BrandMarkProps) {
  return (
    <img
      className={styles.mark}
      src="/favicon.svg"
      alt={label ?? ''}
      {...(label === undefined ? { 'aria-hidden': true } : {})}
      // Intrinsic size so the box is reserved before the file arrives and the heading below it
      // does not jump (docs/15: reserved height, the same discipline as the error slot).
      width={64}
      height={64}
      draggable={false}
    />
  );
}
