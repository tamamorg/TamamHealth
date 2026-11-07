'use client';

/**
 * Staff sign-in, drawn in the marketing site's login language
 * (tamamhealth.org/login): centred logo bar, a two-column body with the form
 * on the left and a blueprint product panel on the right, square-cornered
 * fields with registration marks, and the site's Barlow typography (loaded by
 * this route's layout).
 *
 * The look is the website's; the behaviour is the platform's. This page holds
 * a real session — the site's copy is a mock that only flips a success line —
 * so the fields are the ones auth actually needs (username and password) and
 * every state the platform has (offline-database boot, error and loading)
 * keeps working.
 *
 * Credentials only (2026-11-06, user: "we dont need the role for login just
 * the credentials"). A Role field used to sit between the two; everyone but
 * the super-admin could only ever pick their own role, so for nearly every
 * user it was a question with one right answer. The account decides the
 * workspace. The super-admin reaches every other workspace from its own nav
 * (WORKSPACES), so nothing was lost with it. Which door someone came through
 * is chosen before this page, on the welcome page at `/`.
 */

import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/context';
import { resolveLandingPage } from '@/lib/user-prefs';
import { canRedirectAfterSignIn, resolveNextPath } from '@/lib/navigation/login-redirect';
import { ROLE_LABEL } from '@/lib/role-display';
import { canonicalizeUserRole } from '@/lib/user-role';
import type { UserRole } from '@/lib/db-types';
import { useTranslation } from '@/lib/i18n/useTranslation';
import { Corners } from '@/components/login/login-chrome';
import { portalFromParam, shotForPortal, DEFAULT_PORTAL, type LoginPortal } from '@/components/login/portal-imagery';
import { FormError } from '@/components/overlay/FormNotices';

/** What the heading says for each door the welcome page offers. */
const DOOR_COPY: Record<LoginPortal, { eyebrowKey: string; ledeKey: string }> = {
  staff: { eyebrowKey: 'welcome.staffTitle', ledeKey: 'login.subheadingIssued' },
  ministry: { eyebrowKey: 'welcome.ministryTitle', ledeKey: 'login.subheadingMinistry' },
  admin: { eyebrowKey: 'login.doorAdmin', ledeKey: 'login.subheadingAdmin' },
};

/**
 * One seeded demo account, as `/api/demo-credentials` returns it. The roster
 * and its passwords are per-deployment state fetched at runtime — nothing
 * here is hard-coded, and the route answers only on a standalone demo (see
 * `isStandaloneDemo` in lib/server-users.ts), so a real deployment renders
 * the product panel instead.
 */
interface DemoAccount {
  username: string;
  password: string;
  name: string;
  role: string;
  facility?: string;
  orgId?: string;
}

/** The heading an account is filed under: its facility, or the body it works
 *  for when it has none (org admins, the ministry, the platform operator). */
function demoGroupName(account: DemoAccount): string {
  if (account.facility) return account.facility;
  if (account.orgId === 'org-moh-ss') return 'Ministry of Health';
  return 'Platform';
}

