/**
 * <List> — EVERY list in this app renders through it.
 *
 * docs/02 §contract rule 9: "Lists render through one `<List>` abstraction so it can become
 * `FlatList`." That is why the API is `data` / `renderItem` / `keyExtractor` and not
 * `children`: it is `FlatList`'s API, deliberately, so Phase 12 swaps the implementation
 * and every call site compiles unchanged. A `children`-based list would have to be rewritten
 * at every call site to get virtualisation on mobile.
 *
 * `empty` is a required consideration rather than an afterthought — docs/15: "Empty states
 * always offer the next action. No dead ends."
 *
 * TODO(phase-09): windowing for long lists. The web version renders everything; `FlatList`
 *   virtualises for free on native. Measure with a realistic expense count first
 *   (checklists/phase-09-polish-pwa.md §6).
 */

import type { ReactNode } from 'react';
import styles from './list.module.css';
import { cx, spaceVar, vars, type SpaceToken } from './tokenProps';

export interface ListProps<T> {
  data: readonly T[];
  /** One row. Return a `<ListRow>` — the row component, not a `<li>`. */
  renderItem: (item: T, index: number) => ReactNode;
  /**
   * A stable identity per row. Required, not derived from the index: React Router
   * re-renders on navigation and an index key makes optimistic inserts flicker.
   */
  keyExtractor: (item: T, index: number) => string;
  /** Shown instead of the rows when `data` is empty. Pass an `<EmptyState>`. */
  empty?: ReactNode | undefined;
  /** Gap between rows. Rows are usually flush with a `<Divider>` between them. */
  gap?: SpaceToken | undefined;
  /** Accessible name for the list region. */
  'aria-label'?: string | undefined;
  className?: string | undefined;
}

export function List<T>({
  data,
  renderItem,
  keyExtractor,
  empty,
  gap,
  className,
  ...rest
}: ListProps<T>) {
  if (data.length === 0) return <>{empty}</>;

  return (
    <ul
      className={cx(styles.list, className)}
      style={vars({ gap: gap === undefined ? undefined : spaceVar(gap) })}
      aria-label={rest['aria-label']}
    >
      {data.map((item, index) => (
        <li key={keyExtractor(item, index)} className={styles.listItem}>
          {renderItem(item, index)}
        </li>
      ))}
    </ul>
  );
}

/**
 * A sticky-feeling section label inside a list — "March 2026" above a month of expenses
 * (docs/07 §GroupDetail: "Expense list grouped by month, newest first").
 *
 * Rendered as part of the list body rather than as a real `position: sticky` element,
 * which has no `FlatList` equivalent; `FlatList` gets it as `ListSectionHeaderComponent`.
 */
export function ListSection({ children }: { children: ReactNode }) {
  return <div className={styles.listSection}>{children}</div>;
}
