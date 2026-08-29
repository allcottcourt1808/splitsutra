/**
 * The feed's contract with the user: the pre-rendered summary shown verbatim, one relative
 * timestamp, the amount where there is one, and a link that lands on the right target.
 *
 * The N-query merge itself is `useActivity`'s job and is tested there (`core/src/hooks/__tests__`).
 * What this file holds is that the screen renders whatever order it is handed, keeps rows from
 * two different groups distinct, and never collapses loading / error / empty into one another.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Activity } from '@splitsutra/core';
import type { ActivityFeedEntry } from '@splitsutra/core/hooks';

import { renderAt } from '../../__tests__/helpers/render';
import { paths } from '../../navigation/paths';
import { ActivityScreen } from '../ActivityScreen';

const state = vi.hoisted(() => ({
  entries: [] as unknown[],
  loading: false,
  error: null as Error | null,
  hasMore: false,
  loadMore: vi.fn(),
}));

vi.mock('@splitsutra/core/hooks', () => ({
  useActivity: () => ({
    entries: state.entries,
    loading: state.loading,
    error: state.error,
    hasMore: state.hasMore,
    loadMore: state.loadMore,
  }),
}));

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Fixtures
 * ────────────────────────────────────────────────────────────────────────────────────────── */

/**
 * Timestamps are anchored to the moment the test runs, so `formatRelativeTime` — which is the
 * real implementation here, not a mock — stays on the "Just now" rung of its ladder no matter
 * what time of day the suite runs at. A fixed date would land on a different rung at midnight.
 */
function justNow(): Activity['createdAt'] {
  const ms = Date.now();
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
    toDate: () => new Date(ms),
  } as unknown as Activity['createdAt'];
}

interface EntryOverrides {
  readonly type?: Activity['type'];
  readonly targetId?: string | null;
  readonly amountMinor?: number | null;
  readonly currency?: string | null;
  readonly isImplicit?: boolean;
  readonly groupName?: string;
  readonly actorName?: string;
}

function entry(
  groupId: string,
  activityId: string,
  summary: string,
  overrides: EntryOverrides = {},
): ActivityFeedEntry {
  return {
    groupId,
    groupName: overrides.groupName ?? 'Goa Trip',
    isImplicit: overrides.isImplicit ?? false,
    activity: {
      id: activityId,
      type: overrides.type ?? 'expense.created',
      actorUid: 'u1',
      actorName: overrides.actorName ?? 'Priya Sharma',
      targetId: overrides.targetId === undefined ? 'e1' : overrides.targetId,
      summary,
      amountMinor: overrides.amountMinor ?? null,
      currency: overrides.currency ?? null,
      createdAt: justNow(),
    },
  } as unknown as ActivityFeedEntry;
}

function visit(): HTMLElement {
  return renderAt(<ActivityScreen />, paths.ActivityFeed()).container;
}

function rows(container: HTMLElement): Element[] {
  return [...container.querySelectorAll('ul[aria-label="Activity"] > li')];
}

beforeEach(() => {
  state.entries = [];
  state.loading = false;
  state.error = null;
  state.hasMore = false;
  state.loadMore = vi.fn();
});

/* ────────────────────────────────────────────────────────────────────────────────────────── *
 * Tests
 * ────────────────────────────────────────────────────────────────────────────────────────── */

