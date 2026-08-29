/**
 * The bottom tab bar — Groups · Friends · **Add** · Activity · Account.
 *
 * docs/07 §Navigation model: five destinations, and the centre Add is a raised FAB-style
 * button that opens the Add Expense flow as a modal. It is an action, not a destination,
 * so it never renders as the current tab.
 *
 * Maps 1:1 onto `createBottomTabNavigator` in Phase 12 — {@link TABS} is the screen list,
 * `<Pressable to=…>` becomes `navigation.navigate(...)`, and the raised button becomes a
 * custom `tabBarButton`.
 *
 * Accessibility (NFR-4):
 *   - the visible text label IS the accessible name; icons are `aria-hidden`
 *   - the active tab carries `aria-current="page"`, so the current destination is
 *     announced rather than only coloured
 *   - every target is >= 44x44 by construction — `<Pressable>` enforces it
 *   - the pending-request badge is folded into that accessible name ("Friends, 2 pending
 *     requests") rather than left as a bare number beside it. A count that is only a coloured
 *     dot is exactly the "colour is never the only signal" failure in phase-04 §6, and a
 *     separate text node would announce as an orphaned digit.
 *
 * ## The badge is the in-app notification
 *
 * docs/03 defers a `notifications` collection with push. `useFriendRequests().incomingCount`
 * is a live subscription over the pending requests addressed to this user, so this number is
 * the notification: it appears the moment a request is sent and clears the moment it is
 * answered, on every device, with no second document to keep in step.
 */

import { useLocation } from 'react-router';
import { useFriendRequests } from '@splitsutra/core/hooks';
import { Text } from '../components/Text';
import { Pressable } from '../components/Pressable';
import { cx } from '../components/tokenProps';
import styles from './navigation.module.css';
import { TABS, isTabActive } from './paths';
import { TAB_ICONS } from './TabIcons';

export function TabBar() {
  const { pathname } = useLocation();
  const { incomingCount } = useFriendRequests();

  return (
    <nav className={styles.tabBar} aria-label="Main">
      {TABS.map((tab) => {
        const Icon = TAB_ICONS[tab.key];
        const active = isTabActive(tab, pathname);

        if (tab.raised) {
          return (
            <Pressable
              key={tab.key}
              to={tab.path}
              label="Add an expense"
              className={styles.tabRaised}
            >
              <Icon />
            </Pressable>
          );
        }

        // Only Friends carries a count today. Written as a per-tab lookup rather than an
        // `if (tab.key === 'friends')` so Activity can join it without restructuring the row.
        const badge = tab.key === 'friends' ? incomingCount : 0;

        return (
          <Pressable
            key={tab.key}
            to={tab.path}
            className={cx(styles.tab, active && styles.tabActive)}
            aria-current={active ? 'page' : undefined}
            label={
              badge > 0
                ? `${tab.label}, ${badge} pending ${badge === 1 ? 'request' : 'requests'}`
                : undefined
            }
          >
            <span className={styles.tabIconWrap}>
              <Icon className={styles.tabIcon} />
              {badge > 0 && (
                <span className={styles.tabBadge} aria-hidden="true">
                  {badge > 9 ? '9+' : badge}
                </span>
              )}
            </span>
            <Text as="span" className={styles.tabLabel}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </nav>
  );
}
