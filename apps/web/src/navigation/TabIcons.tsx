/**
 * The five bottom-tab glyphs.
 *
 * Inline SVG rather than emoji. docs/07 sketches the tab bar with emoji (👥 🧑‍🤝‍🧑 ➕ 🔔 ⚙️),
 * which is fine for an ASCII wireframe but not for shipping: emoji render at whatever size
 * and colour the platform font decides, ignore `currentColor`, and ZWJ sequences like
 * 🧑‍🤝‍🧑 fall apart into two glyphs on several desktop platforms.
 *
 * These are sized in `em` and stroked in `currentColor`, so the size comes from one font
 * token and the active/inactive colour comes from the tab's own class — no colour or pixel
 * value appears here (Article IX).
 *
 * Phase 12: `react-native-svg` accepts these same paths verbatim.
 *
 * Every icon is `aria-hidden`. The tab's accessible name is its visible text label, and an
 * icon that also announced itself would make every tab read twice (NFR-4).
 */

import type { ComponentType } from 'react';
import type { TabKey } from './paths';

interface IconProps {
  readonly className?: string | undefined;
}

const COMMON = {
  viewBox: '0 0 24 24',
  width: '1em',
  height: '1em',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

/** Groups — overlapping people. */
function GroupsIcon({ className }: IconProps) {
  return (
    <svg {...COMMON} className={className}>
      <circle cx="9" cy="8" r="3.25" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.5a3.25 3.25 0 0 1 0 6" />
      <path d="M17.5 14.5a5.5 5.5 0 0 1 3 5" />
    </svg>
  );
}

/** Friends — one person with a plus. */
function FriendsIcon({ className }: IconProps) {
  return (
    <svg {...COMMON} className={className}>
      <circle cx="10" cy="8" r="3.5" />
      <path d="M3.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M19 8.5v5M16.5 11h5" />
    </svg>
  );
}

/** Add — the raised centre action. */
function AddIcon({ className }: IconProps) {
  return (
    <svg {...COMMON} strokeWidth={2.25} className={className}>
      <path d="M12 5.5v13M5.5 12h13" />
    </svg>
  );
}

/** Activity — a bell. */
function ActivityIcon({ className }: IconProps) {
  return (
    <svg {...COMMON} className={className}>
      <path d="M6 10a6 6 0 0 1 12 0c0 3.5.9 5.2 1.8 6.2a.6.6 0 0 1-.45 1H4.65a.6.6 0 0 1-.45-1C5.1 15.2 6 13.5 6 10Z" />
      <path d="M10 20.2a2.2 2.2 0 0 0 4 0" />
    </svg>
  );
}

/** Account — a gear. */
function AccountIcon({ className }: IconProps) {
  return (
    <svg {...COMMON} className={className}>
      <circle cx="12" cy="12" r="3.25" />
      <path d="M12 2.75l1.4 2.6 2.9-.5.6 2.9 2.6 1.4-1.5 2.55L19.5 15l-2.6 1.4-.6 2.9-2.9-.5L12 21.4l-1.4-2.6-2.9.5-.6-2.9L4.5 15 6 12.6 4.5 10.05l2.6-1.4.6-2.9 2.9.5Z" />
    </svg>
  );
}

/** Tab key -> glyph. A literal-union key means a missing entry is a compile error. */
export const TAB_ICONS: Readonly<Record<TabKey, ComponentType<IconProps>>> = {
  groups: GroupsIcon,
  friends: FriendsIcon,
  add: AddIcon,
  activity: ActivityIcon,
  account: AccountIcon,
};
