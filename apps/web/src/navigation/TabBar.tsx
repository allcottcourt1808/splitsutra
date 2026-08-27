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
 */

import { useLocation } from 'react-router';
import { Text } from '../components/Text';
import { Pressable } from '../components/Pressable';
import { cx } from '../components/tokenProps';
import styles from './navigation.module.css';
import { TABS, isTabActive } from './paths';
import { TAB_ICONS } from './TabIcons';

export function TabBar() {
  const { pathname } = useLocation();

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

        return (
          <Pressable
            key={tab.key}
            to={tab.path}
            className={cx(styles.tab, active && styles.tabActive)}
            aria-current={active ? 'page' : undefined}
          >
            <Icon className={styles.tabIcon} />
            <Text as="span" className={styles.tabLabel}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </nav>
  );
}
