'use client';

import { ForcePasswordChange } from '@/modules/identity/client';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import EhrTopRail from '@/components/ehr/EhrTopRail';
import RoleGuard from '@/components/RoleGuard';
import { SettingsProvider } from '@/lib/settings/SettingsProvider';
import PreferenceEffects from '@/components/PreferenceEffects';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import LockScreen, { PIN_SETUP_DISMISSED_KEY, shouldPromptPinSetup } from '@/components/LockScreen';
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
  const { isLocked, hasPin, lockEnabled, pinSupported, unlock, verifyPin, setPin } = useAutoLock(
    isAuthenticated, orgTimeout, platformPolicy.sessionTimeoutMinutes, platformPolicy,
  );
  // First-run PIN prompt: shown once per device after sign-in when the session
  // WILL lock but no PIN exists to unlock it with. This is what keeps the lock
  // screen's digit pad reachable outside demo mode — the lock overlay itself
  // refuses PIN *creation* (see LockScreen), so the only safe moment to offer
  // it is right here, while the user has just proven who they are.
  const [pinSetupDismissed, setPinSetupDismissed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try { return localStorage.getItem(PIN_SETUP_DISMISSED_KEY) === '1'; } catch { return true; }
  });
  const dismissPinSetup = useCallback(() => {
    setPinSetupDismissed(true);
    try { localStorage.setItem(PIN_SETUP_DISMISSED_KEY, '1'); } catch { /* best-effort */ }
  }, []);
  const showPinSetup = shouldPromptPinSetup({
    isAuthenticated,
    isLocked,
    lockEnabled,
    hasPin,
    pinSupported,
    dismissed: pinSetupDismissed,
    // In demo/dev the lock overlay offers first-lock setup itself (allowSetup
    // below) — a second interstitial here would also break every fresh-profile
    // login the demo automation drives.
    lockOverlayOffersSetup: process.env.NEXT_PUBLIC_DEMO_MODE === 'true',
  });
  const isMobile = useIsMobileViewport();
  const mobileArchetype = currentUser ? getMobileShellArchetype(currentUser.role) : undefined;
  const useShell = isMobile && !!mobileArchetype;

  /**
   * "Switch User" on the lock screen. The overlay has no password field of
   * its own, so this is the whole re-authentication path: end the session and
   * go to /login, where signing in is already a solved, audited flow.
   *
   * The push is explicit rather than left to the `!isAuthenticated` effect
   * below. `logout()` starts a long best-effort teardown (sync manager,
   * IndexedDB wipe); if `dbReady` drops while that runs, that effect's guard
   * never passes and the locked user is left on the loading spinner.
   */
  const switchUser = useCallback(() => {
    logout();
    router.push('/login');
  }, [logout, router]);

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
          pinSupported={pinSupported}
          /* Demo/dev only: let a PIN-less locked session set a PIN here and
             unlock. Production keeps the secure "set it in Settings" rule. */
          allowSetup={process.env.NEXT_PUBLIC_DEMO_MODE === 'true'}
          onVerifyPin={verifyPin}
          onSetPin={setPin}
          onUnlock={unlock}
          onLogout={switchUser}
        />
      )}
      {showPinSetup && currentUser && (
        <LockScreen
          variant="setup"
          userName={currentUser.name}
          hasPin={false}
          pinSupported={pinSupported}
          onVerifyPin={verifyPin}
          onSetPin={setPin}
          /* Setting a PIN flips hasPin and unmounts this; marking it dismissed
             too keeps the prompt from returning if the PIN is later cleared in
             Settings — that was a deliberate choice, not a fresh device. */
          onUnlock={dismissPinSetup}
          onDismiss={dismissPinSetup}
          onLogout={dismissPinSetup}
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
