'use client';

import { ForcePasswordChange } from '@/modules/identity/client';
import { Suspense, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import EhrTopRail from '@/components/ehr/EhrTopRail';
import RoleGuard from '@/components/RoleGuard';
import { SettingsProvider } from '@/lib/settings/SettingsProvider';
import PreferenceEffects from '@/components/PreferenceEffects';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import LockScreen from '@/components/LockScreen';
import ConnectivityNotice from '@/components/ConnectivityNotice';

import { TourProvider } from '@/lib/tour/tour-context';
import GetStartedCard from '@/components/onboarding/GetStartedCard';

import { useAutoLock } from '@/lib/hooks/useAutoLock';
import { Loader2 } from '@/components/icons/lucide';
import { useIsMobileViewport } from '@/lib/hooks/useIsMobileViewport';
import { getMobileShellArchetype } from '@/lib/mobile-shell/dashboard-strategy';
import MobileAppShell from '@/components/mobile/MobileAppShell';
import UsageTracker from '@/components/UsageTracker';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import RouteContextBar from '@/components/navigation/RouteContextBar';
import { ConsoleTrailProvider } from '@/components/navigation/ConsoleTrail';
import { MessagingDock, MessagingDockProvider } from '@/modules/communication/client';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { isAuthenticated, currentUser, dbReady, logout, platformPolicy } = useAuth();
  const orgTimeout = currentUser?.organization?.lockTimeoutMinutes;
  // The platform's own idle policy is a ceiling over the facility/org/user
  // chain — see useAutoLock. It was displayed on /admin/security and read by
  // nothing until this was wired.
  const { isLocked, hasPin, unlock, verifyPin, setPin } = useAutoLock(
    isAuthenticated, orgTimeout, platformPolicy.sessionTimeoutMinutes,
  );
  const isMobile = useIsMobileViewport();
  const mobileArchetype = currentUser ? getMobileShellArchetype(currentUser.role) : undefined;
  const useShell = isMobile && !!mobileArchetype;

  useEffect(() => {
    if (dbReady && !isAuthenticated) {
      router.push('/login');
    }
  }, [isAuthenticated, dbReady, router]);

  if (!dbReady || !isAuthenticated) {
    return (
      <div className="flex items-center justify-center min-h-screen tamam-solid-bg">
        <div className="flex flex-col items-center gap-4 relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/logos/SVG/Tamam_Style_Guide-33.svg" alt="TamamHealth" className="w-14 h-14" />
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-primary)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>Loading TamamHealth...</p>
          </div>
        </div>
      </div>
    );
  }

  // Force a password change before any app content when the account is still on
  // an admin-issued temporary credential (freshly created or reset).
  //
  // Mirrored by a 403 at the Edge proxy, so this gate is what the user SEES
  // rather than what stops them: a client-only gate blocks browsing and
  // nothing else, which is exactly what `mustChangePassword` did for a year
  // while the session drove /api/* perfectly well.
  if (currentUser?.mustChangePassword) {
    return <ForcePasswordChange userName={currentUser.name} onLogout={logout} />;
  }

  return (
    <SettingsProvider>
    <MessagingDockProvider>
    <TourProvider>
    <ConfirmProvider>
    {/* The record-aware breadcrumb. Wraps BOTH the bar and the pages, so a
        page deep in the organization → facility → person chain can publish a
        trail the shared bar above it renders. */}
    <ConsoleTrailProvider>
    <div className="flex h-screen overflow-hidden tamam-solid-bg tamam-ehr-app">
      {isLocked && currentUser && (
        <LockScreen
          userName={currentUser.name}
          hasPin={hasPin}
          onVerifyPin={verifyPin}
          onSetPin={setPin}
          onUnlock={unlock}
          onLogout={logout}
        />
      )}
      <a href="#main-content" className="skip-link">Skip to main content</a>
      {useShell ? (
        <MobileAppShell archetype={mobileArchetype!}>
          <RoleGuard>{children}</RoleGuard>
        </MobileAppShell>
      ) : (
        <>
          <EhrTopRail />
          <div
            className="flex-1 flex flex-col min-w-0 overflow-hidden relative z-10 transition-all duration-300 ease-in-out tamam-ehr-content-frame"
          >
            <div className="dashboard-content-area flex-1 flex flex-col min-w-0 overflow-hidden">
              <Suspense fallback={null}>
                <RouteContextBar />
              </Suspense>
              <main id="main-content" className="relative flex-1 flex flex-col min-w-0 overflow-hidden">
                <RoleGuard>{children}</RoleGuard>
                <GetStartedCard />
              </main>
            </div>
          </div>
        </>
      )}
      <PreferenceEffects />
      <KeyboardShortcuts />
      <ConnectivityNotice />
      {/* The floating bottom-right messages launcher (restored — removed in
          da19f4d6). Desktop only: it collides with the mobile shell's tab
          bar, where the Inbox tab is the messaging entry point instead. */}
      {!useShell && <MessagingDock />}
      <UsageTracker />
    </div>
    </ConsoleTrailProvider>
    </ConfirmProvider>
    </TourProvider>
    </MessagingDockProvider>
    </SettingsProvider>
  );
}