export default function LoginPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { login, logout, lastLoginFailure, isAuthenticated, currentUser, sessionMode, dbReady } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  /** The sign-in RESOLVED. Distinct from `loading`, which stays true through
   *  the redirect so the button never flashes back to "Log in". */
  const [signedIn, setSignedIn] = useState(false);
  const [keepSignedIn, setKeepSignedIn] = useState(true);
  // Demo-only account picker. The build-time flag decides whether to ASK;
  // the answer decides whether to show anything, so a deployment where the
  // route declines (it has a users database) keeps the product panel.
  /* Which of the site's four doors this visit came through (`?portal=`).
     The photograph beside the form answers it — a ministry official and a
     platform operator both used to land on a picture of clinical work. */
  const [portalParam, setPortal] = useState<LoginPortal | null>(null);
  /* null until the address bar has been read after hydration. The photograph
     can show the staff picture meanwhile; the door line above the form cannot,
     or a console or ministry visitor reads "issued by your facility
     administrator" for a moment first. */
  const portal = portalParam ?? DEFAULT_PORTAL;
  const portalKnown = portalParam !== null;
  /* Set when someone signed in already asks for a different account. Without
     it this page bounced any existing session straight to its dashboard, so
     "sign in as someone else" was impossible — you were returned to whoever
     was signed in last, whichever account you had clicked. */
  const [switching, setSwitching] = useState(false);
  const demoEnabled = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';
  const [demoAccounts, setDemoAccounts] = useState<DemoAccount[]>([]);
  // Second-factor step. The password has been accepted and the server is
  // holding a five-minute hand-off token; nothing is signed in yet.

  // Username handed over from the marketing site's login (?u=). Read from
  // window rather than useSearchParams — the same pattern the patients and
  // appointments pages use for their deep links, and it keeps this route out
  // of a Suspense boundary. Only the username ever travels, never a password,
  // and the param is stripped once read so it does not linger in the address
  // bar, history or a referrer header.
  // Text can reach these fields before React hydrates — a password manager
  // autofilling, or someone typing while "Initializing offline database…" is
  // still up. Those writes land straight on the DOM node, so `username` and
  // `password` never see them, and hydration does not clear the visible text.
  // The form then looks filled while submit posts empty strings, which the API
  // rejects with "Username and password are required". Adopt whatever the DOM
  // already holds, once, on mount.
  const nameInputRef = useRef<HTMLInputElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const preHydrationName = nameInputRef.current?.value;
    const preHydrationPassword = passwordInputRef.current?.value;
    if (preHydrationName) setUsername(prev => prev || preHydrationName);
    if (preHydrationPassword) setPassword(prev => prev || preHydrationPassword);
  }, []);

  /* `?portal=` stays in the address bar — unlike `?u=` below it carries
     nothing private, and a refresh should reopen the same door. */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPortal(portalFromParam(new URLSearchParams(window.location.search).get('portal')));
  }, []);

  const handedOffRef = useRef(false);
  useEffect(() => {
    if (typeof window === 'undefined' || handedOffRef.current) return;
    const params = new URLSearchParams(window.location.search);
    const handed = params.get('u');
    if (!handed) return;
    handedOffRef.current = true;
    setUsername(handed.slice(0, 64));
    params.delete('u');
    const qs = params.toString();
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? `?${qs}` : ''));
  }, []);

  // Passwords are minted per deployment; pull them once per load rather than
  // shipping any in the bundle.
  useEffect(() => {
    if (!demoEnabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/demo-credentials', { cache: 'no-store' });
        if (!res.ok) return;
        const body = await res.json() as { profiles?: DemoAccount[] };
        if (!cancelled) setDemoAccounts(body.profiles ?? []);
      } catch {
        // The picker is a convenience — the manual form still signs in.
      }
    })();
    return () => { cancelled = true; };
  }, [demoEnabled]);

  // Grouped by facility, in the order the roster lists them, so every seeded
  // account is on screen and each facility's staff stay together.
  const demoGroups = useMemo(() => {
    const order: string[] = [];
    const byGroup = new Map<string, DemoAccount[]>();
    for (const account of demoAccounts) {
      const group = demoGroupName(account);
      if (!byGroup.has(group)) { byGroup.set(group, []); order.push(group); }
      byGroup.get(group)!.push(account);
    }
    return order.map(name => ({ name, accounts: byGroup.get(name)! }));
  }, [demoAccounts]);

  /* A session that is already live goes to its dashboard — but NOT while a
     sign-in is in flight, and not once the visitor has said they want a
     different account. Both exceptions are the same bug: this effect fired on
     the OLD identity and pushed you into the old workspace, cancelling the
     login you had just started.

     `signedIn` is what ends the first exception. `loading` alone used to gate
     it, and `loading` is never cleared on a SUCCESSFUL sign-in — the handler
     returns early and lets this effect do the navigating — so the guard it
     was waiting on could never lift. The form sat on "Signing in…" forever
     with a live session behind it, and only a manual refresh (a fresh mount,
     `loading` back to false) ever reached the dashboard. The guard's real
     subject was never "is a request in flight" but "is `currentUser` still
     the OLD identity", and once the sign-in has RESOLVED it is not. */
  useEffect(() => {
    if (!canRedirectAfterSignIn({
      loading, signedIn, switching, isAuthenticated, hasUser: !!currentUser,
    })) return;
    // `apiFetch` sends an expired session here as `/login?next=<path>` so a
    // resumed sign-in can return to the page it was bounced from. Accepted
    // only when `resolveNextPath` clears it — a same-origin relative path
    // this role may actually open — otherwise the role's normal landing page.
    const nextParam = typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search).get('next')
      : null;
    const landing = resolveNextPath(nextParam, currentUser!.role) ?? resolveLandingPage(currentUser!.role);
    if (sessionMode === 'offline') {
      // A document navigation lets the service worker serve the verified HTML
      // route. A Next soft navigation needs an RSC network response and can
      // otherwise strand a successful offline sign-in on this page.
      window.location.assign(landing);
    } else {
      router.push(landing);
    }
  }, [isAuthenticated, currentUser, sessionMode, router, loading, signedIn, switching]);

  /**
   * Name the actual refusal. Every failed sign-in used to read "Invalid
   * credentials", so a stopped database or a lockout sent people back to
   * retyping a password that was already correct.
   */
  const describeLoginFailure = (fallback: string) => {
    const failure = lastLoginFailure();
    if (!failure) return fallback;

    // Codes first. A code is the most specific thing the refusal could tell us,
    // and unlike a status it says *why* rather than merely which layer said no.
    // Two of these never involve the network at all.
    switch (failure.code) {
      // Policy: the password was already verified before these were decided.
      case 'impersonation_disabled': return t('login.errorImpersonationDisabled');
      case 'role_not_permitted': return t('login.errorRoleNotPermitted');
      // Offline: the request never left the device.
      case 'offline_no_credential': return t('login.errorOfflineNoCredential');
      case 'offline_bad_password': return t('login.errorOfflineBadPassword');
      default: break;
    }

    if (failure.status === 429) {
      const minutes = failure.retryAfterSeconds ? Math.ceil(failure.retryAfterSeconds / 60) : 0;
      return minutes > 0
        ? t('login.errorTooManyAttemptsIn', { minutes })
        : t('login.errorTooManyAttempts');
    }
    if (failure.status >= 500) return t('login.errorServiceUnavailable');
    // An unrecognised 403 still beats the credentials message: the server's own
    // prose is at least about the real reason, even if it is untranslated.
    if (failure.status === 403 && failure.message) return failure.message;
    return fallback;
  };

  /** One tap = filled form + signed in, so a demo never stalls on a password. */
  const signInAsDemo = async (account: DemoAccount) => {
    setUsername(account.username);
    setPassword(account.password);
    setError('');
    setLoading(true);
    try {
      // Whoever is signed in now is not who was just asked for. Drop that
      // session first, so the new credentials are the only ones in play.
      if (isAuthenticated) logout();
      const result = await login(account.username, account.password, undefined, undefined, keepSignedIn);
      if (result) { setSignedIn(true); return; }
      else { setError(describeLoginFailure('That demo account could not sign in.')); setLoading(false); }
    } catch { setError(t('login.errorLoginFailed')); setLoading(false); }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (isAuthenticated) logout();
      const result = await login(username, password, undefined, undefined, keepSignedIn);
      if (result) { setSignedIn(true); return; }

      setError(describeLoginFailure(t('login.errorInvalidCredentials')));
      setLoading(false);
    } catch { setError(t('login.errorLoginFailed')); setLoading(false); }
  };

  /* Signed in already and not switching: this is the redirect on its way
     out, so it says whose session it is. `switching` skips it entirely and
     drops through to the form below. */
  if (isAuthenticated && !switching && !loading) {
    return (
      <div className="lg-redirect">
        <span className="lg-redirect-mark" />
        <p>{t('login.redirectingDashboard')}</p>
        {currentUser && (
          <p className="lg-redirect-who">{t('login.signedInAs', { name: currentUser.name || currentUser.username })}</p>
        )}
        <button
          type="button"
          className="lg-redirect-switch"
          onClick={() => { setSwitching(true); logout(); }}
        >
          {t('login.useDifferentAccount')}
        </button>
      </div>
    );
  }

  return (
    <div className="lg-root">
      {/* ── Logo bar ── */}
      <header className="lg-topbar">
        {/* Home is the welcome page, where the door (staff, ministry,
            patient) is chosen; tamamhealth.org stays in the footer. */}
        <Link href="/" className="lg-topbar-link">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed-height SVG logo */}
          <img src="/assets/tamamhealth-logo-full.svg" alt={t('ui.tamamHealthcareSystem')} className="lg-topbar-logo" />
        </Link>
      </header>

      <div className="lg-grid">
        {/* ── Left: the form ── */}
        <div className="lg-col">
          {/* The door chosen on the welcome page, named above the form, and
              who issues that kind of account. Without it the facility and
              ministry cards led to one identical page, and a ministry
              official read that a facility administrator issued their
              password. The form itself is the same for every door: the
              account decides the workspace. */}
          <div>
            <span className="lg-eyebrow" style={portalKnown ? undefined : { visibility: 'hidden' }}>
              {t(DOOR_COPY[portal].eyebrowKey)}
            </span>
            <h1 className="lg-h1">{t('login.logIn')}</h1>
            <p className="lg-lede" style={portalKnown ? undefined : { visibility: 'hidden' }}>
              {t(DOOR_COPY[portal].ledeKey)}
            </p>
          </div>

          {/* Informational only. This used to also DISABLE the submit button,
              which held every sign-in hostage to the demo seed finishing —
              41 measured seconds on a fresh device — even though sign-in is
              server-first and reads none of what was being written. Only the
              offline fallback needs the local store, and its own error copy
              already explains that case. */}
          {!dbReady && (
            <div className="lg-boot"><span className="lg-spin" /> {t('login.initializingOffline')}</div>
          )}

          <form onSubmit={handleSubmit} className="lg-form">
            <div className="lg-field">
              <label htmlFor="tl-name">{t('login.usernameLabel')}</label>
              <input
                id="tl-name"
                ref={nameInputRef}
                type="text"
                className="lg-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('ui.eGDeskAmira')}
                autoComplete="username"
              />
            </div>

            <div className="lg-field">
              <label htmlFor="tl-password">{t('login.passwordLabel')}</label>
              <div className="lg-inputwrap">
                <input
                  id="tl-password"
                  ref={passwordInputRef}
                  type={showPassword ? 'text' : 'password'}
                  className="lg-input lg-input--bare"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="lg-eye"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6-10-6-10-6Z" /><circle cx="12" cy="12" r="2.6" />
                  </svg>
                </button>
              </div>
            </div>


            <label className="lg-keep">
              <input type="checkbox" checked={keepSignedIn} onChange={(e) => setKeepSignedIn(e.target.checked)} />
              {t('login.keepSignedIn')}
            </label>

            {error && <FormError message={error} />}

            <button type="submit" disabled={loading} className="lg-btn blueprint">
              {loading ? t('login.signingIn') : t('login.logIn')}
              <Corners />
            </button>
          </form>

          <div className="lg-links">
            <a href="/patient-portal">{t('login.patientPortal')}</a>
            {/* The string for this existed in both locales from the day the
                login page shipped and was rendered nowhere, because there was
                no flow behind it: every forgotten password was an
                administrator reset and a credential read down a phone line. */}
            <a href="/forgot-password">{t('login.forgotPassword')}</a>
          </div>

          <span className="lg-note">
            {t('login.offlineNote')}
          </span>

        </div>

        {/* ── Right: the seeded roster on a standalone demo, the product
              panel everywhere else. A sign-in page does not offer working
              credentials to whoever loads it — but the demo deployment has no
              users database, no CouchDB and no real patients, and its whole
              purpose is to be walked through without asking anyone for a
              login. `/api/demo-credentials` decides which deployment this is;
              a server that could authenticate a real account returns nothing
              and this column stays a product panel. */}
        {demoGroups.length > 0 ? (
          <aside className="lg-demo blueprint" aria-labelledby="lg-demo-title">
            <Corners />
            <h2 id="lg-demo-title">{t('ui.chooseADemoAccount')}</h2>
            <p>{t('ui.oneTapSignsYouIn')}</p>
            {/* Same picture as the product panel: which door this is, not
                which of the seeded accounts the pointer is over. */}
            <div className="lg-demo-shot blueprint">
              <Corners />
              {/* eslint-disable-next-line @next/next/no-img-element -- photograph, cropped by CSS */}
              <img src={shotForPortal(portal).src} alt={t(shotForPortal(portal).altKey)} />
            </div>
            <div className="lg-demo-scroll">
              {demoGroups.map(group => (
                <div className="lg-demo-group" key={group.name}>
                  <p className="lg-demo-group-name">{group.name}</p>
                  <div className="lg-demo-rows">
                    {group.accounts.map(account => (
                      <button
                        key={account.username}
                        type="button"
                        className="lg-demo-row"
                        disabled={loading}
                        onClick={() => signInAsDemo(account)}
                      >
                        <span className="lg-demo-role">{ROLE_LABEL[canonicalizeUserRole(account.role as UserRole)]}</span>
                        <span className="lg-demo-name">{account.name}</span>
                        <span className="lg-demo-user">{account.username}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </aside>
        ) : (
        <aside className="lg-aside blueprint">
          <Corners />
          <span className="lg-eyebrow">{t('login.tagline')}</span>
          <h2 className="lg-h2">{t('login.promoHeadline')}</h2>
          <p className="lg-aside-copy">
            {t('login.promoBody')}
          </p>
          <a className="lg-aside-link" href="https://tamamhealth.org/products">{t('login.seeProducts')} &nbsp;›</a>
          {/* The picture answers which door this is — staff, ministry, or the
              platform console — not which role the form has selected. */}
          <div className="lg-shot blueprint">
            <Corners />
            {/* eslint-disable-next-line @next/next/no-img-element -- photograph, cropped by CSS */}
            <img src={shotForPortal(portal).src} alt={t(shotForPortal(portal).altKey)} />
          </div>
        </aside>
        )}
      </div>

      <footer className="lg-footer">
        <a href="/terms">{t('login.termsAndConditions')}</a>
        <a href="/privacy">{t('login.privacyPolicy')}</a>
        <a href="https://tamamhealth.org">{t('login.backToSite')}</a>
      </footer>

    </div>
  );
}
