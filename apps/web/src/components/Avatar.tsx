/**
 * <Avatar> / <AvatarStack> — initials fallback, overlapping stack with "+N".
 *
 * Avatar upload is deferred (checklists/phase-03-auth.md §5, 🟢 "requires Storage. Use
 * initials avatars for now"), so the initials path is the one that actually ships in v1
 * and the image path is here for provider photos that arrive free with Google sign-in.
 *
 * TODO(phase-04): the deterministic per-uid colour from docs/07 §Component library.
 *   It is deliberately NOT implemented as `hsl(hash(uid), …)`: a computed colour is a
 *   hard-coded colour by another name, and Article IX admits none. The token set needs a
 *   small palette of avatar background roles first (checklists/phase-04-design-system.md
 *   §1 owns tokens.ts, which is outside this partition). Until then every avatar uses the
 *   neutral surface, which is correct-if-plain rather than wrong-and-pretty.
 */

import styles from './list.module.css';
import { cx, sizeVar, vars, type SizeToken } from './tokenProps';

/** Avatar diameters, from the token scale. */
export type AvatarSize = Extract<SizeToken, 'avatarSm' | 'avatarMd' | 'avatarLg'>;

/**
 * First letter of the first two words: "Priya Sharma" -> "PS", "Goa Trip" -> "GT".
 *
 * `Intl.Segmenter` is not used: `[...name]` iterates by code point, which is enough to keep
 * a leading emoji or an Indic grapheme from being sliced in half, and it works identically
 * under Hermes.
 */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.slice(0, 2).map((word) => [...word][0] ?? '');
  const joined = letters.join('');
  return joined.length > 0 ? joined.toUpperCase() : '?';
}

export interface AvatarProps {
  /** Display name, or a group name. Drives the initials and the accessible name. */
  name: string;
  photoURL?: string | null | undefined;
  size?: AvatarSize | undefined;
  /**
   * `true` when the avatar sits next to the name it represents, which is the common case in
   * a list row. The image is then decorative and announcing it would read the name twice.
   */
  decorative?: boolean | undefined;
  className?: string | undefined;
}

export function Avatar({
  name,
  photoURL,
  size = 'avatarMd',
  decorative = true,
  className,
}: AvatarProps) {
  const style = vars({ '--avatar-size': sizeVar(size) });

  if (photoURL !== null && photoURL !== undefined && photoURL.length > 0) {
    return (
      <span className={cx(styles.avatar, className)} style={style}>
        <img
          className={styles.avatarImage}
          src={photoURL}
          alt={decorative ? '' : name}
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  return (
    <span
      className={cx(styles.avatar, className)}
      style={style}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative ? true : undefined}
    >
      <span className={styles.avatarInitials}>{initialsFor(name)}</span>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* AvatarStack                                                                */
/* -------------------------------------------------------------------------- */

export interface AvatarStackPerson {
  readonly uid: string;
  readonly displayName: string;
  readonly photoURL?: string | null | undefined;
}

export interface AvatarStackProps {
  people: readonly AvatarStackPerson[];
  /** How many faces to show before collapsing into "+N". */
  max?: number | undefined;
  size?: AvatarSize | undefined;
}

/**
 * Overlapping avatars with a "+N" overflow chip — the member stack in the group header
 * (docs/07 §GroupDetail).
 *
 * The whole stack carries ONE accessible name listing everyone, rather than N labelled
 * images, so a screen reader says "Members: Priya, Rohan and 3 others" instead of reading
 * five avatars in a row.
 */
export function AvatarStack({ people, max = 4, size = 'avatarSm' }: AvatarStackProps) {
  const shown = people.slice(0, max);
  const overflow = people.length - shown.length;

  const names = people.map((p) => p.displayName).join(', ');

  return (
    <span className={styles.avatarStack} role="img" aria-label={`Members: ${names}`}>
      {shown.map((person) => (
        <Avatar
          key={person.uid}
          name={person.displayName}
          photoURL={person.photoURL}
          size={size}
          className={styles.avatarStackItem}
        />
      ))}
      {overflow > 0 && (
        <span
          className={cx(styles.avatar, styles.avatarStackItem)}
          style={vars({ '--avatar-size': sizeVar(size) })}
          aria-hidden
        >
          <span className={styles.avatarInitials}>{`+${String(overflow)}`}</span>
        </span>
      )}
    </span>
  );
}
