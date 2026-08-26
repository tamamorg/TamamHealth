'use client';

import type { ReactNode } from 'react';
import { WifiOff } from '@/components/icons/lucide';
import { useAuth, useSync } from '@/lib/context';
import { getRoleConfig } from '@/lib/permissions';
import { useMobileShellState } from '@/lib/mobile-shell/use-mobile-shell-state';
import type { MobileDashboardArchetype } from '@/lib/mobile-shell/dashboard-strategy';
import MobileHeader from './MobileHeader';
import MobileTabBar from './MobileTabBar';
import MobileDashboardView from './dashboard/MobileDashboardView';
import MobilePatientsView from './patients/MobilePatientsView';
import MobileChartDrillIn from './patients/MobileChartDrillIn';
import MobileCalendarView from './calendar/MobileCalendarView';
import MobileInboxView from './inbox/MobileInboxView';
import MobileQuickCreateSheet from './sheets/MobileQuickCreateSheet';
import MobileModulesSheet from './sheets/MobileModulesSheet';

interface MobileAppShellProps {
  archetype: MobileDashboardArchetype;
  children: ReactNode;
}

export default function MobileAppShell({ archetype, children }: MobileAppShellProps) {
  const { currentUser } = useAuth();
  const { isOnline } = useSync();
  const shell = useMobileShellState();
  const roleConfig = currentUser ? getRoleConfig(currentUser.role) : undefined;
  const allowedRoutes = roleConfig?.allowedRoutes || [];
  const homeHref = roleConfig?.defaultDashboard || '/dashboard';

  let body: ReactNode;
  if (shell.tab === 'dashboard') {
    body = <MobileDashboardView archetype={archetype} />;
  } else if (shell.tab === 'patients') {
    body = <MobilePatientsView />;
  } else if (shell.tab === 'calendar') {
    body = <MobileCalendarView />;
  } else if (shell.tab === 'inbox') {
    body = <MobileInboxView />;
  } else {
    // Any route outside the shell's 4 tabs (settings, consultation, etc.)
    // renders the real desktop page, CSS-responsive as it is today, inside
    // the shell's header/tab-bar chrome for navigational consistency.
    body = children;
  }

  return (
    <div className="mobile-shell">
      {!isOnline && (
        <div className="mobile-shell-offline-banner" role="status">
          <WifiOff className="w-4 h-4" />
          <span>Working offline — changes sync when connection returns.</span>
        </div>
      )}
      {shell.chartId ? (
        <MobileChartDrillIn patientId={shell.chartId} onClose={shell.closeChart} />
      ) : (
        <>
          <MobileHeader onOpenModules={() => shell.openSheet('modules')} />
          <main className="mobile-shell-body">{body}</main>
          <MobileTabBar
            activeTab={shell.tab}
            homeHref={homeHref}
            allowedRoutes={allowedRoutes}
            onOpenCreate={() => shell.openSheet('create')}
          />
        </>
      )}
      <MobileQuickCreateSheet open={shell.overlay === 'create'} onClose={shell.closeSheet} />
      <MobileModulesSheet open={shell.overlay === 'modules'} onClose={shell.closeSheet} />
    </div>
  );
}
