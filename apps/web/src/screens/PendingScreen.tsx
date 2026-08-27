/**
 * The placeholder every route renders until its real screen is written.
 *
 * This exists so the route table can be COMPLETE before the screens are. `paths.ts` says a
 * missing screen should be a compile error, and that only holds if every `ScreenName` maps
 * to something — otherwise routes get added one at a time alongside their screens, and the
 * gaps are invisible until someone navigates into one and gets a blank page.
 *
 * It names the screen it is standing in for, so an unfinished route is obvious in the app
 * rather than looking like a rendering bug.
 *
 * TODO: delete this file. Each screen that lands should remove its own entry from the
 * pending set in `routes.tsx`; when the set is empty, this goes with it.
 */

import { Button } from '../components/Button';
import { EmptyState } from '../components/EmptyState';
import { Screen } from '../components/Layout';
import { ScreenHeader } from '../navigation/ScreenHeader';
import { paths, type ScreenName } from '../navigation/paths';

export interface PendingScreenProps {
  screen: ScreenName;
}

export function PendingScreen({ screen }: PendingScreenProps) {
  return (
    <Screen header={<ScreenHeader title={screen} />} label={screen}>
      <EmptyState
        glyph="🚧"
        title={`${screen} isn't built yet`}
        body="The navigation shell and design system are in place. This screen's content is still to come."
        action={<Button to={paths.GroupList()}>Back to groups</Button>}
      />
    </Screen>
  );
}
