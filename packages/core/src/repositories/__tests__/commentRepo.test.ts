/**
 * The shape of the comment-thread query, and the guard on what `addComment` will write.
 *
 * A thread has no cap anywhere — not in Rules, not in the schema, not in a Function — so
 * `watchComments` used to re-deliver the whole discussion on every new reply
 * (checklists/phase-10 §5b). The fix is a page, and the interesting half of it is WHICH END the
 * page is taken from: a thread is read as a conversation, so the rows that matter are the last
 * ones. `limit()` would have kept the first N and frozen a long argument on its opening line,
 * which is a bug you only ever see on the threads that matter most. Hence `limitToLast`, and
 * hence a test that can tell the two apart — they differ by one identifier.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A recorded query constraint. The mocks below record instead of building anything. */
interface Constraint {
  readonly kind: string;
  readonly field?: string;
  readonly direction?: string;
  readonly count?: number;
}

interface Subscription {
  readonly source: { path: string };
  readonly constraints: readonly Constraint[];
}

const captured: { subscriptions: Subscription[]; writes: Record<string, unknown>[] } = {
  subscriptions: [],
  writes: [],
};

vi.mock('firebase/firestore', () => ({
  doc: () => ({ id: 'c_new' }),
  deleteDoc: () => Promise.resolve(),
  setDoc: (_reference: unknown, data: Record<string, unknown>) => {
    captured.writes.push(data);
    return Promise.resolve();
  },
  serverTimestamp: () => 'SERVER_TIMESTAMP',
  query: (source: unknown, ...constraints: Constraint[]) => ({ source, constraints }),
  orderBy: (field: string, direction = 'asc') => ({ kind: 'orderBy', field, direction }),
  limit: (count: number) => ({ kind: 'limit', count }),
  limitToLast: (count: number) => ({ kind: 'limitToLast', count }),
}));

vi.mock('../refs.js', () => ({
  commentsCollection: (groupId: string, expenseId: string) => ({
    path: `groups/${groupId}/expenses/${expenseId}/comments`,
  }),
  commentDoc: (groupId: string, expenseId: string, commentId: string) => ({
    path: `groups/${groupId}/expenses/${expenseId}/comments/${commentId}`,
  }),
}));

vi.mock('../subscribe.js', () => ({
  watchQuery: (built: Subscription) => {
    captured.subscriptions.push(built);
    return () => undefined;
  },
}));

const { COMMENTS_PAGE_SIZE, addComment, watchComments } = await import('../commentRepo.js');

/** The single query the subscription under test built. */
function subscription(): Subscription {
  expect(captured.subscriptions).toHaveLength(1);
  return captured.subscriptions[0]!;
}

beforeEach(() => {
  captured.subscriptions = [];
  captured.writes = [];
});

describe('watchComments', () => {
  it('subscribes to the expense’s own thread', () => {
    watchComments(
      'g1',
      'e1',
      () => undefined,
      () => undefined,
    );

    expect(subscription().source.path).toBe('groups/g1/expenses/e1/comments');
  });

  it('caps the thread, so a long dispute is not re-delivered in full on every reply', () => {
    watchComments(
      'g1',
      'e1',
      () => undefined,
      () => undefined,
    );

    expect(subscription().constraints).toContainEqual({
      kind: 'limitToLast',
      count: COMMENTS_PAGE_SIZE,
    });
  });

  it('🔴 pages from the newest end while still emitting oldest-first', () => {
    // `limit` and `limitToLast` differ by one identifier and both compile. The first keeps the
    // OPENING of an argument and never shows how it ended; only the second shows the reply that
    // resolved it. It is also the end an unacknowledged serverTimestamp() lands inside — such a
    // value sorts after every resolved one — which is what keeps `addComment`'s "the
    // subscription delivers it" true on a thread at the cap.
    watchComments(
      'g1',
      'e1',
      () => undefined,
      () => undefined,
    );

    const { constraints } = subscription();
    expect(constraints[0]).toEqual({ kind: 'orderBy', field: 'createdAt', direction: 'asc' });
    expect(constraints).not.toContainEqual({ kind: 'limit', count: COMMENTS_PAGE_SIZE });
  });
});

describe('addComment', () => {
  it('refuses an empty comment with a message written for a person', async () => {
    await expect(addComment('g1', 'e1', author('   '))).rejects.toThrow(
      'A comment must be 1 to 500 characters.',
    );
    expect(captured.writes).toHaveLength(0);
  });

  it('refuses one over the limit Rules would reject anyway', async () => {
    await expect(addComment('g1', 'e1', author('x'.repeat(501)))).rejects.toThrow(
      'A comment must be 1 to 500 characters.',
    );
    expect(captured.writes).toHaveLength(0);
  });

  it('trims the text and lets the server stamp the time (threat T7)', async () => {
    await addComment('g1', 'e1', author('  wasn’t this $40?  '));

    expect(captured.writes).toHaveLength(1);
    expect(captured.writes[0]).toMatchObject({
      uid: 'u1',
      text: 'wasn’t this $40?',
      createdAt: 'SERVER_TIMESTAMP',
      deletedAt: null,
    });
  });
});

/** A well-formed author snapshot carrying `text`. */
function author(text: string) {
  return { uid: 'u1', displayName: 'Priya Sharma', photoURL: null, text };
}