describe('<ActivityScreen>', () => {
  it('says it is loading before the first answer arrives', () => {
    state.loading = true;

    const container = visit();

    expect(container.textContent).toContain('Loading');
    expect(rows(container)).toHaveLength(0);
  });

  it('reports a failed subscription instead of an empty feed', () => {
    // An N-query fan-out that half fails must not read as "nothing has happened".
    state.error = new Error('permission denied');

    const container = visit();

    expect(container.textContent).toContain('permission denied');
    expect(container.textContent).not.toContain('Nothing has happened yet');
  });

  it('offers the next action when there is nothing to show', () => {
    const container = visit();

    expect(container.textContent).toContain('Nothing has happened yet');
    expect(container.querySelector(`a[href="${paths.AddExpense()}"]`)).not.toBeNull();
  });

  it('shows the server-rendered summary verbatim, with the actor and a relative time', () => {
    state.entries = [entry('g1', 'a1', 'Priya added "Dinner"')];

    const text = visit().textContent ?? '';

    expect(text).toContain('Priya added "Dinner"');
    expect(text).toContain('Just now');
    expect(text).toContain('Goa Trip');
  });

  it('renders the amount when the entry carries one, and nothing when it does not', () => {
    state.entries = [
      entry('g1', 'a1', 'Priya added "Dinner"', { amountMinor: 2500, currency: 'USD' }),
      entry('g1', 'a2', 'Priya joined the group', { type: 'member.joined', targetId: 'u1' }),
    ];

    const container = visit();
    const [withAmount, withoutAmount] = rows(container);

    expect(withAmount?.textContent).toContain('25.00');
    expect(withoutAmount?.textContent).not.toContain('25.00');
  });

  it('keeps the order it was handed, and keeps two groups apart', () => {
    // The merge is the hook's; the screen must not re-sort or dedupe. Both entries share an
    // activity id — ids are unique per group, not globally, so the key has to include the group.
    state.entries = [
      entry('g1', 'shared', 'Priya added "Dinner"', { groupName: 'Goa Trip' }),
      entry('g2', 'shared', 'Ravi added "Rent"', { groupName: 'Flat' }),
    ];

    const container = visit();
    const rendered = rows(container);

    expect(rendered).toHaveLength(2);
    expect(rendered[0]?.textContent).toContain('Priya added "Dinner"');
    expect(rendered[0]?.textContent).toContain('Goa Trip');
    expect(rendered[1]?.textContent).toContain('Ravi added "Rent"');
    expect(rendered[1]?.textContent).toContain('Flat');
  });

  it('links an expense event to that expense', () => {
    state.entries = [entry('g1', 'a1', 'Priya added "Dinner"', { targetId: 'e9' })];

    const container = visit();

    expect(
      container.querySelector(`a[href="${paths.ExpenseDetail({ gid: 'g1', eid: 'e9' })}"]`),
    ).not.toBeNull();
  });

  it('links a settlement or membership event to the group', () => {
    state.entries = [
      entry('g1', 'a1', 'Ravi paid Priya', { type: 'settlement.created', targetId: 's1' }),
      entry('g1', 'a2', 'Ravi joined the group', { type: 'member.joined', targetId: 'u2' }),
    ];

    const container = visit();
    const groupLinks = container.querySelectorAll(`a[href="${paths.GroupDetail({ gid: 'g1' })}"]`);

    expect(groupLinks).toHaveLength(2);
  });

  it('does not link a row from the implicit friend group, which has no group screen', () => {
    state.entries = [
      entry('gf', 'a1', 'Priya paid you', {
        type: 'settlement.created',
        targetId: 's1',
        isImplicit: true,
      }),
    ];

    const container = visit();

    expect(rows(container)).toHaveLength(1);
    expect(container.querySelector('ul[aria-label="Activity"] a')).toBeNull();
  });

  it('offers no pagination control while the whole feed is on screen', () => {
    state.entries = [entry('g1', 'a1', 'Priya added "Dinner"')];

    expect(visit().textContent).not.toContain('Load older activity');
  });

  it('widens the window when there is more to fetch', () => {
    state.entries = [entry('g1', 'a1', 'Priya added "Dinner"')];
    state.hasMore = true;

    const container = visit();
    const button = [...container.querySelectorAll('button')].find((el) =>
      (el.textContent ?? '').includes('Load older activity'),
    );

    expect(button).toBeDefined();
    act(() => {
      button?.click();
    });

    expect(state.loadMore).toHaveBeenCalledTimes(1);
  });
});
