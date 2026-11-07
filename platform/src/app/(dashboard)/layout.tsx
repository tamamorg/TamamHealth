'use client';

import { ForcePasswordChange } from '@/modules/identity/client';
import { Suspense, useCallback, useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isManagementSurface } from '@/lib/navigation/management-surface';
import { useAuth } from '@/lib/context';
import { setAuditActor } from '@/lib/services/audit-service';
import EhrTopRail from '@/components/ehr/EhrTopRail';
import RoleGuard from '@/components/RoleGuard';
import { SettingsProvider } from '@/lib/settings/SettingsProvider';
import PreferenceEffects from '@/components/PreferenceEffects';
import KeyboardShortcuts from '@/components/KeyboardShortcuts';
import LockScreen, { shouldPromptPinSetup } from '@/components/LockScreen';
import ConnectivityNotice from '@/components/ConnectivityNotice';

import { TourProvider } from '@/lib/tour/tour-context';

import { useAutoLock } from '@/lib/hooks/useAutoLock';
import { Loader2 } from '@/components/icons/lucide';
import { useIsMobileViewport } from '@/lib/hooks/useIsMobileViewport';
import { getMobileShellArchetype } from '@/lib/mobile-shell/dashboard-strategy';
import MobileAppShell from '@/components/mobile/MobileAppShell';
import UsageTracker from '@/components/UsageTracker';
import { ConfirmProvider } from '@/components/ConfirmDialog';
import RouteContextBar from '@/components/navigation/RouteContextBar';
import { ConsoleTrailProvider } from '@/components/navigation/ConsoleTrail';
import { MessagingDock, MessagingDockProvider, PatientTextOutbox } from '@/modules/communication/client';
import NavHistoryTracker from '@/components/navigation/NavHistoryTracker';
import RouteMotion from '@/components/motion/RouteMotion';
import TableSortEnhancer from '@/components/table/TableSortEnhancer';
import PageDraftKeeper from '@/components/unsaved/PageDraftKeeper';
import { useTranslation } from '@/lib/i18n/useTranslation';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const router = useRouter();
  const pathname = usePathname();
  const { isAuthenticated, currentUser, dbReady, logout, platformPolicy } = useAuth();
  // Management modules wear the patient chart's frame (app/management-frame.css).
  const managementSurface = isManagementSurface(pathname, currentUser?.role);
  // Audit rows written from this browser are filed under the signed-in user's
  // organisation and facility, or they never replicate to the server — see
  // `setAuditActor`. Cleared on sign-out so the next person on a shared
  // device does not inherit the last one's identity.
  const auditUserId = currentUser?._id;
  const auditUsername = currentUser?.username;
  // A super-admin signed in as a nurse is still a super-admin acting.
  const auditRole = currentUser?.actualRole || currentUser?.role;
  const auditOrgId = currentUser?.orgId;
  const auditHospitalId = currentUser?.hospitalId;
  useEffect(() => {
    setAuditActor(isAuthenticated && auditUserId ? {
      userId: auditUserId, username: auditUsername, role: auditRole, orgId: auditOrgId, hospitalId: auditHospitalId,
    } : null);
    return () => setAuditActor(null);
  }, [isAuthenticated, auditUserId, auditUsername, auditRole, auditOrgId, auditHospitalId]);
  const orgTimeout = currentUser?.organization?.lockTimeoutMinutes;
  // The platform's own idle policy is a ceiling over the facility/org/user
  // chain — see useAutoLock. It was displayed on /admin/security and read by
  // nothing until this was wired.
  const { isLocked, hasPin, lockEnabled, pinSupported, unlock, verifyPin, setPin } = useAutoLock(
    isAuthenticated, orgTimeout, platformPolicy.sessionTimeoutMinutes, platformPolicy, currentUser?._id,
  );
  // First-run PIN prompt: shown after sign-in when the session
  // WILL lock but no PIN exists to unlock it with. This is what keeps the lock
  // screen's digit pad reachable outside demo mode — the lock overlay itself
  // refuses PIN *creation* (see LockScreen), so the only safe moment to offer
  // it is right here, while the user has just proven who they are.
  const showPinSetup = shouldPromptPinSetup({
    isAuthenticated,
    isLocked,
    lockEnabled,
    hasPin,
    pinSupported,
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
          <img src="/assets/logos/SVG/Tamam_Style_Guide-33.svg" alt={t('app.name')} className="w-14 h-14" />
          <div className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent-primary)' }} />
            <p className="text-sm font-medium" style={{ color: 'var(--text-muted)' }}>{t('ui.loadingTamamhealth')}</p>
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
          /* Setting a PIN flips hasPin and unmounts this prompt. A user may
             switch accounts, but cannot dismiss setup while auto-lock remains
             enabled: doing so creates a later lock screen with no PIN field. */
          onUnlock={unlock}
          onLogout={switchUser}
        />
      )}
      <a href="#main-content" className="skip-link">{t('ui.skipToMainContent')}</a>
      {/* Stamps each page's history entry, so every Back control can return
          to the screen the user came from (lib/navigation/nav-history.ts). */}
      <Suspense fallback={null}><NavHistoryTracker /></Suspense>
      {/* Route progress under the rail + the new screen fading in. */}
      <Suspense fallback={null}><RouteMotion /></Suspense>
      {/* Sortable column headers on every table and list (O3 header sort). */}
      <TableSortEnhancer />
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
              <main
                id="main-content"
                className="relative flex-1 flex flex-col min-w-0 overflow-hidden"
                data-surface={managementSurface ? 'management' : undefined}
              >
                <RoleGuard>{children}</RoleGuard>
                <PageDraftKeeper />
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
      <PatientTextOutbox />
      <UsageTracker />
    </div>
    </ConsoleTrailProvider>
    </ConfirmProvider>
    </TourProvider>
    </MessagingDockProvider>
    </SettingsProvider>
  );
}
